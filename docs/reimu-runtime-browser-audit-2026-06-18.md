# Reimu Runtime Browser Audit - 2026-06-18

This note records the deployed browser check for the current Reimu recovery state after `quality:reimu` completed end-to-end and GitHub Pages deployed commit `b370ca88`.

## Target

Deployed Talk page:

```text
https://nozomiidev.github.io/TomaPages/talk.html
```

Query parameters used for each pose:

```text
avatar=reimu
pose=p|t|y
filter=natural
hair=0F766E
hairMix=0.65
eyes=A855F7
eyeMix=0.85
verify=b370ca8-browser-{pose}
```

## Browser Evidence

Artifacts:

- `tmp/browser-screenshots/reimu-runtime-deployed-talk-p-b370ca8.png`
- `tmp/browser-screenshots/reimu-runtime-deployed-talk-t-b370ca8.png`
- `tmp/browser-screenshots/reimu-runtime-deployed-talk-y-b370ca8.png`
- `tmp/browser-screenshots/reimu-runtime-deployed-summary-b370ca8.json`

Runtime checks in the summary:

| Pose | Active Sheet | Images | Loaded | Active Loaded | Broken |
| --- | --- | ---: | ---: | ---: | ---: |
| `p` | `pl_01` | 225 | 225 | 1 | 0 |
| `t` | `pt_01` | 225 | 225 | 1 | 0 |
| `y` | `py_01` | 225 | 225 | 1 | 0 |

The check waits for all 225 Reimu image elements to load and verifies that exactly one active image remains visible for the selected pose. This avoids falsely treating the hidden/preloaded frame stack as multiple displayed avatars.

## Visual Notes

The captured deployed Talk screenshots show Reimu centered in the stage for plain, T-pose, and raised-arm Y-pose. No obvious head clipping, leg clipping, full-stage stretch, missing active image, or browser-side broken image is visible in the sampled runtime poses.

This does not replace the full 225-frame contact sheets and product review board; it complements them by proving that the deployed static app renders the shipped assets correctly in the actual Talk page.
