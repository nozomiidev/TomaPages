import { useCallback, useEffect, useState } from 'react';

export function usePersistentState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? { ...defaultValue, ...JSON.parse(stored) } : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Local storage is optional; private browsing or embedded capture pages can block it.
    }
  }, [key, value]);

  const patchValue = useCallback((patch) => {
    setValue((current) => ({
      ...current,
      ...(typeof patch === 'function' ? patch(current) : patch),
    }));
  }, []);

  return [value, patchValue, setValue];
}
