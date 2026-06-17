# PNGTuber Studio

`rotejin/tomari-guruguru` を参考元として、Live2D を使わず PNG/WebP の 5x5 方向フレームで動かす静的 PNGTuber Studio です。GitHub Pages でそのまま配信できるよう、Vite + React のクライアントサイドアプリとして構成しています。

元リポジトリは `reference/tomari-guruguru` に clone して挙動を確認しながら、root 側へ移植・拡張しています。Tomari の既存機能を残しつつ、`metaassets/fumo` 由来の Reimu / Cirno plush 素材、Room、縦型動画編集を追加しています。

## Pages URL

```text
https://nozomiidev.github.io/TomaPages/
https://nozomiidev.github.io/TomaPages/talk.html
https://nozomiidev.github.io/TomaPages/guruguru.html
https://nozomiidev.github.io/TomaPages/room.html
https://nozomiidev.github.io/TomaPages/video.html
https://nozomiidev.github.io/TomaPages/index.html#assets
```

## Reference

- Original prototype: <https://github.com/rotejin/tomari-guruguru>

This repository is not a clean-room rewrite of the idea. It keeps the original repository locally for reference, then ports and extends the behavior into a static-site friendly studio.

## Features

- `talk.html`: microphone or audio-file lip sync with closed / half-open / open mouth states.
- `guruguru.html`: pointer-driven 5x5 gaze direction.
- `room.html`: static, serverless room prototype using Trystero/WebRTC plus browser fallbacks.
- `index.html#assets`: asset inventory for all exported frame sheets.
- `video.html`: vertical video editor with multiple character tracks, drag-based facing/move/rotate, keyframe pins, per-track effects, shadows, backgrounds, transitions, live preview, frame export, WebM export, project JSON save/load, and local draft autosave.
- GitHub Pages deployment with relative asset paths and a build artifact verifier.
- Tests for character routing, recolor filters, room helpers, P2P/presence helpers, video project persistence, and Pages build structure.

## Characters And Assets

The app currently ships:

| Character | Kind | Sheets | Frames | Notes |
| --- | --- | ---: | ---: | --- |
| Tomari | Bust PNGTuber | 6 | 150 | Original 5x5 direction grid with mouth/blink sheets |
| Reimu Fumo | Full-body plush | 9 | 225 | Plain / T-pose / Y-pose, each with mouth/blink variants |
| Cirno Fumo | Full-body plush | 12 | 300 | Four pose sets, each with mouth/blink variants |

Total exported character inventory is 27 sheets / 675 WebP frames.

Additional character frames live under:

```text
public/characters/{characterId}/{sheet}/r{row}c{col}.webp
```

Rows and columns are `r0..r4` and `c0..c4`; `r2c2` is the front-facing center frame.

### Reimu Pose Sheets

| Pose | Plain eyes | Open mouth | Closed eyes |
| --- | --- | --- | --- |
| Plain | `pl_01` | `om_01` | `ce_01` |
| T-pose | `pt_01` | `ot_01` | `ct_01` |
| Y-pose | `py_01` | `oy_01` | `cy_01` |

### Cirno Pose Sheets

| Pose | Plain eyes | Open mouth | Closed eyes |
| --- | --- | --- | --- |
| Pose 01 | `pl_01` | `om_01` | `ce_01` |
| Pose 02 | `pl_02` | `om_02` | `ce_02` |
| Pose 03 | `pl_03` | `om_03` | `ce_03` |
| Pose 04 | `pl_04` | `om_04` | `ce_04` |

## URL Parameters

```text
talk.html?avatar=reimu
talk.html?avatar=reimu&pose=y
guruguru.html?character=cirno&pose=3
video.html
```

`avatar` and `character` both select the active character. Reimu supports `pose=plain|t|y`; Cirno supports `pose=1|2|3|4`.

## Video Editor

`video.html` is a separate vertical-video workspace, not part of Talk or Room. It is built around a 1080x1920 canvas and is intended for short social/video composition.

It supports:

- multiple character tracks;
- Reimu/Cirno/Tomari character switching per track;
- character-specific pose and filter lists;
- stage drag mode: `Face`, `Move`, or `Rotate`;
- `Shift+drag` / pin-on-release keyframe creation;
- timeline lanes and draggable pins;
- effects: none, bounce, float, wobble, pulse, sway, shake;
- transitions: none, fade, slide, zoom, reveal, spin;
- ground shadows and selectable solid/gradient/custom-image backgrounds;
- PNG frame export;
- WebM export where the browser supports `canvas.captureStream` and `MediaRecorder`;
- project JSON save/load;
- local draft autosave via `localStorage`.

The project JSON format is normalized in `src/domain/video-project.js`, so imported projects are clamped to safe values and character-specific pose/filter IDs are repaired when possible.

## Setup

Node.js 20.19+ or 22.12+ is required by Vite 8.

```bash
npm install
npm run dev
```

Local URLs:

```text
http://127.0.0.1:5173/talk.html
http://127.0.0.1:5173/guruguru.html
http://127.0.0.1:5173/room.html
http://127.0.0.1:5173/video.html
http://127.0.0.1:5173/index.html#assets
```

Microphone input requires `localhost` / `127.0.0.1` or HTTPS. GitHub Pages is HTTPS, so deployed mic access works through the browser permission prompt.

## Asset Generation

Large source sheets live outside Git in `metaassets/fumo`. To regenerate Reimu/Cirno public WebP frames:

```bash
npm run build:assets:fumo
```

Expected source layout:

```text
metaassets/fumo/reimu/reimu_pl_01.png
metaassets/fumo/reimu/reimu_om_01.png
...
metaassets/fumo/cirno/cirno_pl_01.png
metaassets/fumo/cirno/cirno_om_01.png
...
```

The slicer is `tools/slice-fumo-assets.mjs`. It assigns foreground components to a 5x5 grid, crops full-body plush frames, exports WebP, and applies Reimu T/Y sleeve flare post-processing so arm poses retain wide shrine-maiden sleeves.

For the Reimu quality pass, use:

```bash
npm run quality:reimu
```

This regenerates the no-reshape baseline in `tmp/noreshape`, regenerates the shipped Reimu WebP frames, runs the 225-frame asset audit, and rebuilds visual contact sheets in `tmp/audit` plus current-vs-baseline comparison sheets in `tmp/compare`.

If recovered OpenAI image-generation/editing candidates exist locally under `tmp/recovery/reimu-quality-2026-06-17/openai-generated` or `metaassets/fumo/reimu/reimu_sleeve_reference_imagegen.png`, the same command also writes `tmp/reference-audit`. Those references are treated as proportion and mask guidance for sleeve shape; the shipped 5x5 frames still come from the existing source sheets plus deterministic post-processing so identity, canvas, line weight, and frame grid stay stable.

## Static Build

```bash
npm run check
npm run preview
```

`npm run check` runs:

```text
lint -> test -> audit:assets -> build -> verify:pages
```

`scripts/verify-pages-build.mjs` checks:

- every HTML entry exists, including `video.html`;
- Vite asset references are relative and GitHub Pages safe;
- Tomari `public/slices2` has all 6 x 25 WebP frames;
- Reimu has all 9 x 25 WebP frames;
- Cirno has all 12 x 25 WebP frames.

## GitHub Pages And Limits

The deployed studio is static. Runtime work such as lip sync, room UI, video preview, project autosave, and video/frame export runs in the user's browser. It does not consume GitHub Actions minutes while someone uses the site.

GitHub Actions are only used for build/verification/deploy on repository events such as pushes or pull requests. GitHub Pages bandwidth/storage limits still apply as normal for a static site.

## Directory Map

```text
.
├─ index.html / talk.html / guruguru.html / room.html / video.html
├─ src/
│  ├─ app.jsx
│  ├─ room.jsx
│  ├─ video-studio.jsx
│  ├─ styles.css
│  └─ domain/
│     ├─ avatar-recolor.js
│     ├─ character.js
│     ├─ video-project.js
│     └─ *.test.js
├─ public/slices2/
├─ public/characters/
├─ scripts/verify-pages-build.mjs
├─ tools/slice-fumo-assets.mjs
├─ tools/slice_character_sheets.py
├─ reference/tomari-guruguru/
└─ .github/workflows/pages.yml
```

## License

Program code follows the MIT License used by the reference project unless a file states otherwise. Character images, sounds, generated media, and other assets may have separate restrictions. Check `ASSET_LICENSE.md`, the original repository, and the source of any added assets before redistribution or commercial use.
