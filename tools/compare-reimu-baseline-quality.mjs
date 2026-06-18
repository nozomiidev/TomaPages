import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  baselineRoot: 'tmp/before-lossless/public/characters/reimu',
  currentRoot: 'public/characters/reimu',
  expectedFrames: 225,
  maxInternalGapArea: 1800,
  maxWeakAlpha: 320,
  outputRoot: 'tmp/baseline-delta',
  transparentThreshold: 16,
};

const METRICS = [
  'transparentNonBlack',
  'weakAlphaPixels',
  'detachedArea',
  'detachedSliverArea',
  'lineLikeHoleArea',
  'lightInteriorGapArea',
  'internalGapArea',
];

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

async function pathStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function walkWebp(root) {
  const files = [];

  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (entry.isFile() && entry.name.endsWith('.webp')) {
        files.push(file);
      }
    }
  }

  if (!(await pathStat(root))?.isDirectory()) return files;
  await visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function relativeFrame(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
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

function isDetachedSliverComponent(component) {
  const shortSide = Math.min(component.width, component.height);
  const longSide = Math.max(component.width, component.height);

  return shortSide <= 16 && longSide >= 8;
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

function isLightClothPixel(red, green, blue) {
  return (
    red >= 185
    && green >= 165
    && blue >= 155
    && red - blue <= 80
    && red - green <= 70
  );
}

function hasLightInteriorGapNeighbors(data, component, width, height) {
  if (component.area > 700 || component.width > 44 || component.height > 48) return false;

  const inHole = new Set(component.pixels);
  let lightCount = 0;
  let totalCount = 0;

  for (const index of component.pixels) {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        if (dx === 0 && dy === 0) continue;

        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) continue;

        const neighbor = candidateY * width + candidateX;
        if (inHole.has(neighbor)) continue;

        const offset = neighbor * 4;
        if (data[offset + 3] < 16) continue;

        totalCount += 1;
        if (isLightClothPixel(data[offset], data[offset + 1], data[offset + 2])) {
          lightCount += 1;
        }
      }
    }
  }

  return lightCount / Math.max(1, totalCount) >= 0.33;
}

async function auditFrame(file, relativeFile, transparentThreshold) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaMask = new Uint8Array(info.width * info.height);
  const transparentMask = new Uint8Array(info.width * info.height);
  let transparentNonBlack = 0;
  let weakAlphaPixels = 0;

  for (let index = 0; index < alphaMask.length; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];

    if (alpha >= transparentThreshold) {
      alphaMask[index] = 1;
    } else {
      transparentMask[index] = 1;
    }

    if (alpha > 0 && alpha < 32) weakAlphaPixels += 1;
    if (alpha === 0 && (data[offset] || data[offset + 1] || data[offset + 2])) {
      transparentNonBlack += 1;
    }
  }

  const components = componentList(alphaMask, info.width, info.height);
  const detached = components.slice(1).filter((component) => component.area >= 16);
  const detachedSlivers = detached.filter(isDetachedSliverComponent);
  const holes = componentList(transparentMask, info.width, info.height)
    .filter((component) => !component.touchEdge);
  const lineLikeHoles = holes.filter(isLineLikeInteriorHole);
  const lightInteriorGaps = holes.filter((component) => (
    hasLightInteriorGapNeighbors(data, component, info.width, info.height)
  ));
  const holeArea = holes.reduce((sum, component) => sum + component.area, 0);
  const lineLikeHoleArea = lineLikeHoles.reduce((sum, component) => sum + component.area, 0);

  return {
    detachedArea: detached.reduce((sum, component) => sum + component.area, 0),
    detachedSliverArea: detachedSlivers.reduce((sum, component) => sum + component.area, 0),
    file: relativeFile,
    internalGapArea: holeArea - lineLikeHoleArea,
    lightInteriorGapArea: lightInteriorGaps.reduce((sum, component) => sum + component.area, 0),
    lineLikeHoleArea,
    transparentNonBlack,
    weakAlphaPixels,
  };
}

async function auditRoot(root, transparentThreshold) {
  const files = await walkWebp(root);
  const rows = [];

  for (const file of files) {
    rows.push(await auditFrame(file, relativeFrame(root, file), transparentThreshold));
  }

  return rows;
}

function sumBy(rows, key) {
  return rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0);
}

function maxBy(rows, key) {
  return [...rows].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0))[0] ?? { [key]: 0 };
}

function buildDeltaRows(baselineRows, currentRows) {
  const baselineByFile = new Map(baselineRows.map((row) => [row.file, row]));
  const currentByFile = new Map(currentRows.map((row) => [row.file, row]));
  const files = [...new Set([...baselineByFile.keys(), ...currentByFile.keys()])].sort();

  return files.map((file) => {
    const baseline = baselineByFile.get(file) ?? { file };
    const current = currentByFile.get(file) ?? { file };
    const row = { file };

    for (const metric of METRICS) {
      const before = Number(baseline[metric] ?? 0);
      const after = Number(current[metric] ?? 0);
      row[`${metric}Before`] = before;
      row[`${metric}After`] = after;
      row[`${metric}Delta`] = after - before;
    }

    return row;
  });
}

function reductionRatio(before, after) {
  if (before <= 0) return after <= 0 ? 1 : 0;
  return Number(((before - after) / before).toFixed(4));
}

function countRegressions(deltaRows) {
  return Object.fromEntries(METRICS.map((metric) => [
    metric,
    deltaRows.filter((row) => Number(row[`${metric}Delta`]) > 0).length,
  ]));
}

function summarize({
  baselineRows,
  currentRows,
  deltaRows,
  expectedFrames,
  maxInternalGapArea,
  maxWeakAlpha,
}) {
  const totals = Object.fromEntries(METRICS.map((metric) => {
    const before = sumBy(baselineRows, metric);
    const after = sumBy(currentRows, metric);

    return [metric, {
      after,
      before,
      delta: after - before,
      reductionRatio: reductionRatio(before, after),
    }];
  }));
  const max = Object.fromEntries(METRICS.map((metric) => [
    metric,
    {
      after: maxBy(currentRows, metric),
      before: maxBy(baselineRows, metric),
    },
  ]));
  const improvedFrameCount = deltaRows.filter((row) => (
    METRICS.some((metric) => Number(row[`${metric}Delta`]) < 0)
  )).length;
  const regressedFrameCount = deltaRows.filter((row) => (
    METRICS.some((metric) => Number(row[`${metric}Delta`]) > 0)
  )).length;
  const maxCurrentWeakAlpha = max.weakAlphaPixels.after.weakAlphaPixels ?? 0;
  const maxCurrentInternalGapArea = max.internalGapArea.after.internalGapArea ?? 0;

  return {
    baselineFrameCount: baselineRows.length,
    budgets: {
      maxInternalGapArea,
      maxWeakAlpha,
    },
    checks: {
      detachedAreaNotIntroduced: totals.detachedArea.after <= totals.detachedArea.before,
      detachedSliverAreaNotIntroduced: totals.detachedSliverArea.after
        <= totals.detachedSliverArea.before,
      expectedBaselineFrames: baselineRows.length === expectedFrames,
      expectedCurrentFrames: currentRows.length === expectedFrames,
      internalGapTotalReduced: totals.internalGapArea.after < totals.internalGapArea.before,
      internalGapWithinQualityBudget: maxCurrentInternalGapArea <= maxInternalGapArea,
      lightInteriorGapsNotWorse: totals.lightInteriorGapArea.after <= totals.lightInteriorGapArea.before,
      lineLikeHolesNotWorse: totals.lineLikeHoleArea.after <= totals.lineLikeHoleArea.before,
      transparentNonBlackCleared: totals.transparentNonBlack.before > 0
        && totals.transparentNonBlack.after === 0,
      weakAlphaWithinQualityBudget: maxCurrentWeakAlpha <= maxWeakAlpha,
    },
    currentFrameCount: currentRows.length,
    improvedFrameCount,
    max,
    metricCount: METRICS.length,
    regressionCounts: countRegressions(deltaRows),
    regressedFrameCount,
    totals,
  };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function renderSummaryPng(summary, outputFile) {
  const width = 960;
  const rowHeight = 42;
  const headerHeight = 84;
  const height = headerHeight + METRICS.length * rowHeight + 30;
  const maxBefore = Math.max(...METRICS.map((metric) => summary.totals[metric].before), 1);
  const rows = METRICS.map((metric, index) => {
    const total = summary.totals[metric];
    const y = headerHeight + index * rowHeight;
    const beforeWidth = Math.round((total.before / maxBefore) * 300);
    const afterWidth = Math.round((total.after / maxBefore) * 300);

    return [
      `<text x="24" y="${y + 25}" font-family="Arial" font-size="13" fill="#111827">${escapeText(metric)}</text>`,
      `<rect x="245" y="${y + 9}" width="${beforeWidth}" height="12" fill="#f97316"/>`,
      `<rect x="245" y="${y + 25}" width="${afterWidth}" height="12" fill="#14b8a6"/>`,
      `<text x="570" y="${y + 20}" font-family="Arial" font-size="12" fill="#475569">before ${total.before}</text>`,
      `<text x="710" y="${y + 20}" font-family="Arial" font-size="12" fill="#475569">after ${total.after}</text>`,
      `<text x="830" y="${y + 20}" font-family="Arial" font-size="12" fill="#475569">reduced ${(total.reductionRatio * 100).toFixed(1)}%</text>`,
    ].join('');
  }).join('');
  const svg = Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + '<text x="24" y="28" font-family="Arial" font-size="18" font-weight="700" fill="#111827">Reimu baseline quality delta</text>'
    + `<text x="24" y="52" font-family="Arial" font-size="12" fill="#475569">baseline ${summary.baselineFrameCount} frames / current ${summary.currentFrameCount} frames / improved frames ${summary.improvedFrameCount}</text>`
    + '<text x="245" y="76" font-family="Arial" font-size="11" fill="#f97316">before</text>'
    + '<text x="310" y="76" font-family="Arial" font-size="11" fill="#14b8a6">after</text>'
    + rows
    + '</svg>',
  );

  await sharp(svg).png().toFile(outputFile);
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    baselineRoot: path.resolve(readOption(args, 'baseline-root', DEFAULTS.baselineRoot)),
    currentRoot: path.resolve(readOption(args, 'current-root', DEFAULTS.currentRoot)),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    maxInternalGapArea: readNumberOption(
      args,
      'max-internal-gap-area',
      DEFAULTS.maxInternalGapArea,
    ),
    maxWeakAlpha: readNumberOption(args, 'max-weak-alpha', DEFAULTS.maxWeakAlpha),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    transparentThreshold: readNumberOption(
      args,
      'transparent-threshold',
      DEFAULTS.transparentThreshold,
    ),
  };
  const [baselineRows, currentRows] = await Promise.all([
    auditRoot(options.baselineRoot, options.transparentThreshold),
    auditRoot(options.currentRoot, options.transparentThreshold),
  ]);
  if (!baselineRows.length) {
    throw new Error(`Missing baseline frames under ${path.relative(process.cwd(), options.baselineRoot)}`);
  }
  if (!currentRows.length) {
    throw new Error(`Missing current frames under ${path.relative(process.cwd(), options.currentRoot)}`);
  }

  const deltaRows = buildDeltaRows(baselineRows, currentRows);
  const summary = summarize({
    baselineRows,
    currentRows,
    deltaRows,
    expectedFrames: options.expectedFrames,
    maxInternalGapArea: options.maxInternalGapArea,
    maxWeakAlpha: options.maxWeakAlpha,
  });
  const failures = Object.entries(summary.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  await mkdir(options.outputRoot, { recursive: true });
  const csvHeaders = ['file', ...METRICS.flatMap((metric) => [
    `${metric}Before`,
    `${metric}After`,
    `${metric}Delta`,
  ])];
  const csv = [
    csvHeaders.join(','),
    ...deltaRows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');

  await writeFile(path.join(options.outputRoot, 'reimu-baseline-quality-delta.csv'), `${csv}\n`);
  await writeFile(
    path.join(options.outputRoot, 'reimu-baseline-quality-delta-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await renderSummaryPng(
    summary,
    path.join(options.outputRoot, 'reimu-baseline-quality-delta.png'),
  );

  console.log('Compared Reimu current assets with recovered before-lossless baseline.');
  console.log(JSON.stringify(summary, null, 2));
  if (failures.length) {
    throw new Error(`Reimu baseline quality delta failed:\n- ${failures.join('\n- ')}`);
  }
}

await main();
