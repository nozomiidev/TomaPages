import { useEffect, useMemo, useState } from 'react';
import { writeAvatarTintOverlay } from '../domain/avatar-recolor';

const overlayCache = new Map();
const CACHE_LIMIT = 72;

function normalizedStrength(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  return Math.min(1, Math.max(0, numeric)).toFixed(2);
}

function makeCacheKey(src, options) {
  const hairStrength = normalizedStrength(options.hairStrength);
  const eyeStrength = normalizedStrength(options.eyeStrength);

  if (hairStrength === '0.00' && eyeStrength === '0.00') return '';

  return [
    src,
    options.hairColor,
    hairStrength,
    options.eyeColor,
    eyeStrength,
  ].join('|');
}

function rememberOverlay(key, value) {
  overlayCache.set(key, value);
  if (overlayCache.size <= CACHE_LIMIT) return;

  const oldestKey = overlayCache.keys().next().value;
  overlayCache.delete(oldestKey);
}

function renderOverlay(src, options) {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = 'async';

    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) {
          resolve('');
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        const source = context.getImageData(0, 0, width, height);
        const target = context.createImageData(width, height);
        const changedPixels = writeAvatarTintOverlay(source, target, options);

        if (changedPixels === 0) {
          resolve('');
          return;
        }

        context.clearRect(0, 0, width, height);
        context.putImageData(target, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch {
        resolve('');
      }
    };

    image.onerror = () => resolve('');
    image.src = src;
  });
}

export function useAvatarTintOverlay(src, options) {
  const {
    eyeColor,
    eyeStrength,
    hairColor,
    hairStrength,
  } = options;
  const stableOptions = useMemo(() => ({
    eyeColor,
    eyeStrength,
    hairColor,
    hairStrength,
  }), [eyeColor, eyeStrength, hairColor, hairStrength]);
  const cacheKey = useMemo(() => makeCacheKey(src, stableOptions), [src, stableOptions]);
  const [overlaySrc, setOverlaySrc] = useState(() => (
    cacheKey ? overlayCache.get(cacheKey) ?? '' : ''
  ));

  useEffect(() => {
    if (!cacheKey || !src) {
      setOverlaySrc('');
      return undefined;
    }

    const cachedOverlay = overlayCache.get(cacheKey);
    if (cachedOverlay !== undefined) {
      setOverlaySrc(cachedOverlay);
      return undefined;
    }

    let isCancelled = false;
    setOverlaySrc('');

    renderOverlay(src, stableOptions).then((nextOverlay) => {
      rememberOverlay(cacheKey, nextOverlay);
      if (!isCancelled) setOverlaySrc(nextOverlay);
    });

    return () => {
      isCancelled = true;
    };
  }, [cacheKey, stableOptions, src]);

  return overlaySrc;
}
