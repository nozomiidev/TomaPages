import { clamp } from '../lib/math';

export const CHARACTER = {
  rows: 5,
  cols: 5,
  basePath: `${import.meta.env.BASE_URL}slices2`,
  ext: 'webp',
  sheets: {
    eyesOpen: {
      closedMouth: 'A',
      halfMouth: 'B',
      openMouth: 'C',
    },
    eyesClosed: {
      closedMouth: 'D',
      halfMouth: 'E',
      openMouth: 'F',
    },
  },
};

export const MOUTH_STATES = [
  { id: 0, label: 'Closed', shortLabel: 'quiet', key: 'closedMouth' },
  { id: 1, label: 'Half open', shortLabel: 'talk', key: 'halfMouth' },
  { id: 2, label: 'Open', shortLabel: 'loud', key: 'openMouth' },
];

export const SHEET_DEFINITIONS = [
  {
    sheet: 'A',
    name: 'Open eyes / closed mouth',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'B',
    name: 'Open eyes / half mouth',
    eyes: 'open',
    mouth: 'half',
  },
  {
    sheet: 'C',
    name: 'Open eyes / open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'D',
    name: 'Blink / closed mouth',
    eyes: 'closed',
    mouth: 'closed',
  },
  {
    sheet: 'E',
    name: 'Blink / half mouth',
    eyes: 'closed',
    mouth: 'half',
  },
  {
    sheet: 'F',
    name: 'Blink / open mouth',
    eyes: 'closed',
    mouth: 'open',
  },
];

export function frameSrc(sheet, row, col) {
  return `${CHARACTER.basePath}/${sheet}/r${row}c${col}.${CHARACTER.ext}`;
}

export function sheetForPose({ blink, mouth }) {
  const mouthState = MOUTH_STATES[mouth] ?? MOUTH_STATES[0];
  const eyeSet = blink ? CHARACTER.sheets.eyesClosed : CHARACTER.sheets.eyesOpen;
  return eyeSet[mouthState.key];
}

export function allFrames({ includeMouthStates = true } = {}) {
  const sheets = includeMouthStates
    ? SHEET_DEFINITIONS.map((definition) => definition.sheet)
    : [CHARACTER.sheets.eyesOpen.closedMouth, CHARACTER.sheets.eyesClosed.closedMouth];
  const frames = [];

  for (const sheet of sheets) {
    for (let row = 0; row < CHARACTER.rows; row += 1) {
      for (let col = 0; col < CHARACTER.cols; col += 1) {
        frames.push({
          sheet,
          row,
          col,
          src: frameSrc(sheet, row, col),
        });
      }
    }
  }

  return frames;
}

export function pointerToTarget({ clientX, clientY, element, range }) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height * 0.45;

  return {
    x: clamp((clientX - centerX) / range, -1, 1),
    y: clamp((clientY - centerY) / range, -1, 1),
  };
}

export function targetToCell(target) {
  return {
    col: clamp(
      Math.round(((target.x + 1) / 2) * (CHARACTER.cols - 1)),
      0,
      CHARACTER.cols - 1,
    ),
    row: clamp(
      Math.round(((target.y + 1) / 2) * (CHARACTER.rows - 1)),
      0,
      CHARACTER.rows - 1,
    ),
  };
}

export function mouthFromLevel(level, { thresholdHalf, thresholdFull }) {
  if (level >= thresholdFull) return 2;
  if (level >= thresholdHalf) return 1;
  return 0;
}

export function assetManifest() {
  return SHEET_DEFINITIONS.map((definition) => ({
    ...definition,
    frameCount: CHARACTER.rows * CHARACTER.cols,
    preview: frameSrc(definition.sheet, 2, 2),
  }));
}
