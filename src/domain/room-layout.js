export const ROOM_CARD_BASE_WIDTH = 286;
export const ROOM_CARD_BASE_HEIGHT = 184;

const BASE_GAP = 18;
const MAX_COLUMNS = 4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function sceneMargin(width, height) {
  return clamp(Math.min(width, height) * 0.045, 16, 30);
}

function candidateColumns(width, count) {
  if (count <= 1) return [1];

  const maxByWidth = width >= 1080
    ? MAX_COLUMNS
    : width >= 760
      ? 3
      : width >= 320
        ? 2
        : 1;

  return Array.from({ length: Math.min(count, maxByWidth) }, (_, index) => index + 1);
}

function scoreLayout({ cols, rows, scale }, width, height) {
  const sceneRatio = width / Math.max(1, height);
  const gridRatio = cols / Math.max(1, rows);
  const balancePenalty = Math.abs(sceneRatio - gridRatio) * 2.4;
  const smallCardPenalty = scale < 0.54 ? (0.54 - scale) * 52 : 0;

  return scale * 100 - rows * 1.8 - balancePenalty - smallCardPenalty;
}

export function computeRoomSceneLayout(width, height, count) {
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);

  if (safeWidth === 0 || safeHeight === 0 || count <= 0) {
    return {
      cardHeight: 0,
      cardWidth: 0,
      cols: 0,
      gap: 0,
      layouts: [],
      rows: 0,
      scale: 0,
    };
  }

  const margin = sceneMargin(safeWidth, safeHeight);
  const availableWidth = Math.max(1, safeWidth - margin * 2);
  const availableHeight = Math.max(1, safeHeight - margin * 2);
  let best = null;

  for (const cols of candidateColumns(safeWidth, count)) {
    const rows = Math.ceil(count / cols);
    const gap = clamp(BASE_GAP * (cols > 1 || rows > 1 ? 1 : 0.72), 8, BASE_GAP);
    const widthScale = (availableWidth - gap * (cols - 1)) / (ROOM_CARD_BASE_WIDTH * cols);
    const heightScale = (availableHeight - gap * (rows - 1)) / (ROOM_CARD_BASE_HEIGHT * rows);
    const scale = Math.min(1, widthScale, heightScale);

    if (scale <= 0) continue;

    const cardWidth = Math.max(1, Math.floor(ROOM_CARD_BASE_WIDTH * scale));
    const cardHeight = Math.max(1, Math.floor(ROOM_CARD_BASE_HEIGHT * scale));
    const totalWidth = cardWidth * cols + gap * (cols - 1);
    const totalHeight = cardHeight * rows + gap * (rows - 1);
    const score = scoreLayout({ cols, rows, scale }, availableWidth, availableHeight);

    if (!best || score > best.score) {
      best = {
        cardHeight,
        cardWidth,
        cols,
        gap,
        rows,
        scale,
        score,
        totalHeight,
        totalWidth,
      };
    }
  }

  const layout = best ?? {
    cardHeight: Math.min(ROOM_CARD_BASE_HEIGHT, availableHeight),
    cardWidth: Math.min(ROOM_CARD_BASE_WIDTH, availableWidth),
    cols: 1,
    gap: 0,
    rows: count,
    scale: Math.min(availableWidth / ROOM_CARD_BASE_WIDTH, availableHeight / ROOM_CARD_BASE_HEIGHT, 1),
    totalHeight: availableHeight,
    totalWidth: availableWidth,
  };

  const startX = Math.max(margin, (safeWidth - layout.totalWidth) / 2);
  const startY = Math.max(margin, (safeHeight - layout.totalHeight) / 2);

  return {
    cardHeight: layout.cardHeight,
    cardWidth: layout.cardWidth,
    cols: layout.cols,
    gap: layout.gap,
    layouts: Array.from({ length: count }, (_, index) => {
      const col = index % layout.cols;
      const row = Math.floor(index / layout.cols);
      return {
        height: layout.cardHeight,
        scale: layout.scale,
        width: layout.cardWidth,
        x: startX + col * (layout.cardWidth + layout.gap),
        y: startY + row * (layout.cardHeight + layout.gap),
      };
    }),
    rows: layout.rows,
    scale: layout.scale,
  };
}

export function isPointInLayout({ x, y }, layout) {
  return x >= layout.x
    && x <= layout.x + layout.width
    && y >= layout.y
    && y <= layout.y + layout.height;
}
