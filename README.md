# PNGTuber Studio

`tomari-guruguru` を元に、GitHub Pages へそのまま出せる静的 PNGTuber Studio として再構成したリポジトリです。Live2D ではなく、5x5 の方向差分と口・目の状態差分画像を切り替えて動かします。

元リポジトリは作業・比較用に `reference/tomari-guruguru` へ clone しています。アプリ本体はこの repo の root 側に移植・再設計しています。

## 公開 URL

GitHub Pages:

```text
https://nozomiidev.github.io/TomaPages/
https://nozomiidev.github.io/TomaPages/talk.html
https://nozomiidev.github.io/TomaPages/guruguru.html
https://nozomiidev.github.io/TomaPages/room.html
https://nozomiidev.github.io/TomaPages/index.html#assets
```

## 元リポジトリと方針

参考・移植元:

- <https://github.com/rotejin/tomari-guruguru>

この repo は元リポジトリの機能をフルスクラッチで似せ直すのではなく、`reference/tomari-guruguru` に元実装を保持し、挙動を確認しながら root 側へ移植・整理したものです。

主な変更点:

- `talk.html` / `guruguru.html` の URL 互換を維持しつつ、React アプリ本体を単一の Studio UI に統合
- GitHub Pages のサブパスで壊れにくい relative asset path に変更
- GitHub Actions による build / verify / deploy を追加
- lint / test / Pages artifact verifier を追加
- 文字化けしていた UI 文言を整理し、制作ツールとして使える SaaS 風の画面構成に刷新
- asset inventory 画面を追加し、6 シート / 150 フレームの読み込みを確認しやすくした
- 髪色・瞳色を非破壊のピクセルマスクで重ねる appearance tuning を追加

## 機能

- `talk.html`: マイクまたは音声ファイルの音量に合わせた 3 段階口パク
- `Test sync`: マイク権限や外部音源なしで口パク挙動を検証する内蔵テスト信号
- `guruguru.html`: ポインター位置に追従する 25 方向の視線・顔向き
- `room.html`: Trystero の WebRTC presence と html2canvas snapshot を使った通信ルームの第一実装 slice
- 自然な自動まばたき、ダブル blink、長め blink
- 調整パネル: follow range、smoothing、avatar size、mic gain、口パクしきい値、release、髪色、瞳色、背景色、auto blink、debug grid
- `index.html#assets`: 6 シート / 150 フレームの asset inventory
- GitHub Pages 用の relative asset path、Actions deploy、artifact verifier
- lint/test/audit/build/Pages verify を回せる保守用スクリプト

## セットアップ

Node.js 22 LTS 推奨です。Vite 8 の要件として Node.js 20.19+ または 22.12+ が必要です。

```bash
npm install
npm run dev
```

ローカル URL:

```text
http://127.0.0.1:5173/talk.html
http://127.0.0.1:5173/guruguru.html
http://127.0.0.1:5173/room.html
http://127.0.0.1:5173/index.html#assets
```

マイク入力はブラウザ仕様上、`localhost` / `127.0.0.1` または HTTPS で有効です。GitHub Pages は HTTPS なのでそのまま使えます。

## 静的ビルド

```bash
npm run check
npm run preview
```

`npm run check` は以下を順番に実行します。

```text
lint -> test -> build -> verify:pages
```

`vite.config.js` の `base` は `./` です。repo 名が変わっても GitHub Pages のサブパスで壊れにくい構成にしています。

## GitHub Pages

`.github/workflows/pages.yml` は `main` への push で `dist` を Pages artifact として deploy します。Pull request では deploy せず、lint/test/build/verify だけ実行します。

Pages 側の Source は GitHub Actions にしてください。

## 画像構成

`public/slices2` は 6 シート、各 25 フレームです。

| Sheet | Eyes | Mouth |
| --- | --- | --- |
| `A` | open | closed |
| `B` | open | half |
| `C` | open | open |
| `D` | closed | closed |
| `E` | closed | half |
| `F` | closed | open |

方向は `r0..r4` x `c0..c4` です。`r2c2` が正面、列は左から右、行は上から下の向きです。

## 色カスタマイズ

Tuning パネルの Appearance で髪色・瞳色、変換フィルター、mix 強度を調整できます。元画像は書き換えず、現在表示中のフレームから髪・瞳らしい色域を検出して、透明な変換レイヤーを上に重ねます。`mix` が `0` のときは元絵のままです。

- `Silk`: 元画像の線・輝度・ハイライトを残す半透明グレーズ型の標準フィルター
- `Grade`: 元画像の輝度・影・ハイライトを優先して残し、色相だけを自然に寄せるフィルター
- `Soft`: HSL ベースで色相を選択色へ強めに寄せるフィルター
- `Paint`: 以前の単色 overlay 寄りのフィルター

赤・橙・ピンク系のアクセサリ塗り残しは、髪・瞳とは別の accent 色域として検出し、瞳色側の変換に追従します。強い色を seed として拾い、隣接する暗い縁・薄いハイライトを2段階だけ補完するため、アクセサリー周辺の塗り残しを抑えつつ肌色へ広がりにくくしています。

URL パラメーターでも初期値を指定できます。`#` は URL fragment になるため、色は `#` なしで渡すのが安全です。

```text
talk.html?filter=silk&hair=0F766E&hairMix=0.65&eyes=A855F7&eyeMix=0.85
talk.html?filter=grade&hair=0F766E&hairMix=0.65&eyes=A855F7&eyeMix=0.85
talk.html?filter=soft&hair=0F766E&hairMix=0.65&eyes=A855F7&eyeMix=0.85
guruguru.html?filter=paint&hair=6D5BD0&hairMix=0.45&eyeColor=2BA7E8&eyeTint=0.75
```

この方式は GitHub Pages 上でも追加サーバーなしで動きます。完全なレイヤー分けではないため、別キャラクターに差し替える場合は `src/domain/avatar-recolor.js` の色範囲条件を調整してください。

## Room / P2P

`room.html` は追加サーバーなしで動く静的ページです。Trystero を WebRTC room discovery / data-channel presence に使い、同じブラウザ内では BroadcastChannel / storage fallback で検証できます。各 peer は画像フレームではなく、pose cell、mouth、audio level、appearance tuning などの軽い presence state だけを送ります。

カードの通常表示は html2canvas で DOM から canvas snapshot 化し、hover 中のカードだけ live DOM として前面に出します。詳しい設計メモは `docs/multiplayer-architecture.md` にあります。

```text
room.html?room=codec-lobby&name=Nozomi
```

`Copy link` は現在の room/name を含む共有 URL を作ります。`New room` はランダムな room id を作って移動します。presence は状態変化時に加えて短い heartbeat でも送るため、後から入った peer も既存 peer を拾いやすくしています。

### Agent Bridge / MCP 窓口

`room.html` は AI agent も peer として表示できる browser-side bridge を公開します。GitHub Pages は常駐 MCP サーバーをホストできないため、MCP adapter やローカルツール側からブラウザへ presence payload を渡す入口です。

```js
const channel = new BroadcastChannel('tomari-studio:agent-bridge:codec-lobby');
channel.postMessage({
  protocol: 'tomari-agent-bridge.v1',
  type: 'agent-presence',
  roomId: 'codec-lobby',
  peer: {
    id: 'codex',
    name: 'Codex',
    role: 'MCP pilot',
    cell: { row: 2, col: 3 },
    mouth: 1,
    audioLevel: 0.42,
    hair: '0F766E',
    hairMix: 0.65,
    eyes: 'A855F7',
    eyeMix: 0.85,
    filter: 'silk'
  }
});
```

同じページ内では `window.tomariAgentBridge.publish(peer)` も使えます。仕様メモは `docs/agent-bridge.md` にあります。

## 新しいキャラクターへ差し替える

元 repo 由来の `tools/slice_character_sheets.py` を残しています。最終的には `public/slices2/{A..F}/r{0..4}c{0..4}.webp` が揃えばアプリは動きます。

大まかな流れ:

1. 6 枚の 5x5 PNG シートを用意する
2. `tools/slice_character_sheets.py` で `public/slices2` へ切り出す
3. `npm run build`
4. `npm run verify:pages`

## ディレクトリ

```text
.
├─ index.html / talk.html / guruguru.html / room.html
├─ src/
│  ├─ app.jsx
│  ├─ room.jsx
│  ├─ styles.css
│  ├─ domain/
│  │  ├─ audio-engine.js
│  │  ├─ agent-bridge.js
│  │  ├─ avatar-recolor.js
│  │  ├─ avatar-recolor.test.js
│  │  ├─ character.js
│  │  ├─ character.test.js
│  │  └─ presence-transport.js
│  ├─ hooks/
│  └─ lib/
├─ public/slices2/
├─ scripts/verify-pages-build.mjs
├─ tools/slice_character_sheets.py
├─ reference/tomari-guruguru/
└─ .github/workflows/pages.yml
```

## ライセンス

プログラム部分は元 repo と同じ MIT License を継承します。キャラクター画像・音声などの asset は元 repo の `ASSET_LICENSE.md` の制約を引き継ぎます。商用利用や別プロジェクトへの素材流用は避け、詳細は `ASSET_LICENSE.md` と元 repo を確認してください。
