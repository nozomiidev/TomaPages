import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
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
  lossless: false,
};

const REIMU_SLEEVE_REFERENCE_SHEETS = {
  ct_01: 'ce_01',
  cy_01: 'ce_01',
  ot_01: 'om_01',
  oy_01: 'om_01',
  pt_01: 'pl_01',
  py_01: 'pl_01',
};

const REIMU_SLEEVE_STYLE = {
  t: {
    cornerFeather: 0.10,
    eraseRadius: 2,
    heightScale: 1.64,
    innerOverlap: 3,
    innerHeightScale: 1,
    maxHeightFromReference: 1.16,
    maxWidthFromReference: 1.34,
    minHeightFromReference: 1.02,
    minWidthFromReference: 1.14,
    outerHeightScale: 1.42,
    outerSilhouette: 0.98,
    innerSilhouette: 0.80,
    topOffsetY: 2,
    widthScale: 1.09,
  },
  y: {
    cornerFeather: 0.10,
    eraseRadius: 2,
    heightScale: 1.56,
    innerOverlap: 3,
    innerHeightScale: 1,
    maxHeightFromReference: 1.18,
    maxWidthFromReference: 1.40,
    minHeightFromReference: 1.02,
    minWidthFromReference: 1.16,
    outerHeightScale: 1.36,
    outerSilhouette: 0.97,
    innerSilhouette: 0.78,
    topOffsetY: 1,
    widthScale: 1.08,
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

function targetReimuSleeveComponents(components, side, poseKind) {
  return components
    .filter((component) => Math.sign(component.xDist) === side)
    .filter((component) => Math.abs(component.xDist) > 58)
    .filter((component) => component.pixels.length > 200)
    .filter((component) => component.width > 16 && component.height > 15)
    .filter((component) => (poseKind === 't'
      ? component.yNorm >= 0.50 && component.yNorm <= 0.77
      : component.yNorm >= 0.38 && component.yNorm <= 0.68));
}

function referenceReimuSleeveComponent(components, side) {
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

function largestComponentMask(mask, width, height) {
  const components = findForegroundComponents(mask, width, height);
  const largest = components.sort((a, b) => b.pixels.length - a.pixels.length)[0];
  const keep = new Uint8Array(width * height);

  if (!largest) return keep;

  const minPixels = Math.max(64, Math.round(largest.pixels.length * 0.006));
  for (const component of components) {
    if (component !== largest && (
      component.pixels.length < minPixels
      || isDetachedSliverComponent(component)
    )) {
      continue;
    }

    for (const index of component.pixels) {
      keep[index] = 1;
    }
  }

  return keep;
}

function isDetachedSliverComponent(component) {
  const shortSide = Math.min(component.width, component.height);
  const longSide = Math.max(component.width, component.height);

  return shortSide <= 16 && longSide >= 8;
}

function sanitizeSpriteAlpha(data, width, height) {
  const alphaMask = new Uint8Array(width * height);
  const strongMask = new Uint8Array(width * height);

  for (let index = 0; index < alphaMask.length; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha >= 16) alphaMask[index] = 1;
    if (alpha >= 180) strongMask[index] = 1;
  }

  const mainMask = largestComponentMask(alphaMask, width, height);
  const strongNeighborhood = dilatedPixelMask(
    Array.from(strongMask.keys()).filter((index) => strongMask[index]),
    width,
    height,
    3,
  );
  const next = Buffer.from(data);

  for (let index = 0; index < mainMask.length; index += 1) {
    const offset = index * 4;
    const alpha = next[offset + 3];

    if (!mainMask[index] || (alpha > 0 && alpha < 180 && !strongNeighborhood[index])) {
      next[offset] = 0;
      next[offset + 1] = 0;
      next[offset + 2] = 0;
      next[offset + 3] = 0;
    } else if (alpha === 0) {
      next[offset] = 0;
      next[offset + 1] = 0;
      next[offset + 2] = 0;
    }
  }

  bridgeNearbyDetachedComponents(next, width, height);
  fillSmallInteriorAlphaHoles(next, width, height);

  return next;
}

function bridgeNearbyDetachedComponents(data, width, height) {
  const alphaMask = new Uint8Array(width * height);
  for (let index = 0; index < alphaMask.length; index += 1) {
    if (data[index * 4 + 3] >= 16) alphaMask[index] = 1;
  }

  const components = findForegroundComponents(alphaMask, width, height);
  const largest = components[0];
  if (!largest) return;

  const mainMask = new Uint8Array(width * height);
  for (const index of largest.pixels) mainMask[index] = 1;

  for (const component of components.slice(1)) {
    if (
      component.pixels.length < 64
      || component.pixels.length > 512
      || isDetachedSliverComponent(component)
    ) {
      continue;
    }

    const nearest = nearestMainPixel(component, mainMask, width, height, 8);
    if (!nearest) continue;

    const bridgePixels = bridgeLinePixels(nearest.from, nearest.to, width, height, 1)
      .filter((index) => data[index * 4 + 3] < 180);
    if (!bridgePixels.length) continue;

    const color = averageNeighborColor(data, bridgePixels, width, height)
      ?? averageEndpointColor(data, nearest.from, nearest.to);
    if (!color) continue;

    for (const index of bridgePixels) {
      const offset = index * 4;
      data[offset] = color.red;
      data[offset + 1] = color.green;
      data[offset + 2] = color.blue;
      data[offset + 3] = 255;
      mainMask[index] = 1;
    }
    for (const index of component.pixels) mainMask[index] = 1;
  }
}

function fillSmallInteriorAlphaHoles(data, width, height) {
  const transparentMask = new Uint8Array(width * height);

  for (let index = 0; index < transparentMask.length; index += 1) {
    if (data[index * 4 + 3] < 16) transparentMask[index] = 1;
  }

  for (const component of findForegroundComponents(transparentMask, width, height)) {
    if (
      component.minX === 0
      || component.minY === 0
      || component.maxX === width - 1
      || component.maxY === height - 1
    ) {
      continue;
    }

    if (!isLineLikeInteriorHole(component)) continue;

    const color = averageNeighborColor(data, component.pixels, width, height);
    if (!color) continue;

    for (const index of component.pixels) {
      const offset = index * 4;
      data[offset] = color.red;
      data[offset + 1] = color.green;
      data[offset + 2] = color.blue;
      data[offset + 3] = 255;
    }
  }
}

function isLineLikeInteriorHole(component) {
  const shortSide = Math.min(component.width, component.height);
  const longSide = Math.max(component.width, component.height);
  const aspect = longSide / Math.max(1, shortSide);

  return (
    component.pixels.length <= 128
    && (component.width <= 10 || component.height <= 24)
  ) || (
    component.pixels.length <= 256
    && shortSide <= 12
    && longSide >= 32
    && aspect >= 4
  );
}

function nearestMainPixel(component, mainMask, width, height, maxDistance) {
  let nearest = null;

  for (const index of component.pixels) {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let dy = -maxDistance; dy <= maxDistance; dy += 1) {
      for (let dx = -maxDistance; dx <= maxDistance; dx += 1) {
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared === 0 || distanceSquared > maxDistance * maxDistance) continue;
        if (nearest && distanceSquared >= nearest.distanceSquared) continue;

        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) continue;

        const candidate = candidateY * width + candidateX;
        if (mainMask[candidate]) {
          nearest = {
            distanceSquared,
            from: index,
            to: candidate,
          };
        }
      }
    }
  }

  return nearest;
}

function bridgeLinePixels(from, to, width, height, radius) {
  const fromX = from % width;
  const fromY = Math.floor(from / width);
  const toX = to % width;
  const toY = Math.floor(to / width);
  const steps = Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY), 1);
  const pixels = new Set();

  for (let step = 0; step <= steps; step += 1) {
    const x = Math.round(fromX + ((toX - fromX) * step) / steps);
    const y = Math.round(fromY + ((toY - fromY) * step) / steps);

    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (dx * dx + dy * dy > radius * radius) continue;

        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) continue;

        pixels.add(candidateY * width + candidateX);
      }
    }
  }

  return [...pixels];
}

function averageNeighborColor(data, pixels, width, height) {
  const inHole = new Set(pixels);
  let blue = 0;
  let green = 0;
  let red = 0;
  let weight = 0;

  for (const index of pixels) {
    const x = index % width;
    const y = Math.floor(index / width);

    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        if (dx === 0 && dy === 0) continue;

        const candidateX = x + dx;
        const candidateY = y + dy;
        if (candidateX < 0 || candidateY < 0 || candidateX >= width || candidateY >= height) continue;

        const neighbor = candidateY * width + candidateX;
        if (inHole.has(neighbor)) continue;

        const offset = neighbor * 4;
        const alpha = data[offset + 3];
        if (alpha < 16) continue;

        const sampleWeight = (alpha / 255) / (1 + Math.hypot(dx, dy));
        red += data[offset] * sampleWeight;
        green += data[offset + 1] * sampleWeight;
        blue += data[offset + 2] * sampleWeight;
        weight += sampleWeight;
      }
    }
  }

  if (!weight) return null;

  return {
    blue: Math.round(blue / weight),
    green: Math.round(green / weight),
    red: Math.round(red / weight),
  };
}

function averageEndpointColor(data, from, to) {
  let blue = 0;
  let green = 0;
  let red = 0;
  let weight = 0;

  for (const index of [from, to]) {
    const offset = index * 4;
    const alpha = data[offset + 3] / 255;
    if (alpha <= 0) continue;

    red += data[offset] * alpha;
    green += data[offset + 1] * alpha;
    blue += data[offset + 2] * alpha;
    weight += alpha;
  }

  if (!weight) return null;

  return {
    blue: Math.round(blue / weight),
    green: Math.round(green / weight),
    red: Math.round(red / weight),
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

async function isDirectoryEntry(parentDir, entry) {
  if (entry.isDirectory()) return true;
  if (entry.isFile()) return false;

  try {
    return (await stat(path.join(parentDir, entry.name))).isDirectory();
  } catch {
    return false;
  }
}

function webpOptions({ lossless, quality }) {
  return {
    alphaQuality: 100,
    effort: lossless ? 3 : 5,
    exact: true,
    lossless,
    quality,
    smartSubsample: !lossless,
  };
}

async function encodeRawWebp(data, width, height, outputFile, { lossless, quality }) {
  await sharp(data, {
    raw: {
      channels: 4,
      height,
      width,
    },
  })
    .webp(webpOptions({ lossless, quality }))
    .toFile(outputFile);
}

async function encodeRawWebpBuffer(data, width, height, { lossless, quality }) {
  return sharp(data, {
    raw: {
      channels: 4,
      height,
      width,
    },
  })
    .webp(webpOptions({ lossless, quality }))
    .toBuffer();
}

async function writeSanitizedWebp({ data, height, lossless, outputFile, quality, width }) {
  const tempOutputFile = `${outputFile}.${process.pid}.tmp.webp`;

  try {
    const firstPassData = sanitizeSpriteAlpha(data, width, height);
    const encodedBuffer = await encodeRawWebpBuffer(firstPassData, width, height, { lossless, quality });

    const { data: decodedData, info } = await sharp(encodedBuffer)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const finalData = sanitizeSpriteAlpha(decodedData, info.width, info.height);
    await encodeRawWebp(finalData, info.width, info.height, tempOutputFile, { lossless, quality });
    await replaceFileWithRetry(tempOutputFile, outputFile);
  } finally {
    await rm(tempOutputFile, { force: true });
  }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mergeReimuSleeveComponents(components) {
  const pixels = [];
  let maxX = 0;
  let maxY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (const component of components) {
    pixels.push(...component.pixels);
    minX = Math.min(minX, component.minX);
    minY = Math.min(minY, component.minY);
    maxX = Math.max(maxX, component.maxX);
    maxY = Math.max(maxY, component.maxY);

    for (const index of component.pixels) {
      sumX += index % component.sourceWidth;
      sumY += Math.floor(index / component.sourceWidth);
      count += 1;
    }
  }

  if (!count) return null;

  return {
    centerX: sumX / count,
    centerY: sumY / count,
    height: maxY - minY + 1,
    maxX,
    maxY,
    minX,
    minY,
    pixels,
    width: maxX - minX + 1,
  };
}

function reimuSleeveQualityMetric(data, width, height, side, poseKind) {
  const components = withComponentSourceWidth(
    reimuSleeveComponents(data, width, height),
    width,
  );
  const sleeve = mergeReimuSleeveComponents(
    targetReimuSleeveComponents(components, side, poseKind),
  );

  if (!sleeve) {
    return {
      area: 0,
      height: 0,
      width: 0,
    };
  }

  return {
    area: sleeve.pixels.length,
    height: sleeve.height,
    width: sleeve.width,
  };
}

function shouldKeepReimuSleeveEdit(before, after) {
  if (!before.area) return Boolean(after.area);

  return (
    after.area >= before.area * 0.96
    && after.width >= before.width * 0.96
    && after.height >= before.height * 0.90
  );
}

function withComponentSourceWidth(components, width) {
  return components.map((component) => ({
    ...component,
    sourceWidth: width,
  }));
}

function reimuSleevePatch({ component, data, height, mask, width }) {
  const pad = 2;
  const left = Math.max(0, component.minX - pad);
  const top = Math.max(0, component.minY - pad);
  const right = Math.min(width - 1, component.maxX + pad);
  const bottom = Math.min(height - 1, component.maxY + pad);
  const patchWidth = right - left + 1;
  const patchHeight = bottom - top + 1;
  const patch = Buffer.alloc(patchWidth * patchHeight * 4);

  for (let y = 0; y < patchHeight; y += 1) {
    for (let x = 0; x < patchWidth; x += 1) {
      const sourceIndex = (top + y) * width + left + x;
      const sourceOffset = sourceIndex * 4;
      if (!mask[sourceIndex] || data[sourceOffset + 3] < 16) continue;

      const targetOffset = (y * patchWidth + x) * 4;
      patch[targetOffset] = data[sourceOffset];
      patch[targetOffset + 1] = data[sourceOffset + 1];
      patch[targetOffset + 2] = data[sourceOffset + 2];
      patch[targetOffset + 3] = data[sourceOffset + 3];
    }
  }

  return {
    data: patch,
    height: patchHeight,
    width: patchWidth,
  };
}

function clearSleevePixels(data, mask) {
  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;

    const offset = index * 4;
    if (data[offset + 3] < 16) continue;

    data[offset + 3] = 0;
  }
}

function compositeRawPatch({ base, baseHeight, baseWidth, left, patch, patchHeight, patchWidth, top }) {
  for (let y = 0; y < patchHeight; y += 1) {
    const baseY = top + y;
    if (baseY < 0 || baseY >= baseHeight) continue;

    for (let x = 0; x < patchWidth; x += 1) {
      const baseX = left + x;
      if (baseX < 0 || baseX >= baseWidth) continue;

      const sourceOffset = (y * patchWidth + x) * 4;
      const sourceAlpha = patch[sourceOffset + 3] / 255;
      if (sourceAlpha <= 0.01) continue;

      const targetOffset = (baseY * baseWidth + baseX) * 4;
      const targetAlpha = base[targetOffset + 3] / 255;
      const outputAlpha = sourceAlpha + targetAlpha * (1 - sourceAlpha);

      if (outputAlpha <= 0.01) {
        base[targetOffset + 3] = 0;
        continue;
      }

      for (let channel = 0; channel < 3; channel += 1) {
        base[targetOffset + channel] = Math.round(
          (patch[sourceOffset + channel] * sourceAlpha
            + base[targetOffset + channel] * targetAlpha * (1 - sourceAlpha)) / outputAlpha,
        );
      }
      base[targetOffset + 3] = Math.round(outputAlpha * 255);
    }
  }
}

function samplePatchBilinear({ height, patch, width, x, y }) {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return [0, 0, 0, 0];

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const wx = x - x0;
  const wy = y - y0;
  const samples = [
    { weight: (1 - wx) * (1 - wy), x: x0, y: y0 },
    { weight: wx * (1 - wy), x: x1, y: y0 },
    { weight: (1 - wx) * wy, x: x0, y: y1 },
    { weight: wx * wy, x: x1, y: y1 },
  ];
  const rgba = [0, 0, 0, 0];

  for (const sample of samples) {
    const offset = (sample.y * width + sample.x) * 4;
    for (let channel = 0; channel < 4; channel += 1) {
      rgba[channel] += patch[offset + channel] * sample.weight;
    }
  }

  return rgba.map((value) => Math.round(value));
}

function flaredSleevePatch({
  cornerFeather,
  innerSilhouette,
  innerHeightScale,
  outerSilhouette,
  outerHeightScale,
  patch,
  side,
  sourceHeight,
  sourceWidth,
  targetHeight,
  targetWidth,
}) {
  const output = Buffer.alloc(targetWidth * targetHeight * 4);
  const sourceCenterY = (sourceHeight - 1) / 2;
  const targetCenterY = (targetHeight - 1) / 2;

  for (let y = 0; y < targetHeight; y += 1) {
    for (let x = 0; x < targetWidth; x += 1) {
      const u = targetWidth <= 1 ? 0.5 : x / (targetWidth - 1);
      const outerness = side < 0 ? 1 - u : u;
      const localHeightScale = innerHeightScale
        + (outerHeightScale - innerHeightScale) * Math.sqrt(clampNumber(outerness, 0, 1));
      const sourceX = targetWidth <= 1 ? 0 : u * (sourceWidth - 1);
      const sourceY = sourceCenterY + (y - targetCenterY) / localHeightScale;
      const rgba = samplePatchBilinear({
        height: sourceHeight,
        patch,
        width: sourceWidth,
        x: sourceX,
        y: sourceY,
      });
      const verticalDistance = Math.abs(y - targetCenterY) / Math.max(1, targetHeight / 2);
      const sleeveSilhouette = innerSilhouette
        + (outerSilhouette - innerSilhouette) * Math.pow(clampNumber(outerness, 0, 1), 0.72);
      const silhouetteAlpha = clampNumber(
        (sleeveSilhouette + cornerFeather - verticalDistance) / Math.max(0.001, cornerFeather),
        0,
        1,
      );
      const targetOffset = (y * targetWidth + x) * 4;

      output[targetOffset] = rgba[0];
      output[targetOffset + 1] = rgba[1];
      output[targetOffset + 2] = rgba[2];
      output[targetOffset + 3] = Math.round(rgba[3] * silhouetteAlpha);
    }
  }

  return output;
}

async function reshapeReimuPoseSleeves({ lossless, outputFile, quality, referenceFile, targetFile }) {
  const poseKind = path.basename(path.dirname(targetFile)).includes('y') ? 'y' : 't';
  const target = await readRgbaFrame(targetFile);
  const reference = await readRgbaFrame(referenceFile);
  const targetComponents = withComponentSourceWidth(
    reimuSleeveComponents(target.data, target.width, target.height),
    target.width,
  );
  const referenceComponents = reimuSleeveComponents(reference.data, reference.width, reference.height);
  const sleeveStyle = REIMU_SLEEVE_STYLE[poseKind];
  const editedData = Buffer.from(target.data);

  for (const side of [-1, 1]) {
    const targetSleeve = mergeReimuSleeveComponents(
      targetReimuSleeveComponents(targetComponents, side, poseKind),
    );
    const referenceSleeve = referenceReimuSleeveComponent(referenceComponents, side);
    if (!targetSleeve || !referenceSleeve) continue;

    const sleeveMask = dilatedPixelMask(targetSleeve.pixels, target.width, target.height, sleeveStyle.eraseRadius);
    const patch = reimuSleevePatch({
      component: targetSleeve,
      data: target.data,
      height: target.height,
      mask: sleeveMask,
      width: target.width,
    });
    const minWidth = Math.max(
      targetSleeve.width,
      referenceSleeve.width * sleeveStyle.minWidthFromReference,
    );
    const maxWidth = Math.max(minWidth, referenceSleeve.width * sleeveStyle.maxWidthFromReference);
    const outputWidth = Math.round(clampNumber(
      targetSleeve.width * sleeveStyle.widthScale,
      minWidth,
      maxWidth,
    ));
    const minHeight = Math.max(
      targetSleeve.height,
      referenceSleeve.height * sleeveStyle.minHeightFromReference,
    );
    const maxHeight = Math.max(minHeight, referenceSleeve.height * sleeveStyle.maxHeightFromReference);
    const outputHeight = Math.round(clampNumber(
      targetSleeve.height * sleeveStyle.heightScale,
      minHeight,
      maxHeight,
    ));
    const resizedPatch = flaredSleevePatch({
      cornerFeather: sleeveStyle.cornerFeather,
      innerSilhouette: sleeveStyle.innerSilhouette,
      innerHeightScale: sleeveStyle.innerHeightScale,
      outerSilhouette: sleeveStyle.outerSilhouette,
      outerHeightScale: sleeveStyle.outerHeightScale,
      patch: patch.data,
      side,
      sourceHeight: patch.height,
      sourceWidth: patch.width,
      targetHeight: outputHeight,
      targetWidth: outputWidth,
    });
    const left = side < 0
      ? Math.round(targetSleeve.maxX + sleeveStyle.innerOverlap - outputWidth + 1)
      : Math.round(targetSleeve.minX - sleeveStyle.innerOverlap);
    const top = Math.round(targetSleeve.centerY - outputHeight / 2 + sleeveStyle.topOffsetY);
    const beforeEditData = Buffer.from(editedData);
    const beforeMetric = reimuSleeveQualityMetric(
      beforeEditData,
      target.width,
      target.height,
      side,
      poseKind,
    );

    clearSleevePixels(editedData, sleeveMask);
    compositeRawPatch({
      base: editedData,
      baseHeight: target.height,
      baseWidth: target.width,
      left,
      patch: resizedPatch,
      patchHeight: outputHeight,
      patchWidth: outputWidth,
      top,
    });

    const afterMetric = reimuSleeveQualityMetric(
      editedData,
      target.width,
      target.height,
      side,
      poseKind,
    );
    if (!shouldKeepReimuSleeveEdit(beforeMetric, afterMetric)) {
      beforeEditData.copy(editedData);
    }
  }

  await writeSanitizedWebp({
    data: editedData,
    height: target.height,
    lossless,
    outputFile,
    quality,
    width: target.width,
  });
}

async function reshapeReimuPoseSleeveSheets({ characterOutputDir, cols, lossless, quality, rows }) {
  for (const [targetSheet, referenceSheet] of Object.entries(REIMU_SLEEVE_REFERENCE_SHEETS)) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const targetFile = path.join(characterOutputDir, targetSheet, `r${row}c${col}.webp`);
        const referenceFile = path.join(characterOutputDir, referenceSheet, `r${row}c${col}.webp`);

        await reshapeReimuPoseSleeves({
          lossless,
          outputFile: targetFile,
          quality,
          referenceFile,
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
  const known = new Set();
  for (const entry of entries) {
    if (await isDirectoryEntry(sourceRoot, entry)) {
      known.add(entry.name.toLowerCase());
    }
  }

  for (const characterId of characterIds) {
    if (!known.has(characterId)) {
      throw new Error(`Missing source directory for character: ${characterId}`);
    }
  }
}

async function sliceSheet({
  cols,
  gravityBlend,
  lossless,
  outputSize,
  quality,
  rows,
  sheetOutputDir,
  sourceFile,
  windowScale,
}) {
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

      const { data: resizedData, info: resizedInfo } = await sharp(windowData, {
        raw: {
          width: windowSize,
          height: windowSize,
          channels: 4,
        },
      })
        .resize(outputSize, outputSize, { fit: 'fill' })
        .sharpen()
        .raw()
        .toBuffer({ resolveWithObject: true });
      await writeSanitizedWebp({
        data: resizedData,
        height: resizedInfo.height,
        lossless,
        outputFile,
        quality,
        width: resizedInfo.width,
      });
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
    skipReimuPoseReshape: hasOption(args, 'skip-reimu-pose-reshape'),
    windowScale: readNumberOption(args, 'window-scale', DEFAULTS.windowScale),
    gravityBlend: Math.min(1, readNumberOption(args, 'gravity-blend', DEFAULTS.gravityBlend)),
    lossless: hasOption(args, 'lossless') || DEFAULTS.lossless,
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
        lossless: options.lossless,
      });

      written += options.rows * options.cols;
      console.log(`${characterId}/${sheetId}: ${options.rows * options.cols} webp frames`);
    }

    if (characterId === 'reimu' && !options.skipReimuPoseReshape) {
      await reshapeReimuPoseSleeveSheets({
        characterOutputDir,
        cols: options.cols,
        lossless: options.lossless,
        quality: options.quality,
        rows: options.rows,
      });
      console.log('reimu: reshaped T/Y sleeve pixels against plain-pose bounds');
    }
  }

  console.log(`Generated ${written} WebP frames in ${path.relative(process.cwd(), options.outputRoot)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
