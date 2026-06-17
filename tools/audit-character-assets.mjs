import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  character: 'reimu',
  expectedFrames: 0,
  maxDetachedArea: 0,
  maxDetachedSliverArea: 0,
  maxExpressionAlphaSpread: 0.16,
  maxExpressionCenterSpread: 24,
  maxExpressionHeightSpread: 32,
  maxExpressionWidthSpread: 72,
  maxLineHoleArea: 0,
  maxNeighborCenterStep: 32,
  maxTransparentNonBlack: Number.POSITIVE_INFINITY,
  maxWeakAlpha: 300,
  minMargin: 32,
  outputRoot: 'tmp/quality-audit',
  sourceRoot: 'public/characters',
  transparentThreshold: 16,
};

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

function readNumberOption(args, name, fallback) {
  const value = Number(readOption(args, name, fallback));
  return Number.isFinite(value) ? value : fallback;
}

function componentList(mask, width, height) {
  const seen = new Uint8Array(width * height);
  const components = [];

  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || seen[start]) continue;

    const queue = [start];
    const pixels = [];
    let maxX = 0;
    let maxY = 0;
    let minX = width;
    let minY = height;
    let touchEdge = false;
    seen[start] = 1;

    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head];
      const x = index % width;
      const y = Math.floor(index / width);
      pixels.push(index);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchEdge = true;

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
        if (neighbor >= 0 && mask[neighbor] && !seen[neighbor]) {
          seen[neighbor] = 1;
          queue.push(neighbor);
        }
      }
    }

    components.push({
      area: pixels.length,
      height: maxY - minY + 1,
      maxX,
      maxY,
      minX,
      minY,
      touchEdge,
      width: maxX - minX + 1,
    });
  }

  return components.sort((a, b) => b.area - a.area);
}

function isDetachedSliverComponent(component) {
  const shortSide = Math.min(component.width, component.height);
  const longSide = Math.max(component.width, component.height);

  return shortSide <= 16 && longSide >= 8;
}

function csvCell(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
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

async function isWebpFileEntry(parentDir, entry) {
  if (!entry.name.endsWith('.webp')) return false;
  if (entry.isFile()) return true;

  try {
    return (await stat(path.join(parentDir, entry.name))).isFile();
  } catch {
    return false;
  }
}

async function auditFrame(file, relativeFile, transparentThreshold) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alphaMask = new Uint8Array(info.width * info.height);
  const transparentMask = new Uint8Array(info.width * info.height);
  let alphaPixels = 0;
  let maxX = 0;
  let maxY = 0;
  let minX = info.width;
  let minY = info.height;
  let transparentNonBlack = 0;
  let weakAlphaPixels = 0;

  for (let index = 0; index < alphaMask.length; index += 1) {
    const offset = index * 4;
    const alpha = data[offset + 3];

    if (alpha >= transparentThreshold) {
      alphaMask[index] = 1;
      alphaPixels += 1;
      const x = index % info.width;
      const y = Math.floor(index / info.width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    } else {
      transparentMask[index] = 1;
    }

    if (alpha > 0 && alpha < 32) weakAlphaPixels += 1;
    if (alpha === 0 && (data[offset] || data[offset + 1] || data[offset + 2])) {
      transparentNonBlack += 1;
    }
  }

  const components = componentList(alphaMask, info.width, info.height);
  const largest = components[0] ?? { area: 0 };
  const detached = components.slice(1).filter((component) => component.area >= 16);
  const detachedSlivers = detached.filter(isDetachedSliverComponent);
  const holes = componentList(transparentMask, info.width, info.height)
    .filter((component) => !component.touchEdge);
  const lineLikeHoles = holes.filter((component) => (
    component.area <= 128 && (component.width <= 10 || component.height <= 24)
  ));

  return {
    alphaPixels,
    bottomMargin: info.height - 1 - maxY,
    detachedArea: detached.reduce((sum, component) => sum + component.area, 0),
    detachedCount: detached.length,
    detachedSliverArea: detachedSlivers.reduce((sum, component) => sum + component.area, 0),
    detachedSliverCount: detachedSlivers.length,
    file: relativeFile,
    height: maxY - minY + 1,
    holeArea: holes.reduce((sum, component) => sum + component.area, 0),
    holeCount: holes.length,
    largestArea: largest.area,
    leftMargin: minX,
    lineLikeHoleArea: lineLikeHoles.reduce((sum, component) => sum + component.area, 0),
    lineLikeHoleCount: lineLikeHoles.length,
    rightMargin: info.width - 1 - maxX,
    topMargin: minY,
    transparentNonBlack,
    weakAlphaPixels,
    width: maxX - minX + 1,
    centerX: Number((minX + (maxX - minX + 1) / 2).toFixed(2)),
    centerY: Number((minY + (maxY - minY + 1) / 2).toFixed(2)),
  };
}

function summarize(rows) {
  const maxBy = (key) => [...rows].sort((a, b) => b[key] - a[key])[0];
  const minMarginRows = [...rows].sort((a, b) => (
    Math.min(a.leftMargin, a.topMargin, a.rightMargin, a.bottomMargin)
    - Math.min(b.leftMargin, b.topMargin, b.rightMargin, b.bottomMargin)
  ));

  const stability = summarizeStability(rows);

  return {
    frameCount: rows.length,
    maxDetachedArea: maxBy('detachedArea'),
    maxDetachedSliverArea: maxBy('detachedSliverArea'),
    maxLineLikeHoleArea: maxBy('lineLikeHoleArea'),
    maxTransparentNonBlack: maxBy('transparentNonBlack'),
    maxWeakAlphaPixels: maxBy('weakAlphaPixels'),
    minMargin: {
      file: minMarginRows[0]?.file,
      value: minMarginRows[0]
        ? Math.min(
          minMarginRows[0].leftMargin,
          minMarginRows[0].topMargin,
          minMarginRows[0].rightMargin,
          minMarginRows[0].bottomMargin,
        )
        : null,
    },
    stability,
  };
}

function parseFrame(file) {
  const [sheet, frame] = file.split('/');
  const match = /^r(\d+)c(\d+)\.webp$/u.exec(frame);
  if (!sheet || !match) return null;

  return {
    col: Number(match[2]),
    frame,
    pose: sheet[1],
    row: Number(match[1]),
    sheet,
    state: sheet[0],
  };
}

function spread(values) {
  return Math.max(...values) - Math.min(...values);
}

function maxByValue(items, key, fallback = 0) {
  if (!items.length) return { value: fallback };
  return [...items].sort((a, b) => b[key] - a[key])[0];
}

function summarizeExpressionStability(rows) {
  const groups = new Map();
  const spreads = [];

  for (const row of rows) {
    const parsed = parseFrame(row.file);
    if (!parsed?.pose) continue;

    const key = `${parsed.pose}/${parsed.frame}`;
    const group = groups.get(key) ?? [];
    group.push({
      ...row,
      parsed,
    });
    groups.set(key, group);
  }

  for (const [key, group] of groups) {
    if (group.length < 2) continue;

    const centerXSpread = spread(group.map((row) => row.centerX));
    const centerYSpread = spread(group.map((row) => row.centerY));
    const maxAlphaPixels = Math.max(...group.map((row) => row.alphaPixels));
    spreads.push({
      alphaSpreadRatio: Number((spread(group.map((row) => row.alphaPixels)) / maxAlphaPixels).toFixed(4)),
      centerSpread: Number(Math.hypot(centerXSpread, centerYSpread).toFixed(2)),
      files: group.map((row) => row.file).sort(),
      heightSpread: spread(group.map((row) => row.height)),
      key,
      widthSpread: spread(group.map((row) => row.width)),
    });
  }

  return {
    maxAlphaSpreadRatio: maxByValue(spreads, 'alphaSpreadRatio'),
    maxCenterSpread: maxByValue(spreads, 'centerSpread'),
    maxHeightSpread: maxByValue(spreads, 'heightSpread'),
    maxWidthSpread: maxByValue(spreads, 'widthSpread'),
  };
}

function summarizeNeighborStability(rows) {
  const bySheet = new Map();
  const steps = [];

  for (const row of rows) {
    const parsed = parseFrame(row.file);
    if (!parsed) continue;

    const sheetRows = bySheet.get(parsed.sheet) ?? new Map();
    sheetRows.set(`${parsed.row},${parsed.col}`, {
      ...row,
      parsed,
    });
    bySheet.set(parsed.sheet, sheetRows);
  }

  for (const [sheet, sheetRows] of bySheet) {
    for (const row of sheetRows.values()) {
      for (const [rowDelta, colDelta] of [[1, 0], [0, 1]]) {
        const neighbor = sheetRows.get(`${row.parsed.row + rowDelta},${row.parsed.col + colDelta}`);
        if (!neighbor) continue;

        steps.push({
          centerStep: Number(Math.hypot(
            neighbor.centerX - row.centerX,
            neighbor.centerY - row.centerY,
          ).toFixed(2)),
          files: [row.file, neighbor.file],
          key: `${sheet}/r${row.parsed.row}c${row.parsed.col}->r${neighbor.parsed.row}c${neighbor.parsed.col}`,
        });
      }
    }
  }

  return {
    maxCenterStep: maxByValue(steps, 'centerStep'),
  };
}

function summarizeStability(rows) {
  return {
    expression: summarizeExpressionStability(rows),
    neighbor: summarizeNeighborStability(rows),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    character: readOption(args, 'character', DEFAULTS.character),
    expectedFrames: readNumberOption(args, 'expected-frames', DEFAULTS.expectedFrames),
    maxDetachedArea: readNumberOption(args, 'max-detached-area', DEFAULTS.maxDetachedArea),
    maxDetachedSliverArea: readNumberOption(
      args,
      'max-detached-sliver-area',
      DEFAULTS.maxDetachedSliverArea,
    ),
    maxExpressionAlphaSpread: readNumberOption(
      args,
      'max-expression-alpha-spread',
      DEFAULTS.maxExpressionAlphaSpread,
    ),
    maxExpressionCenterSpread: readNumberOption(
      args,
      'max-expression-center-spread',
      DEFAULTS.maxExpressionCenterSpread,
    ),
    maxExpressionHeightSpread: readNumberOption(
      args,
      'max-expression-height-spread',
      DEFAULTS.maxExpressionHeightSpread,
    ),
    maxExpressionWidthSpread: readNumberOption(
      args,
      'max-expression-width-spread',
      DEFAULTS.maxExpressionWidthSpread,
    ),
    maxLineHoleArea: readNumberOption(args, 'max-line-hole-area', DEFAULTS.maxLineHoleArea),
    maxNeighborCenterStep: readNumberOption(args, 'max-neighbor-center-step', DEFAULTS.maxNeighborCenterStep),
    maxTransparentNonBlack: readNumberOption(
      args,
      'max-transparent-non-black',
      DEFAULTS.maxTransparentNonBlack,
    ),
    maxWeakAlpha: readNumberOption(args, 'max-weak-alpha', DEFAULTS.maxWeakAlpha),
    minMargin: readNumberOption(args, 'min-margin', DEFAULTS.minMargin),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    sourceRoot: path.resolve(readOption(args, 'source', DEFAULTS.sourceRoot)),
    transparentThreshold: readNumberOption(args, 'transparent-threshold', DEFAULTS.transparentThreshold),
  };
  const characterRoot = path.join(options.sourceRoot, options.character);
  const rows = [];

  for (const sheetEntry of await readdir(characterRoot, { withFileTypes: true })) {
    const sheetDir = path.join(characterRoot, sheetEntry.name);
    if (!await isDirectoryEntry(characterRoot, sheetEntry)) continue;

    for (const fileEntry of await readdir(sheetDir, { withFileTypes: true })) {
      if (!await isWebpFileEntry(sheetDir, fileEntry)) continue;

      const relativeFile = `${sheetEntry.name}/${fileEntry.name}`;
      rows.push(await auditFrame(
        path.join(sheetDir, fileEntry.name),
        relativeFile,
        options.transparentThreshold,
      ));
    }
  }

  rows.sort((a, b) => a.file.localeCompare(b.file));
  await mkdir(options.outputRoot, { recursive: true });

  const csvHeader = Object.keys(rows[0]);
  const csv = [
    csvHeader.join(','),
    ...rows.map((row) => csvHeader.map((key) => csvCell(row[key])).join(',')),
  ].join('\n');
  const summary = summarize(rows);

  await writeFile(
    path.join(options.outputRoot, `${options.character}-asset-quality.csv`),
    `${csv}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, `${options.character}-asset-quality-summary.json`),
    `${JSON.stringify(summary, null, 2)}\n`,
  );

  console.log(`Audited ${rows.length} ${options.character} frames`);
  console.log(JSON.stringify(summary, null, 2));

  const hardFailures = [];
  if (options.expectedFrames > 0 && rows.length !== options.expectedFrames) {
    hardFailures.push(`expected ${options.expectedFrames} frames, found ${rows.length}`);
  }
  if (summary.minMargin.value < options.minMargin) {
    hardFailures.push(`${summary.minMargin.file} margin ${summary.minMargin.value} < ${options.minMargin}`);
  }
  if (summary.maxDetachedArea.detachedArea > options.maxDetachedArea) {
    hardFailures.push(
      `${summary.maxDetachedArea.file} detached area `
      + `${summary.maxDetachedArea.detachedArea} > ${options.maxDetachedArea}`,
    );
  }
  if (summary.maxDetachedSliverArea.detachedSliverArea > options.maxDetachedSliverArea) {
    hardFailures.push(
      `${summary.maxDetachedSliverArea.file} detached sliver area `
      + `${summary.maxDetachedSliverArea.detachedSliverArea} > ${options.maxDetachedSliverArea}`,
    );
  }
  if (summary.maxLineLikeHoleArea.lineLikeHoleArea > options.maxLineHoleArea) {
    hardFailures.push(
      `${summary.maxLineLikeHoleArea.file} line-like hole area `
      + `${summary.maxLineLikeHoleArea.lineLikeHoleArea} > ${options.maxLineHoleArea}`,
    );
  }
  if (summary.maxTransparentNonBlack.transparentNonBlack > options.maxTransparentNonBlack) {
    hardFailures.push(
      `${summary.maxTransparentNonBlack.file} transparent RGB pixels `
      + `${summary.maxTransparentNonBlack.transparentNonBlack} > ${options.maxTransparentNonBlack}`,
    );
  }
  if (summary.maxWeakAlphaPixels.weakAlphaPixels > options.maxWeakAlpha) {
    hardFailures.push(
      `${summary.maxWeakAlphaPixels.file} weak alpha pixels `
      + `${summary.maxWeakAlphaPixels.weakAlphaPixels} > ${options.maxWeakAlpha}`,
    );
  }
  if (summary.stability.expression.maxCenterSpread.centerSpread > options.maxExpressionCenterSpread) {
    hardFailures.push(
      `${summary.stability.expression.maxCenterSpread.key} expression center spread `
      + `${summary.stability.expression.maxCenterSpread.centerSpread} > ${options.maxExpressionCenterSpread}`,
    );
  }
  if (summary.stability.expression.maxWidthSpread.widthSpread > options.maxExpressionWidthSpread) {
    hardFailures.push(
      `${summary.stability.expression.maxWidthSpread.key} expression width spread `
      + `${summary.stability.expression.maxWidthSpread.widthSpread} > ${options.maxExpressionWidthSpread}`,
    );
  }
  if (summary.stability.expression.maxHeightSpread.heightSpread > options.maxExpressionHeightSpread) {
    hardFailures.push(
      `${summary.stability.expression.maxHeightSpread.key} expression height spread `
      + `${summary.stability.expression.maxHeightSpread.heightSpread} > ${options.maxExpressionHeightSpread}`,
    );
  }
  if (summary.stability.expression.maxAlphaSpreadRatio.alphaSpreadRatio > options.maxExpressionAlphaSpread) {
    hardFailures.push(
      `${summary.stability.expression.maxAlphaSpreadRatio.key} expression alpha spread `
      + `${summary.stability.expression.maxAlphaSpreadRatio.alphaSpreadRatio} > `
      + `${options.maxExpressionAlphaSpread}`,
    );
  }
  if (summary.stability.neighbor.maxCenterStep.centerStep > options.maxNeighborCenterStep) {
    hardFailures.push(
      `${summary.stability.neighbor.maxCenterStep.key} neighbor center step `
      + `${summary.stability.neighbor.maxCenterStep.centerStep} > ${options.maxNeighborCenterStep}`,
    );
  }

  if (hardFailures.length) {
    throw new Error(`Asset audit failed:\n- ${hardFailures.join('\n- ')}`);
  }
  console.log('Asset audit hard checks passed.');
}

await main();
