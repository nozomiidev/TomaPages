# Reimu Direction Stability Report - 2026-06-18

This report records the UI-side stability pass for Reimu 5x5 direction changes after the lossless asset pass.

## Change

- Added `targetToStableCell` in `src/domain/character.js`.
- Kept the original `targetToCell` mapping intact for compatibility.
- Applied the stable mapper only to the live Talk/Gaze avatar loop in `src/app.jsx`.

The stable mapper keeps the previous 5x5 direction cell while the smoothed pointer target is near a grid boundary. It still allows deliberate larger moves to jump immediately to the correct cell.

## Reason

The Reimu sprite sheets are now fixed 512px lossless WebP frames, but the live pointer loop can still look jittery if the smoothed target hovers around a cell boundary. That produces repeated frame swaps even when the user's pointer is effectively steady.

This pass addresses that runtime cause of perceived center-of-mass jitter without changing the Reimu artwork, sleeve edits, 5x5 sheet structure, or existing exported assets.

## Verification

Commands:

```bash
npm.cmd run test -- src/domain/character.test.js
npm.cmd run lint
npm.cmd run check
```

Browser check on local preview:

- URL: `http://127.0.0.1:4187/talk.html?avatar=reimu&pose=t&filter=natural&verify=stable-cell-local`
- Reimu images: 225 loaded / 225 total
- Broken images: 0
- Console errors: 0
- Near-boundary pointer target `x=0.30, y=-0.30`: stayed at `r2 c2`
- Cross-boundary pointer target `x=0.36, y=-0.36`: moved to `r1 c3`
- Screenshot: `tmp/screenshots/reimu-stable-cell-local.png`
