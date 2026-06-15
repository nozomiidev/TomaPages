import { useEffect, useRef } from 'react';

export function useAnimationFrame(callback, enabled = true) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;

    let frameId;
    const tick = (time) => {
      callbackRef.current(time);
      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [enabled]);
}
