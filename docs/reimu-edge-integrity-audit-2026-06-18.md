# Reimu Edge Integrity Audit - 2026-06-18

This note records the deterministic edge-integrity pass added after the full 225-frame visual sweep. It targets a narrower class of artifacts that the broad silhouette audit did not explicitly separate: low-alpha ghost contours and colored pixels hidden inside fully transparent areas.

## What It Checks

`npm run audit:assets:edge` scans all shipped Reimu WebP frames in `public/characters/reimu`.

For each frame it records:

- weak alpha pixels (`0 < alpha < 32`)
- weak alpha pixels supported by nearby strong body alpha (`alpha >= 32` within a 2px radius)
- orphan weak alpha pixels not supported by strong body alpha
- fully transparent pixels that still carry non-black RGB data

The hard gates are intentionally strict:

```text
expectedFrames = 225
maxOrphanWeakAlpha = 0
maxTransparentColored = 0
```

This complements the existing transparent-RGB, detached-fragment, hole, sleeve, full-sweep, and browser checks. The current production pass normalizes weak alpha to zero, so the supported-edge distinction remains useful for diagnostics but the shipped Reimu frames now pass with no weak-alpha pixels at all.

## Current Result

Latest local run:

```bash
npm.cmd run audit:assets:edge
npm.cmd run verify:reimu:quality
```

Summary:

```text
frameCount = 225
maxWeakAlphaPixels = 0
maxEdgeWeakAlphaPixels = 0
maxOrphanWeakAlphaPixels = 0
maxTransparentColoredPixels = 0
```

The visual overlay is generated at:

```text
tmp/edge-audit/reimu-edge-integrity-overlay.png
```

Yellow pixels in the overlay are supported weak edge alpha. Magenta would indicate orphan weak alpha, and red would indicate transparent colored residue. The current overlay contains no yellow, magenta, or red weak-alpha/residue issue pixels.

## Quality Meaning

This proves that the remaining shipped frames no longer contain low-alpha ghost contour pixels or transparent colored residue. It also provides a hard regression gate for the "transparent inner contour" failure mode that can otherwise be easy to miss on pale backgrounds.
