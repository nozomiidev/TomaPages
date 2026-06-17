# Reimu Quality Recovery Index - 2026-06-18

This index records where the recovered Reimu quality work lives and how it maps to the current `main` branch. The recovery notes are historical snapshots from the interrupted work; this file is the current locator.

## Current Main State

- Latest Reimu code/assets commit covered by this index: `8ca9f50 Stabilize Reimu direction cell changes`
- Repository: `https://github.com/nozomiidev/TomaPages.git`
- Branch: `main`
- Shipped Reimu frames: `public/characters/reimu`, 9 sheets x 25 frames = 225 WebP files
- Quality command: `npm run quality:reimu`
- CI-style command: `npm run check`
- Latest verified GitHub Pages workflow: `27714806540`, conclusion `success`

Recent quality commits:

- `8ca9f50 Stabilize Reimu direction cell changes`
- `3b9f75e Document Reimu lossless quality delta`
- `6a2c8f0 Ship lossless Reimu quality assets`
- `8d06789 Highlight Reimu internal gap audit`
- `bd2271a Expand Reimu reference audit coverage`

## Historical Recovery Notes

- `docs/reimu-quality-recovery-2026-06-17.md`
  - Historical recovery note from the moment the goal state disappeared.
  - Contains the then-current dirty worktree summary and the first recommended resume plan.
- `docs/reimu-quality-process-reconstruction-2026-06-17.md`
  - Reconstructed process log from surviving session data, tool output, diffs, generated assets, and visual checks.
  - It intentionally does not reveal private chain-of-thought. It records observable decisions and artifacts instead.
- `docs/reimu-lossless-quality-report-2026-06-18.md`
  - Before/after proof for the lossless Reimu pass, including metric deltas, rebuilt audit artifacts, browser evidence, and Pages deployment status.
- `docs/reimu-direction-stability-report-2026-06-18.md`
  - Runtime stability proof for Reimu 5x5 direction changes, including the live pointer boundary check that prevents repeated frame swaps near grid edges.
- `docs/reimu-goal-evidence-audit-2026-06-18.md`
  - Requirement-by-requirement evidence audit for the active Reimu recovery goal, including what is proven, what is only partially proven, and why the broader goal remains active.
- `docs/reimu-full-sweep-audit-2026-06-18.md`
  - Full 225-frame Reimu visual sweep proof covering all 9 sheets on pink, dark, and alpha views.
- `docs/reimu-edge-integrity-audit-2026-06-18.md`
  - Low-alpha and transparent-color integrity proof covering all 225 shipped Reimu frames.

## Local Full-Preserve Bundle

The full recovered material is kept locally under:

```text
tmp/recovery/reimu-quality-2026-06-17
```

The full raw Codex session JSONL was preserved with image-generation base64 intact in:

```text
tmp/recovery/reimu-quality-2026-06-17/full-preserve/session-full/rollout-2026-06-16T07-24-20-019ecd62-9da6-7250-bf87-415132c790a5.jsonl
```

Session JSONL size: `135775399` bytes

Session SHA256 from `ASSET_INVENTORY.csv`:

```text
48918F8B0AD23DE77E617898B427A572EA2E985785E1F12A3FB1EEE2731B980E
```

The raw session JSONL and full ZIP bundles are intentionally not duplicated into normal project source files. The repository records their exact paths and hashes so the local archive can be verified without adding hundreds of megabytes to the GitHub Pages site history.

## Bundle Hashes

```text
reimu-quality-full-preserve-20260617-195139.zip
SHA256 9AFB5943D9BDF01FE944AFB84730C1B0B84798DF1449DF89BB022284749914F4

reimu-quality-full-preserve-with-process-20260617-195423.zip
SHA256 452EEF19B4D43476621C32BF23043A8A68872A500490FE2FF1B920E830A46350

reimu-quality-full-preserve-with-process-latest.zip
SHA256 0A39043CAC6A304990D383EE7EF461C3FA712B9C5B8E502F0721A311DCE3F1EF

reimu-quality-recovery-bundle.zip
SHA256 05561C41BECDB4378BC4D5EC6B3A107D3F27F2613583190C6F2E29725AF592F5
```

## Recovered Artifact Counts

From `tmp/recovery/reimu-quality-2026-06-17/full-preserve/ASSET_INVENTORY.csv`:

| Group | Count | Bytes |
| --- | ---: | ---: |
| `session-full` | 1 | 135775399 |
| `current-public-reimu-webp` | 225 | 6911836 |
| `noreshape-reimu-webp` | 225 | 6948464 |
| `audit-sheets` | 21 | 49678080 |
| `compare-sheets` | 12 | 21196141 |
| `openai-generated` | 3 | 4034788 |
| `recovery-docs` | 2 | 19198 |

## OpenAI Generated Candidates

These recovered OpenAI outputs are used as references for sleeve proportion and shape, not as direct replacement frames:

```text
tmp/recovery/reimu-quality-2026-06-17/openai-generated/ig_03eb4ba73c27a25f016a3261b063788196aff9f2d64c56e2d7.png
SHA256 6CDE66C14C70000B506FD9083B217B571CC2ED37A32FF0BA4FF35124D4095CE9

tmp/recovery/reimu-quality-2026-06-17/openai-generated/ig_03eb4ba73c27a25f016a3264fc9cf48196923471f62f9ebad3.png
SHA256 D0382A0C75A98F6B2B76A3B1C0D9868340F53139633F9D759B2BD127143E36B5

tmp/recovery/reimu-quality-2026-06-17/openai-generated/ig_0c9f715f97270ac3016a32773cb8088191af4774c1cd0b94a2.png
SHA256 742E901C5E9ECA0E9C8B71215B977564CF50E75C122D43923991FA54C0D22A20
```

The current production pipeline keeps identity, line weight, canvas, and 5x5 frame-grid stability in the deterministic slicer/post-processing path. OpenAI image outputs are reference inputs for controlled edits and proportion guidance rather than direct shipped assets.

## Quality Gates Now In Source

The Reimu quality pass now covers:

- 225-frame count validation
- lossless Reimu WebP output so transparent pixels round-trip with black RGB
- canvas margins, head/body cut-off risk, and 5x5 neighbor center-step stability
- detached alpha fragments and thin detached slivers
- suspicious line-like transparent holes
- larger internal transparent gap cap and overlay review
- weak alpha pixels
- weak alpha edge support and orphan weak-alpha ghost detection in `tmp/edge-audit`
- transparent RGB residue
- T/Y sleeve-width regression against the no-reshape baseline
- visual contact sheets in `tmp/audit`
- current-vs-baseline comparison sheets in `tmp/compare`
- issue overlays in `tmp/issues`
- inspection zooms in `tmp/inspection`
- full 225-frame visual sweeps in `tmp/sweep`
- OpenAI reference metrics in `tmp/reference-audit`, covering the 5 recovered/reference OpenAI images and all 150 Reimu T/Y pose frames

Current default hard caps include:

```text
maxDetachedArea = 0
maxDetachedSliverArea = 0
maxSuspiciousHoleArea = 0
maxLineHoleArea = 0
maxInternalGapArea = 1800
maxTransparentNonBlack = 0
maxWeakAlpha = 220
maxOrphanWeakAlpha = 0
maxTransparentColored = 0
```

Lossless Reimu sleeve guard thresholds are calibrated to decoded lossless masks while keeping absolute width floors:

```text
maxAverageWidthLoss = 0.04
maxSideWidthImbalance = 0.18
maxSideWidthLoss = 0.12
minAverageWidthRatio = 0.25
minSideWidthRatio = 0.20
```

## Operational Notes

- Use the in-app Browser for localhost or GitHub Pages verification by default.
- If Chrome GUI is required, first verify that the Chrome window belongs to `nozomidevbusin@gmail.com`.
- Do not reintroduce separate sleeve-overlay assets for Reimu T/Y poses. The user explicitly rejected that approach.
- Do not directly mix OpenAI generated whole-body frames into the 225-frame grid unless a controlled edit pipeline preserves Reimu identity, line weight, canvas, and all pose-grid invariants.
- Keep the Reimu product-quality regeneration path lossless unless a replacement encoding proves zero transparent RGB residue after decode.
