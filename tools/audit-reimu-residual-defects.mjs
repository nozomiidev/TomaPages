import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  edgeSummary: 'tmp/edge-audit/reimu-edge-integrity-summary.json',
  expectedFrames: 225,
  gapSummary: 'tmp/gap-audit/reimu-reference-covered-gap-summary.json',
  lineSummary: 'tmp/line-audit/reimu-line-integrity-summary.json',
  outputRoot: 'tmp/quality-audit',
  qualityCsv: 'tmp/quality-audit/reimu-asset-quality.csv',
  qualitySummary: 'tmp/quality-audit/reimu-asset-quality-summary.json',
  sleeveSummary: 'tmp/quality-audit/reimu-sleeve-guard-summary.json',
};

const ACTIONABLE_KEYS = [
  'detachedArea',
  'detachedSliverArea',
  'lightInteriorGapArea',
  'lineLikeHoleArea',
  'suspiciousHoleArea',
  'transparentNonBlack',
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

function csvRows(text) {
  const lines = text.trim().split(/\r?\n/u);
  if (lines.length <= 1) return [];
  const header = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
  });
}

function parseCsvLine(line) {
  const cells = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        value += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(value);
      value = '';
    } else {
      value += char;
    }
  }

  cells.push(value);
  return cells;
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function numberValue(row, key) {
  const value = Number(row[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function topBy(rows, key, count = 8) {
  return [...rows]
    .filter((row) => numberValue(row, key) > 0)
    .sort((left, right) => numberValue(right, key) - numberValue(left, key))
    .slice(0, count)
    .map((row) => ({
      file: row.file,
      [key]: numberValue(row, key),
    }));
}

function maxMetric(summary, key, metric = key) {
  return Number(summary[key]?.[metric] ?? 0);
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    edgeSummary: path.resolve(readOption(args, 'edge-summary', DEFAULTS.edgeSummary)),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    gapSummary: path.resolve(readOption(args, 'gap-summary', DEFAULTS.gapSummary)),
    lineSummary: path.resolve(readOption(args, 'line-summary', DEFAULTS.lineSummary)),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    qualityCsv: path.resolve(readOption(args, 'quality-csv', DEFAULTS.qualityCsv)),
    qualitySummary: path.resolve(readOption(args, 'quality-summary', DEFAULTS.qualitySummary)),
    sleeveSummary: path.resolve(readOption(args, 'sleeve-summary', DEFAULTS.sleeveSummary)),
  };

  const [
    qualitySummary,
    edgeSummary,
    gapSummary,
    lineSummary,
    sleeveSummary,
    qualityCsv,
  ] = await Promise.all([
    readJson(options.qualitySummary),
    readJson(options.edgeSummary),
    readJson(options.gapSummary),
    readJson(options.lineSummary),
    readJson(options.sleeveSummary),
    readFile(options.qualityCsv, 'utf8'),
  ]);
  const rows = csvRows(qualityCsv);
  const actionableRows = rows.filter((row) => (
    ACTIONABLE_KEYS.some((key) => numberValue(row, key) > 0)
  ));
  const reviewOnlyRows = rows.filter((row) => (
    !actionableRows.includes(row)
    && (numberValue(row, 'weakAlphaPixels') > 0 || numberValue(row, 'internalGapArea') > 0)
  ));
  const checks = {
    detachedArea: maxMetric(qualitySummary, 'maxDetachedArea', 'detachedArea') === 0,
    detachedSliverArea: maxMetric(qualitySummary, 'maxDetachedSliverArea', 'detachedSliverArea') === 0,
    frameCount: rows.length === options.expectedFrames && qualitySummary.frameCount === options.expectedFrames,
    lightInteriorGapArea: maxMetric(qualitySummary, 'maxLightInteriorGapArea', 'lightInteriorGapArea') === 0,
    lineLikeHoleArea: maxMetric(qualitySummary, 'maxLineLikeHoleArea', 'lineLikeHoleArea') === 0,
    lineIntegrityPixels: (
      Number(lineSummary.maxUnsupportedEdgeInkPixels?.unsupportedEdgeInkPixels ?? 0)
      <= Number(lineSummary.thresholds?.maxUnsupportedEdgeInkPixels ?? 0)
    ),
    lineIntegrityRatio: (
      Number(lineSummary.maxUnsupportedEdgeInkRatio?.unsupportedEdgeInkRatio ?? 0)
      <= Number(lineSummary.thresholds?.maxUnsupportedEdgeInkRatio ?? 0)
    ),
    orphanWeakAlpha: maxMetric(edgeSummary, 'maxOrphanWeakAlphaPixels', 'orphanWeakAlphaPixels') === 0,
    referenceCoveredGapArea: Number(gapSummary.totalReferenceCoveredGapArea ?? 0) === 0,
    referenceCoveredGapCount: Number(gapSummary.totalReferenceCoveredGapCount ?? 0) === 0,
    suspiciousHoleArea: maxMetric(qualitySummary, 'maxSuspiciousHoleArea', 'suspiciousHoleArea') === 0,
    transparentColoredPixels: maxMetric(edgeSummary, 'maxTransparentColoredPixels', 'transparentColoredPixels') === 0,
    transparentNonBlack: maxMetric(qualitySummary, 'maxTransparentNonBlack', 'transparentNonBlack') === 0,
  };
  const summary = {
    actionableDefectFrameCount: actionableRows.length,
    actionableExamples: actionableRows.slice(0, 12).map((row) => ({
      file: row.file,
      metrics: Object.fromEntries(ACTIONABLE_KEYS.map((key) => [key, numberValue(row, key)])),
    })),
    checks,
    frameCount: rows.length,
    originalInternalGapReviewFrameCount: rows.filter((row) => numberValue(row, 'internalGapArea') > 0).length,
    reviewOnlyFrameCount: reviewOnlyRows.length,
    lineIntegrityHeadroom: {
      unsupportedEdgeInkPixels: Number((
        Number(lineSummary.thresholds.maxUnsupportedEdgeInkPixels)
        - Number(lineSummary.maxUnsupportedEdgeInkPixels.unsupportedEdgeInkPixels)
      ).toFixed(4)),
      unsupportedEdgeInkRatio: Number((
        Number(lineSummary.thresholds.maxUnsupportedEdgeInkRatio)
        - Number(lineSummary.maxUnsupportedEdgeInkRatio.unsupportedEdgeInkRatio)
      ).toFixed(4)),
    },
    sleeveGuardHeadroom: {
      averageWidthLoss: Number((Number(sleeveSummary.thresholds.maxAverageWidthLoss)
        - Number(sleeveSummary.maxAverageWidthLoss.averageWidthLoss)).toFixed(4)),
      sideWidthImbalance: Number((Number(sleeveSummary.thresholds.maxSideWidthImbalance)
        - Number(sleeveSummary.maxSideWidthImbalance.sideWidthImbalance)).toFixed(4)),
      sideWidthLoss: Number((Number(sleeveSummary.thresholds.maxSideWidthLoss)
        - Number(sleeveSummary.maxSideWidthLoss.sideWidthLoss)).toFixed(4)),
    },
    topOriginalInternalGaps: topBy(rows, 'internalGapArea', 8),
    topSupportedWeakAlpha: topBy(rows, 'weakAlphaPixels', 8),
    weakAlphaReviewFrameCount: rows.filter((row) => numberValue(row, 'weakAlphaPixels') > 0).length,
  };

  await mkdir(options.outputRoot, { recursive: true });
  const outputFile = path.join(options.outputRoot, 'reimu-residual-defect-summary.json');
  await writeFile(outputFile, `${JSON.stringify(summary, null, 2)}\n`);

  console.log('Audited Reimu residual defect disposition');
  console.log(JSON.stringify(summary, null, 2));

  if (summary.actionableDefectFrameCount > 0) {
    throw new Error(`${summary.actionableDefectFrameCount} actionable residual defect frames remain`);
  }

  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([key]) => key);
  if (failedChecks.length > 0) {
    throw new Error(`Residual defect checks failed: ${failedChecks.join(', ')}`);
  }

  console.log('Residual defect hard checks passed.');
}

await main();
