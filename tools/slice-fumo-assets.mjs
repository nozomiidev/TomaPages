import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';

const DEFAULT_CHARACTER_SHEETS = {
  cirno: [
    'pl_01',
    'om_01',
    'ce_01',
    'pl_02',
    'om_02',
    'ce_02',
    'pl_03',
    'om_03',
    'ce_03',
    'pl_04',
    'om_04',
    'ce_04',
  ],
  reimu: [
    'pl_01',
    'om_01',
    'ce_01',
    'pt_01',
    'ot_01',
    'ct_01',
    'py_01',
    'oy_01',
    'cy_01',
  ],
};

const DEFAULTS = {
  sourceRoot: 'metaassets/fumo',
  outputRoot: 'public/characters',
  characters: ['reimu', 'cirno'],
  rows: 5,
  cols: 5,
  outputSize: 512,
  quality: 94,
  windowScale: 1.55,
  gravityBlend: 0.68,
};

const REIMU_SLEEVE_FLARE_SHEETS = {
  ct_01: 'ce_01',
  cy_01: 'ce_01',
  ot_01: 'om_01',
  oy_01: 'om_01',
  pt_01: 'pl_01',
  py_01: 'pl_01',
};

const REIMU_SLEEVE_STYLE = {
  t: {
    outputHeightFromSource: 1.92,
    outputHeightFromTarget: 2.46,
    outputHeightMin: 134,
    outputWidthFromSource: 2.08,
    outputWidthFromTarget: 1.98,
    outputWidthMin: 166,
    sideOffsetX: 44,
    topOffsetY: 24,
  },
  y: {
    outputHeightFromSource: 2,
    outputHeightFromTarget: 2.3,
    outputHeightMin: 150,
    outputWidthFromSource: 2.14,
    outputWidthFromTarget: 2,
    outputWidthMin: 178,
    sideOffsetX: 50,
    topOffsetY: 20,
  },
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function hasOption(args, name) {
  return args.includes(`--${name}`);
}

function parseList(value) {
  return String(value ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function readListOption(args, name, fallback) {
  if (!hasOption(args, name)) return fallback;
  return parseList(readOption(args, name, ''));
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
    let maxX = 0;
    let maxY = 0;
    let minX = width;
    let minY = height;
    let sumX = 0;
    let sumY = 0;
    visited[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels.push(index);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
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
      height: maxY - minY + 1,
      maxX,
      maxY,
      minX,
      minY,
      pixels,
      width: maxX - minX + 1,
    });
  }

  return components;
}

function alphaBounds(data, width, height) {
  const bounds = {
    maxX: 0,
    maxY: 0,
    minX: width,
    minY: height,
  };

  for (let offset = 0; offset < data.length; offset += 4) {
    if (data[offset + 3] <= 32) continue;

    const index = offset / 4;
    const x = index % width;
    const y = Math.floor(index / width);
    bounds.minX = Math.min(bounds.minX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.maxY = Math.max(bounds.maxY, y);
  }

  return bounds;
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
  const yNorm = (y - bounds.minY) / (bounds.maxY - bounds.minY + 1);
  if (yNorm < 0.22 || yNorm > 0.78) return false;
  if (Math.abs(x - centerX) < 35) return false;

  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const whiteCloth = red > 184 && green > 174 && blue > 166 && max - min < 82;
  const redTrim = red > 145 && green < 122 && blue < 122;
  const pinkEdge = red > 180 && green > 95 && green < 190 && blue > 95 && blue < 190;

  return whiteCloth || redTrim || pinkEdge;
}

function reimuSleeveComponents(data, width, height) {
  const bounds = alphaBounds(data, width, height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const boundsHeight = bounds.maxY - bounds.minY + 1;
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = isReimuSleevePixel(data, index, width, bounds, centerX) ? 1 : 0;
  }

  return findForegroundComponents(mask, width, height).map((component) => ({
    ...component,
    xDist: component.centerX - centerX,
    yNorm: (component.centerY - bounds.minY) / boundsHeight,
  }));
}

function strongestReimuSleeveComponent(components, side, poseKind) {
  return components
    .filter((component) => Math.sign(component.xDist) === side)
    .filter((component) => Math.abs(component.xDist) > 58)
    .filter((component) => component.pixels.length > 200)
    .filter((component) => component.width > 16 && component.height > 15)
    .filter((component) => (poseKind === 't'
      ? component.yNorm >= 0.50 && component.yNorm <= 0.77
      : component.yNorm >= 0.38 && component.yNorm <= 0.68))
    .sort((a, b) => b.pixels.length - a.pixels.length)[0];
}

function sourceReimuSleeveComponent(components, side) {
  return components
    .filter((component) => Math.sign(component.xDist) === side)
    .filter((component) => Math.abs(component.xDist) > 55)
    .filter((component) => component.pixels.length > 1200)
    .filter((component) => component.yNorm >= 0.60 && component.yNorm <= 0.73)
    .sort((a, b) => b.pixels.length - a.pixels.length)[0];
}

function dilatedPixelMask(pixels, width, height, radius) {
  const mask = new Uint8Array(width * height);

  for (const index of pixels) {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;

        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) continue;

        mask[candidateY * width + candidateX] = 1;
      }
    }
  }

  return mask;
}

function reimuSleeveCrop({ component, data, height, width }) {
  const pad = 8;
  const left = Math.max(0, component.minX - pad);
  const top = Math.max(0, component.minY - pad);
  const right = Math.min(width - 1, component.maxX + pad);
  const bottom = Math.min(height - 1, component.maxY + pad);
  const cropWidth = right - left + 1;
  const cropHeight = bottom - top + 1;
  const dilated = dilatedPixelMask(component.pixels, width, height, 3);
  const crop = Buffer.alloc(cropWidth * cropHeight * 4);

  for (let y = 0; y < cropHeight; y += 1) {
    for (let x = 0; x < cropWidth; x += 1) {
      const sourceIndex = (top + y) * width + left + x;
      const sourceOffset = sourceIndex * 4;
      if (!dilated[sourceIndex] || data[sourceOffset + 3] < 20) continue;

      const targetOffset = (y * cropWidth + x) * 4;
      crop[targetOffset] = data[sourceOffset];
      crop[targetOffset + 1] = data[sourceOffset + 1];
      crop[targetOffset + 2] = data[sourceOffset + 2];
      crop[targetOffset + 3] = Math.min(245, data[sourceOffset + 3]);
    }
  }

  return {
    crop,
    height: cropHeight,
    width: cropWidth,
  };
}

async function canvasOverlay(input, left, top, canvasWidth, canvasHeight) {
  const metadata = await sharp(input).metadata();
  const sourceLeft = Math.max(0, -left);
  const sourceTop = Math.max(0, -top);
  const targetLeft = Math.max(0, left);
  const targetTop = Math.max(0, top);
  const width = Math.min((metadata.width ?? 0) - sourceLeft, canvasWidth - targetLeft);
  const height = Math.min((metadata.height ?? 0) - sourceTop, canvasHeight - targetTop);

  if (width <= 0 || height <= 0) return null;

  const cropped = sourceLeft || sourceTop || width !== metadata.width || height !== metadata.height
    ? await sharp(input).extract({
      height,
      left: sourceLeft,
      top: sourceTop,
      width,
    }).png().toBuffer()
    : input;

  return {
    input: cropped,
    left: targetLeft,
    top: targetTop,
  };
}

async function replaceFileWithRetry(sourceFile, targetFile) {
  let lastError;

  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      await rm(targetFile, {
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
      await rename(sourceFile, targetFile);
      return;
    } catch (error) {
      lastError = error;
      await delay(120 * (attempt + 1));
    }
  }

  throw lastError;
}

async function readRgbaFrame(file) {
  const input = await readFile(file);
  const { data, info } = await sharp(input, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    height: info.height,
    width: info.width,
  };
}

async function addReimuSleeveFlares({ outputFile, quality, sourceFile, targetFile }) {
  const poseKind = path.basename(path.dirname(targetFile)).includes('y') ? 'y' : 't';
  const target = await readRgbaFrame(targetFile);
  const source = await readRgbaFrame(sourceFile);
  const targetComponents = reimuSleeveComponents(target.data, target.width, target.height);
  const sourceComponents = reimuSleeveComponents(source.data, source.width, source.height);
  const overlays = [];
  const sleeveStyle = REIMU_SLEEVE_STYLE[poseKind];

  for (const side of [-1, 1]) {
    const targetComponent = strongestReimuSleeveComponent(targetComponents, side, poseKind);
    const sourceComponent = sourceReimuSleeveComponent(sourceComponents, side);
    if (!targetComponent || !sourceComponent) continue;

    const sleeve = reimuSleeveCrop({
      component: sourceComponent,
      data: source.data,
      height: source.height,
      width: source.width,
    });
    const outputWidth = Math.round(Math.max(
      targetComponent.width * sleeveStyle.outputWidthFromTarget,
      sleeveStyle.outputWidthMin,
      sleeve.width * sleeveStyle.outputWidthFromSource,
    ));
    const outputHeight = Math.round(Math.max(
      targetComponent.height * sleeveStyle.outputHeightFromTarget,
      sleeveStyle.outputHeightMin,
      sleeve.height * sleeveStyle.outputHeightFromSource,
    ));
    const sleeveImage = await sharp(sleeve.crop, {
      raw: {
        channels: 4,
        height: sleeve.height,
        width: sleeve.width,
      },
    })
      .resize(outputWidth, outputHeight, { fit: 'fill', kernel: 'cubic' })
      .png()
      .toBuffer();
    const left = Math.round(
      targetComponent.centerX - outputWidth / 2 + side * sleeveStyle.sideOffsetX,
    );
    const top = Math.round(
      targetComponent.centerY - outputHeight / 2 + sleeveStyle.topOffsetY,
    );
    const overlay = await canvasOverlay(sleeveImage, left, top, target.width, target.height);

    if (overlay) overlays.push(overlay);
  }

  const original = await sharp(target.data, {
    raw: {
      channels: 4,
      height: target.height,
      width: target.width,
    },
  }).png().toBuffer();

  const tempOutputFile = `${outputFile}.${process.pid}.tmp.webp`;

  await sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: target.height,
      width: target.width,
    },
  })
    .composite([{ input: original, left: 0, top: 0 }, ...overlays])
    .webp({
      alphaQuality: quality,
      effort: 5,
      quality,
      smartSubsample: true,
    })
    .toFile(tempOutputFile);
  await replaceFileWithRetry(tempOutputFile, outputFile);
}

async function addReimuPoseSleeveFlares({ characterOutputDir, quality, rows, cols }) {
  for (const [targetSheet, sourceSheet] of Object.entries(REIMU_SLEEVE_FLARE_SHEETS)) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const targetFile = path.join(characterOutputDir, targetSheet, `r${row}c${col}.webp`);
        const sourceFile = path.join(characterOutputDir, sourceSheet, `r${row}c${col}.webp`);

        await addReimuSleeveFlares({
          outputFile: targetFile,
          quality,
          sourceFile,
          targetFile,
        });
      }
    }
  }
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

function sheetsForCharacter(characterId, sheetOverride) {
  const sheets = sheetOverride ?? DEFAULT_CHARACTER_SHEETS[characterId];
  if (!sheets?.length) {
    throw new Error(`No sheet list configured for character: ${characterId}`);
  }

  return sheets;
}

async function main() {
  const args = process.argv.slice(2);
  const sheetOverride = hasOption(args, 'sheets') ? readListOption(args, 'sheets', []) : null;
  const options = {
    sourceRoot: path.resolve(readOption(args, 'source', DEFAULTS.sourceRoot)),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    characters: readListOption(args, 'characters', DEFAULTS.characters),
    sheetOverride,
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
    const sheets = sheetsForCharacter(characterId, options.sheetOverride);

    for (const sheetId of sheets) {
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

    if (characterId === 'reimu') {
      await addReimuPoseSleeveFlares({
        characterOutputDir,
        cols: options.cols,
        quality: options.quality,
        rows: options.rows,
      });
      console.log('reimu: added default-sleeve flares for T/Y pose sheets');
    }
  }

  console.log(`Generated ${written} WebP frames in ${path.relative(process.cwd(), options.outputRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
