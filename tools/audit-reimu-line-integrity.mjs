import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 240,
  cols: 4,
  currentRoot: 'public/characters/reimu',
  expectedFrames: 225,
  inkRadius: 4,
  maxFrames: 12,
  maxUnsupportedEdgeComponentArea: 48,
  maxUnsupportedEdgeComponentCount: 12,
  maxUnsupportedEdgeComponentSpan: 42,
  maxUnsupportedEdgeInkPixels: 90,
  maxUnsupportedEdgeInkRatio: 0.055,
  outputRoot: 'tmp/line-audit',
  transparentThreshold: 16,
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) ? value : fallback;
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

function isInkPixel(data, index) {
  const offset = index * 4;
  const alpha = data[offset + 3];
  if (alpha < 48) return false;

  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const redTrim = red > 150 && green < 110 && blue < 110 && max - min > 65;

  return luma < 145 || max < 155 || redTrim;
}

function hasNearbyInk(inkMask, x, y, width, height, radius) {
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius) continue;

      const candidateX = x + dx;
      const candidateY = y + dy;
      if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) continue;

      if (inkMask[candidateY * width + candidateX]) return true;
    }
  }

  return false;
}

function isAlphaEdge(alphaMask, index, width, height) {
  if (!alphaMask[index]) return false;

  const x = index % width;
  const y = Math.floor(index / width);
  return (
    x === 0
    || y === 0
    || x === width - 1
    || y === height - 1
    || !alphaMask[index - 1]
    || !alphaMask[index + 1]
    || !alphaMask[index - width]
    || !alphaMask[index + width]
  );
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

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;

          const neighborX = x + dx;
          const neighborY = y + dy;
          if (neighborX < 0 || neighborY < 0 || neighborX >= width || neighborY >= height) {
            continue;
          }

          const neighbor = neighborY * width + neighborX;
          if (mask[neighbor] && !seen[neighbor]) {
            seen[neighbor] = 1;
            queue.push(neighbor);
          }
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
      span: Math.max(maxX - minX + 1, maxY - minY + 1),
      width: maxX - minX + 1,
    });
  }

  return components.sort((left, right) => (
    right.area - left.area
    || right.span - left.span
  ));
}

async function readFrame(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, height: info.height, width: info.width };
}

async function auditFrame(file, relativeFile, options) {
  const frame = await readFrame(file);
  const alphaMask = new Uint8Array(frame.width * frame.height);
  const inkMask = new Uint8Array(frame.width * frame.height);
  const unsupportedEdgeMask = new Uint8Array(frame.width * frame.height);
  let edgePixels = 0;
  let inkPixels = 0;
  let unsupportedEdgeInkPixels = 0;

  for (let index = 0; index < alphaMask.length; index += 1) {
    if (frame.data[index * 4 + 3] >= options.transparentThreshold) alphaMask[index] = 1;
    if (isInkPixel(frame.data, index)) {
      inkMask[index] = 1;
      inkPixels += 1;
    }
  }

  for (let index = 0; index < alphaMask.length; index += 1) {
    if (!isAlphaEdge(alphaMask, index, frame.width, frame.height)) continue;

    edgePixels += 1;
    const x = index % frame.width;
    const y = Math.floor(index / frame.width);
    if (!hasNearbyInk(inkMask, x, y, frame.width, frame.height, options.inkRadius)) {
      unsupportedEdgeMask[index] = 1;
      unsupportedEdgeInkPixels += 1;
    }
  }
  const unsupportedEdgeComponents = componentList(
    unsupportedEdgeMask,
    frame.width,
    frame.height,
  );
  const largestUnsupportedEdgeComponent = unsupportedEdgeComponents[0] ?? {
    area: 0,
    height: 0,
    maxX: 0,
    maxY: 0,
    minX: 0,
    minY: 0,
    span: 0,
    width: 0,
  };

  return {
    data: frame.data,
    edgePixels,
    file: relativeFile,
    height: frame.height,
    inkPixels,
    maxUnsupportedEdgeComponentArea: largestUnsupportedEdgeComponent.area,
    maxUnsupportedEdgeComponentSpan: largestUnsupportedEdgeComponent.span,
    unsupportedEdgeInkPixels,
    unsupportedEdgeInkRatio: Number((unsupportedEdgeInkPixels / Math.max(1, edgePixels)).toFixed(4)),
    unsupportedEdgeMask,
    unsupportedEdgeComponentCount: unsupportedEdgeComponents.length,
    unsupportedEdgeComponents: unsupportedEdgeComponents.slice(0, 8),
    width: frame.width,
  };
}

async function scanFrames(options) {
  const rows = [];

  for (const sheetEntry of await readdir(options.currentRoot, { withFileTypes: true })) {
    const sheetRoot = path.join(options.currentRoot, sheetEntry.name);
    if (!await isDirectoryEntry(options.currentRoot, sheetEntry)) continue;

    for (const fileEntry of await readdir(sheetRoot, { withFileTypes: true })) {
      if (!await isWebpFileEntry(sheetRoot, fileEntry)) continue;

      rows.push(await auditFrame(
        path.join(sheetRoot, fileEntry.name),
        `${sheetEntry.name}/${fileEntry.name}`,
        options,
      ));
    }
  }

  return rows.sort((left, right) => left.file.localeCompare(right.file));
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function summarize(rows, options) {
  const sortedByRatio = [...rows].sort((left, right) => (
    right.unsupportedEdgeInkRatio - left.unsupportedEdgeInkRatio
    || right.unsupportedEdgeInkPixels - left.unsupportedEdgeInkPixels
  ));
  const sortedByPixels = [...rows].sort((left, right) => (
    right.unsupportedEdgeInkPixels - left.unsupportedEdgeInkPixels
    || right.unsupportedEdgeInkRatio - left.unsupportedEdgeInkRatio
  ));
  const sortedByComponentArea = [...rows].sort((left, right) => (
    right.maxUnsupportedEdgeComponentArea - left.maxUnsupportedEdgeComponentArea
    || right.maxUnsupportedEdgeComponentSpan - left.maxUnsupportedEdgeComponentSpan
  ));
  const sortedByComponentSpan = [...rows].sort((left, right) => (
    right.maxUnsupportedEdgeComponentSpan - left.maxUnsupportedEdgeComponentSpan
    || right.maxUnsupportedEdgeComponentArea - left.maxUnsupportedEdgeComponentArea
  ));
  const sortedByComponentCount = [...rows].sort((left, right) => (
    right.unsupportedEdgeComponentCount - left.unsupportedEdgeComponentCount
    || right.unsupportedEdgeInkPixels - left.unsupportedEdgeInkPixels
  ));

  return {
    frameCount: rows.length,
    maxUnsupportedEdgeComponentArea: {
      componentArea: sortedByComponentArea[0]?.maxUnsupportedEdgeComponentArea ?? 0,
      componentSpan: sortedByComponentArea[0]?.maxUnsupportedEdgeComponentSpan ?? 0,
      file: sortedByComponentArea[0]?.file ?? null,
      unsupportedEdgeComponentCount: sortedByComponentArea[0]?.unsupportedEdgeComponentCount ?? 0,
    },
    maxUnsupportedEdgeComponentCount: {
      componentArea: sortedByComponentCount[0]?.maxUnsupportedEdgeComponentArea ?? 0,
      componentSpan: sortedByComponentCount[0]?.maxUnsupportedEdgeComponentSpan ?? 0,
      file: sortedByComponentCount[0]?.file ?? null,
      unsupportedEdgeComponentCount: sortedByComponentCount[0]?.unsupportedEdgeComponentCount ?? 0,
    },
    maxUnsupportedEdgeComponentSpan: {
      componentArea: sortedByComponentSpan[0]?.maxUnsupportedEdgeComponentArea ?? 0,
      componentSpan: sortedByComponentSpan[0]?.maxUnsupportedEdgeComponentSpan ?? 0,
      file: sortedByComponentSpan[0]?.file ?? null,
      unsupportedEdgeComponentCount: sortedByComponentSpan[0]?.unsupportedEdgeComponentCount ?? 0,
    },
    maxUnsupportedEdgeInkPixels: {
      edgePixels: sortedByPixels[0]?.edgePixels ?? 0,
      file: sortedByPixels[0]?.file ?? null,
      unsupportedEdgeInkPixels: sortedByPixels[0]?.unsupportedEdgeInkPixels ?? 0,
      unsupportedEdgeInkRatio: sortedByPixels[0]?.unsupportedEdgeInkRatio ?? 0,
    },
    maxUnsupportedEdgeInkRatio: {
      edgePixels: sortedByRatio[0]?.edgePixels ?? 0,
      file: sortedByRatio[0]?.file ?? null,
      unsupportedEdgeInkPixels: sortedByRatio[0]?.unsupportedEdgeInkPixels ?? 0,
      unsupportedEdgeInkRatio: sortedByRatio[0]?.unsupportedEdgeInkRatio ?? 0,
    },
    thresholds: {
      maxUnsupportedEdgeComponentArea: options.maxUnsupportedEdgeComponentArea,
      maxUnsupportedEdgeComponentCount: options.maxUnsupportedEdgeComponentCount,
      maxUnsupportedEdgeComponentSpan: options.maxUnsupportedEdgeComponentSpan,
      maxUnsupportedEdgeInkPixels: options.maxUnsupportedEdgeInkPixels,
      maxUnsupportedEdgeInkRatio: options.maxUnsupportedEdgeInkRatio,
    },
  };
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

function overlayFrame(frame) {
  const output = Buffer.alloc(frame.width * frame.height * 4);

  for (let index = 0; index < frame.width * frame.height; index += 1) {
    const offset = index * 4;
    const alpha = frame.data[offset + 3] / 255;
    output[offset] = Math.round(frame.data[offset] * alpha + 248 * (1 - alpha));
    output[offset + 1] = Math.round(frame.data[offset + 1] * alpha + 250 * (1 - alpha));
    output[offset + 2] = Math.round(frame.data[offset + 2] * alpha + 252 * (1 - alpha));
    output[offset + 3] = 255;
  }

  for (let index = 0; index < frame.unsupportedEdgeMask.length; index += 1) {
    if (!frame.unsupportedEdgeMask[index]) continue;

    const offset = index * 4;
    output[offset] = Math.round(output[offset] * 0.15 + 14 * 0.85);
    output[offset + 1] = Math.round(output[offset + 1] * 0.15 + 165 * 0.85);
    output[offset + 2] = Math.round(output[offset + 2] * 0.15 + 233 * 0.85);
    output[offset + 3] = 255;
  }

  return output;
}

async function renderTile(frame, cellSize, labelHeight) {
  const image = await sharp(overlayFrame(frame), {
    raw: {
      channels: 4,
      height: frame.height,
      width: frame.width,
    },
  })
    .resize(cellSize, cellSize, { fit: 'contain', kernel: 'nearest' })
    .png()
    .toBuffer();

  return {
    image,
    label: await labelTile(
      `${frame.file.replace('.webp', '')} u${frame.unsupportedEdgeInkPixels} c${frame.maxUnsupportedEdgeComponentSpan}`,
      cellSize,
      labelHeight,
    ),
  };
}

async function legendTile(width, height, summary) {
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
        + '<rect x="10" y="10" width="18" height="18" fill="#0ea5e9"/>'
        + `<text x="34" y="24" font-family="Arial" font-size="14" fill="#111827">unsupported edge without nearby ink: max ratio ${summary.maxUnsupportedEdgeInkRatio.unsupportedEdgeInkRatio}, max span ${summary.maxUnsupportedEdgeComponentSpan.componentSpan}</text>`
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderOverlay(rows, options, summary) {
  const labelHeight = 30;
  const legendHeight = 40;
  const selected = [...rows]
    .sort((left, right) => (
      right.unsupportedEdgeInkRatio - left.unsupportedEdgeInkRatio
      || right.unsupportedEdgeInkPixels - left.unsupportedEdgeInkPixels
    ))
    .slice(0, options.maxFrames);
  const outputRows = Math.ceil(options.maxFrames / options.cols);
  const width = options.cols * options.cellSize;
  const height = legendHeight + outputRows * (options.cellSize + labelHeight);
  const composites = [{ input: await legendTile(width, legendHeight, summary), left: 0, top: 0 }];

  for (let index = 0; index < selected.length; index += 1) {
    const frame = selected[index];
    const col = index % options.cols;
    const row = Math.floor(index / options.cols);
    const left = col * options.cellSize;
    const top = legendHeight + row * (options.cellSize + labelHeight);
    const tile = await renderTile(frame, options.cellSize, labelHeight);

    composites.push({ input: tile.label, left, top });
    composites.push({ input: tile.image, left, top: top + labelHeight });
  }

  await mkdir(options.outputRoot, { recursive: true });
  const outputFile = path.join(options.outputRoot, 'reimu-line-integrity-overlay.png');
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
    cols: readNumberOption(args, 'cols', DEFAULTS.cols),
    currentRoot: path.resolve(readOption(args, 'current-root', DEFAULTS.currentRoot)),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    inkRadius: readNumberOption(args, 'ink-radius', DEFAULTS.inkRadius),
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    maxUnsupportedEdgeComponentArea: readNumberOption(
      args,
      'max-unsupported-edge-component-area',
      DEFAULTS.maxUnsupportedEdgeComponentArea,
    ),
    maxUnsupportedEdgeComponentCount: readNumberOption(
      args,
      'max-unsupported-edge-component-count',
      DEFAULTS.maxUnsupportedEdgeComponentCount,
    ),
    maxUnsupportedEdgeComponentSpan: readNumberOption(
      args,
      'max-unsupported-edge-component-span',
      DEFAULTS.maxUnsupportedEdgeComponentSpan,
    ),
    maxUnsupportedEdgeInkPixels: readNumberOption(
      args,
      'max-unsupported-edge-ink-pixels',
      DEFAULTS.maxUnsupportedEdgeInkPixels,
    ),
    maxUnsupportedEdgeInkRatio: readNumberOption(
      args,
      'max-unsupported-edge-ink-ratio',
      DEFAULTS.maxUnsupportedEdgeInkRatio,
    ),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    transparentThreshold: readNumberOption(
      args,
      'transparent-threshold',
      DEFAULTS.transparentThreshold,
    ),
  };
  const rows = await scanFrames(options);
  const summary = summarize(rows, options);
  const csvRows = rows.map((row) => ({
    edgePixels: row.edgePixels,
    file: row.file,
    inkPixels: row.inkPixels,
    maxUnsupportedEdgeComponentArea: row.maxUnsupportedEdgeComponentArea,
    maxUnsupportedEdgeComponentSpan: row.maxUnsupportedEdgeComponentSpan,
    unsupportedEdgeInkPixels: row.unsupportedEdgeInkPixels,
    unsupportedEdgeInkRatio: row.unsupportedEdgeInkRatio,
    unsupportedEdgeComponentCount: row.unsupportedEdgeComponentCount,
  }));
  const csvHeader = [
    'file',
    'edgePixels',
    'inkPixels',
    'unsupportedEdgeInkPixels',
    'unsupportedEdgeInkRatio',
    'unsupportedEdgeComponentCount',
    'maxUnsupportedEdgeComponentArea',
    'maxUnsupportedEdgeComponentSpan',
  ];
  const csv = [
    csvHeader.join(','),
    ...csvRows.map((row) => csvHeader.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');

  await mkdir(options.outputRoot, { recursive: true });
  await writeFile(path.join(options.outputRoot, 'reimu-line-integrity.csv'), `${csv}\n`);
  await writeFile(
    path.join(options.outputRoot, 'reimu-line-integrity-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const overlayFile = await renderOverlay(rows, options, summary);

  console.log(`Audited ${rows.length} Reimu frames for line integrity`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Rendered overlay to ${path.relative(process.cwd(), overlayFile)}`);

  if (rows.length !== options.expectedFrames) {
    throw new Error(`Expected ${options.expectedFrames} frames, found ${rows.length}`);
  }
  if (
    summary.maxUnsupportedEdgeInkRatio.unsupportedEdgeInkRatio
    > options.maxUnsupportedEdgeInkRatio
  ) {
    throw new Error(
      `${summary.maxUnsupportedEdgeInkRatio.file} unsupported edge ink ratio `
      + `${summary.maxUnsupportedEdgeInkRatio.unsupportedEdgeInkRatio} > `
      + `${options.maxUnsupportedEdgeInkRatio}`,
    );
  }
  if (
    summary.maxUnsupportedEdgeInkPixels.unsupportedEdgeInkPixels
    > options.maxUnsupportedEdgeInkPixels
  ) {
    throw new Error(
      `${summary.maxUnsupportedEdgeInkPixels.file} unsupported edge ink pixels `
      + `${summary.maxUnsupportedEdgeInkPixels.unsupportedEdgeInkPixels} > `
      + `${options.maxUnsupportedEdgeInkPixels}`,
    );
  }
  if (
    summary.maxUnsupportedEdgeComponentArea.componentArea
    > options.maxUnsupportedEdgeComponentArea
  ) {
    throw new Error(
      `${summary.maxUnsupportedEdgeComponentArea.file} unsupported edge component area `
      + `${summary.maxUnsupportedEdgeComponentArea.componentArea} > `
      + `${options.maxUnsupportedEdgeComponentArea}`,
    );
  }
  if (
    summary.maxUnsupportedEdgeComponentSpan.componentSpan
    > options.maxUnsupportedEdgeComponentSpan
  ) {
    throw new Error(
      `${summary.maxUnsupportedEdgeComponentSpan.file} unsupported edge component span `
      + `${summary.maxUnsupportedEdgeComponentSpan.componentSpan} > `
      + `${options.maxUnsupportedEdgeComponentSpan}`,
    );
  }
  if (
    summary.maxUnsupportedEdgeComponentCount.unsupportedEdgeComponentCount
    > options.maxUnsupportedEdgeComponentCount
  ) {
    throw new Error(
      `${summary.maxUnsupportedEdgeComponentCount.file} unsupported edge component count `
      + `${summary.maxUnsupportedEdgeComponentCount.unsupportedEdgeComponentCount} > `
      + `${options.maxUnsupportedEdgeComponentCount}`,
    );
  }

  console.log('Line integrity hard checks passed.');
}

await main();
