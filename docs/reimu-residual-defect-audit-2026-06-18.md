# Reimu Residual Defect Audit - 2026-06-18

This pass separates actionable drawing defects from review-only residuals after the reference-covered-gap cleanup.

## Problem

`tmp/issues/reimu-issue-overlay.png` intentionally still shows review candidates such as supported edge antialiasing and original internal negative space. That is useful for human inspection, but it can make the current state look less finished than it is.

The goal of this pass is to make the distinction machine-checkable:

- actionable residual defects must be zero
- supported weak alpha is allowed only when the edge audit proves it is not orphaned
- internal transparent gaps are allowed only when the reference-covered-gap audit proves they are not post-processing holes

## New Guard

`tools/audit-reimu-residual-defects.mjs` reads the current audit outputs:

```text
tmp/quality-audit/reimu-asset-quality.csv
tmp/quality-audit/reimu-asset-quality-summary.json
tmp/edge-audit/reimu-edge-integrity-summary.json
tmp/gap-audit/reimu-reference-covered-gap-summary.json
tmp/line-audit/reimu-line-integrity-summary.json
tmp/quality-audit/reimu-sleeve-guard-summary.json
```

It writes:

```text
tmp/quality-audit/reimu-residual-defect-summary.json
```

The default hard checks require:

```text
actionableDefectFrameCount = 0
detachedArea = 0
detachedSliverArea = 0
lightInteriorGapArea = 0
lineLikeHoleArea = 0
orphanWeakAlpha = 0
referenceCoveredGapArea = 0
referenceCoveredGapCount = 0
suspiciousHoleArea = 0
transparentColoredPixels = 0
transparentNonBlack = 0
lineIntegrityPixels = true
lineIntegrityRatio = true
lineIntegrityComponentArea = true
lineIntegrityComponentCount = true
lineIntegrityComponentSpan = true
```

## Result

Latest residual summary:

```json
{
  "actionableDefectFrameCount": 0,
  "frameCount": 225,
  "originalInternalGapReviewFrameCount": 1,
  "topOriginalInternalGaps": [
    {
      "file": "pt_01/r0c1.webp",
      "internalGapArea": 914
    }
  ],
  "sleeveGuardHeadroom": {
    "averageWidthLoss": 0.0094,
    "sideWidthImbalance": 0.027,
    "sideWidthLoss": 0.0179
  },
  "lineIntegrityHeadroom": {
    "unsupportedEdgeInkPixels": 24,
    "unsupportedEdgeInkRatio": 0.0083,
    "unsupportedEdgeComponentArea": 12,
    "unsupportedEdgeComponentCount": 2,
    "unsupportedEdgeComponentSpan": 6
  }
}
```

The single internal-gap review candidate is the `pt_01/r0c1.webp` pose negative space that remains after the no-reshape comparison. It is not a reference-covered post-processing hole.

Verified commands:

```bash
npm.cmd run audit:assets:lines
npm.cmd run audit:assets:residuals
npm.cmd run verify:reimu:quality
npm.cmd run test
npm.cmd run lint
```
