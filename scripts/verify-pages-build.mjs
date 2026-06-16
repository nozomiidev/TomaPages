import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

const DIST = 'dist';
const HTML_FILES = ['index.html', 'talk.html', 'guruguru.html', 'room.html', 'video.html'];
const SHEETS = ['A', 'B', 'C', 'D', 'E', 'F'];
const VIDEO_BUNDLE_MARKERS = [
  'Vertical video stage',
  'Load project',
  'Save project',
  'Export video',
  'Timeline lanes',
  'Stage drag',
  'tomari-studio-video-project-v1',
  'MediaRecorder',
  'captureStream',
];
const VIDEO_CSS_MARKERS = [
  '.video-studio',
  '.video-studio__canvas',
  '.video-timeline__pin',
];
const CHARACTER_SHEETS = {
  reimu: ['pl_01', 'om_01', 'ce_01', 'pt_01', 'ot_01', 'ct_01', 'py_01', 'oy_01', 'cy_01'],
  cirno: ['pl_01', 'om_01', 'ce_01', 'pl_02', 'om_02', 'ce_02', 'pl_03', 'om_03', 'ce_03', 'pl_04', 'om_04', 'ce_04'],
};

function fail(message) {
  console.error(`Pages build verification failed: ${message}`);
  process.exit(1);
}

function assertFile(path) {
  if (!existsSync(path)) fail(`missing file: ${path}`);
}

function readDistAssets(extension) {
  const assetsDir = join(DIST, 'assets');
  assertFile(assetsDir);
  return readdirSync(assetsDir)
    .filter((file) => file.endsWith(extension))
    .map((file) => readFileSync(join(assetsDir, file), 'utf8'))
    .join('\n');
}

function assertTextContains(haystack, marker, scope) {
  if (!haystack.includes(marker)) {
    fail(`${scope} is missing marker: ${marker}`);
  }
}

function readDistHtml(file) {
  const path = join(DIST, file);
  assertFile(path);
  return readFileSync(path, 'utf8');
}

function assertNoAbsoluteLocalReferences(file, html) {
  const badPatterns = [
    'src="/',
    'href="/',
    'url(/',
  ];

  for (const pattern of badPatterns) {
    if (html.includes(pattern)) {
      fail(`${file} contains a root-relative reference: ${pattern}`);
    }
  }
}

function assertRelativeBundleReferences(file, html) {
  if (!html.includes('./assets/')) {
    fail(`${file} does not reference relative Vite assets`);
  }
}

function assertReferencedRelativeAssetsExist(file, html) {
  const attrPattern = /\b(?:src|href)="(\.\/[^"]+)"/g;
  for (const match of html.matchAll(attrPattern)) {
    const urlPath = match[1];
    if (/^\.\/assets\//.test(urlPath)) {
      assertFile(join(DIST, ...urlPath.slice(2).split('/')));
    }
  }
}

function assertSliceImages() {
  for (const sheet of SHEETS) {
    const dir = join(DIST, 'slices2', sheet);
    assertFile(dir);
    const webpFiles = readdirSync(dir).filter((name) => name.endsWith('.webp'));
    if (webpFiles.length !== 25) {
      fail(`${posix.join('dist', 'slices2', sheet)} should contain 25 webp files, found ${webpFiles.length}`);
    }

    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        assertFile(join(dir, `r${row}c${col}.webp`));
      }
    }
  }
}

function assertCharacterImages() {
  for (const [characterId, sheets] of Object.entries(CHARACTER_SHEETS)) {
    for (const sheet of sheets) {
      const dir = join(DIST, 'characters', characterId, sheet);
      assertFile(dir);
      const webpFiles = readdirSync(dir).filter((name) => name.endsWith('.webp'));
      if (webpFiles.length !== 25) {
        fail(`${posix.join('dist', 'characters', characterId, sheet)} should contain 25 webp files, found ${webpFiles.length}`);
      }

      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 5; col += 1) {
          assertFile(join(dir, `r${row}c${col}.webp`));
        }
      }
    }
  }
}

function assertVideoEditorBundle() {
  const videoHtml = readDistHtml('video.html');
  assertTextContains(videoHtml, 'data-initial-mode="video"', 'dist/video.html');

  const javascript = readDistAssets('.js');
  for (const marker of VIDEO_BUNDLE_MARKERS) {
    assertTextContains(javascript, marker, 'dist/assets/*.js');
  }

  const css = readDistAssets('.css');
  for (const marker of VIDEO_CSS_MARKERS) {
    assertTextContains(css, marker, 'dist/assets/*.css');
  }
}

for (const file of HTML_FILES) {
  const html = readDistHtml(file);
  assertNoAbsoluteLocalReferences(file, html);
  assertRelativeBundleReferences(file, html);
  assertReferencedRelativeAssetsExist(file, html);
}

assertSliceImages();
assertCharacterImages();
assertVideoEditorBundle();

console.log('Pages build verification passed.');
