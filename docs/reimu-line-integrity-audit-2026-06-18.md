# Reimu Line Integrity Audit - 2026-06-18

This pass adds an automated contour-line sanity check for the full 225-frame Reimu set.

## Problem

The earlier alpha audits prove that there are no detached alpha fragments, transparent RGB residue, line-like transparent holes, or reference-covered post-processing gaps. They do not directly answer whether a visible outer contour is missing from a bright edge.

## Guard

`tools/audit-reimu-line-integrity.mjs` scans every shipped Reimu WebP frame and looks at alpha-edge pixels. For each edge pixel, it checks whether an ink-like contour or trim pixel exists nearby.

It also groups unsupported edge pixels into connected components. This catches a different class of failure: a small total number of unsupported pixels could still be bad if they form one long visible contour break.

The audit writes:

```text
tmp/line-audit/reimu-line-integrity.csv
tmp/line-audit/reimu-line-integrity-summary.json
tmp/line-audit/reimu-line-integrity-overlay.png
```

Default hard caps:

```text
maxUnsupportedEdgeInkPixels = 90
maxUnsupportedEdgeInkRatio = 0.055
maxUnsupportedEdgeComponentArea = 48
maxUnsupportedEdgeComponentCount = 12
maxUnsupportedEdgeComponentSpan = 42
expectedFrames = 225
```

## Result

Latest line-integrity summary:

```json
{
  "frameCount": 225,
  "maxUnsupportedEdgeComponentArea": {
    "file": "cy_01/r2c1.webp",
    "componentArea": 36,
    "componentSpan": 36
  },
  "maxUnsupportedEdgeComponentCount": {
    "file": "cy_01/r0c3.webp",
    "unsupportedEdgeComponentCount": 9
  },
  "maxUnsupportedEdgeComponentSpan": {
    "file": "cy_01/r2c1.webp",
    "componentArea": 36,
    "componentSpan": 36
  },
  "maxUnsupportedEdgeInkPixels": {
    "file": "cy_01/r0c2.webp",
    "unsupportedEdgeInkPixels": 62,
    "unsupportedEdgeInkRatio": 0.0415
  },
  "maxUnsupportedEdgeInkRatio": {
    "file": "cy_01/r0c2.webp",
    "unsupportedEdgeInkPixels": 62,
    "unsupportedEdgeInkRatio": 0.0415
  }
}
```

The top overlay candidates are bright hands, white sleeve edges, and similar light contour regions rather than broken floating outlines.

Verified commands:

```bash
npm.cmd run audit:assets:lines
npm.cmd run audit:assets:residuals
```
