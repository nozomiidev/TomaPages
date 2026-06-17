import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  cellSize: 160,
  character: 'reimu',
  compareOutputRoot: 'tmp/compare',
  compareSheets: ['pt_01', 'ot_01', 'ct_01', 'py_01', 'oy_01', 'cy_01'],
  modes: ['pink', 'dark', 'alpha'],
  outputRoot: 'tmp/audit',
  sheets: ['pl_01', 'pt_01', 'py_01', 'oy_01', 'ot_01', 'cy_01', 'ct_01'],
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

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.webp'))
    .map((entry) => ({
      file: path.join(sheetRoot, entry.name),
      name: entry.name,
      position: framePosition(entry.name),
    }))
    .filter((frame) => frame.position)
    .sort((a, b) => (
      a.position.row - b.position.row || a.position.col - b.position.col
    ));
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

async function renderGrid({ cellSize, characterRoot, mode, sheet }) {
  const sheetRoot = path.join(characterRoot, sheet);
  const frames = await sheetFrames(sheetRoot);
  const composites = [];

  if (frames.length !== 25) {
    throw new Error(`${sheetRoot} should contain 25 renderable rNcN.webp frames, found ${frames.length}`);
  }

  for (const frame of frames) {
    composites.push({
      input: await tileForMode(frame.file, mode, cellSize),
      left: frame.position.col * cellSize,
      top: frame.position.row * cellSize,
    });
  }

  const background = mode === 'alpha'
    ? { alpha: 1, b: 0, g: 0, r: 0 }
    : BACKGROUNDS[mode];

  return sharp({
    create: {
      background,
      channels: 4,
      height: cellSize * 5,
      width: cellSize * 5,
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

async function renderContactSheets(options) {
  await mkdir(options.outputRoot, { recursive: true });

  for (const sheet of options.sheets) {
    for (const mode of options.modes) {
      const buffer = await renderGrid({
        cellSize: options.cellSize,
        characterRoot: options.characterRoot,
        mode,
        sheet,
      });
      const outputFile = path.join(options.outputRoot, `${sheet}-${mode}.png`);
      await sharp(buffer).png().toFile(outputFile);
      console.log(`Wrote ${path.relative(process.cwd(), outputFile)}`);
    }
  }
}

async function renderCompareSheets(options) {
  if (!options.compareRoot) return;

  await mkdir(options.compareOutputRoot, { recursive: true });

  for (const sheet of options.compareSheets) {
    for (const mode of options.modes.filter((candidate) => candidate !== 'alpha')) {
      const current = await renderGrid({
        cellSize: options.cellSize,
        characterRoot: options.characterRoot,
        mode,
        sheet,
      });
      const baseline = await renderGrid({
        cellSize: options.cellSize,
        characterRoot: options.compareRoot,
        mode,
        sheet,
      });
      const gutter = 16;
      const gridSize = options.cellSize * 5;
      const background = BACKGROUNDS[mode];
      const outputFile = path.join(options.compareOutputRoot, `${sheet}-${mode}-compare.png`);

      await sharp({
        create: {
          background,
          channels: 4,
          height: gridSize,
          width: gridSize * 2 + gutter,
        },
      })
        .composite([
          { input: current, left: 0, top: 0 },
          { input: baseline, left: gridSize + gutter, top: 0 },
        ])
        .png()
        .toFile(outputFile);
      console.log(`Wrote ${path.relative(process.cwd(), outputFile)}`);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const character = readOption(args, 'character', DEFAULTS.character);
  const sourceRoot = readOption(args, 'source', DEFAULTS.sourceRoot);
  const compareSource = readOption(args, 'compare-source', '');
  const options = {
    cellSize: readNumberOption(args, 'cell-size', DEFAULTS.cellSize),
    character,
    characterRoot: await resolveCharacterRoot(sourceRoot, character),
    compareOutputRoot: path.resolve(readOption(args, 'compare-out', DEFAULTS.compareOutputRoot)),
    compareRoot: compareSource
      ? await resolveCharacterRoot(compareSource, character)
      : null,
    compareSheets: readListOption(args, 'compare-sheets', DEFAULTS.compareSheets),
    modes: readListOption(args, 'modes', DEFAULTS.modes),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sheets: readListOption(args, 'sheets', DEFAULTS.sheets),
  };

  await renderContactSheets(options);
  await renderCompareSheets(options);
}

await main();
