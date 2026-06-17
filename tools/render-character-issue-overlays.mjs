import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 240,
  character: 'reimu',
  cols: 4,
  maxFrames: 12,
  outputRoot: 'tmp/issues',
  sourceRoot: 'public/characters',
  transparentThreshold: 16,
};

const COLORS = {
  background: [248, 250, 252],
  detached: [14, 165, 233],
  hole: [239, 68, 68],
  internalGap: [168, 85, 247],
  weakAlpha: [250, 204, 21],
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
    const pixels = [];
    let maxX = 0;
    let maxY = 0;
    let minX = width;
    let minY = height;
    let touchEdge = false;
    seen[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels.push(index);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchEdge = true;

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
      area: pixels.length,
      height: maxY - minY + 1,
      maxX,
      maxY,
      minX,
      minY,
      pixels,
      touchEdge,
      width: maxX - minX + 1,
    });
  }

  return components.sort((a, b) => b.area - a.area);
}

function isLineLikeInteriorHole(component) {
  const shortSide = Math.min(component.width, component.height);
  const longSide = Math.max(component.width, component.height);
  const aspect = longSide / Math.max(1, shortSide);

  return (
    component.area <= 128
    && (component.width <= 10 || component.height <= 24)
  ) || (
    component.area <= 256
    && shortSide <= 12
    && longSide >= 32
    && aspect >= 4
  );
}

async function readFrame(file, relativeFile, transparentThreshold) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaMask = new Uint8Array(info.width * info.height);
  const transparentMask = new Uint8Array(info.width * info.height);
  const weakAlphaMask = new Uint8Array(info.width * info.height);

  for (let index = 0; index < alphaMask.length; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha >= transparentThreshold) {
      alphaMask[index] = 1;
    } else {
      transparentMask[index] = 1;
    }
    if (alpha > 0 && alpha < 32) weakAlphaMask[index] = 1;
  }

  const alphaComponents = componentList(alphaMask, info.width, info.height);
  const detached = alphaComponents.slice(1).filter((component) => component.area >= 16);
  const holes = componentList(transparentMask, info.width, info.height)
    .filter((component) => !component.touchEdge);
  const lineLikeHoles = holes.filter(isLineLikeInteriorHole);
  const holeArea = holes.reduce((sum, component) => sum + component.area, 0);
  const suspiciousHoleArea = lineLikeHoles.reduce((sum, component) => sum + component.area, 0);

  return {
    data,
    detached,
    file,
    holes,
    info,
    lineLikeHoles,
    metrics: {
      detachedArea: detached.reduce((sum, component) => sum + component.area, 0),
      holeArea,
      internalGapArea: holeArea - suspiciousHoleArea,
      lineLikeHoleArea: suspiciousHoleArea,
      suspiciousHoleArea,
      weakAlphaPixels: weakAlphaMask.reduce((sum, value) => sum + value, 0),
    },
    relativeFile,
    weakAlphaMask,
  };
}

async function scanFrames(characterRoot, transparentThreshold) {
  const rows = [];

  for (const sheetEntry of await readdir(characterRoot, { withFileTypes: true })) {
    const sheetRoot = path.join(characterRoot, sheetEntry.name);
    if (!await isDirectoryEntry(characterRoot, sheetEntry)) continue;

    for (const fileEntry of await readdir(sheetRoot, { withFileTypes: true })) {
      if (!await isWebpFileEntry(sheetRoot, fileEntry)) continue;

      const relativeFile = `${sheetEntry.name}/${fileEntry.name}`;
      const frame = await readFrame(
        path.join(sheetRoot, fileEntry.name),
        relativeFile,
        transparentThreshold,
      );
      rows.push(frame);
    }
  }

  return rows.sort((a, b) => a.relativeFile.localeCompare(b.relativeFile));
}

function topBy(rows, key, count) {
  return [...rows]
    .filter((row) => row.metrics[key] > 0)
    .sort((a, b) => b.metrics[key] - a.metrics[key])
    .slice(0, count);
}

function selectIssueFrames(rows, maxFrames) {
  const picked = new Map();
  const addRows = (items) => {
    for (const item of items) {
      if (picked.size >= maxFrames) return;
      picked.set(item.relativeFile, item);
    }
  };

  addRows(topBy(rows, 'suspiciousHoleArea', 4));
  addRows(topBy(rows, 'detachedArea', 4));
  addRows(topBy(rows, 'weakAlphaPixels', 4));
  addRows(topBy(rows, 'holeArea', maxFrames));

  return [...picked.values()];
}

function blendPixel(data, index, color, amount) {
  const offset = index * 4;
  data[offset] = Math.round(data[offset] * (1 - amount) + color[0] * amount);
  data[offset + 1] = Math.round(data[offset + 1] * (1 - amount) + color[1] * amount);
  data[offset + 2] = Math.round(data[offset + 2] * (1 - amount) + color[2] * amount);
  data[offset + 3] = 255;
}

function overlayFrame(frame) {
  const { data, info } = frame;
  const output = Buffer.alloc(info.width * info.height * 4);

  for (let index = 0; index < info.width * info.height; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3] / 255;
    output[offset] = Math.round(data[offset] * alpha + COLORS.background[0] * (1 - alpha));
    output[offset + 1] = Math.round(data[offset + 1] * alpha + COLORS.background[1] * (1 - alpha));
    output[offset + 2] = Math.round(data[offset + 2] * alpha + COLORS.background[2] * (1 - alpha));
    output[offset + 3] = 255;
  }

  for (const component of frame.holes) {
    for (const index of component.pixels) blendPixel(output, index, COLORS.internalGap, 0.72);
  }
  for (const component of frame.lineLikeHoles) {
    const amount = component.area > 128 ? 0.85 : 0.65;
    for (const index of component.pixels) blendPixel(output, index, COLORS.hole, amount);
  }
  for (const component of frame.detached) {
    for (const index of component.pixels) blendPixel(output, index, COLORS.detached, 0.85);
  }
  for (let index = 0; index < frame.weakAlphaMask.length; index += 1) {
    if (frame.weakAlphaMask[index]) blendPixel(output, index, COLORS.weakAlpha, 0.85);
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
  const overlay = overlayFrame(frame);
  const image = await sharp(overlay, {
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
    + `s${frame.metrics.suspiciousHoleArea} g${frame.metrics.internalGapArea} `
    + `d${frame.metrics.detachedArea} w${frame.metrics.weakAlphaPixels}`;

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
        + '<rect x="10" y="10" width="18" height="18" fill="#ef4444"/>'
        + '<text x="34" y="24" font-family="Arial" font-size="14" fill="#111827">suspicious transparent holes</text>'
        + '<rect x="252" y="10" width="18" height="18" fill="#0ea5e9"/>'
        + '<text x="276" y="24" font-family="Arial" font-size="14" fill="#111827">detached alpha fragments</text>'
        + '<rect x="500" y="10" width="18" height="18" fill="#facc15"/>'
        + '<text x="524" y="24" font-family="Arial" font-size="14" fill="#111827">weak alpha pixels</text>'
        + '<rect x="700" y="10" width="18" height="18" fill="#a855f7"/>'
        + '<text x="724" y="24" font-family="Arial" font-size="14" fill="#111827">internal transparent gaps</text>'
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderIssueSheet(frames, options) {
  const labelHeight = 30;
  const legendHeight = 40;
  const rows = Math.ceil(frames.length / options.cols);
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

  await mkdir(options.outputRoot, { recursive: true });
  const outputFile = path.join(options.outputRoot, `${options.character}-issue-overlay.png`);
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
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sourceRoot: path.resolve(readOption(args, 'source', DEFAULTS.sourceRoot)),
    transparentThreshold: readNumberOption(
      args,
      'transparent-threshold',
      DEFAULTS.transparentThreshold,
    ),
  };
  const characterRoot = path.join(options.sourceRoot, options.character);
  const rows = await scanFrames(characterRoot, options.transparentThreshold);
  const issueFrames = selectIssueFrames(rows, options.maxFrames);
  const outputFile = await renderIssueSheet(issueFrames, options);

  console.log(`Rendered ${issueFrames.length} issue-overlay frames to ${path.relative(process.cwd(), outputFile)}`);
}

await main();
