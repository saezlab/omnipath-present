"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "omnipath-floating-chat-state";

type FloatingChatState = {
  open: boolean;
  minimized: boolean;
};

const DEFAULT_STATE: FloatingChatState = {
  open: false,
  minimized: false,
};

export function useFloatingChatState() {
  const [state, setState] = useState<FloatingChatState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        setState({ ...DEFAULT_STATE, ...(JSON.parse(raw) as Partial<FloatingChatState>) });
      }
    } catch {
      // Ignore invalid persisted state.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const open = useCallback(() => {
    setState({ open: true, minimized: false });
  }, []);

  const close = useCallback(() => {
    setState((prev) => ({ ...prev, open: false }));
  }, []);

  const minimize = useCallback(() => {
    setState((prev) => ({ ...prev, open: true, minimized: true }));
  }, []);

  const restore = useCallback(() => {
    setState((prev) => ({ ...prev, open: true, minimized: false }));
  }, []);

  return {
    hydrated,
    isOpen: state.open,
    isMinimized: state.minimized,
    open,
    close,
    minimize,
    restore,
  };
}
