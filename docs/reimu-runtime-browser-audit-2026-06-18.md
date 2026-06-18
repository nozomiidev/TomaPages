# Reimu Runtime Browser Audit - 2026-06-18

This note records deployed and local browser checks for the current Reimu recovery state after `quality:reimu` completed end-to-end.

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

## Deployed Browser Evidence - `b370ca88`

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

## Deployed Browser Evidence - `0efd657e`

After the weak-alpha normalization and face-local expression blend pass was pushed, the deployed GitHub Pages Talk page was checked again with:

```text
verify=deployed-alpha-floor-0efd657e-{pose}
```

Artifacts:

- `tmp/browser-screenshots/reimu-deployed-alpha-floor-0efd657e-p.png`
- `tmp/browser-screenshots/reimu-deployed-alpha-floor-0efd657e-t.png`
- `tmp/browser-screenshots/reimu-deployed-alpha-floor-0efd657e-y.png`
- `tmp/browser-screenshots/reimu-deployed-alpha-floor-0efd657e-summary.json`

Runtime checks in the deployed summary:

| Pose | Active Frame | Images | Loaded | Visible Reimu Images | Broken | Console Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `p` | `pl_01/r2c2.webp` | 225 | 225 | 1 | 0 | 0 |
| `t` | `pt_01/r2c2.webp` | 225 | 225 | 1 | 0 | 0 |
| `y` | `py_01/r2c2.webp` | 225 | 225 | 1 | 0 | 0 |

The deployed `py_01/r2c2.webp` asset hash also matched the local committed file, proving GitHub Pages was serving the updated Reimu WebP output rather than a stale asset.

## Current Local Preview Evidence

After the weak-alpha normalization and face-local expression blend pass, the local static preview was checked at:

```text
http://127.0.0.1:4200/talk.html
```

Artifacts:

- `tmp/browser-screenshots/reimu-local-alpha-floor-p.png`
- `tmp/browser-screenshots/reimu-local-alpha-floor-t.png`
- `tmp/browser-screenshots/reimu-local-alpha-floor-y.png`
- `tmp/browser-screenshots/reimu-local-alpha-floor-summary.json`

Runtime checks in the local summary:

| Pose | Active Frame | Images | Loaded | Visible Reimu Images | Broken | Console Errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `p` | `pl_01/r2c2.webp` | 225 | 225 | 1 | 0 | 0 |
| `t` | `pt_01/r2c2.webp` | 225 | 225 | 1 | 0 | 0 |
| `y` | `py_01/r2c2.webp` | 225 | 225 | 1 | 0 | 0 |

## Visual Notes

The captured deployed Talk screenshots show Reimu centered in the stage for plain, T-pose, and raised-arm Y-pose. No obvious head clipping, leg clipping, full-stage stretch, missing active image, or browser-side broken image is visible in the sampled runtime poses.

This does not replace the full 225-frame contact sheets and product review board; it complements them by proving that the deployed static app renders the shipped assets correctly in the actual Talk page.
