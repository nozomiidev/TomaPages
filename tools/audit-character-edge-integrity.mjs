import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 240,
  character: 'reimu',
  cols: 4,
  expectedFrames: 0,
  maxFrames: 12,
  maxOrphanWeakAlpha: 0,
  maxTransparentColored: 0,
  outputRoot: 'tmp/edge-audit',
  sourceRoot: 'public/characters',
  strongAlphaThreshold: 32,
  supportRadius: 2,
  weakAlphaThreshold: 32,
};

const COLORS = {
  edgeWeak: [250, 204, 21],
  orphanWeak: [217, 70, 239],
  transparentColored: [239, 68, 68],
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function resolveCharacterRoot(root, character) {
  const resolvedRoot = path.resolve(root);
  const nested = path.join(resolvedRoot, character);

  if (await exists(nested)) return nested;
  return resolvedRoot;
}

async function isDirectoryEntry(parentDir, entry) {
  if (entry.isDirectory()) return true;
  if (entry.isFile()) return false;

  try {
    return (await stat(path.join(parentDir, entry.name))).isDirectory();
  } catch {
    return false;
  }
}

async function isWebpFileEntry(parentDir, entry) {
  if (!entry.name.endsWith('.webp')) return false;
  if (entry.isFile()) return true;

  try {
    return (await stat(path.join(parentDir, entry.name))).isFile();
  } catch {
    return false;
  }
}

function componentList(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const components = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;

    const queue = [start];
    let area = 0;
    let maxX = 0;
    let maxY = 0;
    let minX = width;
    let minY = height;
    seen[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
        x > 0 && y > 0 ? index - width - 1 : -1,
        x + 1 < width && y > 0 ? index - width + 1 : -1,
        x > 0 && y + 1 < height ? index + width - 1 : -1,
        x + 1 < width && y + 1 < height ? index + width + 1 : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor >= 0 && mask[neighbor] && !seen[neighbor]) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    components.push({
      area,
      height: maxY - minY + 1,
      maxX,
      maxY,
      minX,
      minY,
      width: maxX - minX + 1,
    });
  }

  return components.sort((a, b) => b.area - a.area);
}

function hasStrongAlphaSupport(strongAlphaMask, width, height, x, y, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;

    for (let dx = -radius; dx <= radius; dx += 1) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      if (strongAlphaMask[yy * width + xx]) return true;
    }
  }

  return false;
}

function rowForComponents(row, key, components) {
  const largest = components[0] ?? { area: 0, height: 0, width: 0 };

  row[`${key}ComponentCount`] = components.length;
  row[`${key}LargestArea`] = largest.area;
  row[`${key}LargestWidth`] = largest.width;
  row[`${key}LargestHeight`] = largest.height;
}

async function auditFrame(file, relativeFile, options) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const strongAlphaMask = new Uint8Array(info.width * info.height);
  const edgeWeakMask = new Uint8Array(info.width * info.height);
  const orphanWeakMask = new Uint8Array(info.width * info.height);
  const transparentColoredMask = new Uint8Array(info.width * info.height);
  let weakAlphaPixels = 0;
  let edgeWeakAlphaPixels = 0;
  let orphanWeakAlphaPixels = 0;
  let transparentColoredPixels = 0;

  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha >= options.strongAlphaThreshold) strongAlphaMask[index] = 1;
  }

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];
    const isWeakAlpha = alpha > 0 && alpha < options.weakAlphaThreshold;

    if (alpha === 0 && (data[offset] || data[offset + 1] || data[offset + 2])) {
      transparentColoredMask[index] = 1;
      transparentColoredPixels += 1;
    }
    if (!isWeakAlpha) continue;

    weakAlphaPixels += 1;
    const x = index % info.width;
    const y = Math.floor(index / info.width);
    if (hasStrongAlphaSupport(
      strongAlphaMask,
      info.width,
      info.height,
      x,
      y,
      options.supportRadius,
    )) {
      edgeWeakMask[index] = 1;
      edgeWeakAlphaPixels += 1;
    } else {
      orphanWeakMask[index] = 1;
      orphanWeakAlphaPixels += 1;
    }
  }

  const row = {
    edgeWeakAlphaPixels,
    file: relativeFile,
    height: info.height,
    orphanWeakAlphaPixels,
    transparentColoredPixels,
    weakAlphaPixels,
    width: info.width,
  };
  rowForComponents(row, 'orphanWeakAlpha', componentList(orphanWeakMask, info.width, info.height));
  rowForComponents(
    row,
    'transparentColored',
    componentList(transparentColoredMask, info.width, info.height),
  );

  return {
    data,
    edgeWeakMask,
    info,
    orphanWeakMask,
    relativeFile,
    row,
    transparentColoredMask,
  };
}

async function scanFrames(options) {
  const frames = [];

  for (const sheetEntry of await readdir(options.characterRoot, { withFileTypes: true })) {
    const sheetRoot = path.join(options.characterRoot, sheetEntry.name);
    if (!await isDirectoryEntry(options.characterRoot, sheetEntry)) continue;

    for (const fileEntry of await readdir(sheetRoot, { withFileTypes: true })) {
      if (!await isWebpFileEntry(sheetRoot, fileEntry)) continue;

      const relativeFile = `${sheetEntry.name}/${fileEntry.name}`;
      frames.push(await auditFrame(
        path.join(sheetRoot, fileEntry.name),
        relativeFile,
        options,
      ));
    }
  }

  return frames.sort((a, b) => a.relativeFile.localeCompare(b.relativeFile));
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function maxBy(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key])[0] ?? { [key]: 0 };
}

function summarize(rows) {
  return {
    frameCount: rows.length,
    maxEdgeWeakAlphaPixels: maxBy(rows, 'edgeWeakAlphaPixels'),
    maxOrphanWeakAlphaPixels: maxBy(rows, 'orphanWeakAlphaPixels'),
    maxTransparentColoredPixels: maxBy(rows, 'transparentColoredPixels'),
    maxWeakAlphaPixels: maxBy(rows, 'weakAlphaPixels'),
  };
}

function selectOverlayFrames(frames, count) {
  const picked = new Map();
  const add = (items) => {
    for (const frame of items) {
      if (picked.size >= count) return;
      picked.set(frame.relativeFile, frame);
    }
  };
  const byMetric = (key) => [...frames]
    .filter((frame) => frame.row[key] > 0)
    .sort((a, b) => b.row[key] - a.row[key])
    .slice(0, count);

  add(byMetric('orphanWeakAlphaPixels'));
  add(byMetric('transparentColoredPixels'));
  add(byMetric('weakAlphaPixels'));
  add(frames);

  return [...picked.values()];
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function blendPixel(output, index, color, amount) {
  const offset = index * 4;
  output[offset] = Math.round(output[offset] * (1 - amount) + color[0] * amount);
  output[offset + 1] = Math.round(output[offset + 1] * (1 - amount) + color[1] * amount);
  output[offset + 2] = Math.round(output[offset + 2] * (1 - amount) + color[2] * amount);
  output[offset + 3] = 255;
}

function overlayFrame(frame) {
  const { data, info } = frame;
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3] / 255;
    output[offset] = Math.round(data[offset] * alpha + 248 * (1 - alpha));
    output[offset + 1] = Math.round(data[offset + 1] * alpha + 250 * (1 - alpha));
    output[offset + 2] = Math.round(data[offset + 2] * alpha + 252 * (1 - alpha));
    output[offset + 3] = 255;
  }

  for (let index = 0; index < frame.edgeWeakMask.length; index += 1) {
    if (frame.edgeWeakMask[index]) blendPixel(output, index, COLORS.edgeWeak, 0.7);
  }
  for (let index = 0; index < frame.orphanWeakMask.length; index += 1) {
    if (frame.orphanWeakMask[index]) blendPixel(output, index, COLORS.orphanWeak, 0.9);
  }
  for (let index = 0; index < frame.transparentColoredMask.length; index += 1) {
    if (frame.transparentColoredMask[index]) blendPixel(output, index, COLORS.transparentColored, 0.9);
  }

  return output;
}

async function labelTile(text, width, height) {
  return sharp({
    create: {
      background: { alpha: 1, b: 252, g: 250, r: 248 },
      channels: 4,
      height,
      width,
    },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
        + `<text x="6" y="20" font-family="Arial" font-size="13" fill="#111827">${escapeText(text)}</text>`
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderTile(frame, cellSize, labelHeight) {
  const image = await sharp(overlayFrame(frame), {
    raw: {
      channels: 4,
      height: frame.info.height,
      width: frame.info.width,
    },
  })
    .resize(cellSize, cellSize, { fit: 'contain', kernel: 'nearest' })
    .png()
    .toBuffer();
  const label = `${frame.relativeFile.replace('.webp', '')} `
    + `w${frame.row.weakAlphaPixels} ew${frame.row.edgeWeakAlphaPixels} `
    + `ow${frame.row.orphanWeakAlphaPixels} tc${frame.row.transparentColoredPixels}`;

  return {
    image,
    label: await labelTile(label, cellSize, labelHeight),
  };
}

async function legendTile(width, height) {
  return sharp({
    create: {
      background: { alpha: 1, b: 255, g: 255, r: 255 },
      channels: 4,
      height,
      width,
    },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
        + '<rect x="10" y="10" width="18" height="18" fill="#facc15"/>'
        + '<text x="34" y="24" font-family="Arial" font-size="14" fill="#111827">supported weak edge alpha</text>'
        + '<rect x="260" y="10" width="18" height="18" fill="#d946ef"/>'
        + '<text x="284" y="24" font-family="Arial" font-size="14" fill="#111827">orphan weak alpha</text>'
        + '<rect x="492" y="10" width="18" height="18" fill="#ef4444"/>'
        + '<text x="516" y="24" font-family="Arial" font-size="14" fill="#111827">transparent colored residue</text>'
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderOverlay(frames, options) {
  const labelHeight = 30;
  const legendHeight = 40;
  const rows = Math.max(1, Math.ceil(frames.length / options.cols));
  const width = options.cols * options.cellSize;
  const height = legendHeight + rows * (options.cellSize + labelHeight);
  const composites = [{ input: await legendTile(width, legendHeight), left: 0, top: 0 }];

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const col = index % options.cols;
    const row = Math.floor(index / options.cols);
    const left = col * options.cellSize;
    const top = legendHeight + row * (options.cellSize + labelHeight);
    const tile = await renderTile(frame, options.cellSize, labelHeight);

    composites.push({ input: tile.label, left, top });
    composites.push({ input: tile.image, left, top: top + labelHeight });
  }

  const outputFile = path.join(options.outputRoot, `${options.character}-edge-integrity-overlay.png`);
  await sharp({
    create: {
      background: { alpha: 1, b: 255, g: 255, r: 255 },
      channels: 4,
      height,
      width,
    },
  })
    .composite(composites)
    .png()
    .toFile(outputFile);

  return outputFile;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    cellSize: readNumberOption(args, 'cell-size', DEFAULTS.cellSize),
    character: readOption(args, 'character', DEFAULTS.character),
    cols: readNumberOption(args, 'cols', DEFAULTS.cols),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    maxOrphanWeakAlpha: readNumberOption(
      args,
      'max-orphan-weak-alpha',
      DEFAULTS.maxOrphanWeakAlpha,
    ),
    maxTransparentColored: readNumberOption(
      args,
      'max-transparent-colored',
      DEFAULTS.maxTransparentColored,
    ),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sourceRoot: readOption(args, 'source', DEFAULTS.sourceRoot),
    strongAlphaThreshold: readNumberOption(
      args,
      'strong-alpha-threshold',
      DEFAULTS.strongAlphaThreshold,
    ),
    supportRadius: readNumberOption(args, 'support-radius', DEFAULTS.supportRadius),
    weakAlphaThreshold: readNumberOption(
      args,
      'weak-alpha-threshold',
      DEFAULTS.weakAlphaThreshold,
    ),
  };
  options.characterRoot = await resolveCharacterRoot(options.sourceRoot, options.character);

  const frames = await scanFrames(options);
  const rows = frames.map((frame) => frame.row);
  const summary = summarize(rows);

  await mkdir(options.outputRoot, { recursive: true });
  const csvHeader = Object.keys(rows[0]);
  const csv = [
    csvHeader.join(','),
    ...rows.map((row) => csvHeader.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');
  await writeFile(
    path.join(options.outputRoot, `${options.character}-edge-integrity.csv`),
    `${csv}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, `${options.character}-edge-integrity-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const overlayFile = await renderOverlay(selectOverlayFrames(frames, options.maxFrames), options);

  console.log(`Audited ${rows.length} ${options.character} edge-integrity frames`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Rendered edge overlay to ${path.relative(process.cwd(), overlayFile)}`);

  const hardFailures = [];
  if (options.expectedFrames > 0 && rows.length !== options.expectedFrames) {
    hardFailures.push(`expected ${options.expectedFrames} frames, found ${rows.length}`);
  }
  if (summary.maxOrphanWeakAlphaPixels.orphanWeakAlphaPixels > options.maxOrphanWeakAlpha) {
    hardFailures.push(
      `${summary.maxOrphanWeakAlphaPixels.file} orphan weak alpha pixels `
      + `${summary.maxOrphanWeakAlphaPixels.orphanWeakAlphaPixels} > ${options.maxOrphanWeakAlpha}`,
    );
  }
  if (summary.maxTransparentColoredPixels.transparentColoredPixels > options.maxTransparentColored) {
    hardFailures.push(
      `${summary.maxTransparentColoredPixels.file} transparent colored pixels `
      + `${summary.maxTransparentColoredPixels.transparentColoredPixels} > `
      + `${options.maxTransparentColored}`,
    );
  }

  if (hardFailures.length) {
    throw new Error(`Edge integrity audit failed:\n- ${hardFailures.join('\n- ')}`);
  }

  console.log('Edge integrity hard checks passed.');
}

await main();
