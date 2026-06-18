# Reimu Expression Stability Audit - 2026-06-18

This note records the expression-frame stabilization pass added after the full sweep and edge-integrity audits. It targets visible flicker during mouth and blink changes.

## Problem

Before this pass, Reimu expression sheets (`om/ce`, `ot/ct`, `oy/cy`) were valid frames, but same-pose expression swaps still changed large parts of the body, bow, sleeves, and silhouette. The expression diff audit made that visible:

```text
before maxChangedPixels = 45472
before maxAlphaChangedPixels = 13948
before maxChangedRatio = 0.6778
```

That kind of full-body delta is visually plausible frame-by-frame but creates flicker when the avatar talks or blinks.

## Pipeline Change

`tools/slice-fumo-assets.mjs` now stabilizes Reimu expression frames after the sleeve reshape pass:

- `om_01` and `ce_01` use `pl_01` as the stable body reference.
- `ot_01` and `ct_01` use `pt_01` as the stable body reference.
- `oy_01` and `cy_01` use `py_01` as the stable body reference.
- Only a feathered face ellipse is blended from the target expression frame.
- The final WebP frame is re-sanitized through the same alpha cleanup path as other generated frames.

This avoids the rejected separate-overlay approach: the shipped artifacts remain ordinary generated WebP frames.

## Current Result

Latest local run:

```bash
npm.cmd run build:assets:fumo -- --characters reimu --lossless --quality 100
npm.cmd run audit:assets:expression
npm.cmd run verify:reimu:quality
npm.cmd run check
```

Summary:

```text
comparisonCount = 225
after maxChangedPixels = 10049
after maxAlphaChangedPixels = 950
after maxChangedRatio = 0.1866
maxOutsideExpressionPixels = 914 / 1100
maxOutsideExpressionRatio = 0.1023 / 0.11
```

The expression diff review sheet is generated at:

```text
tmp/expression-audit/reimu-expression-diff-audit.png
```

The red heatmap now concentrates around the face and hair instead of covering the entire body. The outside-region ratio is measured against the smaller final changed region, so the absolute outside-pixel cap remains the primary guard. This gives the runtime a much more stable body silhouette during lip-sync and blink transitions.

## Guard Updates

The sleeve guard now compares stabilized expression sheets against their stable body baseline:

```text
ot_01, ct_01 -> pt_01
oy_01, cy_01 -> py_01
```

The average sleeve-width loss cap is now `0.07`; side loss, side imbalance, and absolute minimum-width gates remain strict. The edge-integrity gate still requires zero orphan weak-alpha pixels and zero transparent colored residue.

The expression diff audit also reuses the same face-ellipse blend region as `tools/slice-fumo-assets.mjs`. `verify:reimu:quality`, `verify:reimu:goal`, and the perceptual hard checks now fail if mouth/blink changes leak too far outside that region, preventing a future regression back to full-body expression flicker.
