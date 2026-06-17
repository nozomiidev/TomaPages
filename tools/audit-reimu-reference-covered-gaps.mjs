import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 240,
  cols: 4,
  currentRoot: 'public/characters/reimu',
  maxFrames: 12,
  maxReferenceCoveredGapArea: 0,
  outputRoot: 'tmp/gap-audit',
  referenceRoot: 'tmp/noreshape/reimu',
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

function referenceCoverage(referenceData, pixels, transparentThreshold) {
  let covered = 0;

  for (const index of pixels) {
    if (referenceData[index * 4 + 3] >= transparentThreshold) covered += 1;
  }

  return covered / Math.max(1, pixels.length);
}

function isCandidateGap(component, referenceData, transparentThreshold) {
  if (component.touchEdge) return false;
  if (component.area > 1200 || component.width > 150 || component.height > 80) return false;
  return referenceCoverage(referenceData, component.pixels, transparentThreshold) >= 0.65;
}

async function readRgba(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, height: info.height, width: info.width };
}

async function auditFrame(currentFile, referenceFile, relativeFile, transparentThreshold) {
  const current = await readRgba(currentFile);
  const reference = await readRgba(referenceFile);
  if (current.width !== reference.width || current.height !== reference.height) {
    throw new Error(`Mismatched frame dimensions for ${relativeFile}`);
  }

  const transparentMask = new Uint8Array(current.width * current.height);
  for (let index = 0; index < transparentMask.length; index += 1) {
    if (current.data[index * 4 + 3] < transparentThreshold) transparentMask[index] = 1;
  }

  const gaps = componentList(transparentMask, current.width, current.height)
    .filter((component) => isCandidateGap(component, reference.data, transparentThreshold));

  return {
    current,
    file: relativeFile,
    gaps,
    maxGapArea: gaps[0]?.area ?? 0,
    reference,
    referenceCoveredGapArea: gaps.reduce((sum, component) => sum + component.area, 0),
    referenceCoveredGapCount: gaps.length,
  };
}

async function scanFrames(options) {
  const rows = [];

  for (const sheetEntry of await readdir(options.currentRoot, { withFileTypes: true })) {
    const currentSheetRoot = path.join(options.currentRoot, sheetEntry.name);
    if (!await isDirectoryEntry(options.currentRoot, sheetEntry)) continue;

    for (const fileEntry of await readdir(currentSheetRoot, { withFileTypes: true })) {
      if (!await isWebpFileEntry(currentSheetRoot, fileEntry)) continue;

      const relativeFile = `${sheetEntry.name}/${fileEntry.name}`;
      rows.push(await auditFrame(
        path.join(currentSheetRoot, fileEntry.name),
        path.join(options.referenceRoot, sheetEntry.name, fileEntry.name),
        relativeFile,
        options.transparentThreshold,
      ));
    }
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file));
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function summarize(rows) {
  const sorted = [...rows].sort((a, b) => b.referenceCoveredGapArea - a.referenceCoveredGapArea);

  return {
    frameCount: rows.length,
    maxReferenceCoveredGapArea: {
      file: sorted[0]?.file ?? null,
      maxGapArea: sorted[0]?.maxGapArea ?? 0,
      referenceCoveredGapArea: sorted[0]?.referenceCoveredGapArea ?? 0,
      referenceCoveredGapCount: sorted[0]?.referenceCoveredGapCount ?? 0,
    },
    totalReferenceCoveredGapArea: rows.reduce((sum, row) => sum + row.referenceCoveredGapArea, 0),
    totalReferenceCoveredGapCount: rows.reduce((sum, row) => sum + row.referenceCoveredGapCount, 0),
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
  const { current } = frame;
  const output = Buffer.alloc(current.width * current.height * 4);

  for (let index = 0; index < current.width * current.height; index += 1) {
    const offset = index * 4;
    const alpha = current.data[offset + 3] / 255;
    output[offset] = Math.round(current.data[offset] * alpha + 248 * (1 - alpha));
    output[offset + 1] = Math.round(current.data[offset + 1] * alpha + 250 * (1 - alpha));
    output[offset + 2] = Math.round(current.data[offset + 2] * alpha + 252 * (1 - alpha));
    output[offset + 3] = 255;
  }

  for (const gap of frame.gaps) {
    for (const index of gap.pixels) {
      const offset = index * 4;
      output[offset] = Math.round(output[offset] * 0.25 + 168 * 0.75);
      output[offset + 1] = Math.round(output[offset + 1] * 0.25 + 85 * 0.75);
      output[offset + 2] = Math.round(output[offset + 2] * 0.25 + 247 * 0.75);
      output[offset + 3] = 255;
    }
  }

  return output;
}

async function renderTile(frame, cellSize, labelHeight) {
  const image = await sharp(overlayFrame(frame), {
    raw: {
      channels: 4,
      height: frame.current.height,
      width: frame.current.width,
    },
  })
    .resize(cellSize, cellSize, { fit: 'contain', kernel: 'nearest' })
    .png()
    .toBuffer();

  return {
    image,
    label: await labelTile(
      `${frame.file.replace('.webp', '')} g${frame.referenceCoveredGapArea} c${frame.referenceCoveredGapCount}`,
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
        + '<rect x="10" y="10" width="18" height="18" fill="#a855f7"/>'
        + `<text x="34" y="24" font-family="Arial" font-size="14" fill="#111827">reference-covered internal gaps: ${summary.totalReferenceCoveredGapCount} gaps / ${summary.totalReferenceCoveredGapArea} px</text>`
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
  const issueRows = [...rows]
    .filter((row) => row.referenceCoveredGapArea > 0)
    .sort((a, b) => b.referenceCoveredGapArea - a.referenceCoveredGapArea)
    .slice(0, options.maxFrames);
  const outputRows = Math.ceil(options.maxFrames / options.cols);
  const width = options.cols * options.cellSize;
  const height = legendHeight + outputRows * (options.cellSize + labelHeight);
  const composites = [{ input: await legendTile(width, legendHeight, summary), left: 0, top: 0 }];

  for (let index = 0; index < issueRows.length; index += 1) {
    const frame = issueRows[index];
    const col = index % options.cols;
    const row = Math.floor(index / options.cols);
    const left = col * options.cellSize;
    const top = legendHeight + row * (options.cellSize + labelHeight);
    const tile = await renderTile(frame, options.cellSize, labelHeight);

    composites.push({ input: tile.label, left, top });
    composites.push({ input: tile.image, left, top: top + labelHeight });
  }

  await mkdir(options.outputRoot, { recursive: true });
  const outputFile = path.join(options.outputRoot, 'reimu-reference-covered-gap-overlay.png');
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
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    maxReferenceCoveredGapArea: readNumberOption(
      args,
      'max-reference-covered-gap-area',
      DEFAULTS.maxReferenceCoveredGapArea,
    ),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    referenceRoot: path.resolve(readOption(args, 'reference-root', DEFAULTS.referenceRoot)),
    transparentThreshold: readNumberOption(
      args,
      'transparent-threshold',
      DEFAULTS.transparentThreshold,
    ),
  };
  const rows = await scanFrames(options);
  const summary = summarize(rows);
  const csvRows = rows.map((row) => ({
    file: row.file,
    maxGapArea: row.maxGapArea,
    referenceCoveredGapArea: row.referenceCoveredGapArea,
    referenceCoveredGapCount: row.referenceCoveredGapCount,
  }));
  const csvHeader = Object.keys(csvRows[0]);
  const csv = [
    csvHeader.join(','),
    ...csvRows.map((row) => csvHeader.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');

  await mkdir(options.outputRoot, { recursive: true });
  await writeFile(path.join(options.outputRoot, 'reimu-reference-covered-gap.csv'), `${csv}\n`);
  await writeFile(
    path.join(options.outputRoot, 'reimu-reference-covered-gap-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const overlayFile = await renderOverlay(rows, options, summary);

  console.log(`Audited ${rows.length} Reimu frames for reference-covered internal gaps`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Rendered overlay to ${path.relative(process.cwd(), overlayFile)}`);

  if (
    summary.maxReferenceCoveredGapArea.referenceCoveredGapArea
    > options.maxReferenceCoveredGapArea
  ) {
    throw new Error(
      `${summary.maxReferenceCoveredGapArea.file} reference-covered gap area `
      + `${summary.maxReferenceCoveredGapArea.referenceCoveredGapArea} > `
      + `${options.maxReferenceCoveredGapArea}`,
    );
  }

  console.log('Reference-covered gap audit hard checks passed.');
}

await main();
