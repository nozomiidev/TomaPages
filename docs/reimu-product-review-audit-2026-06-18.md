# Reimu Product Review Board Audit - 2026-06-18

This note records the product-level visual review artifact added after the Reimu quality recovery gates reached 25/25. It does not replace final human art acceptance, but it makes the remaining review surface explicit, reproducible, and hash-addressable.

## Generated Artifacts

Command:

```bash
npm.cmd run audit:assets:product-review
```

Outputs:

- `tmp/product-review/reimu-product-review-board.png`
  - `1600 x 1608`
  - 15 representative current frames across pose, expression, and 5x5 direction extremes
  - 12 highest-risk perceptual candidates, each paired current/no-reshape
- `tmp/product-review/reimu-product-review-summary.json`
  - `publicFrameCount = 225`
  - `baselineFrameCount = 225`
  - `representativeFrameCount = 15`
  - `candidateCount = 12`
  - `actionableCandidateCount = 0`
  - `severeIssueCount = 0`
  - `reviewArtifactCount = 10`
- `tmp/product-review/reimu-product-review-artifacts.csv`
  - SHA-256 hashes and dimensions for the board plus supporting visual review artifacts.

## Supporting Visual Artifacts Hashed

The manifest hashes these existing review surfaces:

- `tmp/sweep/reimu-full-sweep-pink.png`
- `tmp/sweep/reimu-full-sweep-dark.png`
- `tmp/sweep/reimu-full-sweep-alpha.png`
- `tmp/perceptual-audit/reimu-perceptual-consistency.png`
- `tmp/perceptual-audit/reimu-perceptual-candidate-zooms.png`
- `tmp/line-audit/reimu-line-integrity-overlay.png`
- `tmp/edge-audit/reimu-edge-integrity-overlay.png`
- `tmp/gap-audit/reimu-reference-covered-gap-overlay.png`
- `tmp/expression-audit/reimu-expression-diff-audit.png`
- `tmp/openai-material-audit/reimu-openai-material-application.png`

## Current Visual Review Notes

The current board and sweep artifacts were inspected in Codex. Pink and dark full sweeps show no obvious head clipping, leg clipping, detached fragments, or transparent color residue. The alpha sweep still shows expected internal negative space in some T/Y poses, but the current line-like, light-interior, reference-covered gap, and residual-defect audits classify the remaining candidates as non-actionable review-only cases.

The most important remaining human-review area is sleeve proportion in the T/Y candidate rows. The board intentionally places those current frames beside the no-reshape baseline so future visual acceptance can focus on the exact frames that sit closest to the sleeve guard limits.

## Gate Integration

`verify:reimu:quality` now requires the product review board, summary, artifact CSV, 15 representative frames, 12 perceptual candidates, zero actionable/severe product-review candidates, and 10 supporting hashed visual artifacts.

`verify:reimu:goal` now includes the same product-review requirement and the weak-alpha-zero gate, raising the automated evidence gate to 25/25.
