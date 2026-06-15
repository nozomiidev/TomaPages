export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(current, target, amount) {
  return current + (target - current) * amount;
}

export function roundToStep(value, step) {
  const decimals = String(step).split('.')[1]?.length ?? 0;
  return Number((Math.round(value / step) * step).toFixed(decimals));
}
