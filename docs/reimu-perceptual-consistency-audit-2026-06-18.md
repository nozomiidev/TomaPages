# Reimu Perceptual Consistency Audit - 2026-06-18

This note records the Reimu perceptual review gate added after the OpenAI reference target pass.

## Purpose

The earlier audits prove alpha integrity, transparent RGB cleanup, line support, sleeve guard limits, and regenerated frame counts. They do not by themselves provide one review surface for drawing-level consistency across all 225 frames.

`tools/audit-reimu-perceptual-consistency.mjs` fills that gap by combining the highest-risk visual signals into one candidate sheet:

- current frame vs. no-reshape frame vs. diff heat
- original internal transparent gaps
- supported weak alpha review candidates
- 5x5 neighbor shape jumps
- expression diff candidates
- T/Y sleeve guard near-threshold candidates
- OpenAI sleeve target low-ratio review candidates
- a larger 1024x1800 current/no-reshape candidate zoom sheet for manual visual acceptance

This is not a separate sleeve-overlay approach and it does not ship generated OpenAI frames directly. It uses the existing regenerated WebP frames and recovered OpenAI sleeve measurements as audit inputs.

## Outputs

```text
tmp/perceptual-audit/reimu-perceptual-consistency.png
tmp/perceptual-audit/reimu-perceptual-candidate-zooms.png
tmp/perceptual-audit/reimu-perceptual-consistency.csv
tmp/perceptual-audit/reimu-perceptual-consistency-summary.json
```

The PNG sheet is a 12-candidate review board. Each candidate is shown as:

```text
current / no-reshape / diff heat
```

The candidate zoom sheet uses the same candidate ordering and shows larger crop-paired tiles:

```text
current / no-reshape
```

## Latest Metrics

Latest local run:

```text
qualityFrames = 225
sleeveFrames = 150
expressionComparisons = 225
openAiReferenceRows = 7
openAiTargetRows = 19
perceptualCandidates = 12
perceptualZoomSheets = 1
severeIssueCount = 0
```

Current top review candidates include:

```text
pt_01/r0c1.webp: original internal gap 914
ct_01/r1c2.webp: sleeve side loss 0.0976, low sleeve side ratio 0.2121
ot_01/r1c2.webp: sleeve side loss 0.0976, low sleeve side ratio 0.2121
oy_01/r3c2.webp: sleeve side loss 0.1021
cy_01/r0c2.webp: supported weak alpha 252, expression changed ratio 0.2451, OpenAI sleeve target review 0.098
```

These are review candidates, not automatic failures. The hard gate fails only if existing severe-quality checks regress or if the expression/coverage limits are exceeded.

## Verification

`quality:reimu` now runs the perceptual audit after residual-defect classification:

```bash
npm.cmd run audit:assets:perceptual
npm.cmd run verify:reimu:quality
npm.cmd run quality:reimu
```

`scripts/verify-reimu-quality-artifacts.mjs` now requires the perceptual PNG/CSV/summary and the candidate zoom PNG, verifies both PNG dimensions, requires `qualityFrames = 225`, requires at least 150 sleeve frames, and requires `severeIssueCount = 0`.

## Status

This strengthens the completion evidence for "product-level quality" because the remaining drawing-level review points are now machine-collected, visible, and freshness-checked. The active goal still remains open until the broader visual acceptance is proven, but future regressions in this review surface will now be caught by the Reimu quality pass.
