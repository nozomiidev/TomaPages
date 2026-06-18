# Reimu OpenAI Reference Integration - 2026-06-18

This note records the recoverable OpenAI-assisted asset workflow for Reimu. It is based on current workspace artifacts, not hidden reasoning.

## Principle

OpenAI image outputs are allowed in the Reimu recovery pipeline, but they are not shipped directly unless they survive deterministic post-processing and the same 225-frame quality gates as the source-sheet output.

The product asset invariants remain:

- preserve the existing Reimu face, head scale, body scale, canvas, and 5x5 direction grid
- preserve transparent WebP output at 512x512
- preserve motion stability between neighboring grid frames
- avoid separate sleeve overlays or doubled assets
- avoid direct adoption of one-off generated full-body images that drift in line weight, framing, or identity

## Recovered Inputs

OpenAI-generated references are available through:

```text
metaassets/fumo/reimu/reimu_sleeve_reference_imagegen.png
metaassets/fumo/reimu/reimu_sleeve_reference_imagegen_tpose_20260617.png
tmp/recovery/reimu-quality-2026-06-17/openai-generated
tmp/imagegen/reimu-sleeve-candidates
```

The `tmp/imagegen/reimu-sleeve-candidates` directory is optional local evidence. It is used when a fresh OpenAI image-model edit candidate exists locally, and ignored on clean checkouts where that directory is absent.

`tools/analyze-reimu-reference-assets.mjs` analyzes these references together with the current T/Y Reimu frames. It extracts foreground and sleeve-region masks, then writes:

```text
tmp/reference-audit/reimu-reference-metrics.csv
tmp/reference-audit/reimu-reference-metrics.json
tmp/reference-audit/*-foreground.png
tmp/reference-audit/*-sleeves.png
```

`tools/render-reimu-openai-reference-targets.mjs` then renders a controlled-edit target sheet:

```text
tmp/reference-audit/reimu-openai-reference-targets.png
tmp/reference-audit/reimu-openai-reference-targets.csv
tmp/reference-audit/reimu-openai-reference-targets-summary.json
```

The target sheet keeps OpenAI reference masks and the lowest current Reimu sleeve-ratio frames in the same visual review surface. This is intentionally a review surface, not an automatic replacement pass.

## Current Metrics

Latest regenerated reference audit:

```text
OpenAI references: 6 when the local sleeve candidate exists, otherwise 5 recovered/reference images
Current T/Y frames: 150
OpenAI target rows: 18 with the local sleeve candidate, otherwise 17
OpenAI sleeve width ratio range: 0.144 - 0.294
Current sleeve width ratio range: 0.098 - 0.260
Current low sleeve-ratio review frames at <= 0.18: 22
```

Useful OpenAI reference readings:

```text
reimu_sleeve_reference_imagegen.png: 0.222
ig_0c9f715f97270ac3016a32773cb8088191af4774c1cd0b94a2.png: 0.222
tmp/imagegen/reimu-sleeve-candidates/reimu-cy-r0c2-openai-sleeve-edit-raw.png: 0.231
ig_03eb4ba73c27a25f016a3264fc9cf48196923471f62f9ebad3.png: 0.233
ig_03eb4ba73c27a25f016a3261b063788196aff9f2d64c56e2d7.png: 0.294
```

The `0.294` reference is useful as an upper-bound broad-sleeve target, but it is too large for direct adoption because it risks contradicting the shipped `p` pose family.

The local `0.231` candidate was generated from the current `cy_01/r0c2.webp` target and measured as a useful moderate-sleeve reference, but it is not directly shippable because the image-model output drifts in face, bow scale, whole-body scale, and canvas framing.

`tools/prepare-reimu-openai-sleeve-candidates.mjs` turns local green-screen OpenAI outputs into preprocessing material:

```text
tmp/imagegen/reimu-sleeve-candidates/processed/*-alpha.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-normalized.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-projected-sleeve-guide.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-drift-heat.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-preprocess-sheet.png
```

The latest local candidate has `nonSleeveDrift.driftRatio = 0.7008`, so the candidate remains a controlled sleeve guide rather than a replacement frame.

Lowest current-frame sleeve ratio review candidates:

```text
cy_01/r0c2.webp: 0.098
py_01/r0c2.webp: 0.103
oy_01/r0c2.webp: 0.103
oy_01/r2c2.webp: 0.123
py_01/r2c2.webp: 0.127
py_01/r2c1.webp: 0.131
oy_01/r2c1.webp: 0.131
cy_01/r3c3.webp: 0.134
```

These are review targets, not automatic failures. Some ratios are low because the arm angle naturally exposes less sleeve surface.

## Controlled Adoption Route

The intended OpenAI-assisted route is:

1. Generate or recover an OpenAI reference that solves only the local visual problem, such as sleeve breadth or soft cloth contour.
2. Extract foreground and sleeve masks from the generated reference.
3. Normalize the mask signal into the existing Reimu 512x512 coordinate system.
4. Apply only the permitted local edit to the source-sheet-derived frame or source-sheet cleanup logic.
5. Preserve the existing face, head, body, canvas, alpha, and 5x5 grid.
6. Regenerate all Reimu frames.
7. Rebuild `tmp/audit` and `tmp/compare`.
8. Verify that defects reduce without new clipping, doubled sleeves, transparent residue, or motion jitter.

## Verification Commands

```bash
npm.cmd run audit:assets:references
npm.cmd run audit:assets:openai-sleeve-candidates
npm.cmd run audit:assets:openai-targets
npm.cmd run quality:reimu
npm.cmd run verify:reimu:quality
```

`quality:reimu` runs `audit:assets:openai-sleeve-candidates` after the reference metrics step, so local OpenAI candidates are preprocessed and verified as part of the Reimu quality pass.

The current pipeline already rebuilds:

```text
tmp/noreshape
tmp/audit
tmp/compare
tmp/reference-audit
tmp/quality-audit
tmp/edge-audit
tmp/line-audit
tmp/issues
tmp/inspection
tmp/sweep
```

`verify:reimu:quality` requires the OpenAI target sheet and reports:

```text
openAiReferenceImages = 6 when local imagegen candidate exists, otherwise 5
openAiTargetRows = 18 when local imagegen candidate exists, otherwise 17
referenceFrames = 150
referencePngs = 312 when local imagegen candidate exists, otherwise 310
openAiCandidateProcessed = 1 when local sleeve candidate exists, otherwise 0
```

The OpenAI target rows are also consumed by the perceptual consistency audit:

```text
tmp/perceptual-audit/reimu-perceptual-consistency.png
tmp/perceptual-audit/reimu-perceptual-consistency-summary.json
```

That sheet promotes the lowest current sleeve-ratio frames into the same current/no-reshape/diff review board used for drawing-level regression checks.

## Current Status

The current shipped Reimu frames pass the hard asset audits. OpenAI references are now available as measured, reproducible inputs and target sheets for future controlled local edits instead of being treated as vague visual inspiration.
