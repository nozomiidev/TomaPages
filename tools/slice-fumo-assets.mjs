import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  sourceRoot: 'metaassets/fumo',
  outputRoot: 'public/characters',
  characters: ['reimu'],
  sheets: ['pl_01', 'om_01', 'ce_01'],
  rows: 5,
  cols: 5,
  outputSize: 512,
  quality: 94,
  windowScale: 1.55,
  gravityBlend: 0.68,
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readListOption(args, name, fallback) {
  return readOption(args, name, fallback.join(','))
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside ${parent}: ${child}`);
  }
}

async function cleanCharacterOutput(outputRoot, characterId) {
  const outputDir = path.resolve(outputRoot, characterId);
  assertInside(path.resolve(outputRoot), outputDir);
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  return outputDir;
}

function isCheckerboardBackground(data, index, width) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const average = (red + green + blue) / 3;
  const x = index % width;
  const y = Math.floor(index / width);
  const checkerSize = 17.5;
  const expectedTone = (Math.floor(x / checkerSize) + Math.floor(y / checkerSize)) % 2 === 0 ? 253 : 238;

  return alpha < 16 || (max - min <= 8 && Math.abs(average - expectedTone) <= 14);
}

function isFloodBackground(data, index, width) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const alpha = data[offset + 3];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);

  return isCheckerboardBackground(data, index, width) || (alpha > 240 && max - min <= 16 && min >= 210);
}

function pushBackgroundSeed({ background, backgroundCandidate, height, index, queue, width }) {
  if (index < 0 || index >= width * height) return;
  if (background[index] || !backgroundCandidate[index]) return;

  background[index] = 1;
  queue.push(index);
}

function floodBackground(backgroundCandidate, width, height) {
  const background = new Uint8Array(width * height);
  const queue = [];

  for (let x = 0; x < width; x += 1) {
    pushBackgroundSeed({ background, backgroundCandidate, height, index: x, queue, width });
    pushBackgroundSeed({ background, backgroundCandidate, height, index: (height - 1) * width + x, queue, width });
  }

  for (let y = 0; y < height; y += 1) {
    pushBackgroundSeed({ background, backgroundCandidate, height, index: y * width, queue, width });
    pushBackgroundSeed({ background, backgroundCandidate, height, index: y * width + width - 1, queue, width });
  }

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) pushBackgroundSeed({ background, backgroundCandidate, height, index: index - 1, queue, width });
    if (x + 1 < width) pushBackgroundSeed({ background, backgroundCandidate, height, index: index + 1, queue, width });
    if (y > 0) pushBackgroundSeed({ background, backgroundCandidate, height, index: index - width, queue, width });
    if (y + 1 < height) pushBackgroundSeed({ background, backgroundCandidate, height, index: index + width, queue, width });
  }

  return background;
}

function findForegroundComponents(foreground, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let start = 0; start < foreground.length; start += 1) {
    if (!foreground[start] || visited[start]) continue;

    const queue = [start];
    const pixels = [];
    let sumX = 0;
    let sumY = 0;
    visited[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels.push(index);
      sumX += x;
      sumY += y;

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
        if (neighbor >= 0 && foreground[neighbor] && !visited[neighbor]) {
          visited[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    components.push({
      centerX: sumX / pixels.length,
      centerY: sumY / pixels.length,
      pixels,
    });
  }

  return components;
}

function cellIndexForPoint(x, y, width, height, rows, cols) {
  const cellWidth = width / cols;
  const cellHeight = height / rows;
  const col = Math.min(cols - 1, Math.max(0, Math.round((x - cellWidth / 2) / cellWidth)));
  const row = Math.min(rows - 1, Math.max(0, Math.round((y - cellHeight / 2) / cellHeight)));

  return row * cols + col;
}

function assignForegroundToCells(data, width, height, rows, cols) {
  const backgroundCandidate = new Uint8Array(width * height);
  for (let index = 0; index < backgroundCandidate.length; index += 1) {
    backgroundCandidate[index] = isFloodBackground(data, index, width) ? 1 : 0;
  }

  const background = floodBackground(backgroundCandidate, width, height);
  const foreground = new Uint8Array(width * height);
  for (let index = 0; index < foreground.length; index += 1) {
    foreground[index] = background[index] ? 0 : 1;
  }

  const assignments = new Int16Array(width * height);
  assignments.fill(-1);

  for (const component of findForegroundComponents(foreground, width, height)) {
    const cellIndex = cellIndexForPoint(component.centerX, component.centerY, width, height, rows, cols);
    for (const pixelIndex of component.pixels) {
      assignments[pixelIndex] = cellIndex;
    }
  }

  return assignments;
}

function collectCellStats(assignments, width, height, cellCount) {
  const stats = Array.from({ length: cellCount }, () => ({
    count: 0,
    maxX: 0,
    maxY: 0,
    minX: width,
    minY: height,
    sumX: 0,
    sumY: 0,
  }));

  for (let index = 0; index < assignments.length; index += 1) {
    const cellIndex = assignments[index];
    if (cellIndex < 0) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    const stat = stats[cellIndex];
    stat.count += 1;
    stat.sumX += x;
    stat.sumY += y;
    stat.minX = Math.min(stat.minX, x);
    stat.minY = Math.min(stat.minY, y);
    stat.maxX = Math.max(stat.maxX, x);
    stat.maxY = Math.max(stat.maxY, y);
  }

  return stats;
}

function anchorForCell({ cellHeight, cellWidth, col, gravityBlend, row, stat }) {
  const fallback = {
    x: (col + 0.5) * cellWidth,
    y: (row + 0.5) * cellHeight,
  };

  if (!stat.count) return fallback;

  const centroid = {
    x: stat.sumX / stat.count,
    y: stat.sumY / stat.count,
  };
  const boxCenter = {
    x: (stat.minX + stat.maxX) / 2,
    y: (stat.minY + stat.maxY) / 2,
  };

  return {
    x: centroid.x * gravityBlend + boxCenter.x * (1 - gravityBlend),
    y: centroid.y * gravityBlend + boxCenter.y * (1 - gravityBlend),
  };
}

function copyAssignedWindow({ anchorX, anchorY, assignments, cellIndex, data, height, width, windowSize }) {
  const output = Buffer.alloc(windowSize * windowSize * 4);
  const left = Math.round(anchorX - windowSize / 2);
  const top = Math.round(anchorY - windowSize / 2);

  for (let y = 0; y < windowSize; y += 1) {
    const sourceY = top + y;
    if (sourceY < 0 || sourceY >= height) continue;

    for (let x = 0; x < windowSize; x += 1) {
      const sourceX = left + x;
      if (sourceX < 0 || sourceX >= width) continue;

      const sourceIndex = sourceY * width + sourceX;
      if (assignments[sourceIndex] !== cellIndex) continue;

      const sourceOffset = sourceIndex * 4;
      const targetOffset = (y * windowSize + x) * 4;
      output[targetOffset] = data[sourceOffset];
      output[targetOffset + 1] = data[sourceOffset + 1];
      output[targetOffset + 2] = data[sourceOffset + 2];
      output[targetOffset + 3] = data[sourceOffset + 3];
    }
  }

  return output;
}

async function assertKnownCharacters(sourceRoot, characterIds) {
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  const known = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase()));

  for (const characterId of characterIds) {
    if (!known.has(characterId)) {
      throw new Error(`Missing source directory for character: ${characterId}`);
    }
  }
}

async function sliceSheet({ sourceFile, sheetOutputDir, rows, cols, outputSize, quality, windowScale, gravityBlend }) {
  const { data, info } = await sharp(sourceFile, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    throw new Error(`Unable to read image size: ${sourceFile}`);
  }

  await mkdir(sheetOutputDir, { recursive: true });

  const assignments = assignForegroundToCells(data, info.width, info.height, rows, cols);
  const cellWidth = info.width / cols;
  const cellHeight = info.height / rows;
  const windowSize = Math.ceil(Math.max(cellWidth, cellHeight) * windowScale);
  const cellStats = collectCellStats(assignments, info.width, info.height, rows * cols);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const outputFile = path.join(sheetOutputDir, `r${row}c${col}.webp`);
      const cellIndex = row * cols + col;
      const anchor = anchorForCell({
        cellHeight,
        cellWidth,
        col,
        gravityBlend,
        row,
        stat: cellStats[cellIndex],
      });
      const windowData = copyAssignedWindow({
        anchorX: anchor.x,
        anchorY: anchor.y,
        assignments,
        cellIndex,
        data,
        height: info.height,
        width: info.width,
        windowSize,
      });

      await sharp(windowData, {
        raw: {
          width: windowSize,
          height: windowSize,
          channels: 4,
        },
      })
        .resize(outputSize, outputSize, { fit: 'fill' })
        .sharpen()
        .webp({
          alphaQuality: quality,
          effort: 5,
          quality,
          smartSubsample: true,
        })
        .toFile(outputFile);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    sourceRoot: path.resolve(readOption(args, 'source', DEFAULTS.sourceRoot)),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    characters: readListOption(args, 'characters', DEFAULTS.characters),
    sheets: readListOption(args, 'sheets', DEFAULTS.sheets),
    rows: readNumberOption(args, 'rows', DEFAULTS.rows),
    cols: readNumberOption(args, 'cols', DEFAULTS.cols),
    outputSize: readNumberOption(args, 'size', DEFAULTS.outputSize),
    quality: Math.min(100, readNumberOption(args, 'quality', DEFAULTS.quality)),
    windowScale: readNumberOption(args, 'window-scale', DEFAULTS.windowScale),
    gravityBlend: Math.min(1, readNumberOption(args, 'gravity-blend', DEFAULTS.gravityBlend)),
  };

  await assertKnownCharacters(options.sourceRoot, options.characters);

  let written = 0;
  for (const characterId of options.characters) {
    const characterOutputDir = await cleanCharacterOutput(options.outputRoot, characterId);

    for (const sheetId of options.sheets) {
      const sourceFile = path.join(options.sourceRoot, characterId, `${characterId}_${sheetId}.png`);
      const sheetOutputDir = path.join(characterOutputDir, sheetId);

      await sliceSheet({
        sourceFile,
        sheetOutputDir,
        rows: options.rows,
        cols: options.cols,
        outputSize: options.outputSize,
        quality: options.quality,
        windowScale: options.windowScale,
        gravityBlend: options.gravityBlend,
      });

      written += options.rows * options.cols;
      console.log(`${characterId}/${sheetId}: ${options.rows * options.cols} webp frames`);
    }
  }

  console.log(`Generated ${written} WebP frames in ${path.relative(process.cwd(), options.outputRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
