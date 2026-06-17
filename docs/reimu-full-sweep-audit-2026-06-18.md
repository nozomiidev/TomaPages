# Reimu Full Sweep Audit - 2026-06-18

This report records the new full-frame visual sweep artifact for Reimu.

## Change

- Added `tools/render-character-frame-sweep.mjs`.
- Added `npm run audit:assets:sweep`.
- Added the sweep step to `npm run quality:reimu`.
- Added `tmp/sweep` verification to `scripts/verify-reimu-quality-artifacts.mjs`.

The sweep renders all 9 Reimu sheets and all 225 frames into three contact sheets:

```text
tmp/sweep/reimu-full-sweep-pink.png
tmp/sweep/reimu-full-sweep-dark.png
tmp/sweep/reimu-full-sweep-alpha.png
```

Each sweep sheet is `1472x1604` and lays out the full 9-sheet inventory:

```text
pl_01 om_01 ce_01
pt_01 ot_01 ct_01
py_01 oy_01 cy_01
```

## Reason

The existing `tmp/audit` and `tmp/compare` artifacts are strong targeted checks, but they do not provide one compact visual proof that every shipped Reimu frame is present and reviewable. The full sweep closes that evidence gap without changing the shipped WebP assets.

## Verification

Commands:

```bash
npm.cmd run audit:assets:sweep
npm.cmd run verify:reimu:quality
npm.cmd run check
```

Full post-regeneration audit chain also passed after the sweep was added:

```bash
npm.cmd run audit:assets
npm.cmd run audit:assets:sleeves
npm.cmd run audit:assets:visuals
npm.cmd run audit:assets:issues
npm.cmd run audit:assets:zooms
npm.cmd run audit:assets:sweep
npm.cmd run audit:assets:references
npm.cmd run verify:reimu:quality
```

`verify:reimu:quality` now reports:

```json
{
  "auditSheets": 21,
  "compareSheets": 12,
  "noreshapeFrames": 225,
  "publicFrames": 225,
  "sweepSheets": 3
}
```

The pink sweep was visually inspected at:

```text
tmp/sweep/reimu-full-sweep-pink.png
```
