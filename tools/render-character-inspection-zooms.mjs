import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 256,
  character: 'reimu',
  compareSource: 'tmp/noreshape',
  maxFrames: 12,
  metrics: ['weakAlphaPixels', 'internalGapArea', 'transparentNonBlack'],
  metricsCsv: 'tmp/quality-audit/reimu-asset-quality.csv',
  outputRoot: 'tmp/inspection',
  sourceRoot: 'public/characters',
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

function readListOption(args, name, fallback) {
  const value = readOption(args, name, '');
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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

async function readMetrics(csvFile) {
  const contents = await readFile(csvFile, 'utf8');
  const lines = contents.trim().split(/\r?\n/u);
  const headers = parseCsvLine(lines.shift() ?? '');

  return lines
    .filter(Boolean)
    .map((line) => {
      const cells = parseCsvLine(line);
      const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));

      for (const [key, value] of Object.entries(row)) {
        if (key !== 'file') row[key] = Number(value);
      }

      return row;
    });
}

function selectedRows(rows, metrics, maxFrames) {
  const selected = [];
  const seen = new Set();

  for (const metric of metrics) {
    const sorted = rows
      .filter((row) => Number.isFinite(row[metric]) && row[metric] > 0)
      .sort((left, right) => right[metric] - left[metric]);

    for (const row of sorted) {
      if (seen.has(row.file)) continue;
      selected.push(row);
      seen.add(row.file);
      if (selected.length >= maxFrames) return selected;
    }
  }

  return selected;
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
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha === 0) continue;

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

function paddedUnion(bounds, imageSize, padding) {
  const minX = Math.max(0, Math.min(...bounds.map((box) => box.left)) - padding);
  const minY = Math.max(0, Math.min(...bounds.map((box) => box.top)) - padding);
  const maxX = Math.min(
    imageSize.width - 1,
    Math.max(...bounds.map((box) => box.left + box.width - 1)) + padding,
  );
  const maxY = Math.min(
    imageSize.height - 1,
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

function labelSvg(width, height, label, sublabel = '') {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + `<text x="10" y="18" font-family="Arial" font-size="13" fill="#111827">${escapeText(label)}</text>`
    + `<text x="10" y="36" font-family="Arial" font-size="12" fill="#64748b">${escapeText(sublabel)}</text>`
    + '</svg>',
  );
}

function metricLabel(metric) {
  const labels = {
    internalGapArea: 'gap',
    suspiciousHoleArea: 'suspicious',
    transparentNonBlack: 'rgb',
    weakAlphaPixels: 'weak',
  };

  return labels[metric] ?? metric;
}

async function renderFrameTile({ crop, file, label, metricsLabel, root, tileSize }) {
  const labelHeight = 44;
  const imageSize = tileSize - 20;
  const frame = await sharp(file, { animated: false })
    .extract(crop)
    .resize(imageSize, imageSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'nearest',
    })
    .png()
    .toBuffer();

  const background = await sharp(checkerSvg(tileSize, tileSize + labelHeight))
    .composite([
      { input: labelSvg(tileSize, labelHeight, label, metricsLabel), left: 0, top: 0 },
      { input: frame, left: 10, top: labelHeight + 10 },
    ])
    .png()
    .toBuffer();

  return {
    input: background,
    root,
  };
}

async function imageSize(file) {
  const metadata = await sharp(file, { animated: false }).metadata();
  return {
    height: metadata.height,
    width: metadata.width,
  };
}

async function renderZoomSheet(options) {
  const sourceRoot = await resolveCharacterRoot(options.sourceRoot, options.character);
  const compareRoot = await resolveCharacterRoot(options.compareSource, options.character);
  const rows = selectedRows(await readMetrics(options.metricsCsv), options.metrics, options.maxFrames);

  if (!rows.length) {
    throw new Error(`No positive metrics found in ${options.metricsCsv}`);
  }

  const tileSize = options.cellSize;
  const tileHeight = tileSize + 44;
  const pairWidth = tileSize * 2;
  const cols = 2;
  const sheetRows = Math.ceil(rows.length / cols);
  const composites = [];

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const sourceFile = path.join(sourceRoot, row.file);
    const compareFile = path.join(compareRoot, row.file);

    for (const file of [sourceFile, compareFile]) {
      if (!await exists(file)) throw new Error(`Missing comparison frame: ${file}`);
    }

    const [sourceBounds, compareBounds, size] = await Promise.all([
      imageBounds(sourceFile),
      imageBounds(compareFile),
      imageSize(sourceFile),
    ]);
    const crop = paddedUnion([sourceBounds, compareBounds], size, 28);
    const metricsLabel = options.metrics
      .map((metric) => `${metricLabel(metric)}:${row[metric] ?? 0}`)
      .join(' ');
    const x = (index % cols) * pairWidth;
    const y = Math.floor(index / cols) * tileHeight;
    const sourceTile = await renderFrameTile({
      crop,
      file: sourceFile,
      label: `current ${row.file}`,
      metricsLabel,
      root: sourceRoot,
      tileSize,
    });
    const compareTile = await renderFrameTile({
      crop,
      file: compareFile,
      label: `compare ${row.file}`,
      metricsLabel: path.relative(process.cwd(), compareRoot),
      root: compareRoot,
      tileSize,
    });

    composites.push({ input: sourceTile.input, left: x, top: y });
    composites.push({ input: compareTile.input, left: x + tileSize, top: y });
  }

  await mkdir(options.outputRoot, { recursive: true });

  const outputFile = path.join(options.outputRoot, `${options.character}-inspection-zooms.png`);
  await sharp({
    create: {
      background: { alpha: 1, b: 255, g: 255, r: 255 },
      channels: 4,
      height: sheetRows * tileHeight,
      width: cols * pairWidth,
    },
  })
    .composite(composites)
    .png()
    .toFile(outputFile);

  return {
    outputFile,
    rows,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    cellSize: readNumberOption(args, 'cell-size', DEFAULTS.cellSize),
    character: readOption(args, 'character', DEFAULTS.character),
    compareSource: readOption(args, 'compare-source', DEFAULTS.compareSource),
    maxFrames: readNumberOption(args, 'max-frames', DEFAULTS.maxFrames),
    metrics: readListOption(args, 'metrics', DEFAULTS.metrics),
    metricsCsv: readOption(args, 'metrics-csv', DEFAULTS.metricsCsv),
    outputRoot: readOption(args, 'output-root', DEFAULTS.outputRoot),
    sourceRoot: readOption(args, 'source-root', DEFAULTS.sourceRoot),
  };

  const { outputFile, rows } = await renderZoomSheet(options);
  console.log(`Rendered ${rows.length} inspection zooms to ${path.relative(process.cwd(), outputFile)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
