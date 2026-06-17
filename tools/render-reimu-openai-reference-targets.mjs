import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 192,
  cols: 4,
  lowRatioCutoff: 0.18,
  metricsFile: 'tmp/reference-audit/reimu-reference-metrics.json',
  outputRoot: 'tmp/reference-audit',
  reviewFrames: 12,
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

async function exists(file) {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function slugForFile(file) {
  return path
    .relative(process.cwd(), path.resolve(file))
    .replace(path.extname(file), '')
    .replaceAll(/[^a-z0-9_-]+/gi, '-')
    .replaceAll(/^-+|-+$/g, '')
    .toLowerCase();
}

function overlayFileForRow(row, outputRoot) {
  return path.join(outputRoot, `${row.group}-${slugForFile(row.file)}-sleeves.png`);
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

function formatRatio(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

async function labelTile(row, width, height) {
  const shortFile = path.basename(row.file).replace(/\.(png|webp|jpe?g)$/iu, '');
  const label = `${shortFile} avg ${formatRatio(row.averageSleeveWidthRatio)}`;
  const sublabel = row.group === 'openai-reference'
    ? 'OpenAI reference'
    : row.file.replace(/^public[\\/]+characters[\\/]+reimu[\\/]+/u, '');

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
        + `<text x="8" y="18" font-family="Arial" font-size="13" font-weight="700" fill="#111827">${escapeText(label)}</text>`
        + `<text x="8" y="36" font-family="Arial" font-size="11" fill="#4b5563">${escapeText(sublabel)}</text>`
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
    'OpenAI sleeve references and lowest current Reimu sleeve-ratio review targets',
    `OpenAI range ${summary.openAiRange.min}-${summary.openAiRange.max}; current range ${summary.currentRange.min}-${summary.currentRange.max}; low cutoff ${summary.thresholds.lowRatioCutoff}`,
    'OpenAI output is measured as mask/proportion guidance; shipped frames must preserve existing identity, canvas, alpha, and 5x5 grid.',
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
          `<text x="12" y="${20 + index * 18}" font-family="Arial" font-size="${index === 0 ? 14 : 12}" fill="${index === 0 ? '#111827' : '#374151'}">${escapeText(line)}</text>`
        )).join('')
        + '</svg>',
      ),
      left: 0,
      top: 0,
    }])
    .png()
    .toBuffer();
}

async function renderTile(row, options) {
  const overlayFile = overlayFileForRow(row, options.outputRoot);
  if (!await exists(overlayFile)) {
    throw new Error(`Missing reference overlay ${path.relative(process.cwd(), overlayFile)}`);
  }

  const image = await sharp(overlayFile)
    .resize(options.cellSize, options.cellSize, {
      background: { alpha: 1, b: 17, g: 17, r: 17 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();

  return {
    image,
    label: await labelTile(row, options.cellSize, options.labelHeight),
  };
}

function rangeForRows(rows) {
  const values = rows
    .map((row) => Number(row.averageSleeveWidthRatio))
    .filter(Number.isFinite);

  if (!values.length) return { max: null, min: null };

  return {
    max: Number(Math.max(...values).toFixed(3)),
    min: Number(Math.min(...values).toFixed(3)),
  };
}

function selectRows(rows, options) {
  const openAiRows = rows
    .filter((row) => row.group === 'openai-reference')
    .sort((left, right) => (
      left.averageSleeveWidthRatio - right.averageSleeveWidthRatio
      || left.file.localeCompare(right.file)
    ));
  const currentRows = rows
    .filter((row) => row.group === 'current-frame' && Number.isFinite(row.averageSleeveWidthRatio));
  const lowCurrentRows = currentRows
    .filter((row) => row.averageSleeveWidthRatio <= options.lowRatioCutoff)
    .sort((left, right) => (
      left.averageSleeveWidthRatio - right.averageSleeveWidthRatio
      || left.file.localeCompare(right.file)
    ));
  const reviewRows = (lowCurrentRows.length ? lowCurrentRows : currentRows)
    .slice(0, options.reviewFrames);

  return {
    currentRows,
    lowCurrentRows,
    openAiRows,
    selectedRows: [...openAiRows, ...reviewRows],
  };
}

async function renderSheet(rows, options, summary) {
  const legendHeight = 68;
  const tileHeight = options.cellSize + options.labelHeight;
  const rowCount = Math.ceil(rows.length / options.cols);
  const width = options.cols * options.cellSize;
  const height = legendHeight + rowCount * tileHeight;
  const composites = [
    { input: await legendTile(width, legendHeight, summary), left: 0, top: 0 },
  ];

  for (let index = 0; index < rows.length; index += 1) {
    const col = index % options.cols;
    const row = Math.floor(index / options.cols);
    const left = col * options.cellSize;
    const top = legendHeight + row * tileHeight;
    const tile = await renderTile(rows[index], options);

    composites.push({ input: tile.label, left, top });
    composites.push({ input: tile.image, left, top: top + options.labelHeight });
  }

  const outputFile = path.join(options.outputRoot, 'reimu-openai-reference-targets.png');
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
    labelHeight: 44,
    lowRatioCutoff: readNumberOption(args, 'low-ratio-cutoff', DEFAULTS.lowRatioCutoff),
    metricsFile: path.resolve(readOption(args, 'metrics-file', DEFAULTS.metricsFile)),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    reviewFrames: readNumberOption(args, 'review-frames', DEFAULTS.reviewFrames),
  };
  const metrics = JSON.parse(await readFile(options.metricsFile, 'utf8'));
  const rows = Array.isArray(metrics.rows) ? metrics.rows : [];
  const {
    currentRows,
    lowCurrentRows,
    openAiRows,
    selectedRows,
  } = selectRows(rows, options);
  const summary = {
    currentFrameCount: currentRows.length,
    currentRange: rangeForRows(currentRows),
    directAdoptionBlocked: true,
    directAdoptionBlockers: [
      'Generated full-body references may drift in face, line weight, canvas, and 5x5 grid alignment.',
      'Only measured local sleeve/mask guidance is eligible for controlled post-processing.',
    ],
    lowCurrentFrameCount: lowCurrentRows.length,
    openAiReferenceCount: openAiRows.length,
    openAiRange: rangeForRows(openAiRows),
    reviewRows: selectedRows.map((row) => ({
      averageSleeveWidthRatio: row.averageSleeveWidthRatio,
      file: row.file,
      group: row.group,
      leftWidthRatio: row.sleeves?.left?.widthRatio ?? null,
      rightWidthRatio: row.sleeves?.right?.widthRatio ?? null,
    })),
    thresholds: {
      lowRatioCutoff: options.lowRatioCutoff,
      reviewFrames: options.reviewFrames,
    },
  };

  if (openAiRows.length < 5) {
    throw new Error(`Expected at least 5 OpenAI reference rows, found ${openAiRows.length}`);
  }
  if (currentRows.length < 150) {
    throw new Error(`Expected at least 150 current Reimu reference rows, found ${currentRows.length}`);
  }

  await mkdir(options.outputRoot, { recursive: true });
  const outputFile = await renderSheet(selectedRows, options, summary);
  const csvHeaders = ['group', 'file', 'averageSleeveWidthRatio', 'leftWidthRatio', 'rightWidthRatio'];
  const csv = [
    csvHeaders.join(','),
    ...summary.reviewRows.map((row) => [
      row.group,
      row.file,
      row.averageSleeveWidthRatio,
      row.leftWidthRatio,
      row.rightWidthRatio,
    ].map(csvCell).join(',')),
  ].join('\n');

  await writeFile(
    path.join(options.outputRoot, 'reimu-openai-reference-targets-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(path.join(options.outputRoot, 'reimu-openai-reference-targets.csv'), `${csv}\n`);

  console.log(`Rendered OpenAI reference target sheet to ${path.relative(process.cwd(), outputFile)}`);
  console.log(JSON.stringify(summary, null, 2));
}

await main();
