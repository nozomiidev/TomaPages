import { clamp } from '../lib/math';

const BASE_URL = import.meta.env.BASE_URL;

export const CHARACTER = {
  rows: 5,
  cols: 5,
  basePath: `${BASE_URL}slices2`,
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

const TOMARI_SHEETS = [
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

const REIMU_SHEETS = [
  {
    sheet: 'pl_01',
    name: 'Reimu plush / closed mouth',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'om_01',
    name: 'Reimu plush / open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'ce_01',
    name: 'Reimu plush / blink',
    eyes: 'closed',
    mouth: 'closed',
  },
];

export const CHARACTER_DEFINITIONS = {
  tomari: {
    id: 'tomari',
    label: 'Tomari',
    kind: 'bust',
    rows: CHARACTER.rows,
    cols: CHARACTER.cols,
    basePath: CHARACTER.basePath,
    ext: CHARACTER.ext,
    supportsTint: true,
    sheets: CHARACTER.sheets,
    sheetDefinitions: TOMARI_SHEETS,
  },
  reimu: {
    id: 'reimu',
    label: 'Reimu Fumo',
    kind: 'full-body plush',
    rows: 5,
    cols: 5,
    basePath: `${BASE_URL}characters/reimu`,
    ext: 'webp',
    supportsTint: false,
    sheets: {
      eyesOpen: {
        closedMouth: 'pl_01',
        halfMouth: 'om_01',
        openMouth: 'om_01',
      },
      eyesClosed: {
        closedMouth: 'ce_01',
        halfMouth: 'ce_01',
        openMouth: 'ce_01',
      },
    },
    sheetDefinitions: REIMU_SHEETS,
  },
};

export const CHARACTER_OPTIONS = Object.values(CHARACTER_DEFINITIONS).map((character) => ({
  id: character.id,
  label: character.label,
}));

export const MOUTH_STATES = [
  { id: 0, label: 'Closed', shortLabel: 'quiet', key: 'closedMouth' },
  { id: 1, label: 'Half open', shortLabel: 'talk', key: 'halfMouth' },
  { id: 2, label: 'Open', shortLabel: 'loud', key: 'openMouth' },
];

export const SHEET_DEFINITIONS = TOMARI_SHEETS;

export function characterForId(characterId = 'tomari') {
  return CHARACTER_DEFINITIONS[characterId] ?? CHARACTER_DEFINITIONS.tomari;
}

export function frameSrc(sheet, row, col, characterId = 'tomari') {
  const character = characterForId(characterId);
  return `${character.basePath}/${sheet}/r${row}c${col}.${character.ext}`;
}

export function sheetForPose({ blink, characterId = 'tomari', mouth }) {
  const character = characterForId(characterId);
  const mouthState = MOUTH_STATES[mouth] ?? MOUTH_STATES[0];
  const eyeSet = blink ? character.sheets.eyesClosed : character.sheets.eyesOpen;
  return eyeSet[mouthState.key];
}

export function allFrames({ characterId = 'tomari', includeMouthStates = true } = {}) {
  const character = characterForId(characterId);
  const sheets = includeMouthStates
    ? Array.from(new Set([
      character.sheets.eyesOpen.closedMouth,
      character.sheets.eyesOpen.halfMouth,
      character.sheets.eyesOpen.openMouth,
      character.sheets.eyesClosed.closedMouth,
      character.sheets.eyesClosed.halfMouth,
      character.sheets.eyesClosed.openMouth,
    ]))
    : [character.sheets.eyesOpen.closedMouth, character.sheets.eyesClosed.closedMouth];
  const frames = [];

  for (const sheet of sheets) {
    for (let row = 0; row < character.rows; row += 1) {
      for (let col = 0; col < character.cols; col += 1) {
        frames.push({
          characterId: character.id,
          sheet,
          row,
          col,
          src: frameSrc(sheet, row, col, character.id),
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

export function assetManifest(characterId = 'tomari') {
  const character = characterForId(characterId);
  return character.sheetDefinitions.map((definition) => ({
    ...definition,
    character: character.label,
    frameCount: character.rows * character.cols,
    preview: frameSrc(definition.sheet, 2, 2, character.id),
  }));
}
