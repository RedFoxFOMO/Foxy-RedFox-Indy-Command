import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'foxy_collapsed_cards_v2';
const SYNC_EVENT = 'foxy-collapse-state-changed';

export type CollapseMap = Record<string, boolean>; // true = collapsed

export function loadCollapseMap(): CollapseMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CollapseMap;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveCollapseMap(map: CollapseMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    window.dispatchEvent(new CustomEvent(SYNC_EVENT));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

export function setCardCollapsed(cardKey: string, collapsed: boolean): void {
  const current = loadCollapseMap();
  current[cardKey] = collapsed;
  saveCollapseMap(current);
}

export function setManyCardsCollapsed(cardKeys: string[], collapsed: boolean): void {
  const current = loadCollapseMap();
  for (const key of cardKeys) {
    current[key] = collapsed;
  }
  saveCollapseMap(current);
}

/**
 * Persisted collapse/expand state for any dashboard card or panel.
 * State is synced across browser refreshes via localStorage and across
 * components via a lightweight custom window event.
 */
export function useCollapsibleCard(
  cardKey: string,
  defaultCollapsed = false
): [boolean, () => void, (next: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    const map = loadCollapseMap();
    return typeof map[cardKey] === 'boolean' ? map[cardKey] : defaultCollapsed;
  });

  useEffect(() => {
    const handleSync = () => {
      const map = loadCollapseMap();
      if (typeof map[cardKey] === 'boolean') {
        setCollapsedState(map[cardKey]);
      }
    };
    window.addEventListener(SYNC_EVENT, handleSync);
    return () => window.removeEventListener(SYNC_EVENT, handleSync);
  }, [cardKey]);

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      setCardCollapsed(cardKey, next);
    },
    [cardKey]
  );

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      setCardCollapsed(cardKey, next);
      return next;
    });
  }, [cardKey]);

  return [collapsed, toggle, setCollapsed];
}
