import type { WatchlistItem } from '../types/eve.ts';

const WATCHLIST_STORAGE_KEY = 'foxy_pinned_watchlist_v2';

export function loadWatchlist(): WatchlistItem[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is WatchlistItem =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as WatchlistItem).id === 'string' &&
        typeof (item as WatchlistItem).typeId === 'number' &&
        typeof (item as WatchlistItem).name === 'string'
    );
  } catch {
    return [];
  }
}

export function saveWatchlist(items: WatchlistItem[]): void {
  try {
    localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage restrictions
  }
}
