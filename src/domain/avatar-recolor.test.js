import { describe, expect, it } from 'vitest';
import { classifyAvatarPixel, parseHexColor, writeAvatarTintOverlay } from './avatar-recolor';

const basePixel = {
  a: 255,
  width: 1200,
  height: 1200,
};

function luma([r, g, b]) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function compositeOverSource(source, overlay) {
  const alpha = overlay[3] / 255;
  return [
    Math.round(source[0] * (1 - alpha) + overlay[0] * alpha),
    Math.round(source[1] * (1 - alpha) + overlay[1] * alpha),
    Math.round(source[2] * (1 - alpha) + overlay[2] * alpha),
    255,
  ];
}

function renderHairPixel([r, g, b], filterMode = 'soft') {
  const source = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([r, g, b, 255]),
  };
  const target = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
  };

  writeAvatarTintOverlay(source, target, {
    filterMode,
    hairColor: '#0F766E',
    hairStrength: 1,
    eyeColor: '#A855F7',
    eyeStrength: 0,
  });

  return Array.from(target.data);
}

function renderAccentPixel([r, g, b], filterMode = 'soft') {
  const source = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([r, g, b, 255]),
  };
  const target = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray(4),
  };

  writeAvatarTintOverlay(source, target, {
    filterMode,
    hairColor: '#0F766E',
    hairStrength: 0,
    eyeColor: '#A855F7',
    eyeStrength: 1,
  });

  return Array.from(target.data);
}

describe('avatar recolor domain', () => {
  it('parses hex colors with long and short notation', () => {
    expect(parseHexColor('#2BA7E8')).toEqual({ r: 43, g: 167, b: 232 });
    expect(parseHexColor('#0f6')).toEqual({ r: 0, g: 255, b: 102 });
  });

  it('keeps invalid colors on the provided fallback', () => {
    expect(parseHexColor('not-a-color', { r: 1, g: 2, b: 3 })).toEqual({ r: 1, g: 2, b: 3 });
  });

  it('classifies golden pixels by color range instead of frame coordinates', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 242,
      g: 183,
      b: 5,
      x: 1040,
      y: 980,
    })).toBe('eye');
  });

  it('classifies dark neutral pixels by color range instead of frame coordinates', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 58,
      g: 60,
      b: 58,
      x: 1040,
      y: 980,
    })).toBe('hair');
  });

  it('classifies red and pink accessory accents as a third color range', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 236,
      g: 76,
      b: 52,
      x: 850,
      y: 320,
    })).toBe('accent');
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 224,
      g: 82,
      b: 142,
      x: 850,
      y: 320,
    })).toBe('accent');
  });

  it('does not recolor skin or transparent pixels', () => {
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 246,
      g: 212,
      b: 180,
      x: 600,
      y: 600,
    })).toBeNull();
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 58,
      g: 60,
      b: 58,
      a: 0,
      x: 360,
      y: 320,
    })).toBeNull();
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 58,
      g: 60,
      b: 58,
      a: 96,
      x: 360,
      y: 320,
    })).toBeNull();
  });

  it('soft filter keeps source shading instead of producing a flat fill', () => {
    const darkHair = renderHairPixel([58, 60, 58]);
    const lightHair = renderHairPixel([112, 116, 112]);

    expect(darkHair[3]).toBe(255);
    expect(lightHair[3]).toBe(255);
    expect(luma(lightHair)).toBeGreaterThan(luma(darkHair));
  });

  it('grade filter preserves luminance while shifting the color smoothly', () => {
    const darkSource = [58, 60, 58];
    const lightSource = [112, 116, 112];
    const darkHair = renderHairPixel(darkSource, 'grade');
    const lightHair = renderHairPixel(lightSource, 'grade');

    expect(darkHair[3]).toBe(255);
    expect(lightHair[3]).toBe(255);
    expect(darkHair[1]).toBeGreaterThan(darkHair[0]);
    expect(lightHair[1]).toBeGreaterThan(lightHair[0]);
    expect(luma(lightHair)).toBeGreaterThan(luma(darkHair) + 30);
    expect(Math.abs(luma(darkHair) - luma(darkSource))).toBeLessThan(24);
    expect(Math.abs(luma(lightHair) - luma(lightSource))).toBeLessThan(24);
  });

  it('silk filter uses a translucent glaze so source detail keeps showing through', () => {
    const darkSource = [58, 60, 58];
    const lightSource = [112, 116, 112];
    const darkOverlay = renderHairPixel(darkSource, 'silk');
    const lightOverlay = renderHairPixel(lightSource, 'silk');
    const darkHair = compositeOverSource(darkSource, darkOverlay);
    const lightHair = compositeOverSource(lightSource, lightOverlay);

    expect(darkOverlay[3]).toBeGreaterThan(120);
    expect(darkOverlay[3]).toBeLessThan(255);
    expect(lightOverlay[3]).toBeLessThan(255);
    expect(darkHair[1]).toBeGreaterThan(darkHair[0]);
    expect(lightHair[1]).toBeGreaterThan(lightHair[0]);
    expect(luma(lightHair)).toBeGreaterThan(luma(darkHair) + 38);
    expect(Math.abs(luma(darkHair) - luma(darkSource))).toBeLessThan(16);
    expect(Math.abs(luma(lightHair) - luma(lightSource))).toBeLessThan(18);
  });

  it('paint filter remains available as a translucent color overlay', () => {
    const paintedHair = renderHairPixel([58, 60, 58], 'paint');

    expect(paintedHair[3]).toBeLessThan(255);
    expect(paintedHair[1]).toBeGreaterThan(paintedHair[0]);
  });

  it('accessory accents follow the eye recolor channel', () => {
    const recoloredAccent = renderAccentPixel([236, 76, 52]);

    expect(recoloredAccent[2]).toBeGreaterThan(recoloredAccent[1]);
    expect(recoloredAccent[3]).toBe(255);
  });
});
