import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, posix } from 'node:path';

const DIST = 'dist';
const HTML_FILES = ['index.html', 'talk.html', 'guruguru.html'];
const SHEETS = ['A', 'B', 'C', 'D', 'E', 'F'];

function fail(message) {
  console.error(`Pages build verification failed: ${message}`);
  process.exit(1);
}

function assertFile(path) {
  if (!existsSync(path)) fail(`missing file: ${path}`);
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

for (const file of HTML_FILES) {
  const html = readDistHtml(file);
  assertNoAbsoluteLocalReferences(file, html);
  assertRelativeBundleReferences(file, html);
  assertReferencedRelativeAssetsExist(file, html);
}

assertSliceImages();

console.log('Pages build verification passed.');
