import { clamp } from '../lib/math';

const BASE_URL = import.meta.env.BASE_URL;

const DEFAULT_VIDEO_FILTERS = [
  { id: 'none', label: 'None', filter: 'none' },
  { id: 'warm', label: 'Warm', filter: 'contrast(1.05) saturate(1.1) brightness(1.02)' },
  { id: 'cool', label: 'Cool', filter: 'contrast(1.03) saturate(1.01) brightness(1.01) hue-rotate(-8deg)' },
  { id: 'soft', label: 'Soft', filter: 'contrast(0.94) saturate(1.02) brightness(1.04)' },
  { id: 'clear', label: 'Crisp', filter: 'contrast(1.11) saturate(1.06) brightness(0.98)' },
];

const REIMU_VIDEO_FILTERS = [
  ...DEFAULT_VIDEO_FILTERS,
  { id: 'vivid', label: 'Vivid', filter: 'saturate(1.28) contrast(1.12) brightness(1.05)' },
];

const CIRNO_VIDEO_FILTERS = [
  ...DEFAULT_VIDEO_FILTERS,
  { id: 'icy', label: 'Icy', filter: 'hue-rotate(165deg) saturate(1.12) brightness(1.08)' },
];

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
    name: 'Reimu plush / plain',
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
    name: 'Reimu plush / closed eyes',
    eyes: 'closed',
    mouth: 'closed',
  },
  {
    sheet: 'pt_01',
    name: 'Reimu plush / T-pose',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'ot_01',
    name: 'Reimu plush / T-pose open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'ct_01',
    name: 'Reimu plush / T-pose closed eyes',
    eyes: 'closed',
    mouth: 'closed',
  },
  {
    sheet: 'py_01',
    name: 'Reimu plush / Y-pose',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'oy_01',
    name: 'Reimu plush / Y-pose open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'cy_01',
    name: 'Reimu plush / Y-pose closed eyes',
    eyes: 'closed',
    mouth: 'closed',
  },
];

const REIMU_POSE_SETS = {
  plain: {
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
  t: {
    eyesOpen: {
      closedMouth: 'pt_01',
      halfMouth: 'ot_01',
      openMouth: 'ot_01',
    },
    eyesClosed: {
      closedMouth: 'ct_01',
      halfMouth: 'ct_01',
      openMouth: 'ct_01',
    },
  },
  y: {
    eyesOpen: {
      closedMouth: 'py_01',
      halfMouth: 'oy_01',
      openMouth: 'oy_01',
    },
    eyesClosed: {
      closedMouth: 'cy_01',
      halfMouth: 'cy_01',
      openMouth: 'cy_01',
    },
  },
};

const CIRNO_POSE_SETS = {
  1: {
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
  2: {
    eyesOpen: {
      closedMouth: 'pl_02',
      halfMouth: 'om_02',
      openMouth: 'om_02',
    },
    eyesClosed: {
      closedMouth: 'ce_02',
      halfMouth: 'ce_02',
      openMouth: 'ce_02',
    },
  },
  3: {
    eyesOpen: {
      closedMouth: 'pl_03',
      halfMouth: 'om_03',
      openMouth: 'om_03',
    },
    eyesClosed: {
      closedMouth: 'ce_03',
      halfMouth: 'ce_03',
      openMouth: 'ce_03',
    },
  },
  4: {
    eyesOpen: {
      closedMouth: 'pl_04',
      halfMouth: 'om_04',
      openMouth: 'om_04',
    },
    eyesClosed: {
      closedMouth: 'ce_04',
      halfMouth: 'ce_04',
      openMouth: 'ce_04',
    },
  },
};

const CIRNO_SHEETS = [
  {
    sheet: 'pl_01',
    name: 'Cirno plush / Pose 01',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'om_01',
    name: 'Cirno plush / Pose 01 open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'ce_01',
    name: 'Cirno plush / Pose 01 closed eyes',
    eyes: 'closed',
    mouth: 'closed',
  },
  {
    sheet: 'pl_02',
    name: 'Cirno plush / Pose 02',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'om_02',
    name: 'Cirno plush / Pose 02 open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'ce_02',
    name: 'Cirno plush / Pose 02 closed eyes',
    eyes: 'closed',
    mouth: 'closed',
  },
  {
    sheet: 'pl_03',
    name: 'Cirno plush / Pose 03',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'om_03',
    name: 'Cirno plush / Pose 03 open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'ce_03',
    name: 'Cirno plush / Pose 03 closed eyes',
    eyes: 'closed',
    mouth: 'closed',
  },
  {
    sheet: 'pl_04',
    name: 'Cirno plush / Pose 04',
    eyes: 'open',
    mouth: 'closed',
  },
  {
    sheet: 'om_04',
    name: 'Cirno plush / Pose 04 open mouth',
    eyes: 'open',
    mouth: 'open',
  },
  {
    sheet: 'ce_04',
    name: 'Cirno plush / Pose 04 closed eyes',
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
    poseVariants: [],
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
    defaultPoseVariant: 'plain',
    sheets: REIMU_POSE_SETS.plain,
    sheetDefinitions: REIMU_SHEETS,
    poseSets: REIMU_POSE_SETS,
    videoFilters: REIMU_VIDEO_FILTERS,
    poseVariants: [
      { id: 'plain', label: 'Plain', shortcut: 'p' },
      { id: 't', label: 'T-pose', shortcut: 't' },
      { id: 'y', label: 'Y-pose', shortcut: 'y' },
    ],
  },
  cirno: {
    id: 'cirno',
    label: 'Cirno Fumo',
    kind: 'full-body plush',
    rows: 5,
    cols: 5,
    basePath: `${BASE_URL}characters/cirno`,
    ext: 'webp',
    supportsTint: false,
    defaultPoseVariant: '1',
    sheets: CIRNO_POSE_SETS[1],
    sheetDefinitions: CIRNO_SHEETS,
    poseSets: CIRNO_POSE_SETS,
    videoFilters: CIRNO_VIDEO_FILTERS,
    poseVariants: [
      { id: '1', label: 'Pose 01', shortcut: '1' },
      { id: '2', label: 'Pose 02', shortcut: '2' },
      { id: '3', label: 'Pose 03', shortcut: '3' },
      { id: '4', label: 'Pose 04', shortcut: '4' },
    ],
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

export function videoFiltersForCharacter(character = 'tomari') {
  const resolved = typeof character === 'string' ? characterForId(character) : character;
  return resolved.videoFilters ?? DEFAULT_VIDEO_FILTERS;
}

export function poseVariantForCharacter(character, poseVariant) {
  if (!character.poseVariants?.length) return null;
  return character.poseVariants.find((variant) => variant.id === poseVariant)
    ?? character.poseVariants.find((variant) => variant.id === character.defaultPoseVariant)
    ?? character.poseVariants[0];
}

function sheetSetForPoseVariant(character, poseVariant) {
  const variant = poseVariantForCharacter(character, poseVariant);
  return character.poseSets?.[variant?.id] ?? character.sheets;
}

export function frameSrc(sheet, row, col, characterId = 'tomari') {
  const character = characterForId(characterId);
  return `${character.basePath}/${sheet}/r${row}c${col}.${character.ext}`;
}

export function sheetForPose({
  blink,
  characterId = 'tomari',
  mouth,
  poseVariant,
}) {
  const character = characterForId(characterId);
  const sheetSet = sheetSetForPoseVariant(character, poseVariant);
  const mouthState = MOUTH_STATES[mouth] ?? MOUTH_STATES[0];
  const eyeSet = blink ? sheetSet.eyesClosed : sheetSet.eyesOpen;
  return eyeSet[mouthState.key];
}

export function allFrames({ characterId = 'tomari', includeMouthStates = true } = {}) {
  const character = characterForId(characterId);
  const sheets = includeMouthStates
    ? character.sheetDefinitions.map((definition) => definition.sheet)
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
    characterId: character.id,
    character: character.label,
    frameCount: character.rows * character.cols,
    preview: frameSrc(definition.sheet, 2, 2, character.id),
  }));
}
