import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  characterSource: 'public/characters/reimu',
  outputRoot: 'tmp/reference-audit',
  referenceSources: [
    'metaassets/fumo/reimu/reimu_sleeve_reference_imagegen.png',
    'metaassets/fumo/reimu/reimu_sleeve_reference_imagegen_tpose_20260617.png',
    'tmp/recovery/reimu-quality-2026-06-17/openai-generated',
  ],
};

const TARGET_SHEETS = ['pt_01', 'ot_01', 'ct_01', 'py_01', 'oy_01', 'cy_01'];
const GRID_ROWS = 5;
const GRID_COLS = 5;

function allTargetFrames() {
  const frames = [];

  for (const sheet of TARGET_SHEETS) {
    for (let row = 0; row < GRID_ROWS; row += 1) {
      for (let col = 0; col < GRID_COLS; col += 1) {
        frames.push(`${sheet}/r${row}c${col}.webp`);
      }
    }
  }

  return frames;
}

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readListOption(args, name, fallback) {
  const value = readOption(args, name, null);
  if (!value) return fallback;
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

async function pathExists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function prepareOutputRoot(outputRoot) {
  const tmpRoot = path.resolve('tmp');

  if (isInside(tmpRoot, outputRoot)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(outputRoot, { force: true, recursive: true });
        break;
      } catch (error) {
        if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(error?.code) || attempt === 4) {
          throw error;
        }

        await new Promise((resolve) => {
          setTimeout(resolve, 150 * (attempt + 1));
        });
      }
    }
  }

  await mkdir(outputRoot, { recursive: true });
}

async function isImageFileEntry(parentDir, entry) {
  if (!/\.(png|webp|jpe?g)$/iu.test(entry.name)) return false;
  if (entry.isFile()) return true;

  try {
    return (await stat(path.join(parentDir, entry.name))).isFile();
  } catch {
    return false;
  }
}

function slugForFile(file) {
  return path
    .relative(process.cwd(), file)
    .replace(path.extname(file), '')
    .replaceAll(/[^a-z0-9_-]+/gi, '-')
    .replaceAll(/^-+|-+$/g, '')
    .toLowerCase();
}

async function expandSource(source) {
  const resolved = path.resolve(source);
  if (!await pathExists(resolved)) return [];

  const sourceStat = await stat(resolved);
  if (sourceStat.isFile()) return [resolved];
  if (!sourceStat.isDirectory()) return [];

  const entries = await readdir(resolved, { withFileTypes: true });
  const images = [];
  for (const entry of entries) {
    if (await isImageFileEntry(resolved, entry)) {
      images.push(path.join(resolved, entry.name));
    }
  }

  return images.sort((a, b) => a.localeCompare(b));
}

function isGreenScreen(data, index) {
  const offset = index * 4;
  return data[offset + 1] > 150 && data[offset] < 90 && data[offset + 2] < 110;
}

function isCheckerLikeBackground(data, index) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const average = (red + green + blue) / 3;

  return max - min <= 14 && average >= 218;
}

function pushFloodSeed({ background, candidate, height, index, queue, width }) {
  if (index < 0 || index >= width * height) return;
  if (background[index] || !candidate[index]) return;

  background[index] = 1;
  queue.push(index);
}

function floodBackground(candidate, width, height) {
  const background = new Uint8Array(width * height);
  const queue = [];

  for (let x = 0; x < width; x += 1) {
    pushFloodSeed({ background, candidate, height, index: x, queue, width });
    pushFloodSeed({ background, candidate, height, index: (height - 1) * width + x, queue, width });
  }
  for (let y = 0; y < height; y += 1) {
    pushFloodSeed({ background, candidate, height, index: y * width, queue, width });
    pushFloodSeed({ background, candidate, height, index: y * width + width - 1, queue, width });
  }

  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head];
    const x = index % width;
    const y = Math.floor(index / width);

    if (x > 0) pushFloodSeed({ background, candidate, height, index: index - 1, queue, width });
    if (x + 1 < width) pushFloodSeed({ background, candidate, height, index: index + 1, queue, width });
    if (y > 0) pushFloodSeed({ background, candidate, height, index: index - width, queue, width });
    if (y + 1 < height) pushFloodSeed({ background, candidate, height, index: index + width, queue, width });
  }

  return background;
}

function components(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const found = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;

    const queue = [start];
    const pixels = [];
    let maxX = 0;
    let maxY = 0;
    let minX = width;
    let minY = height;
    let sumX = 0;
    let sumY = 0;
    seen[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels.push(index);
      sumX += x;
      sumY += y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);

      const neighbors = [
        x > 0 ? index - 1 : -1,
        x + 1 < width ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y + 1 < height ? index + width : -1,
      ];

      for (const neighbor of neighbors) {
        if (neighbor >= 0 && mask[neighbor] && !seen[neighbor]) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    found.push({
      area: pixels.length,
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

  return found.sort((a, b) => b.area - a.area);
}

function foregroundMask(data, width, height) {
  const backgroundCandidate = new Uint8Array(width * height);

  for (let index = 0; index < backgroundCandidate.length; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha < 16 || isGreenScreen(data, index) || isCheckerLikeBackground(data, index)) {
      backgroundCandidate[index] = 1;
    }
  }

  const background = floodBackground(backgroundCandidate, width, height);
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    const alpha = data[index * 4 + 3];
    mask[index] = !background[index] && alpha >= 16 ? 1 : 0;
  }

  return mask;
}

function maskBounds(mask, width, height) {
  let area = 0;
  let maxX = 0;
  let maxY = 0;
  let minX = width;
  let minY = height;

  for (let index = 0; index < mask.length; index += 1) {
    if (!mask[index]) continue;
    area += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    area,
    height: maxY - minY + 1,
    maxX,
    maxY,
    minX,
    minY,
    width: maxX - minX + 1,
  };
}

function isSleeveColoredPixel(data, index) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const whiteCloth = red > 182 && green > 170 && blue > 158 && max - min < 96;
  const redTrim = red > 145 && green < 132 && blue < 132;
  const pinkEdge = red > 178 && green > 85 && green < 190 && blue > 85 && blue < 190;

  return whiteCloth || redTrim || pinkEdge;
}

function sleeveMask(data, foreground, bounds, width, height) {
  const mask = new Uint8Array(width * height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const boundsHeight = Math.max(1, bounds.height);
  const shoulderBandMin = 0.43;
  const shoulderBandMax = 0.79;

  for (let index = 0; index < mask.length; index += 1) {
    if (!foreground[index]) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    const yNorm = (y - bounds.minY) / boundsHeight;
    const xDistance = Math.abs(x - centerX);
    if (yNorm < shoulderBandMin || yNorm > shoulderBandMax) continue;
    if (xDistance < bounds.width * 0.20) continue;
    if (!isSleeveColoredPixel(data, index)) continue;

    mask[index] = 1;
  }

  return mask;
}

function sideMetrics(component, bounds, side) {
  if (!component) return null;

  const centerX = (bounds.minX + bounds.maxX) / 2;
  return {
    area: component.area,
    centerX: Math.round(component.centerX),
    centerY: Math.round(component.centerY),
    height: component.height,
    heightRatio: Number((component.height / bounds.height).toFixed(3)),
    side,
    width: component.width,
    widthRatio: Number((component.width / bounds.width).toFixed(3)),
    xDistanceRatio: Number((Math.abs(component.centerX - centerX) / bounds.width).toFixed(3)),
  };
}

function analyzeSleeves(data, foreground, bounds, width, height) {
  const sleeves = sleeveMask(data, foreground, bounds, width, height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const sleeveComponents = components(sleeves, width, height)
    .filter((component) => component.area > Math.max(120, bounds.area * 0.002));
  const left = sleeveComponents
    .filter((component) => component.centerX < centerX)
    .sort((a, b) => b.area - a.area)[0];
  const right = sleeveComponents
    .filter((component) => component.centerX > centerX)
    .sort((a, b) => b.area - a.area)[0];

  return {
    components: {
      left: sideMetrics(left, bounds, 'left'),
      right: sideMetrics(right, bounds, 'right'),
    },
    mask: sleeves,
  };
}

function averageWidthRatio(sleeves) {
  const ratios = [sleeves.components.left, sleeves.components.right]
    .filter(Boolean)
    .map((component) => component.widthRatio);
  if (!ratios.length) return null;
  return Number((ratios.reduce((sum, value) => sum + value, 0) / ratios.length).toFixed(3));
}

async function renderMask(mask, width, height, outputFile) {
  const rgba = Buffer.alloc(width * height * 4);

  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    rgba[offset] = mask[index] ? 255 : 0;
    rgba[offset + 1] = mask[index] ? 255 : 0;
    rgba[offset + 2] = mask[index] ? 255 : 0;
    rgba[offset + 3] = 255;
  }

  await sharp(rgba, {
    raw: {
      channels: 4,
      height,
      width,
    },
  })
    .png()
    .toFile(outputFile);
}

async function renderSleeveOverlay(data, foreground, sleeves, width, height, outputFile) {
  const rgba = Buffer.from(data);

  for (let index = 0; index < foreground.length; index += 1) {
    const offset = index * 4;
    if (!foreground[index]) {
      rgba[offset] = 17;
      rgba[offset + 1] = 17;
      rgba[offset + 2] = 17;
      rgba[offset + 3] = 255;
      continue;
    }

    if (sleeves[index]) {
      rgba[offset] = Math.round(rgba[offset] * 0.45);
      rgba[offset + 1] = Math.min(255, Math.round(rgba[offset + 1] * 0.60 + 120));
      rgba[offset + 2] = Math.min(255, Math.round(rgba[offset + 2] * 0.60 + 120));
      rgba[offset + 3] = 255;
    }
  }

  await sharp(rgba, {
    raw: {
      channels: 4,
      height,
      width,
    },
  })
    .resize(512, 512, {
      background: { alpha: 1, b: 17, g: 17, r: 17 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .png()
    .toFile(outputFile);
}

async function analyzeFile(file, group, outputRoot) {
  const { data, info } = await sharp(file, { animated: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const foreground = foregroundMask(data, info.width, info.height);
  const bounds = maskBounds(foreground, info.width, info.height);
  const sleeveAnalysis = analyzeSleeves(data, foreground, bounds, info.width, info.height);
  const slug = `${group}-${slugForFile(file)}`;

  await renderMask(
    foreground,
    info.width,
    info.height,
    path.join(outputRoot, `${slug}-foreground.png`),
  );
  await renderSleeveOverlay(
    data,
    foreground,
    sleeveAnalysis.mask,
    info.width,
    info.height,
    path.join(outputRoot, `${slug}-sleeves.png`),
  );

  return {
    averageSleeveWidthRatio: averageWidthRatio(sleeveAnalysis),
    bounds: {
      area: bounds.area,
      height: bounds.height,
      width: bounds.width,
    },
    file: path.relative(process.cwd(), file),
    group,
    image: {
      height: info.height,
      width: info.width,
    },
    sleeves: sleeveAnalysis.components,
  };
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function rangeForRows(rows) {
  const values = rows
    .map((row) => row.averageSleeveWidthRatio)
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;

  return {
    max: Number(Math.max(...values).toFixed(3)),
    min: Number(Math.min(...values).toFixed(3)),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outputRoot = path.resolve(readOption(args, 'out', DEFAULTS.outputRoot));
  const referenceSources = readListOption(args, 'reference-sources', DEFAULTS.referenceSources);
  const characterSource = path.resolve(readOption(args, 'character-source', DEFAULTS.characterSource));
  const localFrames = readListOption(args, 'local-frames', allTargetFrames());
  const rows = [];

  await prepareOutputRoot(outputRoot);

  for (const source of referenceSources) {
    for (const file of await expandSource(source)) {
      rows.push(await analyzeFile(file, 'openai-reference', outputRoot));
    }
  }

  for (const frame of localFrames) {
    const file = path.join(characterSource, frame);
    if (!await pathExists(file)) continue;
    rows.push(await analyzeFile(file, 'current-frame', outputRoot));
  }

  const csvRows = [
    ['group', 'file', 'boundsWidth', 'boundsHeight', 'averageSleeveWidthRatio', 'leftWidthRatio', 'rightWidthRatio']
      .map(csvCell)
      .join(','),
    ...rows.map((row) => [
      row.group,
      row.file,
      row.bounds.width,
      row.bounds.height,
      row.averageSleeveWidthRatio,
      row.sleeves.left?.widthRatio,
      row.sleeves.right?.widthRatio,
    ].map(csvCell).join(',')),
  ];

  const summary = {
    generatedAt: new Date().toISOString(),
    notes: [
      'OpenAI references are analyzed as proportion/mask guides and controlled edit targets.',
      'The shipped 5x5 WebP frames remain generated from the existing Reimu source sheets and deterministic post-processing.',
    ],
    ranges: {
      currentFrames: rangeForRows(rows.filter((row) => row.group === 'current-frame')),
      openAiReferences: rangeForRows(rows.filter((row) => row.group === 'openai-reference')),
    },
    rows,
  };

  await writeFile(path.join(outputRoot, 'reimu-reference-metrics.json'), `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(path.join(outputRoot, 'reimu-reference-metrics.csv'), `${csvRows.join('\n')}\n`);

  const openAiCount = rows.filter((row) => row.group === 'openai-reference').length;
  const currentCount = rows.filter((row) => row.group === 'current-frame').length;
  console.log(`Analyzed ${openAiCount} OpenAI references and ${currentCount} current Reimu frames.`);
  console.log(`Wrote ${path.relative(process.cwd(), outputRoot)}`);
}

await main();
