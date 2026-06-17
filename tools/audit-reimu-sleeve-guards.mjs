import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  baselineSource: 'tmp/noreshape/reimu',
  currentSource: 'public/characters/reimu',
  maxAverageWidthLoss: 0.015,
  maxSideWidthImbalance: 0.16,
  maxSideWidthLoss: 0.12,
  minAverageWidthRatio: 0.26,
  minSideWidthRatio: 0.20,
  outputRoot: 'tmp/quality-audit',
};

const TARGET_SHEETS = new Set(['pt_01', 'ot_01', 'ct_01', 'py_01', 'oy_01', 'cy_01']);

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
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

function alphaBounds(data, width, height) {
  const bounds = {
    maxX: 0,
    maxY: 0,
    minX: width,
    minY: height,
  };

  for (let index = 0; index < width * height; index += 1) {
    if (data[index * 4 + 3] <= 32) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }

  return {
    ...bounds,
    height: bounds.maxY - bounds.minY + 1,
    width: bounds.maxX - bounds.minX + 1,
  };
}

function isReimuSleevePixel(data, index, width, bounds, centerX) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  if (alpha < 32) return false;

  const x = index % width;
  const y = Math.floor(index / width);
  const yNorm = (y - bounds.minY) / Math.max(1, bounds.height);
  if (yNorm < 0.20 || yNorm > 0.82) return false;
  if (Math.abs(x - centerX) < 32) return false;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const whiteCloth = red > 184 && green > 174 && blue > 166 && max - min < 82;
  const redTrim = red > 145 && green < 122 && blue < 122;
  const pinkEdge = red > 180 && green > 95 && green < 190 && blue > 95 && blue < 190;

  return whiteCloth || redTrim || pinkEdge;
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
    let sumX = 0;
    seen[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      area += 1;
      sumX += x;
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
      centerX: sumX / area,
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

function mergeComponents(components) {
  if (!components.length) return null;

  return components.reduce((merged, component) => {
    if (!merged) return { ...component };

    return {
      area: merged.area + component.area,
      maxX: Math.max(merged.maxX, component.maxX),
      maxY: Math.max(merged.maxY, component.maxY),
      minX: Math.min(merged.minX, component.minX),
      minY: Math.min(merged.minY, component.minY),
    };
  }, null);
}

async function sleeveMetrics(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bounds = alphaBounds(data, info.width, info.height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const mask = new Uint8Array(info.width * info.height);

  for (let index = 0; index < mask.length; index += 1) {
    if (isReimuSleevePixel(data, index, info.width, bounds, centerX)) {
      mask[index] = 1;
    }
  }

  const components = componentList(mask, info.width, info.height)
    .filter((component) => component.area >= 100)
    .filter((component) => component.width >= 10 && component.height >= 10)
    .filter((component) => Math.abs(component.centerX - centerX) >= 44);
  const left = mergeComponents(
    components
      .filter((component) => component.centerX < centerX)
      .slice(0, 2),
  );
  const right = mergeComponents(
    components
      .filter((component) => component.centerX > centerX)
      .slice(0, 2),
  );
  const widthRatio = (component) => {
    if (!component) return 0;
    return (component.maxX - component.minX + 1) / Math.max(1, bounds.width);
  };
  const leftWidthRatio = widthRatio(left);
  const rightWidthRatio = widthRatio(right);

  return {
    averageWidthRatio: (leftWidthRatio + rightWidthRatio) / 2,
    leftArea: left?.area ?? 0,
    leftWidthRatio,
    rightArea: right?.area ?? 0,
    rightWidthRatio,
  };
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function collectRows(currentRoot, baselineRoot) {
  const rows = [];

  for (const sheetEntry of await readdir(currentRoot, { withFileTypes: true })) {
    if (!TARGET_SHEETS.has(sheetEntry.name)) continue;
    if (!await isDirectoryEntry(currentRoot, sheetEntry)) continue;

    const currentSheetDir = path.join(currentRoot, sheetEntry.name);
    const baselineSheetDir = path.join(baselineRoot, sheetEntry.name);
    for (const fileEntry of await readdir(currentSheetDir, { withFileTypes: true })) {
      if (!await isWebpFileEntry(currentSheetDir, fileEntry)) continue;

      const currentFile = path.join(currentSheetDir, fileEntry.name);
      const baselineFile = path.join(baselineSheetDir, fileEntry.name);
      if (!await exists(baselineFile)) {
        throw new Error(`Missing no-reshape baseline: ${path.relative(process.cwd(), baselineFile)}`);
      }

      const current = await sleeveMetrics(currentFile);
      const baseline = await sleeveMetrics(baselineFile);
      const averageWidthLoss = baseline.averageWidthRatio - current.averageWidthRatio;
      const leftWidthLoss = baseline.leftWidthRatio - current.leftWidthRatio;
      const rightWidthLoss = baseline.rightWidthRatio - current.rightWidthRatio;
      const sideWidthImbalance = Math.abs(current.leftWidthRatio - current.rightWidthRatio);

      rows.push({
        averageWidthLoss: Number(averageWidthLoss.toFixed(4)),
        baselineAverageWidthRatio: Number(baseline.averageWidthRatio.toFixed(4)),
        baselineLeftArea: baseline.leftArea,
        baselineLeftWidthRatio: Number(baseline.leftWidthRatio.toFixed(4)),
        baselineRightArea: baseline.rightArea,
        baselineRightWidthRatio: Number(baseline.rightWidthRatio.toFixed(4)),
        currentAverageWidthRatio: Number(current.averageWidthRatio.toFixed(4)),
        currentLeftArea: current.leftArea,
        currentLeftWidthRatio: Number(current.leftWidthRatio.toFixed(4)),
        currentRightArea: current.rightArea,
        currentRightWidthRatio: Number(current.rightWidthRatio.toFixed(4)),
        file: `${sheetEntry.name}/${fileEntry.name}`,
        leftWidthLoss: Number(leftWidthLoss.toFixed(4)),
        rightWidthLoss: Number(rightWidthLoss.toFixed(4)),
        sideWidthImbalance: Number(sideWidthImbalance.toFixed(4)),
        sideWidthLoss: Number(Math.max(leftWidthLoss, rightWidthLoss).toFixed(4)),
      });
    }
  }

  return rows.sort((a, b) => a.file.localeCompare(b.file));
}

function maxBy(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key])[0];
}

function minBy(rows, key) {
  return [...rows].sort((a, b) => a[key] - b[key])[0];
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    baselineRoot: path.resolve(readOption(args, 'baseline-source', DEFAULTS.baselineSource)),
    currentRoot: path.resolve(readOption(args, 'current-source', DEFAULTS.currentSource)),
    maxAverageWidthLoss: readNumberOption(
      args,
      'max-average-width-loss',
      DEFAULTS.maxAverageWidthLoss,
    ),
    maxSideWidthImbalance: readNumberOption(
      args,
      'max-side-width-imbalance',
      DEFAULTS.maxSideWidthImbalance,
    ),
    maxSideWidthLoss: readNumberOption(args, 'max-side-width-loss', DEFAULTS.maxSideWidthLoss),
    minAverageWidthRatio: readNumberOption(
      args,
      'min-average-width-ratio',
      DEFAULTS.minAverageWidthRatio,
    ),
    minSideWidthRatio: readNumberOption(args, 'min-side-width-ratio', DEFAULTS.minSideWidthRatio),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
  };

  const rows = await collectRows(options.currentRoot, options.baselineRoot);
  if (!rows.length) {
    throw new Error(
      `No Reimu T/Y sleeve frames found in ${path.relative(process.cwd(), options.currentRoot)}`,
    );
  }

  const summary = {
    frameCount: rows.length,
    maxAverageWidthLoss: maxBy(rows, 'averageWidthLoss'),
    maxSideWidthImbalance: maxBy(rows, 'sideWidthImbalance'),
    maxSideWidthLoss: maxBy(rows, 'sideWidthLoss'),
    minCurrentAverageWidthRatio: minBy(rows, 'currentAverageWidthRatio'),
    minCurrentSideWidthRatio: [...rows]
      .map((row) => ({
        ...row,
        currentSideWidthRatio: Math.min(row.currentLeftWidthRatio, row.currentRightWidthRatio),
      }))
      .sort((a, b) => a.currentSideWidthRatio - b.currentSideWidthRatio)[0],
    thresholds: {
      maxAverageWidthLoss: options.maxAverageWidthLoss,
      maxSideWidthImbalance: options.maxSideWidthImbalance,
      maxSideWidthLoss: options.maxSideWidthLoss,
      minAverageWidthRatio: options.minAverageWidthRatio,
      minSideWidthRatio: options.minSideWidthRatio,
    },
  };
  const headers = Object.keys(rows[0] ?? {});
  const csv = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');

  await mkdir(options.outputRoot, { recursive: true });
  await writeFile(path.join(options.outputRoot, 'reimu-sleeve-guard.csv'), `${csv}\n`);
  await writeFile(
    path.join(options.outputRoot, 'reimu-sleeve-guard-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Audited ${rows.length} Reimu T/Y sleeve frame pairs`);
  console.log(JSON.stringify(summary, null, 2));

  const hardFailures = [];
  if (summary.maxAverageWidthLoss.averageWidthLoss > options.maxAverageWidthLoss) {
    hardFailures.push(
      `${summary.maxAverageWidthLoss.file} average sleeve width loss `
      + `${summary.maxAverageWidthLoss.averageWidthLoss} > ${options.maxAverageWidthLoss}`,
    );
  }
  if (summary.maxSideWidthLoss.sideWidthLoss > options.maxSideWidthLoss) {
    hardFailures.push(
      `${summary.maxSideWidthLoss.file} side sleeve width loss `
      + `${summary.maxSideWidthLoss.sideWidthLoss} > ${options.maxSideWidthLoss}`,
    );
  }
  if (summary.maxSideWidthImbalance.sideWidthImbalance > options.maxSideWidthImbalance) {
    hardFailures.push(
      `${summary.maxSideWidthImbalance.file} sleeve side width imbalance `
      + `${summary.maxSideWidthImbalance.sideWidthImbalance} > ${options.maxSideWidthImbalance}`,
    );
  }
  if (summary.minCurrentAverageWidthRatio.currentAverageWidthRatio < options.minAverageWidthRatio) {
    hardFailures.push(
      `${summary.minCurrentAverageWidthRatio.file} average sleeve width ratio `
      + `${summary.minCurrentAverageWidthRatio.currentAverageWidthRatio} < ${options.minAverageWidthRatio}`,
    );
  }
  if (summary.minCurrentSideWidthRatio.currentSideWidthRatio < options.minSideWidthRatio) {
    hardFailures.push(
      `${summary.minCurrentSideWidthRatio.file} side sleeve width ratio `
      + `${summary.minCurrentSideWidthRatio.currentSideWidthRatio} < ${options.minSideWidthRatio}`,
    );
  }

  if (hardFailures.length) {
    throw new Error(`Reimu sleeve guard audit failed:\n- ${hardFailures.join('\n- ')}`);
  }

  console.log('Reimu sleeve guard audit hard checks passed.');
}

await main();
