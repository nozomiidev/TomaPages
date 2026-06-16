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

function renderPixels(pixels, options = {}) {
  const source = {
    width: pixels.length,
    height: 1,
    data: new Uint8ClampedArray(pixels.flatMap(([r, g, b, a = 255]) => [r, g, b, a])),
  };
  const target = {
    width: pixels.length,
    height: 1,
    data: new Uint8ClampedArray(pixels.length * 4),
  };

  writeAvatarTintOverlay(source, target, {
    filterMode: options.filterMode ?? 'silk',
    hairColor: '#0F766E',
    hairStrength: options.hairStrength ?? 0,
    eyeColor: '#A855F7',
    eyeStrength: options.eyeStrength ?? 1,
  });

  return Array.from({ length: pixels.length }, (_, index) => (
    Array.from(target.data.slice(index * 4, index * 4 + 4))
  ));
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
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 118,
      g: 52,
      b: 65,
      x: 850,
      y: 320,
    })).toBe('accent');
    expect(classifyAvatarPixel({
      ...basePixel,
      r: 231,
      g: 112,
      b: 44,
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

  it('natural filter recolors smoothly without collapsing source contrast', () => {
    const darkSource = [58, 60, 58];
    const midSource = [78, 82, 78];
    const lightSource = [112, 116, 112];
    const darkHair = renderHairPixel(darkSource, 'natural');
    const midHair = renderHairPixel(midSource, 'natural');
    const lightHair = renderHairPixel(lightSource, 'natural');
    const paintedDark = compositeOverSource(darkSource, renderHairPixel(darkSource, 'paint'));
    const paintedLight = compositeOverSource(lightSource, renderHairPixel(lightSource, 'paint'));

    expect(darkHair[3]).toBe(255);
    expect(midHair[3]).toBe(255);
    expect(lightHair[3]).toBe(255);
    expect(darkHair[1]).toBeGreaterThan(darkHair[0]);
    expect(midHair[1]).toBeGreaterThan(midHair[0]);
    expect(luma(midHair)).toBeGreaterThan(luma(darkHair) + 12);
    expect(luma(lightHair)).toBeGreaterThan(luma(midHair) + 18);
    expect(Math.abs(luma(darkHair) - luma(darkSource))).toBeLessThan(16);
    expect(Math.abs(luma(lightHair) - luma(lightSource))).toBeLessThan(16);
    expect(luma(lightHair) - luma(darkHair)).toBeGreaterThan(
      luma(paintedLight) - luma(paintedDark) + 8,
    );
  });

  it('shade filter preserves source texture without a flat color overlay', () => {
    const darkSource = [58, 60, 58];
    const midSource = [78, 82, 78];
    const lightSource = [112, 116, 112];
    const darkHair = renderHairPixel(darkSource, 'shade');
    const midHair = renderHairPixel(midSource, 'shade');
    const lightHair = renderHairPixel(lightSource, 'shade');
    const paintedDark = compositeOverSource(darkSource, renderHairPixel(darkSource, 'paint'));
    const paintedLight = compositeOverSource(lightSource, renderHairPixel(lightSource, 'paint'));

    expect(darkHair[3]).toBe(255);
    expect(midHair[3]).toBe(255);
    expect(lightHair[3]).toBe(255);
    expect(darkHair[1]).toBeGreaterThan(darkHair[0]);
    expect(midHair[1]).toBeGreaterThan(midHair[0]);
    expect(lightHair[1]).toBeGreaterThan(lightHair[0]);
    expect(luma(midHair)).toBeGreaterThan(luma(darkHair) + 16);
    expect(luma(lightHair)).toBeGreaterThan(luma(midHair) + 24);
    expect(Math.abs(luma(darkHair) - luma(darkSource))).toBeLessThan(11);
    expect(Math.abs(luma(lightHair) - luma(lightSource))).toBeLessThan(11);
    expect(luma(lightHair) - luma(darkHair)).toBeGreaterThan(
      luma(paintedLight) - luma(paintedDark) + 14,
    );
  });

  it('smooth filter dyes through a translucent luma-preserving overlay', () => {
    const darkSource = [58, 60, 58];
    const midSource = [78, 82, 78];
    const lightSource = [112, 116, 112];
    const darkOverlay = renderHairPixel(darkSource, 'smooth');
    const midOverlay = renderHairPixel(midSource, 'smooth');
    const lightOverlay = renderHairPixel(lightSource, 'smooth');
    const darkHair = compositeOverSource(darkSource, darkOverlay);
    const midHair = compositeOverSource(midSource, midOverlay);
    const lightHair = compositeOverSource(lightSource, lightOverlay);
    const paintedDark = compositeOverSource(darkSource, renderHairPixel(darkSource, 'paint'));
    const paintedLight = compositeOverSource(lightSource, renderHairPixel(lightSource, 'paint'));

    expect(darkOverlay[3]).toBeGreaterThan(55);
    expect(darkOverlay[3]).toBeLessThan(205);
    expect(midOverlay[3]).toBeLessThan(205);
    expect(lightOverlay[3]).toBeLessThan(205);
    expect(darkHair[1]).toBeGreaterThan(darkHair[0]);
    expect(midHair[1]).toBeGreaterThan(midHair[0]);
    expect(luma(midHair)).toBeGreaterThan(luma(darkHair) + 13);
    expect(luma(lightHair)).toBeGreaterThan(luma(midHair) + 23);
    expect(Math.abs(luma(darkHair) - luma(darkSource))).toBeLessThan(10);
    expect(Math.abs(luma(lightHair) - luma(lightSource))).toBeLessThan(10);
    expect(luma(lightHair) - luma(darkHair)).toBeGreaterThan(
      luma(paintedLight) - luma(paintedDark) + 12,
    );
  });

  it('glaze filter keeps the original layer visible while shifting color smoothly', () => {
    const darkSource = [58, 60, 58];
    const midSource = [78, 82, 78];
    const lightSource = [112, 116, 112];
    const darkOverlay = renderHairPixel(darkSource, 'glaze');
    const midOverlay = renderHairPixel(midSource, 'glaze');
    const lightOverlay = renderHairPixel(lightSource, 'glaze');
    const darkHair = compositeOverSource(darkSource, darkOverlay);
    const midHair = compositeOverSource(midSource, midOverlay);
    const lightHair = compositeOverSource(lightSource, lightOverlay);

    expect(darkOverlay[3]).toBeGreaterThan(70);
    expect(darkOverlay[3]).toBeLessThan(220);
    expect(lightOverlay[3]).toBeLessThan(220);
    expect(darkHair[1]).toBeGreaterThan(darkHair[0]);
    expect(midHair[1]).toBeGreaterThan(midHair[0]);
    expect(luma(midHair)).toBeGreaterThan(luma(darkHair) + 12);
    expect(luma(lightHair)).toBeGreaterThan(luma(midHair) + 22);
    expect(Math.abs(luma(darkHair) - luma(darkSource))).toBeLessThan(13);
    expect(Math.abs(luma(lightHair) - luma(lightSource))).toBeLessThan(13);
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

  it('extends accessory recolor over connected muted edge colors without flooding skin tones', () => {
    const [
      mutedRedEdge,
      deepRedSeed,
      mutedPinkEdge,
      secondRingEdge,
      isolatedSkinTone,
    ] = renderPixels([
      [128, 86, 92],
      [236, 76, 52],
      [160, 118, 137],
      [132, 92, 102],
      [214, 162, 139],
    ]);

    expect(mutedRedEdge[3]).toBeGreaterThan(0);
    expect(deepRedSeed[3]).toBeGreaterThan(0);
    expect(mutedPinkEdge[3]).toBeGreaterThan(0);
    expect(secondRingEdge[3]).toBeGreaterThan(0);
    expect(isolatedSkinTone[3]).toBe(0);
  });

  it('fills connected red accessory highlight, shadow, and second-ring residue without touching adjacent skin', () => {
    const [
      coolRubyHighlight,
      redSeed,
      darkRubyShadow,
      desaturatedRubyResidue,
      adjacentSkinTone,
    ] = renderPixels([
      [181, 124, 126],
      [236, 76, 52],
      [104, 66, 72],
      [142, 105, 110],
      [214, 162, 139],
    ]);

    expect(coolRubyHighlight[3]).toBeGreaterThan(0);
    expect(redSeed[3]).toBeGreaterThan(0);
    expect(darkRubyShadow[3]).toBeGreaterThan(0);
    expect(desaturatedRubyResidue[3]).toBeGreaterThan(0);
    expect(adjacentSkinTone[3]).toBe(0);
  });

  it('uses a third accessory-only residue range for translucent antialias leftovers', () => {
    const [
      redSeed,
      mutedEdge,
      translucentResidue,
      adjacentSkinTone,
    ] = renderPixels([
      [236, 76, 52],
      [132, 91, 96, 190],
      [122, 92, 96, 112],
      [214, 162, 139],
    ]);

    expect(redSeed[3]).toBeGreaterThan(0);
    expect(mutedEdge[3]).toBeGreaterThan(0);
    expect(translucentResidue[3]).toBeGreaterThan(0);
    expect(adjacentSkinTone[3]).toBe(0);
  });

  it('does not let accessory residue jump across skin-colored pixels', () => {
    const [
      redSeed,
      skinBridge,
      isolatedResidue,
    ] = renderPixels([
      [236, 76, 52],
      [214, 162, 139],
      [122, 92, 96, 112],
    ]);

    expect(redSeed[3]).toBeGreaterThan(0);
    expect(skinBridge[3]).toBe(0);
    expect(isolatedResidue[3]).toBe(0);
  });
});
