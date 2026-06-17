# Reimu Lossless Quality Report - 2026-06-18

This report records the quality delta from the pre-lossless Reimu assets to the current product-quality Reimu assets.

## Scope

- Before commit: `8d06789998b42d3c6ef11d9ab07a9812df569f8d`
- After commit: `6a2c8f0fba340149f23f0401c83d9af43853eaa7`
- Character: `reimu`
- Frame count: 225 WebP frames
- Current shipped output: `public/characters/reimu`
- Rebuilt review artifacts:
  - `tmp/audit`
  - `tmp/compare`
  - `tmp/issues`
  - `tmp/inspection`
  - `tmp/reference-audit`

The after state uses lossless WebP for Reimu so transparent pixels decode with black RGB. This specifically targets invisible RGB residue that can later show up as resize/filter edge bleed or transparent inner contour artifacts.

## Before/After Metrics

Both sides were measured with `tools/audit-character-assets.mjs`. The before assets were extracted from `HEAD^` into `tmp/before-lossless/public/characters/reimu`.

| Metric | Before max | After max | Before sum | After sum | Positive frames before -> after |
| --- | ---: | ---: | ---: | ---: | ---: |
| `transparentNonBlack` | 4217 (`cy_01/r2c2.webp`) | 0 (`ce_01/r0c0.webp`) | 567074 | 0 | 225 -> 0 |
| `weakAlphaPixels` | 195 (`cy_01/r0c3.webp`) | 185 (`ct_01/r0c3.webp`) | 23755 | 23585 | 225 -> 225 |
| `internalGapArea` | 1421 (`cy_01/r2c2.webp`) | 1044 (`ct_01/r0c3.webp`) | 8052 | 6608 | 20 -> 21 |
| `suspiciousHoleArea` | 0 (`ce_01/r0c0.webp`) | 0 (`ce_01/r0c0.webp`) | 0 | 0 | 0 -> 0 |
| `detachedArea` | 0 (`ce_01/r0c0.webp`) | 0 (`ce_01/r0c0.webp`) | 0 | 0 | 0 -> 0 |
| `detachedSliverArea` | 0 (`ce_01/r0c0.webp`) | 0 (`ce_01/r0c0.webp`) | 0 | 0 | 0 -> 0 |

## Verification

Commands run after the lossless regeneration:

```bash
npm run quality:reimu
npm run check
```

Browser checks:

- Local preview: `http://127.0.0.1:4186/talk.html?avatar=reimu&pose=t&filter=natural&hair=0F766E&hairMix=0.65&eyes=A855F7&eyeMix=0.85&verify=lossless-local-8d06789-plus`
- Deployed Pages: `https://nozomiidev.github.io/TomaPages/talk.html?avatar=reimu&pose=t&filter=natural&hair=0F766E&hairMix=0.65&eyes=A855F7&eyeMix=0.85&verify=lossless-deployed-6a2c8f0`

Observed browser evidence:

- 225 Reimu images loaded
- 0 broken images
- 0 console errors
- no visible head/leg clipping in the checked Talk pose

GitHub Pages deployment:

- Workflow run: `27713549046`
- Conclusion: `success`

## OpenAI Reference Continuity

Recovered OpenAI image-generation/editing outputs remain part of the process as proportion and mask references through `tmp/reference-audit`. The shipped grid is still generated through deterministic slicing and post-processing so canvas, identity, line weight, and 5x5 pose invariants stay stable.
