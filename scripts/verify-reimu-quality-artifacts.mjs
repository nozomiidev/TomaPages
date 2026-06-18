import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const DEFAULTS = {
  auditRoot: 'tmp/audit',
  baselineDeltaRoot: 'tmp/baseline-delta',
  compareRoot: 'tmp/compare',
  edgeRoot: 'tmp/edge-audit',
  expressionRoot: 'tmp/expression-audit',
  gapRoot: 'tmp/gap-audit',
  inspectionRoot: 'tmp/inspection',
  issueRoot: 'tmp/issues',
  lineRoot: 'tmp/line-audit',
  openAiCandidateSourceRoot: 'tmp/imagegen/reimu-sleeve-candidates',
  noreshapeRoot: 'tmp/noreshape/reimu',
  openAiCandidateRoot: 'tmp/imagegen/reimu-sleeve-candidates/processed',
  perceptualRoot: 'tmp/perceptual-audit',
  openAiMaterialRoot: 'tmp/openai-material-audit',
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
const OPENAI_SLEEVE_MATERIAL_GATES = {
  maxOutsideSleeveDiffRatio: 0.08,
  maxSideWidthLoss: 0.101,
  minAverageWidthDelta: 0.017,
  minChangedFrames: 25,
};
const VISUAL_DIMENSIONS = {
  audit: { height: 800, width: 800 },
  baselineDelta: { height: 408, width: 960 },
  compare: { height: 800, width: 1616 },
  edge: { height: 850, width: 960 },
  expression: { height: 864, width: 1440 },
  frame: { height: 512, width: 512 },
  gap: { height: 850, width: 960 },
  inspection: { height: 1800, width: 1024 },
  issue: { height: 850, width: 960 },
  line: { height: 850, width: 960 },
  openAiTargets: { height: 1248, width: 768 },
  openAiCandidateDrift: { height: 512, width: 512 },
  openAiCandidateGuide: { height: 512, width: 512 },
  openAiMaterialSheet: { minHeight: 192, minWidth: 900 },
  openAiCandidateNormalized: { height: 512, width: 512 },
  openAiCandidateSheet: { height: 354, width: 1100 },
  perceptual: { height: 1390, width: 960 },
  perceptualZoom: { height: 1800, width: 1024 },
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

async function directPngFiles(root) {
  const files = [];
  const resolvedRoot = path.resolve(root);
  const rootStat = await pathStat(resolvedRoot);
  if (!rootStat?.isDirectory()) return files;

  for (const entry of await readdir(resolvedRoot, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.png')) files.push(path.join(resolvedRoot, entry.name));
  }

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

  const referencePngs = (await walkFiles(referenceRoot, '.png'))
    .filter((file) => /-(foreground|sleeves)\.png$/u.test(path.basename(file)));
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

async function verifyOpenAiCandidateArtifacts(
  openAiCandidateSourceRoot,
  openAiCandidateRoot,
  failures,
  referenceMtime,
) {
  const summaryFile = path.join(openAiCandidateRoot, 'reimu-openai-sleeve-candidates-summary.json');
  const summaryStat = await pathStat(summaryFile);
  const sourceCandidates = await directPngFiles(openAiCandidateSourceRoot);
  if (!summaryStat?.isFile()) {
    if (sourceCandidates.length > 0) failures.push(`missing ${path.relative(process.cwd(), summaryFile)}`);
    return { processedCount: 0 };
  }

  await assertFreshFile({ file: summaryFile, failures, referenceMtime });

  const summary = JSON.parse(await readFile(summaryFile, 'utf8'));
  const rows = Array.isArray(summary.rows) ? summary.rows : [];
  const processedRows = rows.filter((row) => row.status === 'processed');
  if (summary.candidateCount !== sourceCandidates.length) {
    failures.push(
      `OpenAI sleeve candidateCount ${summary.candidateCount} !== ${sourceCandidates.length}`,
    );
  }
  if (summary.processedCount !== processedRows.length) {
    failures.push(
      `OpenAI sleeve candidate processedCount ${summary.processedCount} !== ${processedRows.length}`,
    );
  }

  for (const row of processedRows) {
    if (row.controlledMaterialAllowed !== true) {
      failures.push(`${row.candidate?.file ?? 'candidate'} controlledMaterialAllowed should be true`);
    }
    if (row.materialization?.adoptionMode !== 'sleeve-mask-and-proportion-material') {
      failures.push(`${row.candidate?.file ?? 'candidate'} missing controlled materialization mode`);
    }
    if (row.materialization?.preserveIdentityAndGrid !== true) {
      failures.push(`${row.candidate?.file ?? 'candidate'} should preserve identity and grid`);
    }
    if (row.materialization?.fullFrameReplacementAllowed !== row.directAdoptionAllowed) {
      failures.push(`${row.candidate?.file ?? 'candidate'} full-frame policy should match drift gate`);
    }
    if (!(row.nonSleeveDrift?.driftRatio > 0.08)) {
      failures.push(`${row.candidate?.file ?? 'candidate'} drift ratio should block direct adoption`);
    }

    const outputs = row.outputs ?? {};
    const outputChecks = [
      ['alpha', outputs.alpha, { minHeight: 512, minWidth: 512 }],
      ['drift', outputs.drift, VISUAL_DIMENSIONS.openAiCandidateDrift],
      ['guide', outputs.guide, VISUAL_DIMENSIONS.openAiCandidateGuide],
      ['normalized', outputs.normalized, VISUAL_DIMENSIONS.openAiCandidateNormalized],
      ['sheet', outputs.sheet, VISUAL_DIMENSIONS.openAiCandidateSheet],
    ];

    for (const [label, output, dimensions] of outputChecks) {
      if (!output) {
        failures.push(`${row.candidate?.file ?? 'candidate'} missing ${label} output`);
        continue;
      }

      const file = path.resolve(output);
      await assertFreshFile({ file, failures, referenceMtime });
      await assertImageMetadata({
        file,
        failures,
        format: 'png',
        ...dimensions,
      });
    }
  }

  return {
    processedCount: processedRows.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const options = {
    auditRoot: path.resolve(readOption(args, 'audit-root', DEFAULTS.auditRoot)),
    baselineDeltaRoot: path.resolve(readOption(
      args,
      'baseline-delta-root',
      DEFAULTS.baselineDeltaRoot,
    )),
    compareRoot: path.resolve(readOption(args, 'compare-root', DEFAULTS.compareRoot)),
    edgeRoot: path.resolve(readOption(args, 'edge-root', DEFAULTS.edgeRoot)),
    expressionRoot: path.resolve(readOption(args, 'expression-root', DEFAULTS.expressionRoot)),
    gapRoot: path.resolve(readOption(args, 'gap-root', DEFAULTS.gapRoot)),
    inspectionRoot: path.resolve(readOption(args, 'inspection-root', DEFAULTS.inspectionRoot)),
    issueRoot: path.resolve(readOption(args, 'issue-root', DEFAULTS.issueRoot)),
    lineRoot: path.resolve(readOption(args, 'line-root', DEFAULTS.lineRoot)),
    noreshapeRoot: path.resolve(readOption(args, 'noreshape-root', DEFAULTS.noreshapeRoot)),
    openAiCandidateSourceRoot: path.resolve(readOption(
      args,
      'openai-candidate-source-root',
      DEFAULTS.openAiCandidateSourceRoot,
    )),
    openAiCandidateRoot: path.resolve(readOption(
      args,
      'openai-candidate-root',
      DEFAULTS.openAiCandidateRoot,
    )),
    openAiMaterialRoot: path.resolve(readOption(
      args,
      'openai-material-root',
      DEFAULTS.openAiMaterialRoot,
    )),
    perceptualRoot: path.resolve(readOption(args, 'perceptual-root', DEFAULTS.perceptualRoot)),
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
  const baselineDeltaCsvFile = path.join(
    options.baselineDeltaRoot,
    'reimu-baseline-quality-delta.csv',
  );
  const baselineDeltaSummaryFile = path.join(
    options.baselineDeltaRoot,
    'reimu-baseline-quality-delta-summary.json',
  );
  const baselineDeltaPngFile = path.join(
    options.baselineDeltaRoot,
    'reimu-baseline-quality-delta.png',
  );
  const compareFiles = expectedCompareFiles(options.compareRoot);
  const sweepFiles = expectedSweepFiles(options.sweepRoot);
  const issueOverlayFile = path.join(options.issueRoot, 'reimu-issue-overlay.png');
  const edgeOverlayFile = path.join(options.edgeRoot, 'reimu-edge-integrity-overlay.png');
  const expressionDiffFile = path.join(options.expressionRoot, 'reimu-expression-diff-audit.png');
  const gapOverlayFile = path.join(options.gapRoot, 'reimu-reference-covered-gap-overlay.png');
  const inspectionZoomFile = path.join(options.inspectionRoot, 'reimu-inspection-zooms.png');
  const lineOverlayFile = path.join(options.lineRoot, 'reimu-line-integrity-overlay.png');
  const openAiTargetFile = path.join(options.referenceRoot, 'reimu-openai-reference-targets.png');
  const openAiMaterialFile = path.join(
    options.openAiMaterialRoot,
    'reimu-openai-material-application.png',
  );
  const perceptualFile = path.join(options.perceptualRoot, 'reimu-perceptual-consistency.png');
  const perceptualZoomFile = path.join(options.perceptualRoot, 'reimu-perceptual-candidate-zooms.png');
  const perceptualDispositionJsonFile = path.join(
    options.perceptualRoot,
    'reimu-perceptual-candidate-disposition.json',
  );
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
    path.join(options.perceptualRoot, 'reimu-perceptual-consistency.csv'),
    path.join(options.perceptualRoot, 'reimu-perceptual-consistency-summary.json'),
    path.join(options.perceptualRoot, 'reimu-perceptual-candidate-disposition.csv'),
    perceptualDispositionJsonFile,
    ...auditFiles,
    baselineDeltaCsvFile,
    baselineDeltaSummaryFile,
    baselineDeltaPngFile,
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
    path.join(options.referenceRoot, 'reimu-openai-reference-targets.csv'),
    path.join(options.referenceRoot, 'reimu-openai-reference-targets-summary.json'),
    path.join(options.openAiMaterialRoot, 'reimu-openai-material-application.csv'),
    path.join(options.openAiMaterialRoot, 'reimu-openai-material-application-summary.json'),
    openAiTargetFile,
    openAiMaterialFile,
    perceptualFile,
    perceptualZoomFile,
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
  await assertImageMetadata({
    file: baselineDeltaPngFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.baselineDelta,
  });
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
  await assertImageMetadata({
    file: openAiTargetFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.openAiTargets,
  });
  await assertImageMetadata({
    file: openAiMaterialFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.openAiMaterialSheet,
  });
  await assertImageMetadata({
    file: perceptualFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.perceptual,
  });
  await assertImageMetadata({
    file: perceptualZoomFile,
    failures,
    format: 'png',
    ...VISUAL_DIMENSIONS.perceptualZoom,
  });
  const referenceMetrics = await verifyReferenceMetrics(options.referenceRoot, failures);
  const openAiCandidateMetrics = await verifyOpenAiCandidateArtifacts(
    options.openAiCandidateSourceRoot,
    options.openAiCandidateRoot,
    failures,
    referenceMtime,
  );
  const openAiTargetSummaryFile = path.join(options.referenceRoot, 'reimu-openai-reference-targets-summary.json');
  const openAiTargetSummary = JSON.parse(await readFile(openAiTargetSummaryFile, 'utf8'));
  const baselineDeltaSummary = JSON.parse(await readFile(baselineDeltaSummaryFile, 'utf8'));
  const expressionSummary = JSON.parse(
    await readFile(path.join(options.expressionRoot, 'reimu-expression-diff-audit-summary.json'), 'utf8'),
  );
  const qualitySummary = JSON.parse(
    await readFile(path.join(options.qualityRoot, 'reimu-asset-quality-summary.json'), 'utf8'),
  );
  const sleeveGuardSummary = JSON.parse(
    await readFile(path.join(options.qualityRoot, 'reimu-sleeve-guard-summary.json'), 'utf8'),
  );
  const lineSummary = JSON.parse(
    await readFile(path.join(options.lineRoot, 'reimu-line-integrity-summary.json'), 'utf8'),
  );
  const openAiMaterialSummaryFile = path.join(
    options.openAiMaterialRoot,
    'reimu-openai-material-application-summary.json',
  );
  const openAiMaterialSummary = JSON.parse(await readFile(openAiMaterialSummaryFile, 'utf8'));
  const openAiTargetRows = Array.isArray(openAiTargetSummary.reviewRows)
    ? openAiTargetSummary.reviewRows
    : [];
  if (openAiTargetSummary.openAiReferenceCount < EXPECTED_OPENAI_REFERENCE_IMAGES) {
    failures.push(
      `OpenAI target sheet reference rows ${openAiTargetSummary.openAiReferenceCount} < ${EXPECTED_OPENAI_REFERENCE_IMAGES}`,
    );
  }
  if (openAiTargetSummary.currentFrameCount < EXPECTED_REFERENCE_CURRENT_FRAMES) {
    failures.push(
      `OpenAI target sheet current rows ${openAiTargetSummary.currentFrameCount} < ${EXPECTED_REFERENCE_CURRENT_FRAMES}`,
    );
  }
  if (!(Number(openAiMaterialSummary.changedFrameCount) >= OPENAI_SLEEVE_MATERIAL_GATES.minChangedFrames)) {
    failures.push(
      'OpenAI material application changedFrameCount '
      + `${openAiMaterialSummary.changedFrameCount} < ${OPENAI_SLEEVE_MATERIAL_GATES.minChangedFrames}`,
    );
  }
  if (!(
    Number(openAiMaterialSummary.maxOutsideSleeveDiffRatio?.outsideSleeveDiffRatio)
    <= OPENAI_SLEEVE_MATERIAL_GATES.maxOutsideSleeveDiffRatio
  )) {
    failures.push(
      'OpenAI material outside-sleeve diff ratio '
      + `${openAiMaterialSummary.maxOutsideSleeveDiffRatio?.outsideSleeveDiffRatio} `
      + `> ${OPENAI_SLEEVE_MATERIAL_GATES.maxOutsideSleeveDiffRatio}`,
    );
  }
  if (!(
    Number(openAiMaterialSummary.maxAverageWidthDelta?.averageWidthDelta)
    >= OPENAI_SLEEVE_MATERIAL_GATES.minAverageWidthDelta
  )) {
    failures.push(
      'OpenAI material max average sleeve-width delta '
      + `${openAiMaterialSummary.maxAverageWidthDelta?.averageWidthDelta} `
      + `< ${OPENAI_SLEEVE_MATERIAL_GATES.minAverageWidthDelta}`,
    );
  }
  if (!(
    Number(sleeveGuardSummary.maxSideWidthLoss?.sideWidthLoss)
    <= OPENAI_SLEEVE_MATERIAL_GATES.maxSideWidthLoss
  )) {
    failures.push(
      'Reimu tuned sleeve side-width loss '
      + `${sleeveGuardSummary.maxSideWidthLoss?.sideWidthLoss} `
      + `> ${OPENAI_SLEEVE_MATERIAL_GATES.maxSideWidthLoss}`,
    );
  }
  if (baselineDeltaSummary.baselineFrameCount !== 225) {
    failures.push(`baseline delta baselineFrameCount ${baselineDeltaSummary.baselineFrameCount} !== 225`);
  }
  if (baselineDeltaSummary.currentFrameCount !== 225) {
    failures.push(`baseline delta currentFrameCount ${baselineDeltaSummary.currentFrameCount} !== 225`);
  }
  for (const [checkName, passed] of Object.entries(baselineDeltaSummary.checks ?? {})) {
    if (passed !== true) {
      failures.push(`baseline delta check failed: ${checkName}`);
    }
  }
  if (!(baselineDeltaSummary.totals?.transparentNonBlack?.before > 0)
    || baselineDeltaSummary.totals?.transparentNonBlack?.after !== 0) {
    failures.push('baseline delta should prove transparent non-black pixels were cleared');
  }
  if (!(
    baselineDeltaSummary.totals?.internalGapArea?.after
    < baselineDeltaSummary.totals?.internalGapArea?.before
  )) {
    failures.push('baseline delta should prove internal gap area decreased');
  }
  for (const [checkName, passed] of Object.entries(openAiMaterialSummary.checks ?? {})) {
    if (passed !== true) {
      failures.push(`OpenAI material application check failed: ${checkName}`);
    }
  }
  for (const [checkName, passed] of Object.entries(expressionSummary.checks ?? {})) {
    if (passed !== true) {
      failures.push(`expression diff check failed: ${checkName}`);
    }
  }
  if (expressionSummary.comparisonCount !== 225) {
    failures.push(`expression comparisonCount ${expressionSummary.comparisonCount} !== 225`);
  }
  if (
    expressionSummary.maxOutsideExpressionPixels?.outsideExpressionPixels
    > expressionSummary.thresholds?.maxOutsideExpressionPixels
  ) {
    failures.push('expression outside-region pixels exceed threshold');
  }
  if (
    expressionSummary.maxOutsideExpressionRatio?.outsideExpressionRatio
    > expressionSummary.thresholds?.maxOutsideExpressionRatio
  ) {
    failures.push('expression outside-region ratio exceeds threshold');
  }
  const lineChecks = {
    maxUnsupportedEdgeComponentArea: (
      lineSummary.maxUnsupportedEdgeComponentArea?.componentArea
      <= lineSummary.thresholds?.maxUnsupportedEdgeComponentArea
    ),
    maxUnsupportedEdgeComponentCount: (
      lineSummary.maxUnsupportedEdgeComponentCount?.unsupportedEdgeComponentCount
      <= lineSummary.thresholds?.maxUnsupportedEdgeComponentCount
    ),
    maxUnsupportedEdgeComponentSpan: (
      lineSummary.maxUnsupportedEdgeComponentSpan?.componentSpan
      <= lineSummary.thresholds?.maxUnsupportedEdgeComponentSpan
    ),
    maxUnsupportedEdgeInkPixels: (
      lineSummary.maxUnsupportedEdgeInkPixels?.unsupportedEdgeInkPixels
      <= lineSummary.thresholds?.maxUnsupportedEdgeInkPixels
    ),
    maxUnsupportedEdgeInkRatio: (
      lineSummary.maxUnsupportedEdgeInkRatio?.unsupportedEdgeInkRatio
      <= lineSummary.thresholds?.maxUnsupportedEdgeInkRatio
    ),
  };
  for (const [checkName, passed] of Object.entries(lineChecks)) {
    if (passed !== true) {
      failures.push(`line integrity check failed: ${checkName}`);
    }
  }
  const stabilityChecks = {
    maxExpressionAlphaSpread: (
      qualitySummary.stability?.expression?.maxAlphaSpreadRatio?.alphaSpreadRatio
      <= qualitySummary.thresholds?.maxExpressionAlphaSpread
    ),
    maxExpressionCenterSpread: (
      qualitySummary.stability?.expression?.maxCenterSpread?.centerSpread
      <= qualitySummary.thresholds?.maxExpressionCenterSpread
    ),
    maxExpressionHeightSpread: (
      qualitySummary.stability?.expression?.maxHeightSpread?.heightSpread
      <= qualitySummary.thresholds?.maxExpressionHeightSpread
    ),
    maxExpressionWidthSpread: (
      qualitySummary.stability?.expression?.maxWidthSpread?.widthSpread
      <= qualitySummary.thresholds?.maxExpressionWidthSpread
    ),
    maxNeighborAlphaStep: (
      qualitySummary.stability?.neighbor?.maxAlphaStepRatio?.alphaStepRatio
      <= qualitySummary.thresholds?.maxNeighborAlphaStep
    ),
    maxNeighborCenterStep: (
      qualitySummary.stability?.neighbor?.maxCenterStep?.centerStep
      <= qualitySummary.thresholds?.maxNeighborCenterStep
    ),
    maxNeighborHeightStep: (
      qualitySummary.stability?.neighbor?.maxHeightStep?.heightStep
      <= qualitySummary.thresholds?.maxNeighborHeightStep
    ),
    maxNeighborWidthStep: (
      qualitySummary.stability?.neighbor?.maxWidthStep?.widthStep
      <= qualitySummary.thresholds?.maxNeighborWidthStep
    ),
  };
  for (const [checkName, passed] of Object.entries(stabilityChecks)) {
    if (passed !== true) {
      failures.push(`stability check failed: ${checkName}`);
    }
  }
  const perceptualSummaryFile = path.join(options.perceptualRoot, 'reimu-perceptual-consistency-summary.json');
  const perceptualSummary = JSON.parse(await readFile(perceptualSummaryFile, 'utf8'));
  const perceptualDispositions = JSON.parse(await readFile(perceptualDispositionJsonFile, 'utf8'));
  if (perceptualSummary.coverage?.qualityFrames !== 225) {
    failures.push(`perceptual audit qualityFrames ${perceptualSummary.coverage?.qualityFrames} !== 225`);
  }
  if (perceptualSummary.coverage?.sleeveFrames < EXPECTED_REFERENCE_CURRENT_FRAMES) {
    failures.push(
      `perceptual audit sleeveFrames ${perceptualSummary.coverage?.sleeveFrames} < ${EXPECTED_REFERENCE_CURRENT_FRAMES}`,
    );
  }
  if (perceptualSummary.severeIssueCount !== 0) {
    failures.push(`perceptual audit severeIssueCount ${perceptualSummary.severeIssueCount} !== 0`);
  }
  if (perceptualSummary.actionableCandidateCount !== 0) {
    failures.push(
      `perceptual audit actionableCandidateCount ${perceptualSummary.actionableCandidateCount} !== 0`,
    );
  }
  if (!Array.isArray(perceptualDispositions)
    || perceptualDispositions.length !== perceptualSummary.candidateCount) {
    failures.push('perceptual disposition rows do not match candidate count');
  } else if (perceptualDispositions.some((candidate) => candidate.disposition !== 'review-only')) {
    failures.push('perceptual disposition contains actionable candidates');
  }
  for (const [checkName, passed] of Object.entries(perceptualSummary.hardChecks ?? {})) {
    if (passed !== true) {
      failures.push(`perceptual hard check failed: ${checkName}`);
    }
  }

  if (failures.length) {
    throw new Error(`Reimu quality artifact verification failed:\n- ${failures.join('\n- ')}`);
  }

  console.log('Reimu quality artifact verification passed.');
  console.log(JSON.stringify({
    auditSheets: AUDIT_SHEETS.length * AUDIT_MODES.length,
    baselineDeltaImprovedFrames: baselineDeltaSummary.improvedFrameCount,
    baselineDeltaInternalGapReduction: baselineDeltaSummary.totals?.internalGapArea?.reductionRatio,
    baselineDeltaTransparentReduction: baselineDeltaSummary.totals?.transparentNonBlack?.reductionRatio,
    compareSheets: COMPARE_SHEETS.length * COMPARE_MODES.length,
    edgeSheets: 1,
    expressionMaxOutsidePixels: expressionSummary.maxOutsideExpressionPixels?.outsideExpressionPixels,
    expressionMaxOutsideRatio: expressionSummary.maxOutsideExpressionRatio?.outsideExpressionRatio,
    expressionSheets: 1,
    gapSheets: 1,
    lineSheets: 1,
    lineMaxUnsupportedComponentSpan: lineSummary.maxUnsupportedEdgeComponentSpan?.componentSpan,
    noreshapeFrames: noreshapeFrames.length,
    openAiCandidateProcessed: openAiCandidateMetrics.processedCount,
    openAiMaterialChangedFrames: openAiMaterialSummary.changedFrameCount,
    openAiMaterialMaxAverageWidthDelta: openAiMaterialSummary.maxAverageWidthDelta?.averageWidthDelta,
    openAiMaterialMaxOutsideSleeveDiffRatio:
      openAiMaterialSummary.maxOutsideSleeveDiffRatio?.outsideSleeveDiffRatio,
    openAiReferenceImages: referenceMetrics.openAiCount,
    openAiTargetRows: openAiTargetRows.length,
    perceptualActionableCandidates: perceptualSummary.actionableCandidateCount,
    perceptualCandidates: perceptualSummary.candidateCount,
    perceptualZoomSheets: 1,
    publicFrames: sourceFrames.length,
    referenceFrames: referenceMetrics.currentCount,
    referencePngs: referenceMetrics.referencePngCount,
    stabilityMaxNeighborCenterStep: qualitySummary.stability?.neighbor?.maxCenterStep?.centerStep,
    sweepSheets: sweepFiles.length,
  }, null, 2));
}

await main();
