import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  baselineRoot: 'tmp/noreshape/reimu',
  cellSize: 160,
  cols: 2,
  edgeSummary: 'tmp/edge-audit/reimu-edge-integrity-summary.json',
  expressionCsv: 'tmp/expression-audit/reimu-expression-diff-audit.csv',
  expressionSummary: 'tmp/expression-audit/reimu-expression-diff-audit-summary.json',
  gapSummary: 'tmp/gap-audit/reimu-reference-covered-gap-summary.json',
  lineSummary: 'tmp/line-audit/reimu-line-integrity-summary.json',
  maxExpressionAlphaChangedPixels: 1600,
  maxExpressionChangedRatio: 0.28,
  maxFrames: 12,
  openAiTargetSummary: 'tmp/reference-audit/reimu-openai-reference-targets-summary.json',
  outputRoot: 'tmp/perceptual-audit',
  qualityCsv: 'tmp/quality-audit/reimu-asset-quality.csv',
  qualitySummary: 'tmp/quality-audit/reimu-asset-quality-summary.json',
  residualSummary: 'tmp/quality-audit/reimu-residual-defect-summary.json',
  sleeveCsv: 'tmp/quality-audit/reimu-sleeve-guard.csv',
  sleeveSummary: 'tmp/quality-audit/reimu-sleeve-guard-summary.json',
  sourceRoot: 'public/characters/reimu',
  zoomCellSize: 256,
  zoomCols: 2,
};

const BACKGROUND = [248, 250, 252];
const DIFF_THRESHOLD = 24;

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && next === '"' && quoted) {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

async function readCsv(file) {
  const contents = await readFile(file, 'utf8');
  const lines = contents.trim().split(/\r?\n/u).filter(Boolean);
  const headers = parseCsvLine(lines.shift() ?? '');

  return lines.map((line) => {
    const cells = parseCsvLine(line);
    const row = {};

    for (let index = 0; index < headers.length; index += 1) {
      const key = headers[index];
      const value = cells[index] ?? '';
      const numberValue = Number(value);
      row[key] = value !== '' && Number.isFinite(numberValue) ? numberValue : value;
    }

    return row;
  });
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
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

function normalizeReimuFile(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/');
  const marker = 'public/characters/reimu/';
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex >= 0) return normalized.slice(markerIndex + marker.length);
  if (/^[a-z]{2}_01\/r\d+c\d+\.webp$/u.test(normalized)) return normalized;
  return null;
}

function parseFrame(file) {
  const normalized = normalizeReimuFile(file);
  if (!normalized) return null;
  const [sheet, frame] = normalized.split('/');
  const match = /^r(\d+)c(\d+)\.webp$/u.exec(frame);
  if (!match) return null;

  return {
    col: Number(match[2]),
    file: normalized,
    frame,
    pose: sheet[1],
    row: Number(match[1]),
    sheet,
    state: sheet[0],
  };
}

function framePath(root, relativeFile) {
  return path.join(root, ...relativeFile.split('/'));
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : 'n/a';
}

function candidateStore() {
  const items = new Map();

  return {
    add({ file, metrics = {}, priority, reason, score }) {
      const normalized = normalizeReimuFile(file);
      if (!normalized) return;

      const existing = items.get(normalized);
      if (existing) {
        existing.priority = Math.max(existing.priority, priority);
        existing.score = Math.max(existing.score, score);
        existing.reasons.push(reason);
        Object.assign(existing.metrics, metrics);
        return;
      }

      items.set(normalized, {
        file: normalized,
        metrics: { ...metrics },
        priority,
        reasons: [reason],
        score,
      });
    },
    values() {
      return [...items.values()];
    },
  };
}

function topRows(rows, key, count) {
  return [...rows]
    .filter((row) => Number.isFinite(Number(row[key])) && Number(row[key]) > 0)
    .sort((left, right) => Number(right[key]) - Number(left[key]))
    .slice(0, count);
}

function rowsByFile(rows) {
  const map = new Map();
  for (const row of rows) {
    const normalized = normalizeReimuFile(row.file);
    if (normalized) map.set(normalized, row);
  }
  return map;
}

function hasMetric(candidate, name) {
  return Object.hasOwn(candidate.metrics, name);
}

function classifyCandidate(candidate, {
  checks,
  edgeSummary,
  gapSummary,
  openAiSummary,
  options,
  qualityByFile,
  residualSummary,
  sleeveByFile,
  sleeveSummary,
}) {
  const gateResults = [];
  const dispositionReasons = [];
  const qualityRow = qualityByFile.get(candidate.file) ?? {};
  const sleeveRow = sleeveByFile.get(candidate.file) ?? {};
  let actionable = false;

  function addGate(name, passed, reason) {
    gateResults.push({ name, passed, reason });
    dispositionReasons.push(`${passed ? 'pass' : 'fail'}: ${reason}`);
    if (!passed) actionable = true;
  }

  addGate(
    'global-hard-checks',
    Object.values(checks).every(Boolean) && residualSummary.actionableDefectFrameCount === 0,
    'global hard checks passed and residual actionable defects are zero',
  );

  if (hasMetric(candidate, 'internalGapArea')) {
    const originalGapIsReviewOnly = (
      Number(qualityRow.suspiciousHoleArea ?? 0) === 0
      && Number(qualityRow.lineLikeHoleArea ?? 0) === 0
      && Number(qualityRow.lightInteriorGapArea ?? 0) === 0
      && Number(gapSummary.totalReferenceCoveredGapArea ?? 0) === 0
      && Number(gapSummary.totalReferenceCoveredGapCount ?? 0) === 0
    );
    addGate(
      'original-gap-review-only',
      originalGapIsReviewOnly,
      'internal gap is not suspicious, line-like, light-cloth, or reference-covered',
    );
  }

  if (hasMetric(candidate, 'weakAlphaPixels')) {
    const weakAlphaIsSupported = (
      Number(edgeSummary.maxOrphanWeakAlphaPixels?.orphanWeakAlphaPixels ?? 0) === 0
      && Number(edgeSummary.maxTransparentColoredPixels?.transparentColoredPixels ?? 0) === 0
      && Number(qualityRow.transparentNonBlack ?? 0) === 0
    );
    addGate(
      'supported-weak-alpha',
      weakAlphaIsSupported,
      'weak alpha remains attached to visible edges without colored transparent residue',
    );
  }

  if (
    hasMetric(candidate, 'sideWidthLoss')
    || hasMetric(candidate, 'sideWidthImbalance')
    || hasMetric(candidate, 'currentSideWidthRatio')
  ) {
    const thresholds = sleeveSummary.thresholds ?? {};
    const currentSideWidthRatio = Math.min(
      Number(sleeveRow.currentLeftWidthRatio ?? Infinity),
      Number(sleeveRow.currentRightWidthRatio ?? Infinity),
    );
    const sleeveGatePasses = (
      Number(sleeveRow.averageWidthLoss ?? 0) <= Number(thresholds.maxAverageWidthLoss ?? 0)
      && Number(sleeveRow.sideWidthLoss ?? 0) <= Number(thresholds.maxSideWidthLoss ?? 0)
      && Number(sleeveRow.sideWidthImbalance ?? 0) <= Number(thresholds.maxSideWidthImbalance ?? 0)
      && currentSideWidthRatio >= Number(thresholds.minSideWidthRatio ?? 0)
    );
    addGate(
      'within-sleeve-guard',
      sleeveGatePasses,
      'sleeve candidate remains inside width, side-loss, and side-imbalance guard thresholds',
    );
  }

  if (hasMetric(candidate, 'changedRatio')) {
    addGate(
      'within-expression-ratio-gate',
      Number(candidate.metrics.changedRatio) <= options.maxExpressionChangedRatio,
      `expression changed ratio is at or below ${options.maxExpressionChangedRatio}`,
    );
  }

  if (hasMetric(candidate, 'alphaChangedPixels')) {
    addGate(
      'within-expression-alpha-gate',
      Number(candidate.metrics.alphaChangedPixels) <= options.maxExpressionAlphaChangedPixels,
      `expression alpha delta is at or below ${options.maxExpressionAlphaChangedPixels}`,
    );
  }

  if (hasMetric(candidate, 'openAiSleeveTargetRatio')) {
    addGate(
      'openai-material-postprocess',
      openAiSummary.directAdoptionBlocked === true && Number(openAiSummary.openAiReferenceCount ?? 0) >= 5,
      'OpenAI sleeve targets are measured material for local post-processing while full-frame replacement remains blocked',
    );
  }

  if (
    hasMetric(candidate, 'centerStep')
    || hasMetric(candidate, 'heightStep')
    || hasMetric(candidate, 'widthStep')
    || hasMetric(candidate, 'alphaStepRatio')
  ) {
    addGate(
      'neighbor-review-only',
      Number(qualityRow.detachedArea ?? 0) === 0
        && Number(qualityRow.detachedSliverArea ?? 0) === 0
        && Number(qualityRow.transparentNonBlack ?? 0) === 0,
      'neighbor step candidate has no detached fragments or transparent RGB residue',
    );
  }

  return {
    ...candidate,
    disposition: actionable ? 'actionable' : 'review-only',
    dispositionReasons,
    gateResults,
  };
}

function computeNeighborSteps(rows) {
  const bySheet = new Map();
  const steps = [];

  for (const row of rows) {
    const parsed = parseFrame(row.file);
    if (!parsed) continue;
    const sheet = bySheet.get(parsed.sheet) ?? new Map();
    sheet.set(`${parsed.row},${parsed.col}`, { ...row, parsed });
    bySheet.set(parsed.sheet, sheet);
  }

  for (const [sheetName, sheet] of bySheet) {
    for (const row of sheet.values()) {
      for (const [rowDelta, colDelta] of [[1, 0], [0, 1]]) {
        const neighbor = sheet.get(`${row.parsed.row + rowDelta},${row.parsed.col + colDelta}`);
        if (!neighbor) continue;

        steps.push({
          alphaStepRatio: Math.abs(neighbor.alphaPixels - row.alphaPixels)
            / Math.max(neighbor.alphaPixels, row.alphaPixels, 1),
          centerStep: Math.hypot(neighbor.centerX - row.centerX, neighbor.centerY - row.centerY),
          file: neighbor.file,
          heightStep: Math.abs(neighbor.height - row.height),
          key: `${sheetName}/r${row.parsed.row}c${row.parsed.col}->r${neighbor.parsed.row}c${neighbor.parsed.col}`,
          widthStep: Math.abs(neighbor.width - row.width),
        });
      }
    }
  }

  return steps;
}

function collectCandidates({ expressionRows, openAiSummary, qualityRows, sleeveRows }, maxFrames) {
  const candidates = candidateStore();

  for (const row of topRows(qualityRows, 'internalGapArea', 4)) {
    candidates.add({
      file: row.file,
      metrics: { internalGapArea: row.internalGapArea },
      priority: 95,
      reason: `original internal gap ${row.internalGapArea}`,
      score: Number(row.internalGapArea),
    });
  }
  for (const row of topRows(qualityRows, 'weakAlphaPixels', 6)) {
    candidates.add({
      file: row.file,
      metrics: { weakAlphaPixels: row.weakAlphaPixels },
      priority: 70,
      reason: `supported weak alpha ${row.weakAlphaPixels}`,
      score: Number(row.weakAlphaPixels),
    });
  }

  const neighborSteps = computeNeighborSteps(qualityRows);
  for (const [key, label] of [
    ['centerStep', 'neighbor center step'],
    ['heightStep', 'neighbor height step'],
    ['widthStep', 'neighbor width step'],
    ['alphaStepRatio', 'neighbor alpha step'],
  ]) {
    for (const row of topRows(neighborSteps, key, 3)) {
      candidates.add({
        file: row.file,
        metrics: { [key]: Number(row[key].toFixed?.(4) ?? row[key]) },
        priority: 82,
        reason: `${label} ${row.key} ${formatNumber(row[key], key.endsWith('Ratio') ? 4 : 2)}`,
        score: Number(row[key]),
      });
    }
  }

  for (const row of topRows(expressionRows, 'changedRatio', 4)) {
    candidates.add({
      file: `${row.rightSheet}/${row.file}`,
      metrics: { changedRatio: row.changedRatio },
      priority: 78,
      reason: `expression changed ratio ${row.pose}/${row.file} ${formatNumber(row.changedRatio, 4)}`,
      score: Number(row.changedRatio),
    });
  }
  for (const row of topRows(expressionRows, 'alphaChangedPixels', 4)) {
    candidates.add({
      file: `${row.rightSheet}/${row.file}`,
      metrics: { alphaChangedPixels: row.alphaChangedPixels },
      priority: 80,
      reason: `expression alpha delta ${row.pose}/${row.file} ${row.alphaChangedPixels}`,
      score: Number(row.alphaChangedPixels),
    });
  }

  for (const row of topRows(sleeveRows, 'sideWidthLoss', 4)) {
    candidates.add({
      file: row.file,
      metrics: { sideWidthLoss: row.sideWidthLoss },
      priority: 88,
      reason: `sleeve side loss ${formatNumber(row.sideWidthLoss, 4)}`,
      score: Number(row.sideWidthLoss),
    });
  }
  for (const row of topRows(sleeveRows, 'sideWidthImbalance', 4)) {
    candidates.add({
      file: row.file,
      metrics: { sideWidthImbalance: row.sideWidthImbalance },
      priority: 87,
      reason: `sleeve side imbalance ${formatNumber(row.sideWidthImbalance, 4)}`,
      score: Number(row.sideWidthImbalance),
    });
  }
  for (const row of [...sleeveRows]
    .map((item) => ({
      ...item,
      currentSideWidthRatio: Math.min(item.currentLeftWidthRatio, item.currentRightWidthRatio),
    }))
    .filter((item) => Number.isFinite(item.currentSideWidthRatio))
    .sort((left, right) => left.currentSideWidthRatio - right.currentSideWidthRatio)
    .slice(0, 4)) {
    candidates.add({
      file: row.file,
      metrics: { currentSideWidthRatio: row.currentSideWidthRatio },
      priority: 86,
      reason: `low sleeve side ratio ${formatNumber(row.currentSideWidthRatio, 4)}`,
      score: 1 - Number(row.currentSideWidthRatio),
    });
  }

  for (const row of (openAiSummary.reviewRows ?? [])
    .filter((item) => item.group === 'current-frame')
    .slice(0, 6)) {
    candidates.add({
      file: row.file,
      metrics: { openAiSleeveTargetRatio: row.averageSleeveWidthRatio },
      priority: 84,
      reason: `OpenAI sleeve target review ${formatNumber(row.averageSleeveWidthRatio, 3)}`,
      score: 1 - Number(row.averageSleeveWidthRatio),
    });
  }

  return candidates
    .values()
    .sort((left, right) => (
      right.priority - left.priority
      || right.score - left.score
      || left.file.localeCompare(right.file)
    ))
    .slice(0, maxFrames);
}

async function readFrame(file) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data, info };
}

function compositePixel(data, index) {
  const offset = index * 4;
  const alpha = data[offset + 3] / 255;

  return [
    data[offset] * alpha + BACKGROUND[0] * (1 - alpha),
    data[offset + 1] * alpha + BACKGROUND[1] * (1 - alpha),
    data[offset + 2] * alpha + BACKGROUND[2] * (1 - alpha),
  ];
}

function diffMagnitude(left, right, index) {
  const leftPixel = compositePixel(left.data, index);
  const rightPixel = compositePixel(right.data, index);
  const alphaDiff = Math.abs(left.data[index * 4 + 3] - right.data[index * 4 + 3]);

  return Math.max(
    alphaDiff,
    Math.abs(leftPixel[0] - rightPixel[0]),
    Math.abs(leftPixel[1] - rightPixel[1]),
    Math.abs(leftPixel[2] - rightPixel[2]),
  );
}

async function colorTile(file, cellSize) {
  const image = await sharp(file, { animated: false })
    .ensureAlpha()
    .resize(cellSize, cellSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      background: { alpha: 1, b: 224, g: 196, r: 247 },
      channels: 4,
      height: cellSize,
      width: cellSize,
    },
  })
    .composite([{ input: image, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function imageBounds(file) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let maxX = -1;
  let maxY = -1;
  let minX = info.width;
  let minY = info.height;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * 4 + 3] === 0) continue;
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
    }
  }

  if (maxX < minX || maxY < minY) {
    return {
      height: info.height,
      left: 0,
      top: 0,
      width: info.width,
    };
  }

  return {
    height: maxY - minY + 1,
    left: minX,
    top: minY,
    width: maxX - minX + 1,
  };
}

async function imageSize(file) {
  const metadata = await sharp(file, { animated: false }).metadata();
  return {
    height: metadata.height,
    width: metadata.width,
  };
}

function paddedUnion(bounds, image, padding) {
  const minX = Math.max(0, Math.min(...bounds.map((box) => box.left)) - padding);
  const minY = Math.max(0, Math.min(...bounds.map((box) => box.top)) - padding);
  const maxX = Math.min(
    image.width - 1,
    Math.max(...bounds.map((box) => box.left + box.width - 1)) + padding,
  );
  const maxY = Math.min(
    image.height - 1,
    Math.max(...bounds.map((box) => box.top + box.height - 1)) + padding,
  );

  return {
    height: maxY - minY + 1,
    left: minX,
    top: minY,
    width: maxX - minX + 1,
  };
}

function checkerSvg(width, height, size = 12) {
  let output = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;
  output += '<rect width="100%" height="100%" fill="#f8d8ea"/>';

  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if (((x / size) + (y / size)) % 2 === 0) {
        output += `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#efc5dd"/>`;
      }
    }
  }

  return Buffer.from(`${output}</svg>`);
}

function zoomLabelSvg(width, height, label, sublabel) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + `<text x="10" y="18" font-family="Arial" font-size="13" font-weight="700" fill="#111827">${escapeText(label)}</text>`
    + `<text x="10" y="36" font-family="Arial" font-size="11" fill="#64748b">${escapeText(sublabel)}</text>`
    + '</svg>',
  );
}

async function zoomTile({ crop, file, label, sublabel, tileSize }) {
  const labelHeight = 44;
  const imageSizePx = tileSize - 20;
  const frame = await sharp(file, { animated: false })
    .extract(crop)
    .resize(imageSizePx, imageSizePx, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'nearest',
    })
    .png()
    .toBuffer();

  return sharp(checkerSvg(tileSize, tileSize + labelHeight))
    .composite([
      { input: zoomLabelSvg(tileSize, labelHeight, label, sublabel), left: 0, top: 0 },
      { input: frame, left: 10, top: labelHeight + 10 },
    ])
    .png()
    .toBuffer();
}

async function renderCandidateZoomSheet(candidates, options) {
  const labelHeight = 44;
  const tileSize = options.zoomCellSize;
  const tileHeight = tileSize + labelHeight;
  const blockWidth = tileSize * 2;
  const rows = Math.ceil(candidates.length / options.zoomCols);
  const width = options.zoomCols * blockWidth;
  const height = rows * tileHeight;
  const composites = [];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const currentFile = framePath(options.sourceRoot, candidate.file);
    const baselineFile = framePath(options.baselineRoot, candidate.file);
    if (!await exists(currentFile)) throw new Error(`Missing current frame ${currentFile}`);
    if (!await exists(baselineFile)) throw new Error(`Missing no-reshape frame ${baselineFile}`);

    const [currentBounds, baselineBounds, size] = await Promise.all([
      imageBounds(currentFile),
      imageBounds(baselineFile),
      imageSize(currentFile),
    ]);
    const crop = paddedUnion([currentBounds, baselineBounds], size, 28);
    const x = (index % options.zoomCols) * blockWidth;
    const y = Math.floor(index / options.zoomCols) * tileHeight;
    const reason = [
      candidate.disposition,
      candidate.reasons.slice(0, 2).join('; '),
    ].filter(Boolean).join(': ');

    composites.push({
      input: await zoomTile({
        crop,
        file: currentFile,
        label: `current ${candidate.file}`,
        sublabel: reason,
        tileSize,
      }),
      left: x,
      top: y,
    });
    composites.push({
      input: await zoomTile({
        crop,
        file: baselineFile,
        label: `no-reshape ${candidate.file}`,
        sublabel: path.relative(process.cwd(), options.baselineRoot),
        tileSize,
      }),
      left: x + tileSize,
      top: y,
    });
  }

  const outputFile = path.join(options.outputRoot, 'reimu-perceptual-candidate-zooms.png');
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

async function diffTile(currentFile, baselineFile, cellSize) {
  const current = await readFrame(currentFile);
  const baseline = await readFrame(baselineFile);
  if (current.info.width !== baseline.info.width || current.info.height !== baseline.info.height) {
    throw new Error(`Frame size mismatch for ${currentFile}`);
  }

  const output = Buffer.alloc(current.info.width * current.info.height * 4);
  for (let index = 0; index < current.info.width * current.info.height; index += 1) {
    const magnitude = diffMagnitude(current, baseline, index);
    const amount = magnitude <= DIFF_THRESHOLD ? 0 : Math.min(1, magnitude / 255);
    const offset = index * 4;

    output[offset] = Math.round(248 * (1 - amount) + 239 * amount);
    output[offset + 1] = Math.round(250 * (1 - amount) + 68 * amount);
    output[offset + 2] = Math.round(252 * (1 - amount) + 68 * amount);
    output[offset + 3] = 255;
  }

  return sharp(output, {
    raw: {
      channels: 4,
      height: current.info.height,
      width: current.info.width,
    },
  })
    .resize(cellSize, cellSize, { fit: 'contain', kernel: 'nearest' })
    .png()
    .toBuffer();
}

async function labelTile(width, height, candidate) {
  const reason = [
    candidate.disposition,
    candidate.reasons.slice(0, 2).join('; '),
  ].filter(Boolean).join(': ');
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
        + `<text x="8" y="18" font-family="Arial" font-size="12" font-weight="700" fill="#111827">${escapeText(candidate.file)}</text>`
        + `<text x="8" y="36" font-family="Arial" font-size="10" fill="#475569">${escapeText(reason)}</text>`
        + '<text x="8" y="52" font-family="Arial" font-size="10" fill="#64748b">current / no-reshape / diff heat</text>'
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function legendTile(width, height, summary) {
  const lines = [
    'Reimu perceptual consistency audit',
    `225-frame visual review candidates: ${summary.candidateCount}; severe hard-check issues: ${summary.severeIssueCount}`,
    'Candidates combine neighbor jumps, expression deltas, sleeve proportions, OpenAI-derived sleeve material targets, weak alpha, and original gaps.',
  ];

  return sharp({
    create: {
      background: { alpha: 1, b: 248, g: 250, r: 252 },
      channels: 4,
      height,
      width,
    },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
        + lines.map((line, index) => (
          `<text x="12" y="${22 + index * 20}" font-family="Arial" font-size="${index === 0 ? 14 : 11}" fill="${index === 0 ? '#111827' : '#475569'}">${escapeText(line)}</text>`
        )).join('')
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderSheet(candidates, options, summary) {
  const labelHeight = 58;
  const legendHeight = 82;
  const blockWidth = options.cellSize * 3;
  const blockHeight = labelHeight + options.cellSize;
  const rows = Math.ceil(options.maxFrames / options.cols);
  const width = options.cols * blockWidth;
  const height = legendHeight + rows * blockHeight;
  const composites = [
    { input: await legendTile(width, legendHeight, summary), left: 0, top: 0 },
  ];

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const currentFile = framePath(options.sourceRoot, candidate.file);
    const baselineFile = framePath(options.baselineRoot, candidate.file);
    if (!await exists(currentFile)) throw new Error(`Missing current frame ${currentFile}`);
    if (!await exists(baselineFile)) throw new Error(`Missing no-reshape frame ${baselineFile}`);

    const left = (index % options.cols) * blockWidth;
    const top = legendHeight + Math.floor(index / options.cols) * blockHeight;
    composites.push({ input: await labelTile(blockWidth, labelHeight, candidate), left, top });
    composites.push({ input: await colorTile(currentFile, options.cellSize), left, top: top + labelHeight });
    composites.push({
      input: await colorTile(baselineFile, options.cellSize),
      left: left + options.cellSize,
      top: top + labelHeight,
    });
    composites.push({
      input: await diffTile(currentFile, baselineFile, options.cellSize),
      left: left + options.cellSize * 2,
      top: top + labelHeight,
    });
  }

  const outputFile = path.join(options.outputRoot, 'reimu-perceptual-consistency.png');
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

function hardChecks({
  edgeSummary,
  expressionSummary,
  gapSummary,
  lineSummary,
  openAiSummary,
  options,
  qualitySummary,
  residualSummary,
  sleeveSummary,
}) {
  const expressionMaxRatio = expressionSummary.maxChangedRatio?.changedRatio ?? 0;
  const expressionMaxAlpha = expressionSummary.maxAlphaChangedPixels?.alphaChangedPixels ?? 0;
  const checks = {
    actionableResidualDefects: residualSummary.actionableDefectFrameCount === 0,
    detachedFragments: qualitySummary.maxDetachedArea?.detachedArea === 0
      && qualitySummary.maxDetachedSliverArea?.detachedSliverArea === 0,
    expressionAlphaDelta: expressionMaxAlpha <= options.maxExpressionAlphaChangedPixels,
    expressionChangedRatio: expressionMaxRatio <= options.maxExpressionChangedRatio,
    frameCount: qualitySummary.frameCount === 225 && residualSummary.frameCount === 225,
    lineIntegrity: lineSummary.maxUnsupportedEdgeInkPixels?.unsupportedEdgeInkPixels
      <= lineSummary.thresholds?.maxUnsupportedEdgeInkPixels
      && lineSummary.maxUnsupportedEdgeInkRatio?.unsupportedEdgeInkRatio
      <= lineSummary.thresholds?.maxUnsupportedEdgeInkRatio
      && lineSummary.maxUnsupportedEdgeComponentArea?.componentArea
      <= lineSummary.thresholds?.maxUnsupportedEdgeComponentArea
      && lineSummary.maxUnsupportedEdgeComponentCount?.unsupportedEdgeComponentCount
      <= lineSummary.thresholds?.maxUnsupportedEdgeComponentCount
      && lineSummary.maxUnsupportedEdgeComponentSpan?.componentSpan
      <= lineSummary.thresholds?.maxUnsupportedEdgeComponentSpan,
    noReferenceCoveredGaps: gapSummary.totalReferenceCoveredGapArea === 0
      && gapSummary.totalReferenceCoveredGapCount === 0,
    openAiReferenceCoverage: openAiSummary.openAiReferenceCount >= 5
      && openAiSummary.currentFrameCount >= 150,
    sleeveGuard: sleeveSummary.maxAverageWidthLoss?.averageWidthLoss
      <= sleeveSummary.thresholds?.maxAverageWidthLoss
      && sleeveSummary.maxSideWidthLoss?.sideWidthLoss <= sleeveSummary.thresholds?.maxSideWidthLoss
      && sleeveSummary.maxSideWidthImbalance?.sideWidthImbalance
      <= sleeveSummary.thresholds?.maxSideWidthImbalance
      && sleeveSummary.minCurrentAverageWidthRatio?.currentAverageWidthRatio
      >= sleeveSummary.thresholds?.minAverageWidthRatio
      && sleeveSummary.minCurrentSideWidthRatio?.currentSideWidthRatio
      >= sleeveSummary.thresholds?.minSideWidthRatio,
    transparentResidue: qualitySummary.maxTransparentNonBlack?.transparentNonBlack === 0
      && edgeSummary.maxTransparentColoredPixels?.transparentColoredPixels === 0,
    weakAlphaGhosts: edgeSummary.maxOrphanWeakAlphaPixels?.orphanWeakAlphaPixels === 0,
  };

  return checks;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    baselineRoot: path.resolve(readOption(args, 'baseline-root', DEFAULTS.baselineRoot)),
    cellSize: readNumberOption(args, 'cell-size', DEFAULTS.cellSize),
    cols: readNumberOption(args, 'cols', DEFAULTS.cols),
    edgeSummary: path.resolve(readOption(args, 'edge-summary', DEFAULTS.edgeSummary)),
    expressionCsv: path.resolve(readOption(args, 'expression-csv', DEFAULTS.expressionCsv)),
    expressionSummary: path.resolve(readOption(args, 'expression-summary', DEFAULTS.expressionSummary)),
    gapSummary: path.resolve(readOption(args, 'gap-summary', DEFAULTS.gapSummary)),
    lineSummary: path.resolve(readOption(args, 'line-summary', DEFAULTS.lineSummary)),
    maxExpressionAlphaChangedPixels: readNumberOption(
      args,
      'max-expression-alpha-changed-pixels',
      DEFAULTS.maxExpressionAlphaChangedPixels,
    ),
    maxExpressionChangedRatio: readNumberOption(
      args,
      'max-expression-changed-ratio',
      DEFAULTS.maxExpressionChangedRatio,
    ),
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    openAiTargetSummary: path.resolve(readOption(
      args,
      'openai-target-summary',
      DEFAULTS.openAiTargetSummary,
    )),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    qualityCsv: path.resolve(readOption(args, 'quality-csv', DEFAULTS.qualityCsv)),
    qualitySummary: path.resolve(readOption(args, 'quality-summary', DEFAULTS.qualitySummary)),
    residualSummary: path.resolve(readOption(args, 'residual-summary', DEFAULTS.residualSummary)),
    sleeveCsv: path.resolve(readOption(args, 'sleeve-csv', DEFAULTS.sleeveCsv)),
    sleeveSummary: path.resolve(readOption(args, 'sleeve-summary', DEFAULTS.sleeveSummary)),
    sourceRoot: path.resolve(readOption(args, 'source-root', DEFAULTS.sourceRoot)),
    zoomCellSize: readNumberOption(args, 'zoom-cell-size', DEFAULTS.zoomCellSize),
    zoomCols: readNumberOption(args, 'zoom-cols', DEFAULTS.zoomCols),
  };
  const [
    edgeSummary,
    expressionRows,
    expressionSummary,
    gapSummary,
    lineSummary,
    openAiSummary,
    qualityRows,
    qualitySummary,
    residualSummary,
    sleeveRows,
    sleeveSummary,
  ] = await Promise.all([
    readJson(options.edgeSummary),
    readCsv(options.expressionCsv),
    readJson(options.expressionSummary),
    readJson(options.gapSummary),
    readJson(options.lineSummary),
    readJson(options.openAiTargetSummary),
    readCsv(options.qualityCsv),
    readJson(options.qualitySummary),
    readJson(options.residualSummary),
    readCsv(options.sleeveCsv),
    readJson(options.sleeveSummary),
  ]);
  const candidates = collectCandidates({
    expressionRows,
    openAiSummary,
    qualityRows,
    sleeveRows,
  }, options.maxFrames);
  const checks = hardChecks({
    edgeSummary,
    expressionSummary,
    gapSummary,
    lineSummary,
    openAiSummary,
    options,
    qualitySummary,
    residualSummary,
    sleeveSummary,
  });
  const failedChecks = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  const dispositionRows = candidates.map((candidate) => classifyCandidate(candidate, {
    checks,
    edgeSummary,
    gapSummary,
    openAiSummary,
    options,
    qualityByFile: rowsByFile(qualityRows),
    residualSummary,
    sleeveByFile: rowsByFile(sleeveRows),
    sleeveSummary,
  }));
  const actionableCandidateCount = dispositionRows
    .filter((candidate) => candidate.disposition === 'actionable')
    .length;
  const summary = {
    actionableCandidateCount,
    candidateCount: dispositionRows.length,
    candidates: dispositionRows.map((candidate) => ({
      disposition: candidate.disposition,
      dispositionReasons: candidate.dispositionReasons,
      file: candidate.file,
      gateResults: candidate.gateResults,
      metrics: candidate.metrics,
      reasons: candidate.reasons,
    })),
    coverage: {
      expressionComparisons: expressionRows.length,
      openAiReferenceRows: openAiSummary.openAiReferenceCount,
      openAiTargetRows: Array.isArray(openAiSummary.reviewRows) ? openAiSummary.reviewRows.length : 0,
      qualityFrames: qualityRows.length,
      sleeveFrames: sleeveRows.length,
    },
    hardChecks: checks,
    reviewOnlyCandidateCount: dispositionRows.length - actionableCandidateCount,
    severeIssueCount: failedChecks.length + actionableCandidateCount,
    thresholds: {
      maxExpressionAlphaChangedPixels: options.maxExpressionAlphaChangedPixels,
      maxExpressionChangedRatio: options.maxExpressionChangedRatio,
    },
  };

  await mkdir(options.outputRoot, { recursive: true });
  const outputFile = await renderSheet(dispositionRows, options, summary);
  const zoomOutputFile = await renderCandidateZoomSheet(dispositionRows, options);
  const csvHeaders = ['file', 'disposition', 'reasons', 'metrics'];
  const csv = [
    csvHeaders.join(','),
    ...summary.candidates.map((candidate) => [
      candidate.file,
      candidate.disposition,
      candidate.reasons.join('; '),
      JSON.stringify(candidate.metrics),
    ].map(csvCell).join(',')),
  ].join('\n');
  const dispositionHeaders = ['file', 'disposition', 'reasons', 'dispositionReasons', 'metrics'];
  const dispositionCsv = [
    dispositionHeaders.join(','),
    ...summary.candidates.map((candidate) => [
      candidate.file,
      candidate.disposition,
      candidate.reasons.join('; '),
      candidate.dispositionReasons.join('; '),
      JSON.stringify(candidate.metrics),
    ].map(csvCell).join(',')),
  ].join('\n');

  await writeFile(path.join(options.outputRoot, 'reimu-perceptual-consistency.csv'), `${csv}\n`);
  await writeFile(
    path.join(options.outputRoot, 'reimu-perceptual-candidate-disposition.csv'),
    `${dispositionCsv}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, 'reimu-perceptual-candidate-disposition.json'),
    `${JSON.stringify(summary.candidates, null, 2)}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, 'reimu-perceptual-consistency-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Rendered perceptual consistency sheet to ${path.relative(process.cwd(), outputFile)}`);
  console.log(`Rendered perceptual candidate zooms to ${path.relative(process.cwd(), zoomOutputFile)}`);
  console.log(JSON.stringify(summary, null, 2));

  if (failedChecks.length || actionableCandidateCount > 0) {
    const failures = [
      ...failedChecks,
      ...(actionableCandidateCount > 0
        ? [`actionable perceptual candidates ${actionableCandidateCount}`]
        : []),
    ];
    throw new Error(`Reimu perceptual consistency audit failed:\n- ${failures.join('\n- ')}`);
  }
}

await main();
