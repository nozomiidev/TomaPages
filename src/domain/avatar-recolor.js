const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clampChannel = (value) => Math.min(255, Math.max(0, Math.round(value)));
const clampRange = (value, min, max) => Math.min(max, Math.max(min, value));
const luma01 = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

export function parseHexColor(value, fallback = { r: 255, g: 255, b: 255 }) {
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().replace(/^#/, '');
  const expanded = normalized.length === 3
    ? normalized.split('').map((item) => `${item}${item}`).join('')
    : normalized;

  if (!/^[0-9a-f]{6}$/i.test(expanded)) return fallback;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

export function classifyAvatarPixel({ r, g, b, a, x, y, width, height }) {
  if (a < 160) return null;
  void x;
  void y;
  void width;
  void height;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  const isGoldenRange = r > 145 && g > 82 && b < 125 && r >= g && saturation > 0.28;
  if (isGoldenRange) return 'eye';

  const isRedAccentRange = r > 145 && g > 35 && g < 150 && b < 170 && r > g * 1.12 && saturation > 0.3;
  const isPinkAccentRange = r > 165 && b > 95 && g < 145 && r > g * 1.18 && saturation > 0.22;
  if (isRedAccentRange || isPinkAccentRange) return 'accent';

  const isSkin = r > 135 && g > 85 && b > 60 && r > g * 1.08 && g > b * 1.06;
  const isWhiteArea = luma > 0.78 && saturation < 0.2;
  const isWarmAccent = r > 135 && g > 65 && b < 130 && saturation > 0.3;
  const isDarkNeutralFill = max >= 34 && luma >= 0.12 && luma < 0.5 && saturation < 0.34;

  if (!isSkin && !isWhiteArea && !isWarmAccent && isDarkNeutralFill) {
    return 'hair';
  }

  return null;
}

function rgbToHsl({ r, g, b }) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: lightness };

  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  let hue;

  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }

  return {
    h: hue / 6,
    s: saturation,
    l: lightness,
  };
}

function hueToRgb(p, q, t) {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb({ h, s, l }) {
  if (s === 0) {
    const gray = clampChannel(l * 255);
    return { r: gray, g: gray, b: gray };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: clampChannel(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampChannel(hueToRgb(p, q, h) * 255),
    b: clampChannel(hueToRgb(p, q, h - 1 / 3) * 255),
  };
}

function mixChannel(source, target, amount) {
  return clampChannel(source + (target - source) * amount);
}

function smoothstep(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clampRange((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function writePaintPixel({ index, source, target, tintColor, tintStrength, type }) {
  const max = Math.max(source[index], source[index + 1], source[index + 2]);
  const min = Math.min(source[index], source[index + 1], source[index + 2]);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const shadeBoost = type === 'hair' ? 0.7 + (1 - max / 255) * 0.3 : 0.72 + saturation * 0.28;
  const colorBoost = type === 'hair' ? 1.12 + (1 - max / 255) * 0.58 : 1;
  const alphaBoost = type === 'accent' ? 1.04 : 1;

  target[index] = clampChannel(tintColor.r * colorBoost);
  target[index + 1] = clampChannel(tintColor.g * colorBoost);
  target[index + 2] = clampChannel(tintColor.b * colorBoost);
  target[index + 3] = Math.round(source[index + 3] * tintStrength * shadeBoost * alphaBoost);
}

function writeSoftPixel({ index, source, target, tintStrength, tintTone, type }) {
  const sourceColor = {
    r: source[index],
    g: source[index + 1],
    b: source[index + 2],
  };
  const sourceTone = rgbToHsl(sourceColor);
  const saturation = type === 'hair'
    ? clampRange(tintTone.s * 0.74 + sourceTone.s * 0.16, 0.28, 0.78)
    : clampRange(tintTone.s * 0.9 + sourceTone.s * 0.08, 0.44, type === 'accent' ? 0.96 : 0.9);
  const lightness = type === 'hair'
    ? clampRange(sourceTone.l * 0.98, 0.08, 0.56)
    : clampRange(sourceTone.l * (type === 'accent' ? 0.9 : 0.96) + 0.015, 0.16, 0.72);
  const recolored = hslToRgb({
    h: tintTone.h,
    s: saturation,
    l: lightness,
  });
  const amount = type === 'hair' ? tintStrength * 0.92 : tintStrength * (type === 'accent' ? 1 : 0.98);

  target[index] = mixChannel(sourceColor.r, recolored.r, amount);
  target[index + 1] = mixChannel(sourceColor.g, recolored.g, amount);
  target[index + 2] = mixChannel(sourceColor.b, recolored.b, amount);
  target[index + 3] = source[index + 3];
}

function writeGradePixel({ index, source, target, tintStrength, tintTone, type }) {
  const sourceColor = {
    r: source[index],
    g: source[index + 1],
    b: source[index + 2],
  };
  const sourceTone = rgbToHsl(sourceColor);
  const sourceLuma = luma01(sourceColor);
  const saturation = type === 'hair'
    ? clampRange(tintTone.s * 0.76 + sourceTone.s * 0.24, 0.2, 0.7)
    : clampRange(tintTone.s * 0.86 + sourceTone.s * 0.16, 0.34, type === 'accent' ? 0.94 : 0.86);
  const lightness = type === 'hair'
    ? clampRange(sourceTone.l + (tintTone.l - 0.5) * 0.07, 0.05, 0.72)
    : clampRange(sourceTone.l + (tintTone.l - 0.5) * 0.045, 0.1, 0.78);
  const colorized = hslToRgb({
    h: tintTone.h,
    s: saturation,
    l: lightness,
  });
  const colorizedLuma = Math.max(0.001, luma01(colorized));
  const targetLuma = clampRange(
    sourceLuma * (0.96 + tintTone.l * 0.08) + (tintTone.l - 0.5) * 0.025,
    0.015,
    0.96,
  );
  const lumaRatio = clampRange(targetLuma / colorizedLuma, 0.45, 1.75);
  const lumaPreserved = {
    r: clampChannel(colorized.r * lumaRatio),
    g: clampChannel(colorized.g * lumaRatio),
    b: clampChannel(colorized.b * lumaRatio),
  };
  const shadowProtection = 0.18 * (1 - smoothstep(0.08, 0.36, sourceLuma));
  const highlightProtection = 0.08 * smoothstep(0.72, 0.94, sourceLuma);
  const typeAmount = type === 'hair' ? 0.82 : type === 'accent' ? 1 : 0.98;
  const amount = clamp01(tintStrength * typeAmount * (1 - shadowProtection - highlightProtection));

  target[index] = mixChannel(sourceColor.r, lumaPreserved.r, amount);
  target[index + 1] = mixChannel(sourceColor.g, lumaPreserved.g, amount);
  target[index + 2] = mixChannel(sourceColor.b, lumaPreserved.b, amount);
  target[index + 3] = source[index + 3];
}

export function writeAvatarTintOverlay(sourceImageData, targetImageData, options) {
  const { width, height } = sourceImageData;
  const source = sourceImageData.data;
  const target = targetImageData.data;
  const hairStrength = clamp01(options.hairStrength);
  const eyeStrength = clamp01(options.eyeStrength);
  const hairColor = parseHexColor(options.hairColor, { r: 109, g: 91, b: 208 });
  const eyeColor = parseHexColor(options.eyeColor, { r: 43, g: 167, b: 232 });
  const filterMode = ['paint', 'soft'].includes(options.filterMode) ? options.filterMode : 'grade';
  const hairTone = rgbToHsl(hairColor);
  const eyeTone = rgbToHsl(eyeColor);
  let changedPixels = 0;

  target.fill(0);

  if (hairStrength === 0 && eyeStrength === 0) return changedPixels;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const a = source[index + 3];
      const type = classifyAvatarPixel({
        r: source[index],
        g: source[index + 1],
        b: source[index + 2],
        a,
        x,
        y,
        width,
        height,
      });

      if (!type) continue;

      const tintStrength = type === 'hair' ? hairStrength : eyeStrength;
      if (tintStrength === 0) continue;

      const tintColor = type === 'hair' ? hairColor : eyeColor;
      const tintTone = type === 'hair' ? hairTone : eyeTone;

      if (filterMode === 'paint') {
        writePaintPixel({ index, source, target, tintColor, tintStrength, type });
      } else if (filterMode === 'soft') {
        writeSoftPixel({ index, source, target, tintStrength, tintTone, type });
      } else {
        writeGradePixel({ index, source, target, tintStrength, tintTone, type });
      }

      changedPixels += 1;
    }
  }

  return changedPixels;
}
