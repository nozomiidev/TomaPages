# Reimu OpenAI Reference Integration - 2026-06-18

This note records the recoverable OpenAI-assisted asset workflow for Reimu. It is based on current workspace artifacts, not hidden reasoning.

## Principle

OpenAI image outputs are allowed in the Reimu recovery pipeline. The full generated frame is not shipped when it drifts, but normalized sleeve masks, sleeve ratios, and local material recipes can be adopted after deterministic post-processing and the same 225-frame quality gates as the source-sheet output.

The product asset invariants remain:

- preserve the existing Reimu face, head scale, body scale, canvas, and 5x5 direction grid
- preserve transparent WebP output at 512x512
- preserve motion stability between neighboring grid frames
- avoid separate sleeve overlays or doubled assets
- avoid unprocessed adoption of one-off generated full-body images that drift in line weight, framing, or identity

## Recovered Inputs

OpenAI-generated references are available through:

```text
metaassets/fumo/reimu/reimu_sleeve_reference_imagegen.png
metaassets/fumo/reimu/reimu_sleeve_reference_imagegen_tpose_20260617.png
tmp/recovery/reimu-quality-2026-06-17/openai-generated
tmp/imagegen/reimu-sleeve-candidates
metaassets/fumo/reimu/reimu_openai_sleeve_material_recipe.json
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

The target sheet keeps OpenAI reference masks and the lowest current Reimu sleeve-ratio frames in the same visual review surface. The material recipe turns that evidence into conservative local sleeve-width floors for the deterministic slicer.

The production impact of that material recipe is audited against a generated no-material baseline:

```text
tmp/openai-material-baseline/reimu
tmp/openai-material-audit/reimu-openai-material-application.csv
tmp/openai-material-audit/reimu-openai-material-application-summary.json
tmp/openai-material-audit/reimu-openai-material-application.png
```

This proves the recipe has a visible, scoped effect without relying on a separate sleeve overlay asset or whole-frame OpenAI replacement.

## Current Metrics

Latest regenerated reference audit:

```text
OpenAI references: 7 when both local sleeve candidates exist, otherwise 5 recovered/reference images
Current T/Y frames: 150
OpenAI target rows: 19 with both local sleeve candidates, otherwise 17
OpenAI sleeve width ratio range: 0.144 - 0.294
Current sleeve width ratio range: 0.098 - 0.260
Current low sleeve-ratio review frames at <= 0.18: 22
```

Useful OpenAI reference readings:

```text
reimu_sleeve_reference_imagegen.png: 0.222
ig_0c9f715f97270ac3016a32773cb8088191af4774c1cd0b94a2.png: 0.222
tmp/imagegen/reimu-sleeve-candidates/reimu-cy-r0c2-openai-sleeve-edit-raw.png: 0.231
tmp/imagegen/reimu-sleeve-candidates/reimu-ct-r1c2-openai-sleeve-edit-raw.png: 0.233
ig_03eb4ba73c27a25f016a3264fc9cf48196923471f62f9ebad3.png: 0.233
ig_03eb4ba73c27a25f016a3261b063788196aff9f2d64c56e2d7.png: 0.294
```

The `0.294` reference is useful as an upper-bound broad-sleeve target, but it is too large for direct adoption because it risks contradicting the shipped `p` pose family.

The local `0.231` candidate was generated from the current `cy_01/r0c2.webp` target, and the local `0.233` candidate was generated from the near-threshold `ct_01/r1c2.webp` target. Both are useful moderate-sleeve references, but neither is directly shippable because the image-model output drifts in face, bow scale, whole-body scale, and canvas framing.

`tools/prepare-reimu-openai-sleeve-candidates.mjs` turns local green-screen OpenAI outputs into preprocessing material:

```text
tmp/imagegen/reimu-sleeve-candidates/processed/*-alpha.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-normalized.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-projected-sleeve-guide.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-drift-heat.png
tmp/imagegen/reimu-sleeve-candidates/processed/*-preprocess-sheet.png
```

The latest local candidates have `nonSleeveDrift.driftRatio = 0.7008` and `0.8519`, so the whole generated frames remain blocked as replacements. Their sleeve measurements are now materialized through `metaassets/fumo/reimu/reimu_openai_sleeve_material_recipe.json`, which sets conservative `t` and `y` pose sleeve-width floors.

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
4. Record safe material targets in `metaassets/fumo/reimu/reimu_openai_sleeve_material_recipe.json`.
5. Apply only the permitted local edit to the source-sheet-derived frame or source-sheet cleanup logic.
6. Preserve the existing face, head, body, canvas, alpha, and 5x5 grid.
7. Regenerate all Reimu frames.
8. Rebuild `tmp/audit` and `tmp/compare`.
9. Verify that defects reduce without new clipping, doubled sleeves, transparent residue, or motion jitter.

## Verification Commands

```bash
npm.cmd run audit:assets:references
npm.cmd run audit:assets:openai-sleeve-candidates
npm.cmd run audit:assets:openai-targets
npm.cmd run build:assets:reimu:no-openai-material
npm.cmd run audit:assets:openai-material
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
tmp/openai-material-baseline
tmp/openai-material-audit
```

The slicer reads the OpenAI-derived material recipe when present and logs:

```text
reimu: reshaped T/Y sleeve pixels with OpenAI-derived material bounds
```

The no-material baseline build intentionally points the slicer at an empty local recipe file and logs:

```text
reimu: reshaped T/Y sleeve pixels against plain-pose bounds
```

`audit:assets:openai-material` then compares that baseline against the shipped frames. The current audit records 16 changed frames, all scoped to T/Y target sheets, with preserved margins and bounded non-sleeve differences.

`verify:reimu:quality` requires the OpenAI target sheet and reports:

```text
openAiReferenceImages = 7 when both local imagegen candidates exist, otherwise 5
openAiTargetRows = 19 when both local imagegen candidates exist, otherwise 17
referenceFrames = 150
referencePngs = 314 when both local imagegen candidates exist, otherwise 310
openAiCandidateProcessed = 2 when both local sleeve candidates exist, otherwise 0
```

The OpenAI target rows are also consumed by the perceptual consistency audit:

```text
tmp/perceptual-audit/reimu-perceptual-consistency.png
tmp/perceptual-audit/reimu-perceptual-consistency-summary.json
```

That sheet promotes the lowest current sleeve-ratio frames into the same current/no-reshape/diff review board used for drawing-level regression checks.

## Current Status

The current shipped Reimu frames pass the hard asset audits. OpenAI references are now measured, reproducible inputs for controlled local material edits instead of being treated as vague visual inspiration or discarded whole-frame candidates.
