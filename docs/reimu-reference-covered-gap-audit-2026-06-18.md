# Reimu Reference-Covered Gap Audit - 2026-06-18

This pass targets internal transparent holes that were introduced by deterministic post-processing. The rule is conservative: if the final frame has a closed transparent gap, but the same frame before Reimu pose reshaping/expression stabilization has visible pixels covering that gap, the production frame should reuse those original same-frame pixels instead of leaving a new transparent contour.

## Problem

After the light-sleeve cleanup, the remaining issue overlay still showed current-only transparent holes around hair, sleeves, and lower body. Comparing against `tmp/noreshape/reimu` showed that most of those holes were not present in the pre-reshape frame.

Pre-fix reference-covered candidates:

```text
py_01/r2c2.webp 966
ct_01/r0c1.webp 914
ot_01/r0c1.webp 914
cy_01/r2c2.webp 584
py_01/r2c1.webp 452
oy_01/r2c2.webp 368
ct_01/r3c3.webp 167
py_01/r2c3.webp 54
```

Total current-only reference-covered gap area: `4419 px`.

## Pipeline Change

`tools/slice-fumo-assets.mjs` now runs `fillReferenceCoveredInteriorGaps`:

- after Reimu T/Y sleeve reshaping, using the same frame before sleeve reshaping as the reference
- after Reimu expression stabilization, using the expression frame before body stabilization as the reference

The fill is baked into the generated WebP frame. It does not add a runtime overlay and does not ship separate sleeve assets.

## Guardrail

`tools/audit-reimu-reference-covered-gaps.mjs` compares:

```text
public/characters/reimu
tmp/noreshape/reimu
```

It fails by default when any internal transparent gap in the shipped frame is sufficiently covered by the no-reshape reference:

```text
maxReferenceCoveredGapArea = 0
```

## Result

After regeneration:

```text
reference-covered internal gaps: 0 gaps / 0 px
issue overlay candidates: 12 -> 5
maxInternalGapArea: 966 -> 914
```

The remaining internal gap is `pt_01/r0c1.webp`, which is also present in the no-reshape frame and therefore is treated as original pose negative space rather than a post-processing artifact.

Verified commands:

```bash
npm.cmd run quality:reimu
npm.cmd run audit:assets:reference-gaps
npm.cmd run verify:reimu:quality
```

Relevant local artifacts:

```text
tmp/gap-audit/reimu-reference-covered-gap-overlay.png
tmp/issues/reimu-issue-overlay.png
tmp/compare
```
