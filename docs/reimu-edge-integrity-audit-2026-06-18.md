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

This complements the existing transparent-RGB, detached-fragment, hole, sleeve, full-sweep, and browser checks. Weak alpha is allowed only when it is part of a normal anti-aliased edge.

## Current Result

Latest local run:

```bash
npm.cmd run audit:assets:edge
npm.cmd run verify:reimu:quality
```

Summary:

```text
frameCount = 225
maxWeakAlphaPixels = 302 at oy_01/r0c2.webp
maxEdgeWeakAlphaPixels = 302 at oy_01/r0c2.webp
maxOrphanWeakAlphaPixels = 0
maxTransparentColoredPixels = 0
```

The visual overlay is generated at:

```text
tmp/edge-audit/reimu-edge-integrity-overlay.png
```

Yellow pixels in the overlay are supported weak edge alpha. Magenta would indicate orphan weak alpha, and red would indicate transparent colored residue. The current overlay contains no magenta or red issue pixels.

## Quality Meaning

This proves that the remaining weak alpha pixels are attached to the visible silhouette and are not floating semi-transparent contour debris. It also provides a hard regression gate for the "transparent inner contour" failure mode that can otherwise be easy to miss on pale backgrounds.
