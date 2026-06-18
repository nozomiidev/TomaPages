import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  baselineRoot: 'tmp/noreshape/reimu',
  outputRoot: 'tmp/product-review',
  perceptualSummary: 'tmp/perceptual-audit/reimu-perceptual-consistency-summary.json',
  sourceRoot: 'public/characters/reimu',
};

const BOARD = {
  background: { alpha: 1, b: 255, g: 255, r: 255 },
  candidateCols: 4,
  candidateTileSize: 180,
  gap: 16,
  labelHeight: 36,
  padding: 24,
  representativeCols: 5,
  representativeTileSize: 180,
  sectionHeaderHeight: 42,
  titleHeight: 84,
  width: 1600,
};

const REPRESENTATIVE_FRAMES = [
  'pl_01/r0c0.webp',
  'pl_01/r2c2.webp',
  'pl_01/r4c4.webp',
  'om_01/r0c2.webp',
  'om_01/r2c2.webp',
  'ce_01/r0c2.webp',
  'ce_01/r2c2.webp',
  'pt_01/r0c1.webp',
  'pt_01/r2c3.webp',
  'ot_01/r1c2.webp',
  'ct_01/r2c3.webp',
  'py_01/r0c2.webp',
  'py_01/r4c4.webp',
  'oy_01/r3c2.webp',
  'cy_01/r1c1.webp',
];

const HASH_ARTIFACTS = [
  'tmp/sweep/reimu-full-sweep-pink.png',
  'tmp/sweep/reimu-full-sweep-dark.png',
  'tmp/sweep/reimu-full-sweep-alpha.png',
  'tmp/perceptual-audit/reimu-perceptual-consistency.png',
  'tmp/perceptual-audit/reimu-perceptual-candidate-zooms.png',
  'tmp/line-audit/reimu-line-integrity-overlay.png',
  'tmp/edge-audit/reimu-edge-integrity-overlay.png',
  'tmp/gap-audit/reimu-reference-covered-gap-overlay.png',
  'tmp/expression-audit/reimu-expression-diff-audit.png',
  'tmp/openai-material-audit/reimu-openai-material-application.png',
];

function readOption(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
}

async function pathStat(file) {
  try {
    return await stat(file);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function walkFiles(root, extension) {
  const files = [];
  const rootStat = await pathStat(root);
  if (!rootStat?.isDirectory()) return files;

  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else if (!extension || entry.name.endsWith(extension)) {
        files.push(file);
      }
    }
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function escapeText(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function framePath(root, relativeFile) {
  return path.join(root, ...relativeFile.split('/'));
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

function textSvg({ fill = '#111827', fontSize = 12, height, lines, width }) {
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`
    + '<rect width="100%" height="100%" fill="#f8fafc"/>'
    + lines.map((line, index) => (
      `<text x="10" y="${18 + index * 16}" font-family="Arial" font-size="${fontSize}" fill="${fill}">${escapeText(line)}</text>`
    )).join('')
    + '</svg>',
  );
}

async function frameTile({ background = 'checker', file, label, sublabel, tileSize }) {
  const labelHeight = BOARD.labelHeight;
  const image = await sharp(file, { animated: false })
    .ensureAlpha()
    .resize(tileSize, tileSize, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
      kernel: 'lanczos3',
    })
    .png()
    .toBuffer();
  const base = background === 'dark'
    ? sharp({
      create: {
        background: { alpha: 1, b: 17, g: 17, r: 17 },
        channels: 4,
        height: tileSize + labelHeight,
        width: tileSize,
      },
    })
    : sharp(checkerSvg(tileSize, tileSize + labelHeight));

  return base
    .composite([
      {
        input: textSvg({
          fill: '#111827',
          fontSize: 11,
          height: labelHeight,
          lines: [label, sublabel].filter(Boolean),
          width: tileSize,
        }),
        left: 0,
        top: 0,
      },
      { input: image, left: 0, top: labelHeight },
    ])
    .png()
    .toBuffer();
}

function sectionHeader(title, subtitle) {
  return {
    input: textSvg({
      fill: '#111827',
      fontSize: 13,
      height: BOARD.sectionHeaderHeight,
      lines: [title, subtitle].filter(Boolean),
      width: BOARD.width - BOARD.padding * 2,
    }),
    left: BOARD.padding,
  };
}

async function hashImage(file) {
  const fileStat = await pathStat(file);
  if (!fileStat?.isFile()) {
    return {
      exists: false,
      file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
    };
  }

  const buffer = await readFile(file);
  const metadata = await sharp(buffer, { animated: false }).metadata();
  return {
    exists: true,
    file: path.relative(process.cwd(), file).replaceAll('\\', '/'),
    height: metadata.height,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    width: metadata.width,
  };
}

async function renderBoard({ baselineRoot, candidates, outputRoot, sourceRoot }) {
  const repRows = Math.ceil(REPRESENTATIVE_FRAMES.length / BOARD.representativeCols);
  const repBlockHeight = BOARD.labelHeight + BOARD.representativeTileSize;
  const representativeSectionHeight = (
    BOARD.sectionHeaderHeight
    + repRows * repBlockHeight
    + (repRows - 1) * BOARD.gap
  );
  const candidateRows = Math.ceil(candidates.length / BOARD.candidateCols);
  const candidateBlockHeight = BOARD.labelHeight + BOARD.candidateTileSize;
  const candidateSectionHeight = (
    BOARD.sectionHeaderHeight
    + candidateRows * candidateBlockHeight
    + Math.max(0, candidateRows - 1) * BOARD.gap
  );
  const height = (
    BOARD.padding
    + BOARD.titleHeight
    + BOARD.gap
    + representativeSectionHeight
    + BOARD.gap
    + candidateSectionHeight
    + BOARD.padding
  );
  const composites = [];
  let y = BOARD.padding;

  composites.push({
    input: textSvg({
      fill: '#111827',
      fontSize: 14,
      height: BOARD.titleHeight,
      lines: [
        'Reimu product visual review board',
        'Representative runtime frames plus highest-risk review-only candidates.',
        'Generated from current WebP assets and no-reshape baseline material.',
      ],
      width: BOARD.width - BOARD.padding * 2,
    }),
    left: BOARD.padding,
    top: y,
  });
  y += BOARD.titleHeight + BOARD.gap;
  composites.push({
    ...sectionHeader('Representative frames', `${REPRESENTATIVE_FRAMES.length} selected frames across pose, expression, and direction extremes`),
    top: y,
  });
  y += BOARD.sectionHeaderHeight;

  for (let index = 0; index < REPRESENTATIVE_FRAMES.length; index += 1) {
    const relativeFile = REPRESENTATIVE_FRAMES[index];
    const col = index % BOARD.representativeCols;
    const row = Math.floor(index / BOARD.representativeCols);
    composites.push({
      input: await frameTile({
        file: framePath(sourceRoot, relativeFile),
        label: relativeFile,
        sublabel: 'current',
        tileSize: BOARD.representativeTileSize,
      }),
      left: BOARD.padding + col * (BOARD.representativeTileSize + BOARD.gap),
      top: y + row * (repBlockHeight + BOARD.gap),
    });
  }

  y += representativeSectionHeight - BOARD.sectionHeaderHeight + BOARD.gap;
  composites.push({
    ...sectionHeader('Highest-risk review candidates', `${candidates.length} perceptual candidates, current paired with no-reshape baseline`),
    top: y,
  });
  y += BOARD.sectionHeaderHeight;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const col = index % BOARD.candidateCols;
    const row = Math.floor(index / BOARD.candidateCols);
    const left = BOARD.padding + col * (BOARD.candidateTileSize * 2 + BOARD.gap);
    const top = y + row * (candidateBlockHeight + BOARD.gap);
    composites.push({
      input: await frameTile({
        file: framePath(sourceRoot, candidate.file),
        label: candidate.file,
        sublabel: 'current',
        tileSize: BOARD.candidateTileSize,
      }),
      left,
      top,
    });
    composites.push({
      input: await frameTile({
        file: framePath(baselineRoot, candidate.file),
        label: candidate.file,
        sublabel: 'no-reshape',
        tileSize: BOARD.candidateTileSize,
      }),
      left: left + BOARD.candidateTileSize,
      top,
    });
  }

  const boardFile = path.join(outputRoot, 'reimu-product-review-board.png');
  await sharp({
    create: {
      background: BOARD.background,
      channels: 4,
      height,
      width: BOARD.width,
    },
  })
    .composite(composites)
    .png()
    .toFile(boardFile);

  return boardFile;
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    baselineRoot: path.resolve(readOption(args, 'baseline-root', DEFAULTS.baselineRoot)),
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    perceptualSummary: path.resolve(readOption(
      args,
      'perceptual-summary',
      DEFAULTS.perceptualSummary,
    )),
    sourceRoot: path.resolve(readOption(args, 'source-root', DEFAULTS.sourceRoot)),
  };
  const perceptualSummary = JSON.parse(await readFile(options.perceptualSummary, 'utf8'));
  const candidates = Array.isArray(perceptualSummary.candidates)
    ? perceptualSummary.candidates
    : [];
  const [baselineFrames, publicFrames] = await Promise.all([
    walkFiles(options.baselineRoot, '.webp'),
    walkFiles(options.sourceRoot, '.webp'),
  ]);

  await mkdir(options.outputRoot, { recursive: true });
  const boardFile = await renderBoard({
    baselineRoot: options.baselineRoot,
    candidates,
    outputRoot: options.outputRoot,
    sourceRoot: options.sourceRoot,
  });
  const reviewArtifacts = await Promise.all(
    HASH_ARTIFACTS.map((file) => hashImage(path.resolve(file))),
  );
  const boardArtifact = await hashImage(boardFile);
  const summary = {
    actionableCandidateCount: perceptualSummary.actionableCandidateCount ?? null,
    baselineFrameCount: baselineFrames.length,
    board: boardArtifact,
    candidateCount: candidates.length,
    publicFrameCount: publicFrames.length,
    representativeFrameCount: REPRESENTATIVE_FRAMES.length,
    representativeFrames: REPRESENTATIVE_FRAMES,
    reviewArtifacts,
    reviewArtifactCount: reviewArtifacts.filter((artifact) => artifact.exists).length,
    severeIssueCount: perceptualSummary.severeIssueCount ?? null,
  };
  const csvHeaders = ['file', 'role', 'sha256', 'width', 'height'];
  const csvRows = [boardArtifact, ...reviewArtifacts].map((artifact, index) => [
    artifact.file,
    index === 0 ? 'product-review-board' : 'supporting-review-artifact',
    artifact.sha256 ?? '',
    artifact.width ?? '',
    artifact.height ?? '',
  ]);

  await writeFile(
    path.join(options.outputRoot, 'reimu-product-review-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, 'reimu-product-review-artifacts.csv'),
    `${csvHeaders.join(',')}\n${csvRows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')}\n`,
  );

  console.log(`Rendered product review board to ${path.relative(process.cwd(), boardFile)}`);
  console.log(JSON.stringify(summary, null, 2));

  if (summary.publicFrameCount !== 225 || summary.baselineFrameCount !== 225) {
    throw new Error('Reimu product review requires 225 public and baseline frames');
  }
  if (summary.actionableCandidateCount !== 0 || summary.severeIssueCount !== 0) {
    throw new Error('Reimu product review cannot pass with actionable or severe candidates');
  }
  if (summary.reviewArtifactCount !== HASH_ARTIFACTS.length) {
    throw new Error(`Reimu product review found ${summary.reviewArtifactCount}/${HASH_ARTIFACTS.length} supporting artifacts`);
  }
}

await main();
