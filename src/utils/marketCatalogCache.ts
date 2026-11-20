import { EVE_ITEMS, MARKET_CATEGORIES } from '../data/eveCatalog.ts';
import type {
  CatalogSku,
  DynamicMarketCatalog,
  MarketCategoryId,
} from '../types/eve.ts';

export const CATALOG_SCHEMA_VERSION = 2;
export const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const MARKET_REFRESH_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes (300s ESI cache)
export const CATALOG_REBUILD_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour (3600s)

const CATALOG_STORAGE_KEY = 'foxy_redfox_esi_catalog_v2';
const MARKET_COOLDOWN_KEY = 'foxy_redfox_market_refresh_until';
const CATALOG_COOLDOWN_KEY = 'foxy_redfox_catalog_rebuild_until';

export function buildBaselineCatalog(): DynamicMarketCatalog {
  const categories = {} as Record<MarketCategoryId, CatalogSku[]>;
  const groupByCat = Object.fromEntries(
    MARKET_CATEGORIES.map((c) => [c.id, c.marketGroupId])
  ) as Record<MarketCategoryId, number>;

  for (const cat of MARKET_CATEGORIES) {
    categories[cat.id] = [];
  }

  let total = 0;
  for (const item of EVE_ITEMS) {
    if (item.category === 'indy_support') continue;
    categories[item.category].push({
      typeId: item.typeId,
      name: item.name,
      category: item.category,
      marketGroupId: groupByCat[item.category] ?? 0,
      volume: item.volume,
      estDailyJitaVol: item.estDailyJitaVol,
      estDailyDodixieVol: item.estDailyDodixieVol,
      isBaseline: true,
    });
    total += 1;
  }

  return {
    version: CATALOG_SCHEMA_VERSION,
    builtAt: new Date().toISOString(),
    expiresAt: 0,
    source: 'baseline_fallback',
    totalSkus: total,
    categories,
  };
}

export function loadCachedCatalog(): DynamicMarketCatalog | null {
  try {
    const raw = localStorage.getItem(CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DynamicMarketCatalog;
    if (
      !parsed ||
      parsed.version !== CATALOG_SCHEMA_VERSION ||
      parsed.source !== 'esi_live' ||
      !parsed.categories ||
      !parsed.expiresAt ||
      Date.now() > parsed.expiresAt
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveCachedCatalog(catalog: DynamicMarketCatalog): void {
  try {
    localStorage.setItem(CATALOG_STORAGE_KEY, JSON.stringify(catalog));
  } catch {
    // Ignore quota errors in restricted storage environments
  }
}

export function clearCachedCatalog(): void {
  try {
    localStorage.removeItem(CATALOG_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function getCooldownUntil(kind: 'market' | 'catalog'): number {
  try {
    const key = kind === 'market' ? MARKET_COOLDOWN_KEY : CATALOG_COOLDOWN_KEY;
    const raw = localStorage.getItem(key);
    const ts = Number(raw || 0);
    return Number.isFinite(ts) && ts > Date.now() ? ts : 0;
  } catch {
    return 0;
  }
}

export function setCooldownUntil(kind: 'market' | 'catalog', untilMs: number): void {
  try {
    const key = kind === 'market' ? MARKET_COOLDOWN_KEY : CATALOG_COOLDOWN_KEY;
    if (untilMs <= Date.now()) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(untilMs));
    }
  } catch {
    // Ignore
  }
}

export function formatCooldownDuration(remainingSec: number): string {
  const sec = Math.max(0, Math.ceil(remainingSec));
  const mins = Math.floor(sec / 60);
  const rem = sec % 60;
  if (mins >= 60) {
    const hrs = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `${hrs}h ${String(remMins).padStart(2, '0')}m`;
  }
  if (mins > 0) {
    return `${mins}m ${String(rem).padStart(2, '0')}s`;
  }
  return `${rem}s`;
}
