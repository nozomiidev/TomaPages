import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  baselineRoot: 'tmp/openai-material-baseline/reimu',
  currentRoot: 'public/characters/reimu',
  expectedFrames: 225,
  maxChangedFrames: 40,
  maxOutsideSleeveDiffRatio: 0.10,
  minMargin: 32,
  minMaterialChangedFrames: 1,
  outputRoot: 'tmp/openai-material-audit',
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
  const rootStat = await pathStat(root);
  if (!rootStat?.isDirectory()) return files;

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

  await visit(root);
  return files.sort((a, b) => a.localeCompare(b));
}

function relativeFrame(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

async function readRgba(file) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    height: info.height,
    width: info.width,
  };
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

function sleeveMaskAndMetrics(rgba) {
  const bounds = alphaBounds(rgba.data, rgba.width, rgba.height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const mask = new Uint8Array(rgba.width * rgba.height);

  for (let index = 0; index < mask.length; index += 1) {
    if (isReimuSleevePixel(rgba.data, index, rgba.width, bounds, centerX)) {
      mask[index] = 1;
    }
  }

  const components = componentList(mask, rgba.width, rgba.height)
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
    bounds,
    leftWidthRatio,
    mask,
    minSideWidthRatio: Math.min(leftWidthRatio, rightWidthRatio),
    rightWidthRatio,
  };
}

function dilateMask(mask, width, height, radius) {
  const output = new Uint8Array(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;

        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) {
          continue;
        }
        output[candidateY * width + candidateX] = 1;
      }
    }
  }

  return output;
}

function diffFrames(baseline, current, sleeveMask) {
  const bbox = {
    maxX: 0,
    maxY: 0,
    minX: baseline.width,
    minY: baseline.height,
  };
  let changedPixels = 0;
  let outsideSleevePixels = 0;

  for (let index = 0; index < baseline.width * baseline.height; index += 1) {
    const offset = index * 4;
    const channelDelta = Math.abs(baseline.data[offset] - current.data[offset])
      + Math.abs(baseline.data[offset + 1] - current.data[offset + 1])
      + Math.abs(baseline.data[offset + 2] - current.data[offset + 2])
      + Math.abs(baseline.data[offset + 3] - current.data[offset + 3]);

    if (channelDelta <= 12) continue;

    changedPixels += 1;
    if (!sleeveMask[index]) outsideSleevePixels += 1;
    const x = index % baseline.width;
    const y = Math.floor(index / baseline.width);
    bbox.minX = Math.min(bbox.minX, x);
    bbox.minY = Math.min(bbox.minY, y);
    bbox.maxX = Math.max(bbox.maxX, x);
    bbox.maxY = Math.max(bbox.maxY, y);
  }

  return {
    changedPixels,
    outsideSleeveDiffRatio: Number((outsideSleevePixels / Math.max(1, changedPixels)).toFixed(4)),
    outsideSleevePixels,
    ...(changedPixels ? bbox : {
      maxX: 0,
      maxY: 0,
      minX: 0,
      minY: 0,
    }),
  };
}

function minMargin(bounds, width, height) {
  return Math.min(
    bounds.minX,
    bounds.minY,
    width - bounds.maxX - 1,
    height - bounds.maxY - 1,
  );
}

async function auditPair({ baselineFile, currentFile, relative }) {
  const [baseline, current] = await Promise.all([
    readRgba(baselineFile),
    readRgba(currentFile),
  ]);
  if (baseline.width !== current.width || baseline.height !== current.height) {
    throw new Error(`${relative} dimension mismatch`);
  }

  const baselineSleeve = sleeveMaskAndMetrics(baseline);
  const currentSleeve = sleeveMaskAndMetrics(current);
  const sleeveMask = dilateMask(
    baselineSleeve.mask.map((value, index) => (value || currentSleeve.mask[index] ? 1 : 0)),
    baseline.width,
    baseline.height,
    14,
  );
  const diff = diffFrames(baseline, current, sleeveMask);
  const currentMargin = minMargin(currentSleeve.bounds, current.width, current.height);

  return {
    averageWidthDelta: Number((
      currentSleeve.averageWidthRatio - baselineSleeve.averageWidthRatio
    ).toFixed(4)),
    baselineAverageWidthRatio: Number(baselineSleeve.averageWidthRatio.toFixed(4)),
    baselineMinSideWidthRatio: Number(baselineSleeve.minSideWidthRatio.toFixed(4)),
    changedPixels: diff.changedPixels,
    currentAverageWidthRatio: Number(currentSleeve.averageWidthRatio.toFixed(4)),
    currentMinSideWidthRatio: Number(currentSleeve.minSideWidthRatio.toFixed(4)),
    file: relative,
    minMargin: currentMargin,
    minSideWidthDelta: Number((
      currentSleeve.minSideWidthRatio - baselineSleeve.minSideWidthRatio
    ).toFixed(4)),
    outsideSleeveDiffRatio: diff.outsideSleeveDiffRatio,
    outsideSleevePixels: diff.outsideSleevePixels,
    sheet: relative.split('/')[0],
  };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function maxBy(rows, key) {
  return [...rows].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0))[0] ?? null;
}

function minBy(rows, key) {
  return [...rows].sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0))[0] ?? null;
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function tile(file, label, sublabel) {
  const tileSize = 150;
  const labelHeight = 42;
  const image = await sharp(file, { animated: false })
    .ensureAlpha()
    .resize(tileSize, tileSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .flatten({ background: '#f8d8ea' })
    .png()
    .toBuffer();
  const header = Buffer.from(
    `<svg width="${tileSize}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + `<text x="8" y="17" font-family="Arial" font-size="11" font-weight="700" fill="#111827">${escapeText(label)}</text>`
    + `<text x="8" y="34" font-family="Arial" font-size="9" fill="#64748b">${escapeText(sublabel)}</text>`
    + '</svg>',
  );

  return sharp({
    create: {
      background: '#ffffff',
      channels: 4,
      height: tileSize + labelHeight,
      width: tileSize,
    },
  })
    .composite([
      { input: header, left: 0, top: 0 },
      { input: image, left: 0, top: labelHeight },
    ])
    .png()
    .toBuffer();
}

async function renderSheet({ baselineRoot, currentRoot, outputFile, rows }) {
  const changedRows = rows.filter((row) => row.changedPixels > 0);
  const tileWidth = 300;
  const tileHeight = 192;
  const cols = 3;
  const width = cols * tileWidth;
  const height = Math.max(1, Math.ceil(changedRows.length / cols)) * tileHeight;
  const composites = [];

  for (let index = 0; index < changedRows.length; index += 1) {
    const row = changedRows[index];
    const baselineFile = path.join(baselineRoot, row.file);
    const currentFile = path.join(currentRoot, row.file);
    const [baselineTile, currentTile] = await Promise.all([
      tile(baselineFile, row.file, 'without material'),
      tile(currentFile, row.file, `with material / ${row.changedPixels}px`),
    ]);
    const x = (index % cols) * tileWidth;
    const y = Math.floor(index / cols) * tileHeight;
    composites.push({ input: baselineTile, left: x, top: y });
    composites.push({ input: currentTile, left: x + 150, top: y });
  }

  await sharp({
    create: {
      background: '#ffffff',
      channels: 4,
      height,
      width,
    },
  })
    .composite(composites)
    .png()
    .toFile(outputFile);
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    baselineRoot: path.resolve(readOption(args, 'baseline-root', DEFAULTS.baselineRoot)),
    currentRoot: path.resolve(readOption(args, 'current-root', DEFAULTS.currentRoot)),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    maxChangedFrames: readNumberOption(args, 'max-changed-frames', DEFAULTS.maxChangedFrames),
    maxOutsideSleeveDiffRatio: readNumberOption(
      args,
      'max-outside-sleeve-diff-ratio',
      DEFAULTS.maxOutsideSleeveDiffRatio,
    ),
    minMargin: readNumberOption(args, 'min-margin', DEFAULTS.minMargin),
    minMaterialChangedFrames: readNumberOption(
      args,
      'min-material-changed-frames',
      DEFAULTS.minMaterialChangedFrames,
    ),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
  };

  const [baselineFiles, currentFiles] = await Promise.all([
    walkWebp(options.baselineRoot),
    walkWebp(options.currentRoot),
  ]);
  const currentByRelative = new Map(currentFiles.map((file) => [
    relativeFrame(options.currentRoot, file),
    file,
  ]));
  const rows = [];

  for (const baselineFile of baselineFiles) {
    const relative = relativeFrame(options.baselineRoot, baselineFile);
    const currentFile = currentByRelative.get(relative);
    if (!currentFile) {
      throw new Error(`Missing current frame for ${relative}`);
    }
    rows.push(await auditPair({ baselineFile, currentFile, relative }));
  }

  const changedRows = rows.filter((row) => row.changedPixels > 0);
  const changedOutsideTargetSheets = changedRows.filter((row) => !TARGET_SHEETS.has(row.sheet));
  const changedWithOutsideDiff = changedRows.filter((row) => (
    row.outsideSleeveDiffRatio > options.maxOutsideSleeveDiffRatio
  ));
  const changedWithBadMargin = changedRows.filter((row) => row.minMargin < options.minMargin);
  const changedWithNarrowerSleeveMetric = changedRows.filter((row) => (
    row.averageWidthDelta < -0.002 || row.minSideWidthDelta < -0.002
  ));
  const improvedRows = changedRows.filter((row) => (
    row.averageWidthDelta > 0.002 || row.minSideWidthDelta > 0.002
  ));
  const summary = {
    baselineFrameCount: baselineFiles.length,
    changedFrameCount: changedRows.length,
    checks: {
      changedFramesWithinBudget: changedRows.length <= options.maxChangedFrames,
      expectedBaselineFrames: baselineFiles.length === options.expectedFrames,
      expectedCurrentFrames: currentFiles.length === options.expectedFrames,
      materialHasVisibleEffect: changedRows.length >= options.minMaterialChangedFrames,
      materialHasPositiveSleeveMetricSignal: improvedRows.length > 0,
      minMarginPreserved: changedWithBadMargin.length === 0,
      outsideSleeveDiffWithinBudget: changedWithOutsideDiff.length === 0,
      scopedToTargetSheets: changedOutsideTargetSheets.length === 0,
    },
    currentFrameCount: currentFiles.length,
    maxAverageWidthDelta: maxBy(changedRows, 'averageWidthDelta'),
    maxChangedPixels: maxBy(changedRows, 'changedPixels'),
    maxOutsideSleeveDiffRatio: maxBy(changedRows, 'outsideSleeveDiffRatio'),
    minAverageWidthDelta: minBy(changedRows, 'averageWidthDelta'),
    minMargin: minBy(changedRows, 'minMargin'),
    minSideWidthDelta: minBy(changedRows, 'minSideWidthDelta'),
    narrowerSleeveMetricExamples: changedWithNarrowerSleeveMetric.slice(0, 8),
    thresholds: {
      maxChangedFrames: options.maxChangedFrames,
      maxOutsideSleeveDiffRatio: options.maxOutsideSleeveDiffRatio,
      minMargin: options.minMargin,
      minMaterialChangedFrames: options.minMaterialChangedFrames,
    },
  };
  const csvHeaders = Object.keys(rows[0] ?? {});
  const csv = [
    csvHeaders.join(','),
    ...rows.map((row) => csvHeaders.map((header) => csvCell(row[header])).join(',')),
  ].join('\n');

  await mkdir(options.outputRoot, { recursive: true });
  await writeFile(path.join(options.outputRoot, 'reimu-openai-material-application.csv'), `${csv}\n`);
  await writeFile(
    path.join(options.outputRoot, 'reimu-openai-material-application-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await renderSheet({
    baselineRoot: options.baselineRoot,
    currentRoot: options.currentRoot,
    outputFile: path.join(options.outputRoot, 'reimu-openai-material-application.png'),
    rows,
  });

  console.log('Audited Reimu OpenAI material application.');
  console.log(JSON.stringify(summary, null, 2));

  const failures = Object.entries(summary.checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failures.length) {
    throw new Error(`Reimu OpenAI material application audit failed:\n- ${failures.join('\n- ')}`);
  }
}

await main();
