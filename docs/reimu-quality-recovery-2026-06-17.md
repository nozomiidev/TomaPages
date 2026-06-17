# Reimu Quality Recovery Notes - 2026-06-17

This note preserves the recovery context for the interrupted Reimu asset-quality goal.

## Lost Goal Text

The active Goal object disappeared from Codex Desktop state, but the objective is still recoverable from the session log:

```text
なんか絵として破綻していたり輪郭線途切れていたり透明な中輪郭だけが余計にあるものも多いそれ以外も色々雑。製品レベルのクオリティにして
```

Additional constraints from the recovered objective:

- Use Browser / Chrome / Computer / GitHub as needed.
- If Chrome GUI is used, verify the window belongs to `nozomidevbusin@gmail.com` first.
- Do not avoid OpenAI image generation or image editing models.
- Keep Reimu identity, pose-grid consistency, transparency, framing, and motion stability.

Session log:

- `C:\Users\USER\.codex\sessions\2026\06\16\rollout-2026-06-16T07-24-20-019ecd62-9da6-7250-bf87-415132c790a5.jsonl`
- Key area: around lines `24551` to `24756`
- Thread id: `019ecd62-9da6-7250-bf87-415132c790a5`
- Thread title: `GitHub Pages向けに改修`

## Current Repository State

Repository:

- Path: `C:\Users\USER\OneDrive - 筑波大学\ドキュメント\pngtuber`
- Remote: `https://github.com/nozomiidev/TomaPages.git`
- Branch: `main`
- Last pushed commit before this recovery work: `9d1f658 Reshape Reimu pose sleeves`

Git may reject normal commands with `dubious ownership`. Use this form:

```powershell
$repo = (Get-Location).Path -replace '\\','/'
git -c safe.directory="$repo" status --short
```

Important dirty state:

- `tools/slice-fumo-assets.mjs` has uncommitted recovery changes.
- All 225 files under `public/characters/reimu/*/*.webp` are regenerated and modified.
- `tmp/` contains untracked recovery/audit assets.

## Recovered Artifacts

Recovery bundle created in the workspace:

- `C:\Users\USER\OneDrive - 筑波大学\ドキュメント\pngtuber\tmp\recovery\reimu-quality-2026-06-17\reimu-quality-recovery-bundle.zip`

The bundle contains:

- `tmp/audit` - 21 audit contact sheets including alpha-focused views.
- `tmp/compare` - 12 comparison sheets.
- `tmp/noreshape` - 225 Reimu WebP frames generated with `--skip-reimu-pose-reshape`.
- `openai-generated` - copied OpenAI image generation/editing candidates.

Copied OpenAI candidates:

- `tmp/recovery/reimu-quality-2026-06-17/openai-generated/ig_0c9f715f97270ac3016a32773cb8088191af4774c1cd0b94a2.png`
- `tmp/recovery/reimu-quality-2026-06-17/openai-generated/ig_03eb4ba73c27a25f016a3264fc9cf48196923471f62f9ebad3.png`
- `tmp/recovery/reimu-quality-2026-06-17/openai-generated/ig_03eb4ba73c27a25f016a3261b063788196aff9f2d64c56e2d7.png`

Useful comparison sheets:

- `tmp/compare/pt_01-pink-compare.png`
- `tmp/compare/py_01-pink-compare.png`
- `tmp/compare/pt_01-dark-compare.png`
- `tmp/compare/py_01-dark-compare.png`

In comparison sheets, the left half is the current public output and the right half is the no-reshape output.

## Findings Before Interruption

- The alpha cleanup worked: floating low-alpha contour fragments were reduced.
- The previous sleeve reshape from `9d1f658` likely introduces some visual breakage in T/Y frames.
- The no-reshape Reimu output is often cleaner than the reshaped output, especially in Y poses.
- OpenAI image generation/editing produced a useful broad-sleeve reference, but direct adoption is unsafe because it changed face scale, line weight, canvas framing, and overall drawing style.
- Some remaining horizontal grey/pink streaks appear to come from source-sheet/background extraction or cell slicing, not just sleeve shape.

## Current Code Recovery Changes

`tools/slice-fumo-assets.mjs` currently adds:

- `sanitizeSpriteAlpha(data, width, height)`
  - Keeps the largest alpha component.
  - Removes small disconnected alpha fragments.
  - Removes weak alpha pixels that are far from strong body pixels.
- Alpha cleanup is applied both:
  - after normal sheet slicing, and
  - after Reimu T/Y sleeve reshape.
- `--skip-reimu-pose-reshape`
  - Lets the asset builder generate clean no-reshape Reimu frames for comparison.

The no-reshape generation command used:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' run build:assets:fumo -- --characters reimu --out tmp/noreshape --skip-reimu-pose-reshape
```

## Recommended Resume Plan

1. Do not reset or clean the worktree.
2. Open `tmp/compare/py_01-pink-compare.png` and `tmp/compare/pt_01-pink-compare.png`.
3. Treat the current sleeve reshape as suspect. Product quality may be better if default Reimu generation skips T/Y sleeve reshape or uses a much more conservative version.
4. Fix the slicer/background extraction issue that leaves horizontal grey/pink streaks in some Y/down/side frames.
5. Use OpenAI image output as a visual reference for sleeve shape, not as a direct 225-frame replacement unless a controlled edit/mask workflow is available and verified.
6. Regenerate Reimu assets.
7. Verify with contact sheets and browser rendering:
   - `talk.html?avatar=reimu&pose=t`
   - `talk.html?avatar=reimu&pose=y`
   - representative 5x5 direction movement
8. Run:

```powershell
$env:Path = 'C:\Program Files\nodejs;' + $env:Path
& 'C:\Program Files\nodejs\npm.cmd' run lint
& 'C:\Program Files\nodejs\npm.cmd' run test
& 'C:\Program Files\nodejs\npm.cmd' run build
& 'C:\Program Files\nodejs\npm.cmd' run verify:pages
```

9. Commit and push only after browser screenshots and contact-sheet inspection pass.

## Browser / Chrome Rule

Use the in-app Browser for localhost/static verification by default. If using Chrome GUI, first verify that the active Chrome window/account is `nozomidevbusin@gmail.com`.
