import { mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  character: 'reimu',
  expectedFrames: 0,
  maxDetachedArea: 512,
  maxLineHoleArea: 800,
  maxWeakAlpha: 1000,
  minMargin: 32,
  outputRoot: 'tmp/quality-audit',
  sourceRoot: 'public/characters',
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
      touchEdge,
      width: maxX - minX + 1,
    });
  }

  return components.sort((a, b) => b.area - a.area);
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function auditFrame(file, relativeFile, transparentThreshold) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaMask = new Uint8Array(info.width * info.height);
  const transparentMask = new Uint8Array(info.width * info.height);
  let alphaPixels = 0;
  let maxX = 0;
  let maxY = 0;
  let minX = info.width;
  let minY = info.height;
  let transparentNonBlack = 0;
  let weakAlphaPixels = 0;

  for (let index = 0; index < alphaMask.length; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];

    if (alpha >= transparentThreshold) {
      alphaMask[index] = 1;
      alphaPixels += 1;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    } else {
      transparentMask[index] = 1;
    }

    if (alpha > 0 && alpha < 32) weakAlphaPixels += 1;
    if (alpha === 0 && (data[offset] || data[offset + 1] || data[offset + 2])) {
      transparentNonBlack += 1;
    }
  }

  const components = componentList(alphaMask, info.width, info.height);
  const largest = components[0] ?? { area: 0 };
  const detached = components.slice(1).filter((component) => component.area >= 16);
  const holes = componentList(transparentMask, info.width, info.height)
    .filter((component) => !component.touchEdge);
  const lineLikeHoles = holes.filter((component) => (
    component.area <= 128 && (component.width <= 10 || component.height <= 24)
  ));

  return {
    alphaPixels,
    bottomMargin: info.height - 1 - maxY,
    detachedArea: detached.reduce((sum, component) => sum + component.area, 0),
    detachedCount: detached.length,
    file: relativeFile,
    height: maxY - minY + 1,
    holeArea: holes.reduce((sum, component) => sum + component.area, 0),
    holeCount: holes.length,
    largestArea: largest.area,
    leftMargin: minX,
    lineLikeHoleArea: lineLikeHoles.reduce((sum, component) => sum + component.area, 0),
    lineLikeHoleCount: lineLikeHoles.length,
    rightMargin: info.width - 1 - maxX,
    topMargin: minY,
    transparentNonBlack,
    weakAlphaPixels,
    width: maxX - minX + 1,
  };
}

function summarize(rows) {
  const maxBy = (key) => [...rows].sort((a, b) => b[key] - a[key])[0];
  const minMarginRows = [...rows].sort((a, b) => (
    Math.min(a.leftMargin, a.topMargin, a.rightMargin, a.bottomMargin)
    - Math.min(b.leftMargin, b.topMargin, b.rightMargin, b.bottomMargin)
  ));

  return {
    frameCount: rows.length,
    maxDetachedArea: maxBy('detachedArea'),
    maxLineLikeHoleArea: maxBy('lineLikeHoleArea'),
    maxWeakAlphaPixels: maxBy('weakAlphaPixels'),
    minMargin: {
      file: minMarginRows[0]?.file,
      value: minMarginRows[0]
        ? Math.min(
          minMarginRows[0].leftMargin,
          minMarginRows[0].topMargin,
          minMarginRows[0].rightMargin,
          minMarginRows[0].bottomMargin,
        )
        : null,
    },
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    character: readOption(args, 'character', DEFAULTS.character),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    maxDetachedArea: readNumberOption(args, 'max-detached-area', DEFAULTS.maxDetachedArea),
    maxLineHoleArea: readNumberOption(args, 'max-line-hole-area', DEFAULTS.maxLineHoleArea),
    maxWeakAlpha: readNumberOption(args, 'max-weak-alpha', DEFAULTS.maxWeakAlpha),
    minMargin: readNumberOption(args, 'min-margin', DEFAULTS.minMargin),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sourceRoot: path.resolve(readOption(args, 'source', DEFAULTS.sourceRoot)),
    transparentThreshold: readNumberOption(args, 'transparent-threshold', DEFAULTS.transparentThreshold),
  };
  const characterRoot = path.join(options.sourceRoot, options.character);
  const rows = [];

  for (const sheetEntry of await readdir(characterRoot, { withFileTypes: true })) {
    if (!sheetEntry.isDirectory()) continue;

    const sheetDir = path.join(characterRoot, sheetEntry.name);
    for (const fileEntry of await readdir(sheetDir, { withFileTypes: true })) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith('.webp')) continue;

      const relativeFile = `${sheetEntry.name}/${fileEntry.name}`;
      rows.push(await auditFrame(
        path.join(sheetDir, fileEntry.name),
        relativeFile,
        options.transparentThreshold,
      ));
    }
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));
  await mkdir(options.outputRoot, { recursive: true });

  const csvHeader = Object.keys(rows[0]);
  const csv = [
    csvHeader.join(','),
    ...rows.map((row) => csvHeader.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');
  const summary = summarize(rows);

  await writeFile(
    path.join(options.outputRoot, `${options.character}-asset-quality.csv`),
    `${csv}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, `${options.character}-asset-quality-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Audited ${rows.length} ${options.character} frames`);
  console.log(JSON.stringify(summary, null, 2));

  const hardFailures = [];
  if (options.expectedFrames > 0 && rows.length !== options.expectedFrames) {
    hardFailures.push(`expected ${options.expectedFrames} frames, found ${rows.length}`);
  }
  if (summary.minMargin.value < options.minMargin) {
    hardFailures.push(`${summary.minMargin.file} margin ${summary.minMargin.value} < ${options.minMargin}`);
  }
  if (summary.maxDetachedArea.detachedArea > options.maxDetachedArea) {
    hardFailures.push(
      `${summary.maxDetachedArea.file} detached area `
      + `${summary.maxDetachedArea.detachedArea} > ${options.maxDetachedArea}`,
    );
  }
  if (summary.maxLineLikeHoleArea.lineLikeHoleArea > options.maxLineHoleArea) {
    hardFailures.push(
      `${summary.maxLineLikeHoleArea.file} line-like hole area `
      + `${summary.maxLineLikeHoleArea.lineLikeHoleArea} > ${options.maxLineHoleArea}`,
    );
  }
  if (summary.maxWeakAlphaPixels.weakAlphaPixels > options.maxWeakAlpha) {
    hardFailures.push(
      `${summary.maxWeakAlphaPixels.file} weak alpha pixels `
      + `${summary.maxWeakAlphaPixels.weakAlphaPixels} > ${options.maxWeakAlpha}`,
    );
  }

  if (hardFailures.length) {
    throw new Error(`Asset audit failed:\n- ${hardFailures.join('\n- ')}`);
  }
  console.log('Asset audit hard checks passed.');
}

await main();
