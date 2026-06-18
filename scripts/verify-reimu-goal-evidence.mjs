import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULTS = {
  auditRoot: 'tmp/audit',
  baselineDeltaRoot: 'tmp/baseline-delta',
  compareRoot: 'tmp/compare',
  docsRoot: 'docs',
  edgeRoot: 'tmp/edge-audit',
  expressionRoot: 'tmp/expression-audit',
  gapRoot: 'tmp/gap-audit',
  lineRoot: 'tmp/line-audit',
  noreshapeRoot: 'tmp/noreshape/reimu',
  openAiCandidateRoot: 'tmp/imagegen/reimu-sleeve-candidates/processed',
  openAiMaterialRoot: 'tmp/openai-material-audit',
  outputRoot: 'tmp/goal-audit',
  perceptualRoot: 'tmp/perceptual-audit',
  publicRoot: 'public/characters/reimu',
  qualityRoot: 'tmp/quality-audit',
  referenceRoot: 'tmp/reference-audit',
  sleeveMaterialFile: 'metaassets/fumo/reimu/reimu_openai_sleeve_material_recipe.json',
};

const EXPECTED = {
  auditPngs: 21,
  comparePngs: 12,
  currentReferenceFrames: 150,
  frames: 225,
  lineMaxUnsupportedPixels: 90,
  lineMaxUnsupportedRatio: 0.055,
  minOpenAiReferenceRows: 5,
  minOutputMargin: 32,
  sleeveFrames: 150,
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

async function readJson(file) {
  const fileStat = await pathStat(file);
  if (!fileStat?.isFile()) {
    throw new Error(`Missing required evidence file: ${path.relative(process.cwd(), file)}`);
  }
  return JSON.parse(await readFile(file, 'utf8'));
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
  return files.sort((a, b) => a.localeCompare(b));
}

async function fileExists(file) {
  return Boolean((await pathStat(file))?.isFile());
}

function valueAt(source, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], source);
}

function allObjectValuesTrue(source) {
  return Object.values(source ?? {}).every((value) => value === true);
}

function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

function passRequirement(requirements, id, passed, evidence) {
  requirements.push({
    evidence,
    id,
    status: passed ? 'pass' : 'fail',
  });
}

function lessThanOrEqual(value, limit) {
  return Number(value) <= Number(limit);
}

function greaterThanOrEqual(value, limit) {
  return Number(value) >= Number(limit);
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
    docsRoot: path.resolve(readOption(args, 'docs-root', DEFAULTS.docsRoot)),
    edgeRoot: path.resolve(readOption(args, 'edge-root', DEFAULTS.edgeRoot)),
    expressionRoot: path.resolve(readOption(args, 'expression-root', DEFAULTS.expressionRoot)),
    gapRoot: path.resolve(readOption(args, 'gap-root', DEFAULTS.gapRoot)),
    lineRoot: path.resolve(readOption(args, 'line-root', DEFAULTS.lineRoot)),
    noreshapeRoot: path.resolve(readOption(args, 'noreshape-root', DEFAULTS.noreshapeRoot)),
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
    outputRoot: path.resolve(readOption(args, 'out', DEFAULTS.outputRoot)),
    perceptualRoot: path.resolve(readOption(args, 'perceptual-root', DEFAULTS.perceptualRoot)),
    publicRoot: path.resolve(readOption(args, 'public-root', DEFAULTS.publicRoot)),
    qualityRoot: path.resolve(readOption(args, 'quality-root', DEFAULTS.qualityRoot)),
    referenceRoot: path.resolve(readOption(args, 'reference-root', DEFAULTS.referenceRoot)),
    sleeveMaterialFile: path.resolve(readOption(
      args,
      'sleeve-material-file',
      DEFAULTS.sleeveMaterialFile,
    )),
  };

  const [
    baselineDelta,
    edgeSummary,
    expressionSummary,
    gapSummary,
    lineSummary,
    openAiCandidateSummary,
    openAiMaterialSummary,
    openAiSleeveMaterial,
    openAiTargetSummary,
    perceptualDispositions,
    perceptualSummary,
    qualitySummary,
    residualSummary,
    sleeveGuardSummary,
  ] = await Promise.all([
    readJson(path.join(
      options.baselineDeltaRoot,
      'reimu-baseline-quality-delta-summary.json',
    )),
    readJson(path.join(options.edgeRoot, 'reimu-edge-integrity-summary.json')),
    readJson(path.join(options.expressionRoot, 'reimu-expression-diff-audit-summary.json')),
    readJson(path.join(options.gapRoot, 'reimu-reference-covered-gap-summary.json')),
    readJson(path.join(options.lineRoot, 'reimu-line-integrity-summary.json')),
    readJson(path.join(
      options.openAiCandidateRoot,
      'reimu-openai-sleeve-candidates-summary.json',
    )),
    readJson(path.join(
      options.openAiMaterialRoot,
      'reimu-openai-material-application-summary.json',
    )),
    readJson(options.sleeveMaterialFile),
    readJson(path.join(options.referenceRoot, 'reimu-openai-reference-targets-summary.json')),
    readJson(path.join(options.perceptualRoot, 'reimu-perceptual-candidate-disposition.json')),
    readJson(path.join(options.perceptualRoot, 'reimu-perceptual-consistency-summary.json')),
    readJson(path.join(options.qualityRoot, 'reimu-asset-quality-summary.json')),
    readJson(path.join(options.qualityRoot, 'reimu-residual-defect-summary.json')),
    readJson(path.join(options.qualityRoot, 'reimu-sleeve-guard-summary.json')),
  ]);

  const [auditPngs, comparePngs, noreshapeFrames, publicFrames] = await Promise.all([
    walkFiles(options.auditRoot, '.png'),
    walkFiles(options.compareRoot, '.png'),
    walkFiles(options.noreshapeRoot, '.webp'),
    walkFiles(options.publicRoot, '.webp'),
  ]);
  const requiredDocs = [
    'reimu-quality-process-reconstruction-2026-06-17.md',
    'reimu-quality-recovery-index-2026-06-18.md',
    'reimu-openai-sleeve-candidate-2026-06-18.md',
    'reimu-baseline-delta-audit-2026-06-18.md',
    'reimu-goal-evidence-audit-2026-06-18.md',
  ];
  const docExists = await Promise.all(
    requiredDocs.map((doc) => fileExists(path.join(options.docsRoot, doc))),
  );

  const requirements = [];
  const candidateRows = Array.isArray(openAiCandidateSummary.rows)
    ? openAiCandidateSummary.rows
    : [];
  const dispositionRows = Array.isArray(perceptualDispositions) ? perceptualDispositions : [];
  const linePixelThreshold = valueAt(
    lineSummary,
    'thresholds.maxUnsupportedEdgeInkPixels',
  ) ?? EXPECTED.lineMaxUnsupportedPixels;
  const lineRatioThreshold = valueAt(
    lineSummary,
    'thresholds.maxUnsupportedEdgeInkRatio',
  ) ?? EXPECTED.lineMaxUnsupportedRatio;
  const lineComponentAreaThreshold = valueAt(
    lineSummary,
    'thresholds.maxUnsupportedEdgeComponentArea',
  );
  const lineComponentCountThreshold = valueAt(
    lineSummary,
    'thresholds.maxUnsupportedEdgeComponentCount',
  );
  const lineComponentSpanThreshold = valueAt(
    lineSummary,
    'thresholds.maxUnsupportedEdgeComponentSpan',
  );
  const sleeveThresholds = sleeveGuardSummary.thresholds ?? {};

  passRequirement(
    requirements,
    'process-reconstruction-documents',
    docExists.every(Boolean),
    `docs present ${docExists.filter(Boolean).length}/${requiredDocs.length}`,
  );
  passRequirement(
    requirements,
    'public-and-noreshape-frame-counts',
    publicFrames.length === EXPECTED.frames && noreshapeFrames.length === EXPECTED.frames,
    `public=${publicFrames.length}, noreshape=${noreshapeFrames.length}`,
  );
  passRequirement(
    requirements,
    'visual-audit-contact-sheets',
    auditPngs.length === EXPECTED.auditPngs && comparePngs.length === EXPECTED.comparePngs,
    `audit=${auditPngs.length}, compare=${comparePngs.length}`,
  );
  passRequirement(
    requirements,
    'baseline-delta-hard-checks',
    allObjectValuesTrue(baselineDelta.checks),
    `baseline checks ${JSON.stringify(baselineDelta.checks)}`,
  );
  passRequirement(
    requirements,
    'baseline-artifacts-reduced',
    baselineDelta.totals?.transparentNonBlack?.after === 0
      && baselineDelta.totals?.transparentNonBlack?.before > 0
      && baselineDelta.totals?.internalGapArea?.after
        < baselineDelta.totals?.internalGapArea?.before,
    `transparent ${baselineDelta.totals?.transparentNonBlack?.before}->${baselineDelta.totals?.transparentNonBlack?.after}, gaps ${baselineDelta.totals?.internalGapArea?.before}->${baselineDelta.totals?.internalGapArea?.after}`,
  );
  passRequirement(
    requirements,
    'quality-hard-artifact-zeroes',
    qualitySummary.frameCount === EXPECTED.frames
      && qualitySummary.maxTransparentNonBlack?.transparentNonBlack === 0
      && qualitySummary.maxDetachedArea?.detachedArea === 0
      && qualitySummary.maxDetachedSliverArea?.detachedSliverArea === 0
      && qualitySummary.maxSuspiciousHoleArea?.suspiciousHoleArea === 0
      && qualitySummary.maxLineLikeHoleArea?.lineLikeHoleArea === 0
      && qualitySummary.maxLightInteriorGapArea?.lightInteriorGapArea === 0,
    `frames=${qualitySummary.frameCount}, transparent=${qualitySummary.maxTransparentNonBlack?.transparentNonBlack}, detached=${qualitySummary.maxDetachedArea?.detachedArea}, lineHoles=${qualitySummary.maxLineLikeHoleArea?.lineLikeHoleArea}`,
  );
  passRequirement(
    requirements,
    'no-head-or-leg-clipping-margin',
    qualitySummary.minMargin?.value >= EXPECTED.minOutputMargin,
    `minMargin=${qualitySummary.minMargin?.value}`,
  );
  passRequirement(
    requirements,
    'edge-ghost-and-transparent-residue-zero',
    edgeSummary.frameCount === EXPECTED.frames
      && edgeSummary.maxOrphanWeakAlphaPixels?.orphanWeakAlphaPixels === 0
      && edgeSummary.maxTransparentColoredPixels?.transparentColoredPixels === 0,
    `orphanWeakAlpha=${edgeSummary.maxOrphanWeakAlphaPixels?.orphanWeakAlphaPixels}, transparentColored=${edgeSummary.maxTransparentColoredPixels?.transparentColoredPixels}`,
  );
  passRequirement(
    requirements,
    'line-integrity-within-thresholds',
    lineSummary.frameCount === EXPECTED.frames
      && lessThanOrEqual(
        lineSummary.maxUnsupportedEdgeInkPixels?.unsupportedEdgeInkPixels,
        linePixelThreshold,
      )
      && lessThanOrEqual(
        lineSummary.maxUnsupportedEdgeInkRatio?.unsupportedEdgeInkRatio,
        lineRatioThreshold,
      )
      && lessThanOrEqual(
        lineSummary.maxUnsupportedEdgeComponentArea?.componentArea,
        lineComponentAreaThreshold,
      )
      && lessThanOrEqual(
        lineSummary.maxUnsupportedEdgeComponentCount?.unsupportedEdgeComponentCount,
        lineComponentCountThreshold,
      )
      && lessThanOrEqual(
        lineSummary.maxUnsupportedEdgeComponentSpan?.componentSpan,
        lineComponentSpanThreshold,
      ),
    `pixels=${lineSummary.maxUnsupportedEdgeInkPixels?.unsupportedEdgeInkPixels}/${linePixelThreshold}, ratio=${lineSummary.maxUnsupportedEdgeInkRatio?.unsupportedEdgeInkRatio}/${lineRatioThreshold}, componentSpan=${lineSummary.maxUnsupportedEdgeComponentSpan?.componentSpan}/${lineComponentSpanThreshold}`,
  );
  passRequirement(
    requirements,
    'reference-covered-gaps-zero',
    gapSummary.frameCount === EXPECTED.frames
      && gapSummary.totalReferenceCoveredGapArea === 0
      && gapSummary.totalReferenceCoveredGapCount === 0,
    `area=${gapSummary.totalReferenceCoveredGapArea}, count=${gapSummary.totalReferenceCoveredGapCount}`,
  );
  passRequirement(
    requirements,
    'residual-actionable-defects-zero',
    residualSummary.frameCount === EXPECTED.frames
      && residualSummary.actionableDefectFrameCount === 0
      && allObjectValuesTrue(residualSummary.checks),
    `actionable=${residualSummary.actionableDefectFrameCount}, checks=${JSON.stringify(residualSummary.checks)}`,
  );
  passRequirement(
    requirements,
    'expression-stability-gates',
    expressionSummary.comparisonCount === EXPECTED.frames
      && perceptualSummary.hardChecks?.expressionAlphaDelta === true
      && perceptualSummary.hardChecks?.expressionChangedRatio === true,
    `comparisons=${expressionSummary.comparisonCount}, maxAlpha=${expressionSummary.maxAlphaChangedPixels?.alphaChangedPixels}, maxChangedRatio=${expressionSummary.maxChangedRatio?.changedRatio}`,
  );
  passRequirement(
    requirements,
    'direction-neighbor-stability-gates',
    qualitySummary.frameCount === EXPECTED.frames
      && lessThanOrEqual(
        qualitySummary.stability?.neighbor?.maxAlphaStepRatio?.alphaStepRatio,
        qualitySummary.thresholds?.maxNeighborAlphaStep,
      )
      && lessThanOrEqual(
        qualitySummary.stability?.neighbor?.maxCenterStep?.centerStep,
        qualitySummary.thresholds?.maxNeighborCenterStep,
      )
      && lessThanOrEqual(
        qualitySummary.stability?.neighbor?.maxHeightStep?.heightStep,
        qualitySummary.thresholds?.maxNeighborHeightStep,
      )
      && lessThanOrEqual(
        qualitySummary.stability?.neighbor?.maxWidthStep?.widthStep,
        qualitySummary.thresholds?.maxNeighborWidthStep,
      ),
    `center=${qualitySummary.stability?.neighbor?.maxCenterStep?.centerStep}/${qualitySummary.thresholds?.maxNeighborCenterStep}, alpha=${qualitySummary.stability?.neighbor?.maxAlphaStepRatio?.alphaStepRatio}/${qualitySummary.thresholds?.maxNeighborAlphaStep}`,
  );
  passRequirement(
    requirements,
    'sleeve-guards-within-thresholds',
    sleeveGuardSummary.frameCount === EXPECTED.sleeveFrames
      && lessThanOrEqual(
        sleeveGuardSummary.maxAverageWidthLoss?.averageWidthLoss,
        sleeveThresholds.maxAverageWidthLoss,
      )
      && lessThanOrEqual(
        sleeveGuardSummary.maxSideWidthImbalance?.sideWidthImbalance,
        sleeveThresholds.maxSideWidthImbalance,
      )
      && lessThanOrEqual(
        sleeveGuardSummary.maxSideWidthLoss?.sideWidthLoss,
        sleeveThresholds.maxSideWidthLoss,
      )
      && greaterThanOrEqual(
        sleeveGuardSummary.minCurrentAverageWidthRatio?.currentAverageWidthRatio,
        sleeveThresholds.minAverageWidthRatio,
      )
      && greaterThanOrEqual(
        sleeveGuardSummary.minCurrentSideWidthRatio?.currentSideWidthRatio,
        sleeveThresholds.minSideWidthRatio,
      ),
    `loss=${sleeveGuardSummary.maxSideWidthLoss?.sideWidthLoss}/${sleeveThresholds.maxSideWidthLoss}, imbalance=${sleeveGuardSummary.maxSideWidthImbalance?.sideWidthImbalance}/${sleeveThresholds.maxSideWidthImbalance}`,
  );
  passRequirement(
    requirements,
    'openai-material-recipe-present',
    openAiSleeveMaterial.policy?.controlledMaterialAdoption === true
      && openAiSleeveMaterial.policy?.fullFrameReplacement === false
      && Number(openAiSleeveMaterial.poseTargets?.t?.minSideWidthRatio ?? 0) > 0
      && Number(openAiSleeveMaterial.poseTargets?.y?.minSideWidthRatio ?? 0) > 0
      && Array.isArray(openAiSleeveMaterial.candidateSleeveWidthRatios)
      && openAiSleeveMaterial.candidateSleeveWidthRatios.length >= 1,
    `controlledMaterial=${openAiSleeveMaterial.policy?.controlledMaterialAdoption}, tMin=${openAiSleeveMaterial.poseTargets?.t?.minSideWidthRatio}, yMin=${openAiSleeveMaterial.poseTargets?.y?.minSideWidthRatio}`,
  );
  passRequirement(
    requirements,
    'openai-material-recipe-has-visible-scoped-effect',
    openAiMaterialSummary.changedFrameCount >= 1
      && allObjectValuesTrue(openAiMaterialSummary.checks),
    `changedFrames=${openAiMaterialSummary.changedFrameCount}, maxOutsideSleeveDiffRatio=${openAiMaterialSummary.maxOutsideSleeveDiffRatio?.outsideSleeveDiffRatio}`,
  );
  passRequirement(
    requirements,
    'openai-reference-guidance-present',
    openAiTargetSummary.openAiReferenceCount >= EXPECTED.minOpenAiReferenceRows
      && openAiTargetSummary.currentFrameCount >= EXPECTED.currentReferenceFrames
      && openAiTargetSummary.directAdoptionBlocked === true,
    `openAiReferences=${openAiTargetSummary.openAiReferenceCount}, currentRows=${openAiTargetSummary.currentFrameCount}, directAdoptionBlocked=${openAiTargetSummary.directAdoptionBlocked}`,
  );
  passRequirement(
    requirements,
    'openai-candidates-materialized-through-local-postprocess',
    openAiCandidateSummary.candidateCount >= 1
      && openAiCandidateSummary.processedCount === openAiCandidateSummary.candidateCount
      && candidateRows.every((row) => row.status === 'processed')
      && candidateRows.every((row) => row.controlledMaterialAllowed === true)
      && candidateRows.every((row) => (
        row.materialization?.adoptionMode === 'sleeve-mask-and-proportion-material'
      ))
      && candidateRows.every((row) => row.materialization?.preserveIdentityAndGrid === true)
      && candidateRows.every((row) => row.directAdoptionAllowed === false),
    `candidates=${openAiCandidateSummary.candidateCount}, processed=${openAiCandidateSummary.processedCount}, materialAllowed=${candidateRows.filter((row) => row.controlledMaterialAllowed).length}, directFullFrameAllowed=${candidateRows.filter((row) => row.directAdoptionAllowed).length}`,
  );
  passRequirement(
    requirements,
    'perceptual-candidate-gate',
    perceptualSummary.coverage?.qualityFrames === EXPECTED.frames
      && perceptualSummary.coverage?.sleeveFrames >= EXPECTED.sleeveFrames
      && perceptualSummary.severeIssueCount === 0
      && perceptualSummary.actionableCandidateCount === 0
      && perceptualSummary.reviewOnlyCandidateCount === perceptualSummary.candidateCount
      && dispositionRows.length === perceptualSummary.candidateCount
      && dispositionRows.every((row) => row.disposition === 'review-only')
      && dispositionRows.every((row) => (
        Array.isArray(row.gateResults) && row.gateResults.every((gate) => gate.passed === true)
      ))
      && allObjectValuesTrue(perceptualSummary.hardChecks),
    `candidates=${perceptualSummary.candidateCount}, actionable=${perceptualSummary.actionableCandidateCount}, severe=${perceptualSummary.severeIssueCount}`,
  );

  const failed = requirements.filter((requirement) => requirement.status !== 'pass');
  const summary = {
    automatedEvidencePassed: failed.length === 0,
    checkedAt: new Date().toISOString(),
    caveat: 'This is an automated evidence gate; final product-level art acceptance still depends on visual review of the generated contact sheets.',
    failedRequirementCount: failed.length,
    passedRequirementCount: requirements.length - failed.length,
    requirements,
    totalRequirementCount: requirements.length,
  };
  const csv = [
    ['id', 'status', 'evidence'].join(','),
    ...requirements.map((requirement) => [
      csvCell(requirement.id),
      csvCell(requirement.status),
      csvCell(requirement.evidence),
    ].join(',')),
  ].join('\n');

  await mkdir(options.outputRoot, { recursive: true });
  await writeFile(
    path.join(options.outputRoot, 'reimu-goal-evidence-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    path.join(options.outputRoot, 'reimu-goal-evidence.csv'),
    `${csv}\n`,
  );

  console.log('Reimu goal evidence verification complete.');
  console.log(JSON.stringify({
    automatedEvidencePassed: summary.automatedEvidencePassed,
    failedRequirementCount: summary.failedRequirementCount,
    passedRequirementCount: summary.passedRequirementCount,
    totalRequirementCount: summary.totalRequirementCount,
  }, null, 2));

  if (failed.length) {
    throw new Error(`Reimu goal evidence verification failed:\n- ${
      failed.map((requirement) => `${requirement.id}: ${requirement.evidence}`).join('\n- ')
    }`);
  }
}

await main();
