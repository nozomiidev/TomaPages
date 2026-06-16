const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clampChannel = (value) => Math.min(255, Math.max(0, Math.round(value)));
const clampRange = (value, min, max) => Math.min(max, Math.max(min, value));
const luma01 = ({ r, g, b }) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function colorStats({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);

  return {
    luma: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255,
    max,
    min,
    saturation: max === 0 ? 0 : (max - min) / max,
  };
}

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

  const {
    luma,
    max,
    saturation,
  } = colorStats({ r, g, b });

  const isGoldenRange = r > 145 && g > 82 && b < 125 && r >= g && g > r * 0.52 && saturation > 0.28;
  if (isGoldenRange) return 'eye';

  const isRedAccentRange = r > 145 && g > 35 && g < 150 && b < 170 && r > g * 1.12 && saturation > 0.3;
  const isDeepRedAccentRange = r > 92 && g < 96 && b < 125 && r > g * 1.22 && r >= b * 1.04 && saturation > 0.24;
  const isOrangeAccentRange = r > 158 && g > 68 && g < 174 && b < 118 && r > g * 1.02 && g > b * 1.04 && saturation > 0.32;
  const isPinkAccentRange = r > 165 && b > 95 && g < 145 && r > g * 1.18 && saturation > 0.22;
  if (isRedAccentRange || isDeepRedAccentRange || isOrangeAccentRange || isPinkAccentRange) return 'accent';

  const isSkin = r > 135 && g > 85 && b > 60 && r > g * 1.08 && g > b * 1.06;
  const isWhiteArea = luma > 0.78 && saturation < 0.2;
  const isWarmAccent = r > 135 && g > 65 && b < 130 && saturation > 0.3;
  const isDarkNeutralFill = max >= 34 && luma >= 0.12 && luma < 0.5 && saturation < 0.34;

  if (!isSkin && !isWhiteArea && !isWarmAccent && isDarkNeutralFill) {
    return 'hair';
  }

  return null;
}

function pixelAt(source, index) {
  return {
    a: source[index + 3],
    b: source[index + 2],
    g: source[index + 1],
    r: source[index],
  };
}

function isAccentSeedPixel(pixel) {
  return classifyAvatarPixel({
    ...pixel,
    height: 1,
    width: 1,
    x: 0,
    y: 0,
  }) === 'accent';
}

function isAccessoryEdgeCandidate(pixel) {
  if (pixel.a < 128) return false;

  const {
    luma,
    saturation,
  } = colorStats(pixel);
  const { r, g, b } = pixel;
  const isSkinLike = r > 145 && g > 95 && b > 80 && r > g * 1.04 && g > b * 0.92 && saturation < 0.42;
  const isWhiteArea = luma > 0.82 && saturation < 0.28;
  const isGoldenEyeEdge = r > 135 && g > 98 && b < 105 && r >= g && g > b * 1.18;
  const isMutedRedEdge = r > 86 && g < 148 && b < 168 && r > g * 1.08 && r > b * 0.86 && saturation > 0.14;
  const isMutedPinkEdge = r > 118 && b > 66 && g < 162 && r > g * 1.03 && saturation > 0.13;
  const isMutedOrangeEdge = r > 128 && g > 56 && b < 138 && r > g * 0.98 && g > b * 0.82 && saturation > 0.16;

  return !isSkinLike
    && !isWhiteArea
    && !isGoldenEyeEdge
    && luma > 0.12
    && luma < 0.82
    && (isMutedRedEdge || isMutedPinkEdge || isMutedOrangeEdge);
}

function isAccessoryHighlightCandidate(pixel) {
  if (pixel.a < 128) return false;

  const {
    luma,
    saturation,
  } = colorStats(pixel);
  const { r, g, b } = pixel;
  const isWhiteArea = luma > 0.88 && saturation < 0.24;
  const isGoldenEyeEdge = r > 135 && g > 98 && b < 105 && r >= g && g > b * 1.18;
  const isCoolRubyHighlight = r > 150 && g > 86 && b > 92 && b >= g * 0.96 && r > g * 1.12 && saturation > 0.18;
  const isSoftOrangeHighlight = r > 172 && g > 92 && g < 168 && b > 64 && b < 132 && r > g * 1.2 && saturation > 0.26;

  return !isWhiteArea
    && !isGoldenEyeEdge
    && luma > 0.22
    && luma < 0.76
    && (isCoolRubyHighlight || isSoftOrangeHighlight);
}

function hasMaskNeighbor(mask, x, y, width, height) {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (mask[ny * width + nx]) return true;
    }
  }

  return false;
}

function buildAccessoryAccentMask(sourceImageData) {
  const { data, height, width } = sourceImageData;
  const pixelCount = width * height;
  const edgeCandidateMask = new Uint8Array(pixelCount);
  const highlightCandidateMask = new Uint8Array(pixelCount);
  const accentMask = new Uint8Array(pixelCount);

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const pixel = pixelAt(data, pixelIndex * 4);
    if (isAccentSeedPixel(pixel)) {
      accentMask[pixelIndex] = 1;
    } else if (isAccessoryEdgeCandidate(pixel)) {
      edgeCandidateMask[pixelIndex] = 1;
    } else if (isAccessoryHighlightCandidate(pixel)) {
      highlightCandidateMask[pixelIndex] = 1;
    }
  }

  for (let pass = 0; pass < 3; pass += 1) {
    const previousMask = new Uint8Array(accentMask);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const pixelIndex = y * width + x;
        if (accentMask[pixelIndex]) continue;
        const isCandidate = edgeCandidateMask[pixelIndex]
          || (pass > 0 && highlightCandidateMask[pixelIndex]);
        if (!isCandidate) continue;
        if (hasMaskNeighbor(previousMask, x, y, width, height)) {
          accentMask[pixelIndex] = 1;
        }
      }
    }
  }

  return accentMask;
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

function writeSilkPixel({ index, source, target, tintStrength, tintTone, type }) {
  const sourceColor = {
    r: source[index],
    g: source[index + 1],
    b: source[index + 2],
  };
  const sourceTone = rgbToHsl(sourceColor);
  const sourceLuma = luma01(sourceColor);
  const saturation = type === 'hair'
    ? clampRange(sourceTone.s * 0.38 + tintTone.s * 0.46, 0.16, 0.66)
    : clampRange(sourceTone.s * 0.28 + tintTone.s * 0.62, 0.26, type === 'accent' ? 0.9 : 0.82);
  const lightness = type === 'hair'
    ? clampRange(sourceTone.l + (tintTone.l - 0.5) * 0.035, 0.04, 0.78)
    : clampRange(sourceTone.l + (tintTone.l - 0.5) * 0.05, 0.08, 0.86);
  const colorized = hslToRgb({
    h: tintTone.h,
    s: saturation,
    l: lightness,
  });
  const colorizedLuma = Math.max(0.001, luma01(colorized));
  const targetLuma = clampRange(
    sourceLuma + (tintTone.l - 0.5) * (type === 'hair' ? 0.01 : 0.018),
    0.01,
    0.98,
  );
  const lumaRatio = clampRange(targetLuma / colorizedLuma, 0.54, 1.62);
  const lumaPreserved = {
    r: clampChannel(colorized.r * lumaRatio),
    g: clampChannel(colorized.g * lumaRatio),
    b: clampChannel(colorized.b * lumaRatio),
  };
  const shadowProtection = 0.2 * (1 - smoothstep(0.08, 0.34, sourceLuma));
  const highlightProtection = 0.14 * smoothstep(0.68, 0.94, sourceLuma);
  const protectedAmount = shadowProtection + highlightProtection;
  const sourceBlend = clamp01((type === 'hair' ? 0.08 : 0.06) + protectedAmount * 0.24);
  const alphaBase = type === 'hair' ? 0.82 : type === 'accent' ? 0.9 : 0.86;
  const alpha = clamp01(tintStrength * alphaBase * (1 - protectedAmount * 0.48));

  target[index] = mixChannel(lumaPreserved.r, sourceColor.r, sourceBlend);
  target[index + 1] = mixChannel(lumaPreserved.g, sourceColor.g, sourceBlend);
  target[index + 2] = mixChannel(lumaPreserved.b, sourceColor.b, sourceBlend);
  target[index + 3] = Math.round(source[index + 3] * alpha);
}

function tintConfidenceForPixel(pixel, type) {
  const {
    luma,
    max,
    min,
    saturation,
  } = colorStats(pixel);
  const { r, g, b } = pixel;

  if (type === 'hair') {
    const neutralConfidence = 1 - smoothstep(0.24, 0.4, saturation);
    const lumaConfidence = smoothstep(0.1, 0.2, luma) * (1 - smoothstep(0.46, 0.58, luma));
    const contrastConfidence = smoothstep(16, 44, max - min + 16);
    return clampRange(neutralConfidence * lumaConfidence * (0.82 + contrastConfidence * 0.18), 0.18, 1);
  }

  if (type === 'eye') {
    const hueConfidence = smoothstep(132, 196, r)
      * smoothstep(72, 132, g)
      * (1 - smoothstep(112, 152, b));
    const saturationConfidence = smoothstep(0.24, 0.5, saturation);
    return clampRange(0.5 + hueConfidence * saturationConfidence * 0.5, 0.38, 1);
  }

  const redConfidence = smoothstep(100, 178, r)
    * (1 - smoothstep(132, 184, g))
    * (1 - smoothstep(132, 184, b));
  const pinkConfidence = smoothstep(102, 172, r)
    * smoothstep(62, 118, b)
    * (1 - smoothstep(146, 188, g));
  const orangeConfidence = smoothstep(132, 202, r)
    * smoothstep(56, 112, g)
    * (1 - smoothstep(120, 164, b));
  return clampRange(0.42 + Math.max(redConfidence, pinkConfidence, orangeConfidence) * 0.46, 0.32, 0.92);
}

function writeNaturalPixel({ index, source, target, tintStrength, tintTone, type }) {
  const sourceColor = {
    r: source[index],
    g: source[index + 1],
    b: source[index + 2],
  };
  const sourceTone = rgbToHsl(sourceColor);
  const sourceLuma = luma01(sourceColor);
  const confidence = tintConfidenceForPixel(sourceColor, type);
  const saturation = type === 'hair'
    ? clampRange(sourceTone.s * 0.5 + tintTone.s * 0.42, 0.08, 0.58)
    : clampRange(sourceTone.s * 0.24 + tintTone.s * 0.68, 0.3, type === 'accent' ? 0.88 : 0.82);
  const lightness = type === 'hair'
    ? clampRange(sourceTone.l + (tintTone.l - 0.5) * 0.018, 0.035, 0.8)
    : clampRange(sourceTone.l + (tintTone.l - 0.5) * 0.03, 0.08, 0.86);
  const colorized = hslToRgb({
    h: tintTone.h,
    s: saturation,
    l: lightness,
  });
  const colorizedLuma = Math.max(0.001, luma01(colorized));
  const targetLuma = clampRange(
    sourceLuma + (tintTone.l - 0.5) * (type === 'hair' ? 0.004 : 0.012),
    0.01,
    0.98,
  );
  const lumaRatio = clampRange(targetLuma / colorizedLuma, 0.5, 1.72);
  const lumaPreserved = {
    r: clampChannel(colorized.r * lumaRatio),
    g: clampChannel(colorized.g * lumaRatio),
    b: clampChannel(colorized.b * lumaRatio),
  };
  const shadowProtection = (type === 'hair' ? 0.32 : 0.14) * (1 - smoothstep(0.08, 0.3, sourceLuma));
  const highlightProtection = (type === 'hair' ? 0.18 : 0.24) * smoothstep(0.64, 0.94, sourceLuma);
  const typeAmount = type === 'hair' ? 0.78 : type === 'accent' ? 0.88 : 0.9;
  const amount = clamp01(tintStrength * typeAmount * confidence * (1 - shadowProtection - highlightProtection));

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
  const filterMode = ['natural', 'paint', 'silk', 'soft', 'grade'].includes(options.filterMode)
    ? options.filterMode
    : 'natural';
  const hairTone = rgbToHsl(hairColor);
  const eyeTone = rgbToHsl(eyeColor);
  const accentMask = eyeStrength > 0 ? buildAccessoryAccentMask(sourceImageData) : null;
  let changedPixels = 0;

  target.fill(0);

  if (hairStrength === 0 && eyeStrength === 0) return changedPixels;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const a = source[index + 3];
      const type = accentMask?.[y * width + x]
        ? 'accent'
        : classifyAvatarPixel({
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
      } else if (filterMode === 'natural') {
        writeNaturalPixel({ index, source, target, tintStrength, tintTone, type });
      } else if (filterMode === 'silk') {
        writeSilkPixel({ index, source, target, tintStrength, tintTone, type });
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
