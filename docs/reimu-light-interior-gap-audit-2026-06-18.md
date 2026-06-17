# Reimu Light Interior Gap Audit - 2026-06-18

This note records the Reimu pass that targets small transparent holes inside light sleeve/cloth areas. It is intentionally narrower than the general internal-gap audit: larger dark gaps around the skirt, legs, and pose silhouette can be legitimate negative space and are still reviewed separately.

## Problem

The issue overlay still showed several small closed transparent regions inside or next to Reimu's white sleeves. These read as broken sleeve paint or stray inner transparent contours, especially on `cy_01/r0c4.webp`, `oy_01/r0c4.webp`, `cy_01/r2c1.webp`, `oy_01/r2c1.webp`, and `cy_01/r1c2.webp`.

## Pipeline Change

`tools/slice-fumo-assets.mjs` now runs a constrained `fillLightInteriorAlphaGaps` pass after the existing alpha sanitization, detached-component bridging, and line-hole filling.

The pass only fills a closed transparent component when all of these are true:

- the component is internal and does not touch the canvas edge
- the component is small enough to be a sleeve/cloth defect, not a large pose cutout
- enough neighboring visible pixels match a light cloth color range
- the fill color is sampled from nearby light cloth pixels

This keeps the production output as ordinary generated WebP frames. It does not add separate sleeve overlays or runtime filters.

## Guardrail

`tools/audit-character-assets.mjs` now computes `lightInteriorGapArea` and fails by default if any Reimu frame has a detected light-cloth internal gap:

```text
maxLightInteriorGapArea = 0
```

## Evidence

Before this pass, the internal-hole scan had 14 closed-hole components totaling 7340 pixels. The white-sleeve candidates removed by this pass were:

```text
cy_01/r0c4.webp area 615
oy_01/r0c4.webp area 615
cy_01/r2c1.webp area 303
oy_01/r2c1.webp area 303
cy_01/r1c2.webp area 171
```

After regeneration and audit, the scan has 9 closed-hole components totaling 5333 pixels, and `maxLightInteriorGapArea` is 0. The remaining larger holes are dark/skirt or pose negative-space candidates rather than light-sleeve defects.

Verified commands:

```bash
npm.cmd run quality:reimu
npm.cmd run check
```

Browser verification:

```text
http://127.0.0.1:4198/talk.html?avatar=reimu&pose=y&verify=light-gap-local
225 Reimu frames loaded
0 broken Reimu images
0 console errors
T and Y keyboard pose switches verified
```

Relevant local artifacts:

```text
tmp/issues/reimu-issue-overlay.png
tmp/sweep/reimu-full-sweep-pink.png
tmp/screenshots/reimu-light-gap-local.png
```
