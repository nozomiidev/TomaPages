# Reimu OpenAI Sleeve Candidate - 2026-06-18

This note records the OpenAI image-model sleeve-edit candidates generated during the resumed Reimu quality pass.

## Candidate

Raw generated images copied for local evidence:

```text
tmp/imagegen/reimu-sleeve-candidates/reimu-cy-r0c2-openai-sleeve-edit-raw.png
tmp/imagegen/reimu-sleeve-candidates/reimu-ct-r1c2-openai-sleeve-edit-raw.png
```

The original generated files remain under:

```text
C:\Users\USER\.codex\generated_images\019ecd62-9da6-7250-bf87-415132c790a5\ig_03c3d0584f27b42d016a333aef000481918b1a1bc7aa826801.png
C:\Users\USER\.codex\generated_images\019ecd62-9da6-7250-bf87-415132c790a5\ig_090176fc53a4fb3c016a3354694658819088efe70c139d6f99.png
```

## Prompt

```text
Use case: precise-object-edit
Asset type: PNGTuber sprite edit candidate
Input images: Use the first visible 512x512 chibi Reimu frame as the edit target. Use the large green-background Reimu plush reference only as sleeve-shape guidance.
Primary request: Create one edited 512x512 sprite candidate where only the two white sleeves are modestly widened into a soft flared shrine-maiden sleeve shape. The sleeve area should be larger and more butterfly-like than the target, but not huge; keep it consistent with the existing plain-pose proportions.
Style/medium: keep the original target sprite's soft chibi raster style, line weight, colors, shading, and low-resolution PNGTuber asset look.
Composition/framing: exact same centered full-body pose and scale as the target; preserve canvas, head, face, bow, hair, torso, skirt, legs, hands, and facial expression.
Constraints: change only sleeve contours and sleeve cloth fill. Preserve identity, face, head size, body size, pose, transparent-safe silhouette, and 5x5 frame alignment. No doubled sleeves, no overlay-looking extra parts, no disconnected outlines, no broken contours, no clipped head or legs, no added accessories.
Background: perfectly flat solid #00ff00 chroma-key background, no shadows, no gradients, no texture, no text, no watermark. Do not use #00ff00 in the subject.
```

The local `ct_01/r1c2` follow-up prompt targeted the near-threshold T-pose sleeve imbalance:

```text
Use case: precise-object-edit
Asset type: PNGTuber frame reference candidate only, not final shipped asset
Primary request: Edit the visible 512x512 chibi shrine-maiden avatar frame. Preserve the exact character identity, face, closed eyes, hair, red bow, body, skirt, legs, arm pose, canvas size, framing, center, line style, colors, and transparent silhouette. Change only the white detached sleeves on both arms: make the sleeves subtly wider and more flared like traditional wide shrine-maiden sleeves, with the same large cuff area as the default/plain pose, but not oversized.
Constraints: do not crop the head, bow, hands, legs, or skirt; do not add duplicate sleeve overlays; do not change expression; do not repaint the whole character; do not make the sleeves huge; do not alter background or introduce shadows; preserve crisp transparent-style cutout edges.
```

## Evaluation

The generated candidates are not directly shippable:

- face, eyes, bow scale, and full-body proportions drift from the current 5x5 frame
- the model output is larger and framed differently than the production 512x512 sprite cell
- direct replacement would break the identity/canvas/grid invariants

It is still useful as a reference because the sleeve mask is coherent and close to the desired moderate broad-sleeve target.

Measured by `tools/analyze-reimu-reference-assets.mjs`:

```text
reimu-cy-r0c2-openai-sleeve-edit-raw.png: averageSleeveWidthRatio = 0.231, leftWidthRatio = 0.235, rightWidthRatio = 0.227
reimu-ct-r1c2-openai-sleeve-edit-raw.png: averageSleeveWidthRatio = 0.233, leftWidthRatio = 0.236, rightWidthRatio = 0.230
```

These sit close to the usable OpenAI reference range around `0.222 - 0.233`, and below the broad upper-bound reference at `0.294`.

## Preprocessing Artifacts

The candidate is converted into local post-processing material with:

```bash
npm.cmd run audit:assets:openai-sleeve-candidates
```

This command is also part of `npm run quality:reimu`, immediately after the OpenAI/reference metrics are regenerated. `verify:reimu:quality` checks the preprocessing summary and all processed PNG outputs when local candidates exist.

Latest output:

```text
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-openai-sleeve-candidates-summary.json
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-cy-r0c2-openai-sleeve-edit-raw-alpha.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-cy-r0c2-openai-sleeve-edit-raw-normalized.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-cy-r0c2-openai-sleeve-edit-raw-projected-sleeve-guide.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-cy-r0c2-openai-sleeve-edit-raw-drift-heat.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-cy-r0c2-openai-sleeve-edit-raw-preprocess-sheet.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-ct-r1c2-openai-sleeve-edit-raw-alpha.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-ct-r1c2-openai-sleeve-edit-raw-normalized.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-ct-r1c2-openai-sleeve-edit-raw-projected-sleeve-guide.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-ct-r1c2-openai-sleeve-edit-raw-drift-heat.png
tmp/imagegen/reimu-sleeve-candidates/processed/reimu-ct-r1c2-openai-sleeve-edit-raw-preprocess-sheet.png
```

Latest preprocessing metrics:

```text
target = cy_01/r0c2.webp
candidate sleeve ratio = 0.231
target sleeve ratio = 0.098
non-sleeve drift ratio = 0.7008
directAdoptionAllowed = false

target = ct_01/r1c2.webp
candidate sleeve ratio = 0.302 in candidate-preprocess geometry, 0.233 in reference-audit geometry
target sleeve ratio = 0.251
non-sleeve drift ratio = 0.8519
directAdoptionAllowed = false

verify:reimu:quality openAiCandidateProcessed = 2
```

The normalized and projected outputs are useful as local sleeve-shape guides. The `0.7008` and `0.8519` non-sleeve drift values prove the full generated frames must not replace shipped frames directly.

## Integration

`tools/analyze-reimu-reference-assets.mjs` now treats this local directory as an optional OpenAI reference source:

```text
tmp/imagegen/reimu-sleeve-candidates
```

When the local candidate exists, the reference audit reports:

```text
openAiReferenceImages = 7
openAiTargetRows = 19
referenceFrames = 150
referencePngs = 314
```

On a clean checkout or CI run without local `tmp/imagegen` candidates, the same audit falls back to the existing five recovered/reference OpenAI images.

The production frames are still generated by the deterministic Reimu slicer and post-processing path. The OpenAI candidate is a measured local sleeve-mask/proportion input, not a shipped full-body replacement.
