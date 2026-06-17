import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  auditRoot: 'tmp/audit',
  compareRoot: 'tmp/compare',
  edgeRoot: 'tmp/edge-audit',
  expressionRoot: 'tmp/expression-audit',
  gapRoot: 'tmp/gap-audit',
  inspectionRoot: 'tmp/inspection',
  issueRoot: 'tmp/issues',
  lineRoot: 'tmp/line-audit',
  noreshapeRoot: 'tmp/noreshape/reimu',
  qualityRoot: 'tmp/quality-audit',
  referenceRoot: 'tmp/reference-audit',
  sourceRoot: 'public/characters/reimu',
  sweepRoot: 'tmp/sweep',
};

const AUDIT_SHEETS = ['pl_01', 'pt_01', 'py_01', 'oy_01', 'ot_01', 'cy_01', 'ct_01'];
const AUDIT_MODES = ['pink', 'dark', 'alpha'];
const COMPARE_SHEETS = ['pt_01', 'ot_01', 'ct_01', 'py_01', 'oy_01', 'cy_01'];
const COMPARE_MODES = ['pink', 'dark'];
const FRESHNESS_TOLERANCE_MS = 5000;
const EXPECTED_REFERENCE_CURRENT_FRAMES = COMPARE_SHEETS.length * 25;
const EXPECTED_OPENAI_REFERENCE_IMAGES = 5;
const VISUAL_DIMENSIONS = {
  audit: { height: 800, width: 800 },
  compare: { height: 800, width: 1616 },
  edge: { height: 850, width: 960 },
  expression: { height: 864, width: 1440 },
  frame: { height: 512, width: 512 },
  gap: { height: 850, width: 960 },
  inspection: { height: 1800, width: 1024 },
  issue: { height: 850, width: 960 },
  line: { height: 850, width: 960 },
  referenceForeground: { minHeight: 512, minWidth: 512 },
  referenceSleeves: { height: 512, width: 512 },
  sweep: { height: 1604, width: 1472 },
};

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
  const resolvedRoot = path.resolve(root);
  const rootStat = await pathStat(resolvedRoot);
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

  await visit(resolvedRoot);
  return files.sort((a, b) => a.localeCompare(b));
}

async function latestMtimeMs(files) {
  let latest = 0;
  for (const file of files) {
    const fileStat = await pathStat(file);
    if (fileStat?.isFile()) latest = Math.max(latest, fileStat.mtimeMs);
  }
  return latest;
}

async function assertFreshFile({ file, failures, referenceMtime }) {
  const fileStat = await pathStat(file);
  const relative = path.relative(process.cwd(), file);

  if (!fileStat?.isFile()) {
    failures.push(`missing ${relative}`);
    return;
  }
  if (fileStat.size <= 0) {
    failures.push(`empty ${relative}`);
  }
  if (referenceMtime && fileStat.mtimeMs + FRESHNESS_TOLERANCE_MS < referenceMtime) {
    failures.push(`stale ${relative}`);
  }
}

async function assertImageMetadata({ file, failures, format, height, minHeight, minWidth, width }) {
  const relative = path.relative(process.cwd(), file);

  try {
    const metadata = await sharp(file, { animated: false }).metadata();
    if (format && metadata.format !== format) {
      failures.push(`${relative} format ${metadata.format} !== ${format}`);
    }
    if (width && metadata.width !== width) {
      failures.push(`${relative} width ${metadata.width} !== ${width}`);
    }
    if (height && metadata.height !== height) {
      failures.push(`${relative} height ${metadata.height} !== ${height}`);
    }
    if (minWidth && metadata.width < minWidth) {
      failures.push(`${relative} width ${metadata.width} < ${minWidth}`);
    }
    if (minHeight && metadata.height < minHeight) {
      failures.push(`${relative} height ${metadata.height} < ${minHeight}`);
    }
  } catch (error) {
    failures.push(`${relative} cannot be read as an image: ${error.message}`);
  }
}

function expectedAuditFiles(root) {
  return AUDIT_SHEETS.flatMap((sheet) => (
    AUDIT_MODES.map((mode) => path.join(root, `${sheet}-${mode}.png`))
  ));
}

function expectedCompareFiles(root) {
  return COMPARE_SHEETS.flatMap((sheet) => (
    COMPARE_MODES.map((mode) => path.join(root, `${sheet}-${mode}-compare.png`))
  ));
}

function expectedSweepFiles(root) {
  return ['pink', 'dark', 'alpha'].map((mode) => path.join(root, `reimu-full-sweep-${mode}.png`));
}

async function verifyReferenceMetrics(referenceRoot, failures) {
  const metricsFile = path.join(referenceRoot, 'reimu-reference-metrics.json');
  const metricsStat = await pathStat(metricsFile);
  if (!metricsStat?.isFile()) {
    failures.push(`missing ${path.relative(process.cwd(), metricsFile)}`);
    return { currentCount: 0, openAiCount: 0, referencePngCount: 0 };
  }

  const metrics = JSON.parse(await readFile(metricsFile, 'utf8'));
  const rows = Array.isArray(metrics.rows) ? metrics.rows : [];
  const openAiCount = rows.filter((row) => row.group === 'openai-reference').length;
  const currentCount = rows.filter((row) => row.group === 'current-frame').length;

  if (currentCount < EXPECTED_REFERENCE_CURRENT_FRAMES) {
    failures.push(
      `reference audit current-frame rows ${currentCount} < ${EXPECTED_REFERENCE_CURRENT_FRAMES}`,
    );
  }
  if (openAiCount < EXPECTED_OPENAI_REFERENCE_IMAGES) {
    failures.push(
      `reference audit openai-reference rows ${openAiCount} < ${EXPECTED_OPENAI_REFERENCE_IMAGES}`,
    );
  }

  const referencePngs = await walkFiles(referenceRoot, '.png');
  const expectedPngCount = rows.length * 2;
  if (referencePngs.length !== expectedPngCount) {
    failures.push(`reference audit PNG count ${referencePngs.length} !== ${expectedPngCount}`);
  }

  for (const file of referencePngs) {
    const dimensions = path.basename(file).endsWith('-sleeves.png')
      ? VISUAL_DIMENSIONS.referenceSleeves
      : VISUAL_DIMENSIONS.referenceForeground;

    await assertImageMetadata({
      file,
      failures,
      format: 'png',
      ...dimensions,
    });
  }

  return {
    currentCount,
    openAiCount,
    referencePngCount: referencePngs.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    auditRoot: path.resolve(readOption(args, 'audit-root', DEFAULTS.auditRoot)),
    compareRoot: path.resolve(readOption(args, 'compare-root', DEFAULTS.compareRoot)),
    edgeRoot: path.resolve(readOption(args, 'edge-root', DEFAULTS.edgeRoot)),
    expressionRoot: path.resolve(readOption(args, 'expression-root', DEFAULTS.expressionRoot)),
    gapRoot: path.resolve(readOption(args, 'gap-root', DEFAULTS.gapRoot)),
    inspectionRoot: path.resolve(readOption(args, 'inspection-root', DEFAULTS.inspectionRoot)),
    issueRoot: path.resolve(readOption(args, 'issue-root', DEFAULTS.issueRoot)),
    lineRoot: path.resolve(readOption(args, 'line-root', DEFAULTS.lineRoot)),
    noreshapeRoot: path.resolve(readOption(args, 'noreshape-root', DEFAULTS.noreshapeRoot)),
    qualityRoot: path.resolve(readOption(args, 'quality-root', DEFAULTS.qualityRoot)),
    referenceRoot: path.resolve(readOption(args, 'reference-root', DEFAULTS.referenceRoot)),
    sourceRoot: path.resolve(readOption(args, 'source-root', DEFAULTS.sourceRoot)),
    sweepRoot: path.resolve(readOption(args, 'sweep-root', DEFAULTS.sweepRoot)),
  };
  const sourceFrames = await walkFiles(options.sourceRoot, '.webp');
  const noreshapeFrames = await walkFiles(options.noreshapeRoot, '.webp');
  const failures = [];

  if (sourceFrames.length !== 225) {
    failures.push(`public Reimu frame count ${sourceFrames.length} !== 225`);
  }
  if (noreshapeFrames.length !== 225) {
    failures.push(`no-reshape Reimu frame count ${noreshapeFrames.length} !== 225`);
  }
  for (const file of [...sourceFrames, ...noreshapeFrames]) {
    await assertImageMetadata({
      file,
      failures,
      format: 'webp',
      ...VISUAL_DIMENSIONS.frame,
    });
  }

  const referenceMtime = await latestMtimeMs([...sourceFrames, ...noreshapeFrames]);
  const auditFiles = expectedAuditFiles(options.auditRoot);
  const compareFiles = expectedCompareFiles(options.compareRoot);
  const sweepFiles = expectedSweepFiles(options.sweepRoot);
  const issueOverlayFile = path.join(options.issueRoot, 'reimu-issue-overlay.png');
  const edgeOverlayFile = path.join(options.edgeRoot, 'reimu-edge-integrity-overlay.png');
  const expressionDiffFile = path.join(options.expressionRoot, 'reimu-expression-diff-audit.png');
  const gapOverlayFile = path.join(options.gapRoot, 'reimu-reference-covered-gap-overlay.png');
  const inspectionZoomFile = path.join(options.inspectionRoot, 'reimu-inspection-zooms.png');
  const lineOverlayFile = path.join(options.lineRoot, 'reimu-line-integrity-overlay.png');
  const requiredFiles = [
    path.join(options.qualityRoot, 'reimu-asset-quality.csv'),
    path.join(options.qualityRoot, 'reimu-asset-quality-summary.json'),
    path.join(options.qualityRoot, 'reimu-sleeve-guard.csv'),
    path.join(options.qualityRoot, 'reimu-sleeve-guard-summary.json'),
    path.join(options.edgeRoot, 'reimu-edge-integrity.csv'),
    path.join(options.edgeRoot, 'reimu-edge-integrity-summary.json'),
    path.join(options.expressionRoot, 'reimu-expression-diff-audit.csv'),
    path.join(options.expressionRoot, 'reimu-expression-diff-audit-summary.json'),
    path.join(options.gapRoot, 'reimu-reference-covered-gap.csv'),
    path.join(options.gapRoot, 'reimu-reference-covered-gap-summary.json'),
    path.join(options.lineRoot, 'reimu-line-integrity.csv'),
    path.join(options.lineRoot, 'reimu-line-integrity-summary.json'),
    path.join(options.qualityRoot, 'reimu-residual-defect-summary.json'),
    ...auditFiles,
    ...compareFiles,
    ...sweepFiles,
    edgeOverlayFile,
    expressionDiffFile,
    gapOverlayFile,
    issueOverlayFile,
    lineOverlayFile,
    inspectionZoomFile,
    path.join(options.referenceRoot, 'reimu-reference-metrics.csv'),
    path.join(options.referenceRoot, 'reimu-reference-metrics.json'),
  ];

  for (const file of requiredFiles) {
    await assertFreshFile({ file, failures, referenceMtime });
  }
  for (const file of auditFiles) {
    await assertImageMetadata({
      file,
      failures,
      format: 'png',
      ...VISUAL_DIMENSIONS.audit,
    });
  }
  for (const file of compareFiles) {
    await assertImageMetadata({
      file,
      failures,
      format: 'png',
      ...VISUAL_DIMENSIONS.compare,
    });
  }
  for (const file of sweepFiles) {
    await assertImageMetadata({
      file,
      failures,
      format: 'png',
      ...VISUAL_DIMENSIONS.sweep,
    });
  }
  await assertImageMetadata({
    file: edgeOverlayFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.edge,
  });
  await assertImageMetadata({
    file: expressionDiffFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.expression,
  });
  await assertImageMetadata({
    file: gapOverlayFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.gap,
  });
  await assertImageMetadata({
    file: issueOverlayFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.issue,
  });
  await assertImageMetadata({
    file: lineOverlayFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.line,
  });
  await assertImageMetadata({
    file: inspectionZoomFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.inspection,
  });
  const referenceMetrics = await verifyReferenceMetrics(options.referenceRoot, failures);

  if (failures.length) {
    throw new Error(`Reimu quality artifact verification failed:\n- ${failures.join('\n- ')}`);
  }

  console.log('Reimu quality artifact verification passed.');
  console.log(JSON.stringify({
    auditSheets: AUDIT_SHEETS.length * AUDIT_MODES.length,
    compareSheets: COMPARE_SHEETS.length * COMPARE_MODES.length,
    edgeSheets: 1,
    expressionSheets: 1,
    gapSheets: 1,
    lineSheets: 1,
    noreshapeFrames: noreshapeFrames.length,
    openAiReferenceImages: referenceMetrics.openAiCount,
    publicFrames: sourceFrames.length,
    referenceFrames: referenceMetrics.currentCount,
    referencePngs: referenceMetrics.referencePngCount,
    sweepSheets: sweepFiles.length,
  }, null, 2));
}

await main();
