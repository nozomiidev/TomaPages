import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  candidatesRoot: 'tmp/imagegen/reimu-sleeve-candidates',
  metricsFile: 'tmp/reference-audit/reimu-reference-metrics.json',
  outputRoot: 'tmp/imagegen/reimu-sleeve-candidates/processed',
  targetRoot: 'public/characters/reimu',
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

async function listPngs(root) {
  if (!await exists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readReferenceMetrics(file) {
  if (!await exists(file)) return [];

  const metrics = JSON.parse(await readFile(file, 'utf8'));
  return Array.isArray(metrics.rows) ? metrics.rows : [];
}

function normalizePathName(file) {
  return String(file).replaceAll('\\', '/');
}

function findReferenceMetric(rows, group, filePart) {
  const normalizedPart = normalizePathName(filePart);

  return rows.find((row) => (
    row.group === group && normalizePathName(row.file).endsWith(normalizedPart)
  ));
}

function candidateTarget(candidateFile) {
  const match = /reimu-([a-z]{2})-r(\d)c(\d)/iu.exec(path.basename(candidateFile));
  if (!match) return null;

  return `${match[1].toLowerCase()}_01/r${match[2]}c${match[3]}.webp`;
}

function isGreenScreen(data, index) {
  const offset = index * 4;
  const red = data[offset];
  const green = data[offset + 1];
  const blue = data[offset + 2];

  return green > 125 && green - red > 70 && green - blue > 70;
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

function componentList(mask, width, height) {
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

function alphaMask(data, width, height) {
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    if (data[index * 4 + 3] >= 16) mask[index] = 1;
  }

  return mask;
}

function foregroundFromGreenScreen(data, width, height) {
  const backgroundCandidate = new Uint8Array(width * height);

  for (let index = 0; index < backgroundCandidate.length; index += 1) {
    const alpha = data[index * 4 + 3];
    if (alpha < 16 || isGreenScreen(data, index)) backgroundCandidate[index] = 1;
  }

  const background = floodBackground(backgroundCandidate, width, height);
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < mask.length; index += 1) {
    if (!background[index] && data[index * 4 + 3] >= 16) mask[index] = 1;
  }

  return mask;
}

function rgbaWithAlpha(data, foreground) {
  const output = Buffer.from(data);

  for (let index = 0; index < foreground.length; index += 1) {
    const offset = index * 4;
    if (foreground[index]) {
      output[offset + 3] = 255;
    } else {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
      output[offset + 3] = 0;
    }
  }

  return output;
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

  for (let index = 0; index < mask.length; index += 1) {
    if (!foreground[index]) continue;

    const x = index % width;
    const y = Math.floor(index / width);
    const yNorm = (y - bounds.minY) / boundsHeight;
    const xDistance = Math.abs(x - centerX);
    if (yNorm < 0.43 || yNorm > 0.79) continue;
    if (xDistance < bounds.width * 0.20) continue;
    if (!isSleeveColoredPixel(data, index)) continue;

    mask[index] = 1;
  }

  return mask;
}

function sideMetrics(component, bounds, side) {
  if (!component) return null;

  return {
    area: component.area,
    height: component.height,
    side,
    width: component.width,
    widthRatio: Number((component.width / bounds.width).toFixed(3)),
  };
}

function analyzeSleeves(data, foreground, width, height) {
  const bounds = maskBounds(foreground, width, height);
  const mask = sleeveMask(data, foreground, bounds, width, height);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const components = componentList(mask, width, height)
    .filter((component) => component.area > Math.max(120, bounds.area * 0.002));
  const left = components
    .filter((component) => component.centerX < centerX)
    .sort((a, b) => b.area - a.area)[0];
  const right = components
    .filter((component) => component.centerX > centerX)
    .sort((a, b) => b.area - a.area)[0];
  const ratios = [left, right]
    .filter(Boolean)
    .map((component) => component.width / bounds.width);

  return {
    averageWidthRatio: ratios.length
      ? Number((ratios.reduce((sum, value) => sum + value, 0) / ratios.length).toFixed(3))
      : null,
    bounds,
    components: {
      left: sideMetrics(left, bounds, 'left'),
      right: sideMetrics(right, bounds, 'right'),
    },
    mask,
  };
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

async function normalizeCandidate(candidateRgba, candidateForeground, targetBounds) {
  const sourceBounds = maskBounds(candidateForeground, candidateRgba.width, candidateRgba.height);
  const sourceAlpha = rgbaWithAlpha(candidateRgba.data, candidateForeground);
  const crop = await sharp(sourceAlpha, {
    raw: {
      channels: 4,
      height: candidateRgba.height,
      width: candidateRgba.width,
    },
  })
    .extract({
      height: sourceBounds.height,
      left: sourceBounds.minX,
      top: sourceBounds.minY,
      width: sourceBounds.width,
    })
    .resize(targetBounds.width, targetBounds.height, {
      fit: 'fill',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();

  const canvas = await sharp({
    create: {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      channels: 4,
      height: 512,
      width: 512,
    },
  })
    .composite([{ input: crop, left: targetBounds.minX, top: targetBounds.minY }])
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data: canvas.data,
    height: canvas.info.height,
    width: canvas.info.width,
  };
}

function blend(data, index, color, amount) {
  const offset = index * 4;
  data[offset] = Math.round(data[offset] * (1 - amount) + color[0] * amount);
  data[offset + 1] = Math.round(data[offset + 1] * (1 - amount) + color[1] * amount);
  data[offset + 2] = Math.round(data[offset + 2] * (1 - amount) + color[2] * amount);
  data[offset + 3] = 255;
}

async function renderGuide(target, candidateSleeves, outputFile) {
  const output = Buffer.from(target.data);

  for (let index = 0; index < candidateSleeves.mask.length; index += 1) {
    if (candidateSleeves.mask[index]) blend(output, index, [20, 184, 166], 0.58);
  }

  await sharp(output, {
    raw: {
      channels: 4,
      height: target.height,
      width: target.width,
    },
  })
    .png()
    .toFile(outputFile);
}

function nonSleeveDrift({ candidate, candidateSleeves, target, targetSleeves }) {
  let compared = 0;
  let driftPixels = 0;

  for (let index = 0; index < target.width * target.height; index += 1) {
    if (targetSleeves.mask[index] || candidateSleeves.mask[index]) continue;

    const offset = index * 4;
    const targetAlpha = target.data[offset + 3];
    const candidateAlpha = candidate.data[offset + 3];
    if (targetAlpha < 16 && candidateAlpha < 16) continue;

    compared += 1;
    const alphaDelta = Math.abs(targetAlpha - candidateAlpha);
    const colorDelta = Math.abs(target.data[offset] - candidate.data[offset])
      + Math.abs(target.data[offset + 1] - candidate.data[offset + 1])
      + Math.abs(target.data[offset + 2] - candidate.data[offset + 2]);

    if (alphaDelta > 48 || colorDelta > 90) driftPixels += 1;
  }

  return {
    comparedPixels: compared,
    driftPixels,
    driftRatio: Number((driftPixels / Math.max(1, compared)).toFixed(4)),
  };
}

async function renderDriftHeat({ candidate, candidateSleeves, outputFile, target, targetSleeves }) {
  const output = Buffer.alloc(target.width * target.height * 4);

  for (let index = 0; index < target.width * target.height; index += 1) {
    const offset = index * 4;
    output[offset] = 17;
    output[offset + 1] = 17;
    output[offset + 2] = 17;
    output[offset + 3] = 255;

    if (targetSleeves.mask[index] || candidateSleeves.mask[index]) {
      output[offset] = 20;
      output[offset + 1] = 184;
      output[offset + 2] = 166;
      continue;
    }

    const targetAlpha = target.data[offset + 3];
    const candidateAlpha = candidate.data[offset + 3];
    if (targetAlpha < 16 && candidateAlpha < 16) continue;

    const alphaDelta = Math.abs(targetAlpha - candidateAlpha);
    const colorDelta = Math.abs(target.data[offset] - candidate.data[offset])
      + Math.abs(target.data[offset + 1] - candidate.data[offset + 1])
      + Math.abs(target.data[offset + 2] - candidate.data[offset + 2]);
    if (alphaDelta > 48 || colorDelta > 90) {
      output[offset] = 239;
      output[offset + 1] = 68;
      output[offset + 2] = 68;
    } else {
      output[offset] = 241;
      output[offset + 1] = 245;
      output[offset + 2] = 249;
    }
  }

  await sharp(output, {
    raw: {
      channels: 4,
      height: target.height,
      width: target.width,
    },
  })
    .png()
    .toFile(outputFile);
}

function labelSvg(width, height, label, sublabel = '') {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + `<text x="10" y="22" font-family="Arial" font-size="15" font-weight="700" fill="#111827">${label}</text>`
    + `<text x="10" y="42" font-family="Arial" font-size="12" fill="#475569">${sublabel}</text>`
    + '</svg>',
  );
}

async function tileFromFile(file, label, sublabel) {
  const tileSize = 220;
  const labelHeight = 56;
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

  return sharp({
    create: {
      background: { alpha: 1, b: 255, g: 255, r: 255 },
      channels: 4,
      height: tileSize + labelHeight,
      width: tileSize,
    },
  })
    .composite([
      { input: labelSvg(tileSize, labelHeight, label, sublabel), left: 0, top: 0 },
      { input: image, left: 0, top: labelHeight },
    ])
    .png()
    .toBuffer();
}

async function renderSheet({ candidateFile, driftFile, guideFile, normalizedFile, outputFile, summary, targetFile }) {
  const tileSize = 220;
  const labelHeight = 56;
  const width = tileSize * 5;
  const height = tileSize + labelHeight + 78;
  const legend = Buffer.from(
    `<svg width="${width}" height="78" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + '<text x="14" y="25" font-family="Arial" font-size="17" font-weight="700" fill="#111827">Reimu OpenAI sleeve candidate preprocessing</text>'
    + `<text x="14" y="49" font-family="Arial" font-size="12" fill="#475569">candidate sleeve ${summary.candidate.averageSleeveWidthRatio}; target sleeve ${summary.target.averageSleeveWidthRatio}; non-sleeve drift ${(summary.nonSleeveDrift.driftRatio * 100).toFixed(1)}%; material adoption ${summary.controlledMaterialAllowed ? 'allowed' : 'blocked'}</text>`
    + '</svg>',
  );
  const tiles = await Promise.all([
    tileFromFile(targetFile, 'target', summary.target.file),
    tileFromFile(candidateFile, 'raw OpenAI', 'green-screen output'),
    tileFromFile(normalizedFile, 'normalized', 'foreground fitted to target bounds'),
    tileFromFile(guideFile, 'sleeve guide', 'teal candidate projection'),
    tileFromFile(driftFile, 'drift heat', 'red outside sleeve'),
  ]);

  await sharp({
    create: {
      background: { alpha: 1, b: 255, g: 255, r: 255 },
      channels: 4,
      height,
      width,
    },
  })
    .composite([
      { input: legend, left: 0, top: 0 },
      ...tiles.map((input, index) => ({ input, left: index * tileSize, top: 78 })),
    ])
    .png()
    .toFile(outputFile);
}

async function writeRawPng(rgba, file) {
  await sharp(rgba.data, {
    raw: {
      channels: 4,
      height: rgba.height,
      width: rgba.width,
    },
  })
    .png()
    .toFile(file);
}

async function processCandidate(candidateFile, options, referenceRows) {
  const targetRelative = candidateTarget(candidateFile);
  if (!targetRelative) {
    return {
      candidate: path.relative(process.cwd(), candidateFile),
      reason: 'filename does not encode a target frame',
      status: 'skipped',
    };
  }

  const targetFile = path.join(options.targetRoot, targetRelative);
  if (!await exists(targetFile)) {
    return {
      candidate: path.relative(process.cwd(), candidateFile),
      reason: `missing target ${targetRelative}`,
      status: 'skipped',
    };
  }

  const slug = path.basename(candidateFile, '.png');
  const candidate = await readRgba(candidateFile);
  const target = await readRgba(targetFile);
  const candidateForeground = foregroundFromGreenScreen(candidate.data, candidate.width, candidate.height);
  const targetForeground = alphaMask(target.data, target.width, target.height);
  const targetSleeves = analyzeSleeves(target.data, targetForeground, target.width, target.height);
  const alphaCandidate = {
    data: rgbaWithAlpha(candidate.data, candidateForeground),
    height: candidate.height,
    width: candidate.width,
  };
  const normalized = await normalizeCandidate(candidate, candidateForeground, targetSleeves.bounds);
  const normalizedForeground = alphaMask(normalized.data, normalized.width, normalized.height);
  const normalizedSleeves = analyzeSleeves(
    normalized.data,
    normalizedForeground,
    normalized.width,
    normalized.height,
  );
  const candidateReferenceMetric = findReferenceMetric(
    referenceRows,
    'openai-reference',
    path.relative(process.cwd(), candidateFile),
  );
  const targetReferenceMetric = findReferenceMetric(
    referenceRows,
    'current-frame',
    targetRelative,
  );
  const drift = nonSleeveDrift({
    candidate: normalized,
    candidateSleeves: normalizedSleeves,
    target,
    targetSleeves,
  });
  const directAdoptionAllowed = drift.driftRatio <= 0.08;
  const outputFiles = {
    alpha: path.join(options.outputRoot, `${slug}-alpha.png`),
    drift: path.join(options.outputRoot, `${slug}-drift-heat.png`),
    guide: path.join(options.outputRoot, `${slug}-projected-sleeve-guide.png`),
    normalized: path.join(options.outputRoot, `${slug}-normalized.png`),
    sheet: path.join(options.outputRoot, `${slug}-preprocess-sheet.png`),
  };
  const summary = {
    candidate: {
      analysisSource: candidateReferenceMetric ? 'reference-audit' : 'normalized-candidate',
      averageSleeveWidthRatio: candidateReferenceMetric?.averageSleeveWidthRatio
        ?? normalizedSleeves.averageWidthRatio,
      file: path.relative(process.cwd(), candidateFile),
      originalSize: {
        height: candidate.height,
        width: candidate.width,
      },
    },
    controlledMaterialAllowed: true,
    directAdoptionAllowed,
    directAdoptionBlockers: directAdoptionAllowed
      ? []
      : ['non-sleeve drift is above the safe direct-adoption threshold'],
    materialization: {
      adoptionMode: 'sleeve-mask-and-proportion-material',
      fullFrameReplacementAllowed: directAdoptionAllowed,
      localPostprocessRequired: true,
      preserveIdentityAndGrid: true,
    },
    nonSleeveDrift: drift,
    outputs: Object.fromEntries(Object.entries(outputFiles).map(([key, file]) => [
      key,
      path.relative(process.cwd(), file),
    ])),
    status: 'processed',
    target: {
      analysisSource: targetReferenceMetric ? 'reference-audit' : 'local-preprocess',
      averageSleeveWidthRatio: targetReferenceMetric?.averageSleeveWidthRatio
        ?? targetSleeves.averageWidthRatio,
      file: targetRelative,
    },
  };

  await writeRawPng(alphaCandidate, outputFiles.alpha);
  await writeRawPng(normalized, outputFiles.normalized);
  await renderGuide(target, normalizedSleeves, outputFiles.guide);
  await renderDriftHeat({
    candidate: normalized,
    candidateSleeves: normalizedSleeves,
    outputFile: outputFiles.drift,
    target,
    targetSleeves,
  });
  await renderSheet({
    candidateFile,
    driftFile: outputFiles.drift,
    guideFile: outputFiles.guide,
    normalizedFile: outputFiles.normalized,
    outputFile: outputFiles.sheet,
    summary,
    targetFile,
  });

  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    candidatesRoot: path.resolve(readOption(args, 'candidates-root', DEFAULTS.candidatesRoot)),
    metricsFile: path.resolve(readOption(args, 'metrics-file', DEFAULTS.metricsFile)),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    targetRoot: path.resolve(readOption(args, 'target-root', DEFAULTS.targetRoot)),
  };
  const candidates = await listPngs(options.candidatesRoot);
  const referenceRows = await readReferenceMetrics(options.metricsFile);
  const rows = [];

  await mkdir(options.outputRoot, { recursive: true });

  for (const candidate of candidates) {
    rows.push(await processCandidate(candidate, options, referenceRows));
  }

  const summary = {
    candidateCount: candidates.length,
    generatedAt: new Date().toISOString(),
    notes: [
      'OpenAI candidates are converted from green-screen output to local transparent material.',
      'Normalized outputs and sleeve guides are controlled preprocessing material for deterministic local post-processing.',
      'Full-frame replacement is blocked when drift is high, but sleeve material adoption remains allowed after local guards.',
      'Sleeve ratios are read from the reference audit when available so candidate and target use the same metric definition.',
    ],
    processedCount: rows.filter((row) => row.status === 'processed').length,
    rows,
  };

  await writeFile(
    path.join(options.outputRoot, 'reimu-openai-sleeve-candidates-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Prepared ${summary.processedCount}/${summary.candidateCount} Reimu OpenAI sleeve candidates.`);
  console.log(`Wrote ${path.relative(process.cwd(), options.outputRoot)}`);
}

await main();
