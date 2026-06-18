# Reimu Baseline Delta Audit - 2026-06-18

This note records the recovered before/after comparison between the local pre-polish Reimu baseline and the current shipped Reimu WebP frames.

## Scope

The comparison script is:

```bash
npm.cmd run audit:assets:baseline-delta
```

It is also part of the full Reimu evidence pipeline:

```bash
npm.cmd run quality:reimu
```

It compares:

```text
baseline: tmp/before-lossless/public/characters/reimu
current:  public/characters/reimu
```

Both sides contain 225 WebP frames. The baseline lives in `tmp/`, so this audit is intentionally a local recovery/evidence tool rather than a GitHub Actions gate. The result is consumed by `npm.cmd run verify:reimu:quality` and `npm.cmd run verify:reimu:goal` as one of the requirement-level recovery checks.

## Output Artifacts

```text
tmp/baseline-delta/reimu-baseline-quality-delta.csv
tmp/baseline-delta/reimu-baseline-quality-delta-summary.json
tmp/baseline-delta/reimu-baseline-quality-delta.png
```

The PNG summary is a compact chart for reviewing metric totals before and after.
`verify:reimu:quality` requires all three files to be present, non-empty, fresh relative to the regenerated public/no-reshape frames, and requires the PNG to stay at `960x408` so the before/after review artifact cannot silently disappear or drift format.

## Latest Result

Latest run:

```bash
npm.cmd run audit:assets:baseline-delta
```

Result: pass.

Key totals:

| Metric | Baseline | Current | Delta | Reduction |
| --- | ---: | ---: | ---: | ---: |
| `transparentNonBlack` | 567074 | 0 | -567074 | 100.00% |
| `weakAlphaPixels` | 23755 | 0 | -23755 | 100.00% |
| `internalGapArea` | 8052 | 914 | -7138 | 88.65% |
| `detachedArea` | 0 | 0 | 0 | 100.00% |
| `detachedSliverArea` | 0 | 0 | 0 | 100.00% |
| `lineLikeHoleArea` | 0 | 0 | 0 | 100.00% |
| `lightInteriorGapArea` | 0 | 0 | 0 | 100.00% |

Weak alpha pixels are now normalized from `23755` to `0`. This removes the last low-alpha ghost-contour class instead of merely treating supported antialiasing as acceptable.

The only current internal-gap regression by frame is `pt_01/r0c1.webp`, `822 -> 914`; the total internal-gap area still drops by `7138` px and the maximum current frame remains within `maxInternalGapArea = 1800`.

## Hard Checks

The baseline-delta script currently requires:

```text
expectedBaselineFrames = 225
expectedCurrentFrames = 225
transparentNonBlack = cleared to 0
weakAlphaPixels = cleared to 0
detachedArea = not introduced
detachedSliverArea = not introduced
lineLikeHoleArea = not worse
lightInteriorGapArea = not worse
internalGapArea = total reduced
internalGapArea = current max within 1800
```

This keeps the audit focused on product-visible defects while preventing a return of weak-alpha contour residue.
