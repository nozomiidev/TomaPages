import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  character: 'reimu',
  cols: 3,
  diffThreshold: 24,
  maxFrames: 12,
  outputRoot: 'tmp/expression-audit',
  sourceRoot: 'public/characters',
  tileSize: 160,
};

const POSE_SETS = {
  plain: ['pl_01', 'om_01', 'ce_01'],
  t: ['pt_01', 'ot_01', 'ct_01'],
  y: ['py_01', 'oy_01', 'cy_01'],
};

const PAIR_LABELS = [
  ['closed-open', 0, 1],
  ['closed-blink', 0, 2],
  ['open-blink', 1, 2],
];

const BACKGROUND = [248, 250, 252];

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

function diffMagnitude(a, b, index) {
  const ca = compositePixel(a.data, index);
  const cb = compositePixel(b.data, index);
  const alphaDiff = Math.abs(a.data[index * 4 + 3] - b.data[index * 4 + 3]);

  return Math.max(
    alphaDiff,
    Math.abs(ca[0] - cb[0]),
    Math.abs(ca[1] - cb[1]),
    Math.abs(ca[2] - cb[2]),
  );
}

function alphaUnionPixels(a, b) {
  let pixels = 0;

  for (let index = 0; index < a.data.length / 4; index += 1) {
    if (a.data[index * 4 + 3] >= 16 || b.data[index * 4 + 3] >= 16) pixels += 1;
  }

  return pixels;
}

function measureDiff(a, b, options) {
  let changedPixels = 0;
  let alphaChangedPixels = 0;
  let totalMagnitude = 0;
  let maxMagnitude = 0;
  let maxX = 0;
  let maxY = 0;
  let minX = a.info.width;
  let minY = a.info.height;
  let weightedX = 0;
  let weightedY = 0;

  for (let index = 0; index < a.data.length / 4; index += 1) {
    const magnitude = diffMagnitude(a, b, index);
    if (magnitude <= options.diffThreshold) continue;

    const x = index % a.info.width;
    const y = Math.floor(index / a.info.width);
    const alphaDiff = Math.abs(a.data[index * 4 + 3] - b.data[index * 4 + 3]);

    changedPixels += 1;
    if (alphaDiff > options.diffThreshold) alphaChangedPixels += 1;
    totalMagnitude += magnitude;
    maxMagnitude = Math.max(maxMagnitude, magnitude);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    weightedX += x * magnitude;
    weightedY += y * magnitude;
  }

  const unionPixels = alphaUnionPixels(a, b);

  return {
    alphaChangedPixels,
    bboxHeight: changedPixels ? maxY - minY + 1 : 0,
    bboxMaxX: changedPixels ? maxX : 0,
    bboxMaxY: changedPixels ? maxY : 0,
    bboxMinX: changedPixels ? minX : 0,
    bboxMinY: changedPixels ? minY : 0,
    bboxWidth: changedPixels ? maxX - minX + 1 : 0,
    centroidX: changedPixels ? Number((weightedX / totalMagnitude).toFixed(2)) : 0,
    centroidY: changedPixels ? Number((weightedY / totalMagnitude).toFixed(2)) : 0,
    changedPixels,
    changedRatio: Number((changedPixels / Math.max(1, unionPixels)).toFixed(4)),
    maxMagnitude: Math.round(maxMagnitude),
    meanMagnitude: changedPixels ? Number((totalMagnitude / changedPixels).toFixed(2)) : 0,
    unionPixels,
  };
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

async function frameNames(sheetRoot) {
  const entries = await readdir(sheetRoot, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /^r\d+c\d+\.webp$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => {
      const left = /^r(\d+)c(\d+)\.webp$/u.exec(a);
      const right = /^r(\d+)c(\d+)\.webp$/u.exec(b);

      return Number(left[1]) - Number(right[1]) || Number(left[2]) - Number(right[2]);
    });
}

async function scanDiffs(options) {
  const rows = [];
  const frames = [];

  for (const [pose, sheets] of Object.entries(POSE_SETS)) {
    const names = await frameNames(path.join(options.characterRoot, sheets[0]));

    for (const name of names) {
      const images = await Promise.all(sheets.map((sheet) => (
        readFrame(path.join(options.characterRoot, sheet, name))
      )));

      for (const [pairLabel, leftIndex, rightIndex] of PAIR_LABELS) {
        const leftSheet = sheets[leftIndex];
        const rightSheet = sheets[rightIndex];
        const metrics = measureDiff(images[leftIndex], images[rightIndex], options);
        const row = {
          file: name,
          leftSheet,
          pair: pairLabel,
          pose,
          rightSheet,
          ...metrics,
        };

        rows.push(row);
        frames.push({
          left: images[leftIndex],
          leftSheet,
          name,
          pair: pairLabel,
          pose,
          right: images[rightIndex],
          rightSheet,
          row,
        });
      }
    }
  }

  return {
    frames,
    rows: rows.sort((a, b) => (
      a.pose.localeCompare(b.pose)
      || a.file.localeCompare(b.file)
      || a.pair.localeCompare(b.pair)
    )),
  };
}

function maxBy(rows, key) {
  return [...rows].sort((a, b) => b[key] - a[key])[0] ?? { [key]: 0 };
}

function summarize(rows) {
  return {
    comparisonCount: rows.length,
    maxAlphaChangedPixels: maxBy(rows, 'alphaChangedPixels'),
    maxChangedPixels: maxBy(rows, 'changedPixels'),
    maxChangedRatio: maxBy(rows, 'changedRatio'),
    maxMeanMagnitude: maxBy(rows, 'meanMagnitude'),
  };
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function colorTile(frame, tileSize) {
  return sharp(frame.data, {
    raw: {
      channels: 4,
      height: frame.info.height,
      width: frame.info.width,
    },
  })
    .resize(tileSize, tileSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .flatten({ background: { b: BACKGROUND[2], g: BACKGROUND[1], r: BACKGROUND[0] } })
    .png()
    .toBuffer();
}

async function diffTile(left, right, tileSize, options) {
  const rgba = Buffer.alloc(left.info.width * left.info.height * 4);

  for (let index = 0; index < left.info.width * left.info.height; index += 1) {
    const magnitude = diffMagnitude(left, right, index);
    const amount = Math.min(1, magnitude / 255);
    const offset = index * 4;

    if (magnitude <= options.diffThreshold) {
      rgba[offset] = 248;
      rgba[offset + 1] = 250;
      rgba[offset + 2] = 252;
    } else {
      rgba[offset] = Math.round(248 * (1 - amount) + 239 * amount);
      rgba[offset + 1] = Math.round(250 * (1 - amount) + 68 * amount);
      rgba[offset + 2] = Math.round(252 * (1 - amount) + 68 * amount);
    }
    rgba[offset + 3] = 255;
  }

  return sharp(rgba, {
    raw: {
      channels: 4,
      height: left.info.height,
      width: left.info.width,
    },
  })
    .resize(tileSize, tileSize, { fit: 'contain', kernel: 'nearest' })
    .png()
    .toBuffer();
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
        + `<text x="8" y="18" font-family="Arial" font-size="12" fill="#111827">${escapeText(text)}</text>`
        + '<text x="8" y="34" font-family="Arial" font-size="11" fill="#64748b">left / right / diff heat</text>'
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
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
        + '<text x="12" y="22" font-family="Arial" font-size="14" font-weight="700" fill="#111827">Reimu expression diff audit</text>'
        + '<text x="12" y="42" font-family="Arial" font-size="12" fill="#64748b">Top comparisons by changed pixels. Red heat shows visible difference after compositing on a neutral background.</text>'
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderComparisonBlock(frame, options) {
  const tileSize = options.tileSize;
  const labelHeight = 42;
  const width = tileSize * 3;
  const height = labelHeight + tileSize;
  const label = `${frame.pose}/${frame.name.replace('.webp', '')} ${frame.pair} `
    + `d${frame.row.changedPixels} r${frame.row.changedRatio}`;

  return sharp({
    create: {
      background: { alpha: 1, b: 255, g: 255, r: 255 },
      channels: 4,
      height,
      width,
    },
  })
    .composite([
      { input: await labelTile(label, width, labelHeight), left: 0, top: 0 },
      { input: await colorTile(frame.left, tileSize), left: 0, top: labelHeight },
      { input: await colorTile(frame.right, tileSize), left: tileSize, top: labelHeight },
      {
        input: await diffTile(frame.left, frame.right, tileSize, options),
        left: tileSize * 2,
        top: labelHeight,
      },
    ])
    .png()
    .toBuffer();
}

async function renderSheet(frames, options) {
  const selected = [...frames]
    .sort((a, b) => b.row.changedPixels - a.row.changedPixels)
    .slice(0, options.maxFrames);
  const legendHeight = 56;
  const blockWidth = options.tileSize * 3;
  const blockHeight = options.tileSize + 42;
  const rows = Math.ceil(options.maxFrames / options.cols);
  const width = blockWidth * options.cols;
  const height = legendHeight + blockHeight * rows;
  const composites = [{ input: await legendTile(width, legendHeight), left: 0, top: 0 }];

  for (let index = 0; index < selected.length; index += 1) {
    const block = await renderComparisonBlock(selected[index], options);
    composites.push({
      input: block,
      left: (index % options.cols) * blockWidth,
      top: legendHeight + Math.floor(index / options.cols) * blockHeight,
    });
  }

  const outputFile = path.join(options.outputRoot, `${options.character}-expression-diff-audit.png`);
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
    character: readOption(args, 'character', DEFAULTS.character),
    cols: readNumberOption(args, 'cols', DEFAULTS.cols),
    diffThreshold: readNumberOption(args, 'diff-threshold', DEFAULTS.diffThreshold),
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sourceRoot: readOption(args, 'source', DEFAULTS.sourceRoot),
    tileSize: readNumberOption(args, 'tile-size', DEFAULTS.tileSize),
  };
  options.characterRoot = await resolveCharacterRoot(options.sourceRoot, options.character);

  const { frames, rows } = await scanDiffs(options);
  const summary = summarize(rows);
  await mkdir(options.outputRoot, { recursive: true });

  const csvHeader = Object.keys(rows[0]);
  const csv = [
    csvHeader.join(','),
    ...rows.map((row) => csvHeader.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');
  await writeFile(
    path.join(options.outputRoot, `${options.character}-expression-diff-audit.csv`),
    `${csv}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, `${options.character}-expression-diff-audit-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  const outputFile = await renderSheet(frames, options);

  console.log(`Audited ${rows.length} ${options.character} expression comparisons`);
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Rendered expression diff sheet to ${path.relative(process.cwd(), outputFile)}`);
}

await main();
