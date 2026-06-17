import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 96,
  character: 'reimu',
  modes: ['pink', 'dark', 'alpha'],
  outputRoot: 'tmp/sweep',
  sheets: ['pl_01', 'om_01', 'ce_01', 'pt_01', 'ot_01', 'ct_01', 'py_01', 'oy_01', 'cy_01'],
  sourceRoot: 'public/characters',
};

const BACKGROUNDS = {
  dark: { alpha: 1, b: 17, g: 17, r: 17 },
  pink: { alpha: 1, b: 224, g: 196, r: 247 },
};

function hasOption(args, name) {
  return args.includes(`--${name}`);
}

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
  if (!hasOption(args, name)) return fallback;
  return String(readOption(args, name, ''))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
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

async function isWebpFileEntry(parentDir, entry) {
  if (!entry.name.endsWith('.webp')) return false;
  if (entry.isFile()) return true;

  try {
    return (await stat(path.join(parentDir, entry.name))).isFile();
  } catch {
    return false;
  }
}

function framePosition(fileName) {
  const match = /^r(\d+)c(\d+)\.webp$/u.exec(fileName);
  if (!match) return null;

  return {
    col: Number(match[2]),
    row: Number(match[1]),
  };
}

async function sheetFrames(sheetRoot) {
  const entries = await readdir(sheetRoot, { withFileTypes: true });
  const frames = [];

  for (const entry of entries) {
    if (!await isWebpFileEntry(sheetRoot, entry)) continue;

    frames.push({
      file: path.join(sheetRoot, entry.name),
      name: entry.name,
      position: framePosition(entry.name),
    });
  }

  return frames
    .filter((frame) => frame.position)
    .sort((a, b) => (
      a.position.row - b.position.row || a.position.col - b.position.col
    ));
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function labelSvg(width, height, sheet, mode) {
  const fill = mode === 'dark' ? '#f8fafc' : '#111827';
  const subFill = mode === 'dark' ? '#cbd5e1' : '#64748b';
  const background = mode === 'dark' ? '#111111' : '#f8fafc';

  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
      + `<rect width="100%" height="100%" fill="${background}"/>`
      + `<text x="10" y="18" font-family="Arial" font-size="13" font-weight="700" fill="${fill}">${escapeText(sheet)}</text>`
      + `<text x="10" y="36" font-family="Arial" font-size="11" fill="${subFill}">5x5 ${escapeText(mode)} sweep</text>`
      + '</svg>',
  );
}

async function alphaTile(file, cellSize) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .resize(cellSize, cellSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rgba = Buffer.alloc(info.width * info.height * 4);

  for (let index = 0; index < info.width * info.height; index += 1) {
    const alpha = data[index * 4 + 3];
    const offset = index * 4;
    rgba[offset] = alpha;
    rgba[offset + 1] = alpha;
    rgba[offset + 2] = alpha;
    rgba[offset + 3] = 255;
  }

  return sharp(rgba, {
    raw: {
      channels: 4,
      height: info.height,
      width: info.width,
    },
  })
    .png()
    .toBuffer();
}

async function colorTile(file, cellSize, background) {
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
      background,
      channels: 4,
      height: cellSize,
      width: cellSize,
    },
  })
    .composite([{ input: image, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function tileForMode(file, mode, cellSize) {
  if (mode === 'alpha') return alphaTile(file, cellSize);

  const background = BACKGROUNDS[mode];
  if (!background) throw new Error(`Unknown render mode: ${mode}`);

  return colorTile(file, cellSize, background);
}

async function renderSheetBlock({ cellSize, characterRoot, labelHeight, mode, sheet }) {
  const sheetRoot = path.join(characterRoot, sheet);
  const frames = await sheetFrames(sheetRoot);
  const width = cellSize * 5;
  const height = labelHeight + cellSize * 5;
  const composites = [
    { input: labelSvg(width, labelHeight, sheet, mode), left: 0, top: 0 },
  ];

  if (frames.length !== 25) {
    throw new Error(`${sheetRoot} should contain 25 renderable rNcN.webp frames, found ${frames.length}`);
  }

  for (const frame of frames) {
    composites.push({
      input: await tileForMode(frame.file, mode, cellSize),
      left: frame.position.col * cellSize,
      top: labelHeight + frame.position.row * cellSize,
    });
  }

  const background = mode === 'alpha'
    ? { alpha: 1, b: 0, g: 0, r: 0 }
    : BACKGROUNDS[mode];

  return sharp({
    create: {
      background,
      channels: 4,
      height,
      width,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function renderSweep(options, mode) {
  const labelHeight = 44;
  const gap = 16;
  const blockWidth = options.cellSize * 5;
  const blockHeight = labelHeight + options.cellSize * 5;
  const columns = 3;
  const rows = Math.ceil(options.sheets.length / columns);
  const width = columns * blockWidth + (columns - 1) * gap;
  const height = rows * blockHeight + (rows - 1) * gap;
  const background = mode === 'alpha'
    ? { alpha: 1, b: 0, g: 0, r: 0 }
    : BACKGROUNDS[mode];
  const composites = [];

  for (let index = 0; index < options.sheets.length; index += 1) {
    const sheet = options.sheets[index];
    const block = await renderSheetBlock({
      cellSize: options.cellSize,
      characterRoot: options.characterRoot,
      labelHeight,
      mode,
      sheet,
    });
    composites.push({
      input: block,
      left: (index % columns) * (blockWidth + gap),
      top: Math.floor(index / columns) * (blockHeight + gap),
    });
  }

  const outputFile = path.join(options.outputRoot, `${options.character}-full-sweep-${mode}.png`);
  await sharp({
    create: {
      background,
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

async function renderSweeps(options) {
  await mkdir(options.outputRoot, { recursive: true });

  for (const mode of options.modes) {
    const outputFile = await renderSweep(options, mode);
    console.log(`Wrote ${path.relative(process.cwd(), outputFile)}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const character = readOption(args, 'character', DEFAULTS.character);
  const sourceRoot = readOption(args, 'source', DEFAULTS.sourceRoot);
  const options = {
    cellSize: readNumberOption(args, 'cell-size', DEFAULTS.cellSize),
    character,
    characterRoot: await resolveCharacterRoot(sourceRoot, character),
    modes: readListOption(args, 'modes', DEFAULTS.modes),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sheets: readListOption(args, 'sheets', DEFAULTS.sheets),
  };

  await renderSweeps(options);
}

await main();
