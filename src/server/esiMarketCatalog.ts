import {
  CORRIDOR_SYSTEM_MAP,
  EVE_ANCHORS,
  EVE_ITEMS,
  ITEM_BY_ID,
  MARKET_CATEGORIES,
} from '../data/eveCatalog.ts';
import { EVE_USER_AGENT } from '../utils/eveMarketMath.ts';
import type {
  CatalogSku,
  CorridorOrder,
  DynamicMarketCatalog,
  EsiRateLimitState,
  MarketCacheTelemetry,
  MarketCategoryId,
  MarketQuote,
  OrderBookLevel,
} from '../types/eve.ts';

const CATALOG_SCHEMA_VERSION = 2;
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ORDER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (matches CCP ESI cache)
const ESI_USER_AGENT = EVE_USER_AGENT;

// --- Centralized ESI Rate-Limit & Error-Budget Tracker ---

const rateLimitState: EsiRateLimitState = {
  errorLimitRemain: null,
  errorLimitResetSec: null,
  ratelimitRemaining: null,
  retryAfterSec: null,
  paused: false,
  pauseReason: undefined,
  pausedUntilMs: undefined,
};

export function getEsiRateLimitState(): EsiRateLimitState {
  if (rateLimitState.paused && rateLimitState.pausedUntilMs) {
    if (Date.now() >= rateLimitState.pausedUntilMs) {
      rateLimitState.paused = false;
      rateLimitState.pauseReason = undefined;
      rateLimitState.pausedUntilMs = undefined;
      rateLimitState.retryAfterSec = null;
    } else {
      rateLimitState.retryAfterSec = Math.max(
        1,
        Math.ceil((rateLimitState.pausedUntilMs - Date.now()) / 1000)
      );
    }
  }
  return { ...rateLimitState };
}

function inspectEsiHeaders(res: Response): void {
  const errRemainRaw = res.headers.get('x-esi-error-limit-remain');
  const errResetRaw = res.headers.get('x-esi-error-limit-reset');
  const rateRemainRaw = res.headers.get('x-ratelimit-remaining');
  const retryAfterRaw = res.headers.get('retry-after');

  const errRemain = errRemainRaw !== null ? Number(errRemainRaw) : null;
  const errReset = errResetRaw !== null ? Number(errResetRaw) : null;
  const rateRemain = rateRemainRaw !== null ? Number(rateRemainRaw) : null;
  const retryAfter = retryAfterRaw !== null ? Number(retryAfterRaw) : null;

  if (errRemain !== null && Number.isFinite(errRemain)) {
    rateLimitState.errorLimitRemain = errRemain;
  }
  if (errReset !== null && Number.isFinite(errReset)) {
    rateLimitState.errorLimitResetSec = errReset;
  }
  if (rateRemain !== null && Number.isFinite(rateRemain)) {
    rateLimitState.ratelimitRemaining = rateRemain;
  }

  const isStatusBlocked = res.status === 420 || res.status === 429;
  const isErrBudgetLow = errRemain !== null && Number.isFinite(errRemain) && errRemain < 20;
  const isTokenBudgetLow = rateRemain !== null && Number.isFinite(rateRemain) && rateRemain < 20;

  if (isStatusBlocked || isErrBudgetLow || isTokenBudgetLow) {
    const waitSec = Math.max(
      15,
      (retryAfter && Number.isFinite(retryAfter) ? retryAfter : 0) ||
        (errReset && Number.isFinite(errReset) ? errReset : 0) ||
        60
    );
    rateLimitState.paused = true;
    rateLimitState.retryAfterSec = waitSec;
    rateLimitState.pausedUntilMs = Date.now() + waitSec * 1000;
    rateLimitState.pauseReason = isStatusBlocked
      ? `EVE ESI returned HTTP ${res.status} rate-limit response.`
      : isErrBudgetLow
        ? `X-ESI-Error-Limit-Remain dropped to ${errRemain} (< 20 safety threshold).`
        : `X-Ratelimit-Remaining dropped to ${rateRemain} (< 20 safety threshold).`;
  }
}

export async function esiFetchTracked(
  url: string,
  init: RequestInit = {},
  timeoutMs = 6500
): Promise<Response | null> {
  const current = getEsiRateLimitState();
  if (current.paused) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': ESI_USER_AGENT,
        'X-Compatibility-Date': '2026-08-18',
        ...(init.headers || {}),
      },
    });
    inspectEsiHeaders(res);
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// --- v2.1.0 ESI 5-Minute Cache & ETag (If-None-Match / 304 Not Modified) Shield ---

interface EsiHttpCacheRecord {
  data: unknown;
  etag?: string;
  expiresAtMs: number;
  fetchedAtMs: number;
}

const esiHttpCache = new Map<string, EsiHttpCacheRecord>();
const esiTelemetryState = {
  from304Count: 0,
  zeroTokenHits: 0,
  lastRefreshedAt: new Date().toISOString(),
  nextExpiresAtMs: Date.now() + ORDER_CACHE_TTL_MS,
};

function parseCacheExpiryMs(res: Response, fallbackTtlMs: number): number {
  const now = Date.now();
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  if (maxAgeMatch) {
    const sec = Number(maxAgeMatch[1]);
    if (Number.isFinite(sec) && sec > 0) {
      return now + sec * 1000;
    }
  }
  const expiresHeader = res.headers.get('expires');
  if (expiresHeader) {
    const parsed = Date.parse(expiresHeader);
    if (Number.isFinite(parsed) && parsed > now) {
      return parsed;
    }
  }
  return now + fallbackTtlMs;
}

export function getEsiCacheTelemetry(
  mode: MarketCacheTelemetry['mode'] = 'active_sync'
): MarketCacheTelemetry {
  const rl = getEsiRateLimitState();
  return {
    expiresAtMs: esiTelemetryState.nextExpiresAtMs,
    lastRefreshedAt: esiTelemetryState.lastRefreshedAt,
    ratelimitRemaining: rl.ratelimitRemaining ?? rl.errorLimitRemain,
    retryAfterSec: rl.retryAfterSec,
    from304Count: esiTelemetryState.from304Count,
    zeroTokenHits: esiTelemetryState.zeroTokenHits,
    mode,
  };
}

export interface EsiCachedFetchResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  fromCache: boolean;
  from304: boolean;
  expiresAtMs: number;
  etag?: string;
}

/**
 * Fetches an ESI JSON endpoint respecting CCP's Expires / Cache-Control window (0 tokens while fresh)
 * and sending If-None-Match (ETag) upon expiry so 304 Not Modified consumes 1 token instead of 2.
 */
export async function esiCachedFetchJson<T>(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; fallbackTtlMs?: number; forceRevalidate?: boolean; cacheKey?: string } = {}
): Promise<EsiCachedFetchResult<T>> {
  const fallbackTtlMs = options.fallbackTtlMs ?? ORDER_CACHE_TTL_MS;
  const timeoutMs = options.timeoutMs ?? 7500;
  const cacheKey = options.cacheKey ?? url;
  const now = Date.now();
  const cached = esiHttpCache.get(cacheKey);

  // 1. Fresh within CCP Expires/Cache-Control window -> 0 ESI tokens consumed!
  if (!options.forceRevalidate && cached && now < cached.expiresAtMs) {
    esiTelemetryState.zeroTokenHits += 1;
    return {
      ok: true,
      status: 200,
      data: cached.data as T,
      fromCache: true,
      from304: false,
      expiresAtMs: cached.expiresAtMs,
      etag: cached.etag,
    };
  }

  // 2. Expired (or forced revalidate) -> send If-None-Match if we have an ETag (304 = 1 token vs 2)
  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': ESI_USER_AGENT,
    ...(init.headers as Record<string, string> | undefined),
  };
  if (cached?.etag) {
    reqHeaders['If-None-Match'] = cached.etag;
  }

  const res = await esiFetchTracked(url, { ...init, headers: reqHeaders }, timeoutMs);
  if (!res) {
    if (cached) {
      return {
        ok: true,
        status: 200,
        data: cached.data as T,
        fromCache: true,
        from304: false,
        expiresAtMs: cached.expiresAtMs,
        etag: cached.etag,
      };
    }
    return {
      ok: false,
      status: 0,
      data: null,
      fromCache: false,
      from304: false,
      expiresAtMs: now + 30_000,
    };
  }

  const nextExpiry = parseCacheExpiryMs(res, fallbackTtlMs);
  const newEtag = res.headers.get('etag') || cached?.etag;

  if (res.status === 304 && cached) {
    esiTelemetryState.from304Count += 1;
    esiTelemetryState.lastRefreshedAt = new Date().toISOString();
    esiTelemetryState.nextExpiresAtMs = nextExpiry;
    esiHttpCache.set(cacheKey, {
      ...cached,
      etag: newEtag,
      expiresAtMs: nextExpiry,
      fetchedAtMs: now,
    });
    return {
      ok: true,
      status: 304,
      data: cached.data as T,
      fromCache: true,
      from304: true,
      expiresAtMs: nextExpiry,
      etag: newEtag,
    };
  }

  if (res.ok) {
    try {
      const parsed = (await res.json()) as T;
      esiTelemetryState.lastRefreshedAt = new Date().toISOString();
      esiTelemetryState.nextExpiresAtMs = nextExpiry;
      esiHttpCache.set(cacheKey, {
        data: parsed,
        etag: newEtag,
        expiresAtMs: nextExpiry,
        fetchedAtMs: now,
      });
      // Bound cache size cleanly
      if (esiHttpCache.size > 1200) {
        const oldestKey = esiHttpCache.keys().next().value;
        if (oldestKey) esiHttpCache.delete(oldestKey);
      }
      return {
        ok: true,
        status: res.status,
        data: parsed,
        fromCache: false,
        from304: false,
        expiresAtMs: nextExpiry,
        etag: newEtag,
      };
    } catch {
      return {
        ok: false,
        status: res.status,
        data: cached ? (cached.data as T) : null,
        fromCache: Boolean(cached),
        from304: false,
        expiresAtMs: nextExpiry,
      };
    }
  }

  return {
    ok: false,
    status: res.status,
    data: cached ? (cached.data as T) : null,
    fromCache: Boolean(cached),
    from304: false,
    expiresAtMs: nextExpiry,
  };
}

// --- Batch ESI Name Resolution (with 404 bisection) ---

async function resolveNamesChunk(ids: number[], out: Map<number, string>): Promise<void> {
  if (ids.length === 0 || getEsiRateLimitState().paused) return;

  const res = await esiFetchTracked(
    'https://esi.evetech.net/universe/names/?datasource=tranquility',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ids),
    },
    10000
  );

  if (res && res.ok) {
    const entries = (await res.json()) as { id: number; name: string }[];
    for (const e of entries) {
      if (e?.id && e?.name) out.set(e.id, e.name);
    }
    return;
  }

  if (res && res.status === 404 && ids.length > 1) {
    const mid = Math.floor(ids.length / 2);
    await resolveNamesChunk(ids.slice(0, mid), out);
    await resolveNamesChunk(ids.slice(mid), out);
  }
}

async function resolveEsiTypeNames(typeIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const unique: number[] = [];
  const seen = new Set<number>();

  for (const id of typeIds) {
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    if (ITEM_BY_ID[id]) {
      out.set(id, ITEM_BY_ID[id].name);
    } else {
      unique.push(id);
    }
  }

  // Batch into 500-ID requests sequentially/small concurrency to stay gentle on ESI
  for (let i = 0; i < unique.length; i += 500) {
    if (getEsiRateLimitState().paused) break;
    await resolveNamesChunk(unique.slice(i, i + 500), out);
  }

  return out;
}

// --- Dynamic 19-Category EVE ESI Market Group Tree Builder ---

interface RawEsiMarketGroup {
  market_group_id: number;
  name: string;
  parent_group_id?: number;
  types?: number[];
}

const DEFAULT_VOLUME_BY_CATEGORY: Record<MarketCategoryId, number> = {
  t1_ammo: 0.025,
  t2_ammo: 0.025,
  bombs: 75.0,
  probes: 0.1,
  scripts: 1.0,
  fuel_blocks: 5.0,
  t1_rigs: 10.0,
  t2_rigs: 10.0,
  t1_drones: 10.0,
  t2_drones: 10.0,
  shuttles: 500.0,
  implants: 1.0,
  scrap_loot: 5.0,
  ores: 0.1,
  ice: 100.0,
  minerals: 0.01,
  salvaged: 0.01,
  pi_p0_p1: 0.38,
  pi_p2_p4: 6.0,
};

const T2_FACTION_AMMO_RE =
  /\b(Fury|Precision|Javelin|Rage|Void|Null|Spike|Hail|Barrage|Tremor|Quake|Scorch|Conflagration|Gleam|Aurora|Navy|Fleet|Arch Angel|Dread Guristas|True Sansha|Dark Blood|Domination|Shadow|Guristas|Sansha|Blood|Serpentis|Faction|II|Polarized|Syndicate|Mordu)\b/i;

const EXCLUDED_AMMO_GROUP_RE =
  /(mining crystal|festival|filament|mutaplasmid|paste|nanite|condenser|cynosural|command burst|exotic|breacher|scanner|probe|bomb|script|structure)/i;

const ALLOWED_AMMO_GROUP_RE =
  /(hybrid|projectile|frequency|crystal|missile|rocket|torpedo|capacitor booster|cap booster|ammo|charge)/i;

const T2_FACTION_DRONE_RE =
  /(\bII\b|Augmented|Integrated|Navy|Fleet|Gecko|Harvester|Excavator|Mutated|Subverted|Federation|Caldari|Imperial|Republic)/i;

// Meta 1–4 published ship module & weapon naming filter (excludes T2, Faction, Deadspace, Officer, Capital, Abyssal)
const META_LOOT_INCLUDE_RE =
  /\b(Compact|Enduring|Restrained|Scoped|Ample|Modal|Arbalest|Eutectic|Faint|Fleeting|Initiated|Phased|Limited|Upgraded|Prototype|Experimental|Extruded|Malkuth|TE-2100|Azeotropic|Alumel|Piranha|Anode|Scout|Gallium|J5|X5|Balmer|Baker|Monopropellant|Quad Lif|Cold-Gas|I-a|Mark I|Regulated|Optical|Peripheral|Catalyzed|Thermal|Kinetic|EM|Explosive|Crystalline|Layered|Tungsten|Carbine|Ion|Neutron|Electron|Railgun|Blaster|Autocannon|Artillery|Beam|Pulse)\b/i;

const META_LOOT_EXCLUDE_RE =
  /(\bII\b|\bCapital\b|XL\b|X-Large|Imperial Navy|Caldari Navy|Federation Navy|Republic Fleet|Domination|Dread Guristas|Dark Blood|True Sansha|Shadow Serpentis|Khanid|Ammatar|Syndicate|Thukker|Sisters|Pith|Gist|Corel|Corp|Cent|Brynn|Estamel|Tobias|Cormack|Setele|Tuvan|Ahremen|Chelm|Vepas|Thon|Kaikka|Draclira|Gotan|Mizuro|Hakim|Unit |Abyssal|Mutated|Storyline|'Cetus'|'Limos'|'Gistii'|'Pithum'|Polarized|Entropic|Vorton|Breacher|Bastion|Siege|Triage|Cynosural|Jump|Clone|Filament|Snowball|Festival|Civilian)/i;

let serverCatalogCache: DynamicMarketCatalog | null = null;
let inFlightCatalogPromise: Promise<DynamicMarketCatalog> | null = null;

function buildFallbackCatalog(): DynamicMarketCatalog {
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
    expiresAt: Date.now() + 60 * 60 * 1000,
    source: 'baseline_fallback',
    totalSkus: total,
    categories,
    esiRateLimit: getEsiRateLimitState(),
  };
}

async function fetchAllMarketGroupsFromEsi(): Promise<Map<number, RawEsiMarketGroup>> {
  const groups = new Map<number, RawEsiMarketGroup>();

  const listRes = await esiFetchTracked(
    'https://esi.evetech.net/markets/groups/?datasource=tranquility',
    {},
    8000
  );
  if (!listRes || !listRes.ok) {
    return groups;
  }

  const allIds = (await listRes.json()) as number[];
  if (!Array.isArray(allIds) || allIds.length === 0) {
    return groups;
  }

  // Bounded worker pool (32 concurrent workers, per-request 5s timeout, auto-stops if ESI rate-limit guard trips)
  let cursor = 0;
  const concurrency = 32;

  const worker = async () => {
    while (cursor < allIds.length) {
      if (getEsiRateLimitState().paused) return;
      const idx = cursor++;
      const id = allIds[idx];
      let res = await esiFetchTracked(
        `https://esi.evetech.net/markets/groups/${id}/?datasource=tranquility`,
        {},
        5500
      );
      if (!res && !getEsiRateLimitState().paused) {
        // Single lightweight retry on transient timeout
        res = await esiFetchTracked(
          `https://esi.evetech.net/markets/groups/${id}/?datasource=tranquility`,
          {},
          5500
        );
      }
      if (res && res.ok) {
        try {
          const data = (await res.json()) as RawEsiMarketGroup;
          if (data && typeof data.market_group_id === 'number') {
            groups.set(data.market_group_id, data);
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return groups;
}

export async function getOrBuildDynamicMarketCatalog(
  force = false
): Promise<DynamicMarketCatalog> {
  if (!force && serverCatalogCache && Date.now() < serverCatalogCache.expiresAt) {
    return {
      ...serverCatalogCache,
      esiRateLimit: getEsiRateLimitState(),
    };
  }

  if (inFlightCatalogPromise) {
    return inFlightCatalogPromise;
  }

  inFlightCatalogPromise = (async () => {
    try {
      const groups = await fetchAllMarketGroupsFromEsi();
      if (groups.size < 200) {
        // ESI unreachable or rate-limited before tree finished
        return serverCatalogCache ?? buildFallbackCatalog();
      }

      // Build parent -> child adjacency map
      const childrenByParent = new Map<number, RawEsiMarketGroup[]>();
      for (const g of groups.values()) {
        const pid = g.parent_group_id ?? 0;
        const arr = childrenByParent.get(pid) ?? [];
        arr.push(g);
        childrenByParent.set(pid, arr);
      }

      interface DiscoveredEntry {
        typeId: number;
        marketGroupId: number;
        groupPath: string;
        bucketHint:
          | MarketCategoryId
          | 'ammo_split'
          | 'rigs_split'
          | 'drones_split'
          | 'meta_loot_filter';
      }

      const discovered: DiscoveredEntry[] = [];

      const collectSubtree = (
        rootId: number,
        bucketHint: DiscoveredEntry['bucketHint'],
        excludeGroupIds: Set<number> = new Set()
      ) => {
        const dfs = (gid: number, pathParts: string[]) => {
          if (excludeGroupIds.has(gid)) return;
          const g = groups.get(gid);
          if (!g) return;
          const nextPath = [...pathParts, g.name];
          const pathStr = nextPath.join(' > ');
          if (Array.isArray(g.types) && g.types.length > 0) {
            for (const tid of g.types) {
              discovered.push({
                typeId: tid,
                marketGroupId: gid,
                groupPath: pathStr,
                bucketHint,
              });
            }
          }
          for (const child of childrenByParent.get(gid) ?? []) {
            dfs(child.market_group_id, nextPath);
          }
        };
        dfs(rootId, []);
      };

      // Map ALL 19 official EVE ESI market groups accurately
      // 1-2. T1 & T2 Ammo (under root 11, excluding Bombs 1015, Probes 120, Scripts 1094, Structure Bombs 2198)
      collectSubtree(11, 'ammo_split', new Set([1015, 120, 1094, 2198]));
      // 3. Bombs (1015 under 11)
      collectSubtree(1015, 'bombs');
      // 4. Probes (120 under 11: Scan Probes 1199, Survey Probes 1200, Interdiction Probes 1201)
      collectSubtree(120, 'probes');
      // 5. Scripts (1094 under 11)
      collectSubtree(1094, 'scripts');
      // 6. Fuel Blocks (1870) + Ice Products (1033)
      collectSubtree(1870, 'fuel_blocks');
      collectSubtree(1033, 'fuel_blocks');
      // 7-8. T1 & T2 Rigs (root 1111)
      collectSubtree(1111, 'rigs_split');
      // 9-10. T1 & T2 Drones (root 157, excluding Fighters 2236)
      collectSubtree(157, 'drones_split', new Set([2236]));
      // 11. Shuttles (391)
      collectSubtree(391, 'shuttles');
      // 12. Implants (27: Attribute Enhancers 532 + Skill Hardwiring 531)
      collectSubtree(27, 'implants');
      // 13. Scrap / Meta Loot Modules (under root 9: Ship Equipment, filtered to Meta 1-4)
      collectSubtree(9, 'meta_loot_filter');
      // 14. Ores (54: All Standard & Compressed Ores)
      collectSubtree(54, 'ores');
      // 15. Ice (1855 Ice Ores + 1033 Ice Products/Isotopes)
      collectSubtree(1855, 'ice');
      collectSubtree(1033, 'ice');
      // 16. Minerals (1857)
      collectSubtree(1857, 'minerals');
      // 17. Salvaged (1861: 1863 Salvaged Materials + 1862 Ancient Salvaged Materials)
      collectSubtree(1861, 'salvaged');
      // 18. PI (P0-P1): under 1332 -> 1333 (Raw P0) + 1334 (Processed P1)
      collectSubtree(1333, 'pi_p0_p1');
      collectSubtree(1334, 'pi_p0_p1');
      // 19. PI (P2-P4): under 1332 -> 1335 (Refined P2) + 1336 (Specialized P3) + 1337 (Advanced P4)
      collectSubtree(1335, 'pi_p2_p4');
      collectSubtree(1336, 'pi_p2_p4');
      collectSubtree(1337, 'pi_p2_p4');

      // Batch resolve real EVE Online item names for all discovered type_ids
      const allDiscoveredIds = discovered.map((d) => d.typeId);
      const nameMap = await resolveEsiTypeNames(allDiscoveredIds);

      const categoryMaps = {} as Record<MarketCategoryId, Map<number, CatalogSku>>;
      for (const cat of MARKET_CATEGORIES) {
        categoryMaps[cat.id] = new Map<number, CatalogSku>();
      }

      const addSku = (
        catId: MarketCategoryId,
        typeId: number,
        name: string,
        marketGroupId: number
      ) => {
        if (categoryMaps[catId].has(typeId)) return;
        const base = ITEM_BY_ID[typeId];
        categoryMaps[catId].set(typeId, {
          typeId,
          name,
          category: catId,
          marketGroupId,
          volume: base?.volume ?? DEFAULT_VOLUME_BY_CATEGORY[catId],
          estDailyJitaVol: base?.estDailyJitaVol,
          estDailyDodixieVol: base?.estDailyDodixieVol,
          isBaseline: Boolean(base),
        });
      };

      for (const entry of discovered) {
        const name = nameMap.get(entry.typeId);
        if (!name) continue;

        if (entry.bucketHint === 'ammo_split') {
          if (EXCLUDED_AMMO_GROUP_RE.test(entry.groupPath)) continue;
          if (!ALLOWED_AMMO_GROUP_RE.test(entry.groupPath)) continue;
          const isT2OrFaction =
            /\b(Advanced|Faction)\b/i.test(entry.groupPath) ||
            T2_FACTION_AMMO_RE.test(name);
          addSku(
            isT2OrFaction ? 't2_ammo' : 't1_ammo',
            entry.typeId,
            name,
            entry.marketGroupId
          );
        } else if (entry.bucketHint === 'rigs_split') {
          const isT2 = /\bII\b/.test(name);
          addSku(isT2 ? 't2_rigs' : 't1_rigs', entry.typeId, name, entry.marketGroupId);
        } else if (entry.bucketHint === 'drones_split') {
          const isT2OrFaction = T2_FACTION_DRONE_RE.test(name);
          addSku(
            isT2OrFaction ? 't2_drones' : 't1_drones',
            entry.typeId,
            name,
            entry.marketGroupId
          );
        } else if (entry.bucketHint === 'meta_loot_filter') {
          // Keep published Meta 1-4 ship modules & weapons commonly traded for reprocessing/fitting
          const isBaselineScrap = ITEM_BY_ID[entry.typeId]?.category === 'scrap_loot';
          if (
            isBaselineScrap ||
            (META_LOOT_INCLUDE_RE.test(name) && !META_LOOT_EXCLUDE_RE.test(name))
          ) {
            addSku('scrap_loot', entry.typeId, name, entry.marketGroupId);
          }
        } else {
          addSku(entry.bucketHint, entry.typeId, name, entry.marketGroupId);
        }
      }

      // Ensure all curated baseline EVE_ITEMS remain guaranteed present in their category
      for (const base of EVE_ITEMS) {
        if (base.category === 'indy_support') continue;
        if (!categoryMaps[base.category].has(base.typeId)) {
          const catDef = MARKET_CATEGORIES.find((c) => c.id === base.category);
          addSku(base.category, base.typeId, base.name, catDef?.marketGroupId ?? 0);
        }
      }

      const categories = {} as Record<MarketCategoryId, CatalogSku[]>;
      let totalSkus = 0;

      for (const cat of MARKET_CATEGORIES) {
        const list = Array.from(categoryMaps[cat.id].values()).sort((a, b) =>
          a.name.localeCompare(b.name)
        );
        categories[cat.id] = list;
        totalSkus += list.length;
      }

      const built: DynamicMarketCatalog = {
        version: CATALOG_SCHEMA_VERSION,
        builtAt: new Date().toISOString(),
        expiresAt: Date.now() + CATALOG_TTL_MS,
        source: 'esi_live',
        totalSkus,
        categories,
        esiRateLimit: getEsiRateLimitState(),
      };

      serverCatalogCache = built;
      return built;
    } finally {
      inFlightCatalogPromise = null;
    }
  })();

  return inFlightCatalogPromise;
}

// --- Throttled Live ESI Market Order Batch Scanner (Jita 10000002 + Dodixie 10000032) ---

interface RawEsiOrder {
  order_id: number;
  type_id: number;
  system_id: number;
  location_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  min_volume?: number;
}

const esiBatchQuoteCache = new Map<
  number,
  { quote: MarketQuote; corridorOrders: CorridorOrder[]; fetchedAt: number; expiresAtMs: number }
>();

const avg7dVolCache = new Map<
  string,
  { avgDailyVol7d: number; yesterdayAvgPrice?: number; fetchedAt: number }
>();
const HISTORY_7D_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function fetch7DayHistoryStats(
  regionId: number,
  typeId: number
): Promise<{ avgDailyVol7d?: number; yesterdayAvgPrice?: number }> {
  const key = `${regionId}:${typeId}`;
  const cached = avg7dVolCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_7D_CACHE_TTL_MS) {
    return {
      avgDailyVol7d: cached.avgDailyVol7d,
      yesterdayAvgPrice: cached.yesterdayAvgPrice,
    };
  }
  const rl = getEsiRateLimitState();
  if (rl.paused || (rl.errorLimitRemain !== null && rl.errorLimitRemain < 35)) {
    return cached
      ? { avgDailyVol7d: cached.avgDailyVol7d, yesterdayAvgPrice: cached.yesterdayAvgPrice }
      : {};
  }

  const res = await esiCachedFetchJson<{ date: string; volume: number; average?: number }[]>(
    `https://esi.evetech.net/markets/${regionId}/history/?datasource=tranquility&type_id=${typeId}`,
    {},
    { timeoutMs: 5500, fallbackTtlMs: HISTORY_7D_CACHE_TTL_MS }
  );
  if (!res.ok || !Array.isArray(res.data)) {
    return cached
      ? { avgDailyVol7d: cached.avgDailyVol7d, yesterdayAvgPrice: cached.yesterdayAvgPrice }
      : {};
  }

  if (res.data.length === 0) {
    avg7dVolCache.set(key, { avgDailyVol7d: 0, fetchedAt: Date.now() });
    return { avgDailyVol7d: 0 };
  }
  const sorted = [...res.data].sort((a, b) => a.date.localeCompare(b.date));
  const last7 = sorted.slice(-7);
  const totalVol = last7.reduce((s, d) => s + (Number(d.volume) || 0), 0);
  const avgDailyVol7d = Math.round(totalVol / 7);
  const lastDay = sorted[sorted.length - 1];
  const yesterdayAvgPrice =
    lastDay && Number(lastDay.average) > 0 ? Number(lastDay.average) : undefined;
  avg7dVolCache.set(key, { avgDailyVol7d, yesterdayAvgPrice, fetchedAt: Date.now() });
  return { avgDailyVol7d, yesterdayAvgPrice };
}

function aggregateStationOrders(
  orders: RawEsiOrder[],
  stationId: number
): {
  sellMin: number;
  sellVolume: number;
  buyMax: number;
  buyVolume: number;
  topBuyDepthUnits: number;
  buyLevels: OrderBookLevel[];
  sellLevels: OrderBookLevel[];
} {
  let sellMin = Infinity;
  let sellVolume = 0;
  let buyMax = 0;
  let buyVolume = 0;

  let stationSellMin = Infinity;
  let stationSellVol = 0;
  let stationBuyMax = 0;
  let stationBuyVol = 0;

  const stationBuyOrders: OrderBookLevel[] = [];
  const regionalBuyOrders: OrderBookLevel[] = [];
  const stationSellOrders: OrderBookLevel[] = [];
  const regionalSellOrders: OrderBookLevel[] = [];

  for (const o of orders) {
    if (!o || o.price <= 0 || o.volume_remain <= 0) continue;
    const roundedPrice = Math.round(o.price * 100) / 100;
    const minVol = Math.max(1, Number(o.min_volume ?? 1));
    if (o.is_buy_order) {
      buyVolume += o.volume_remain;
      if (o.price > buyMax) buyMax = o.price;
      regionalBuyOrders.push({ price: roundedPrice, volume: o.volume_remain, minVolume: minVol });
      if (o.location_id === stationId) {
        stationBuyVol += o.volume_remain;
        if (o.price > stationBuyMax) stationBuyMax = o.price;
        stationBuyOrders.push({ price: roundedPrice, volume: o.volume_remain, minVolume: minVol });
      }
    } else {
      sellVolume += o.volume_remain;
      if (o.price < sellMin) sellMin = o.price;
      regionalSellOrders.push({ price: roundedPrice, volume: o.volume_remain, minVolume: 1 });
      if (o.location_id === stationId) {
        stationSellVol += o.volume_remain;
        if (o.price < stationSellMin) stationSellMin = o.price;
        stationSellOrders.push({ price: roundedPrice, volume: o.volume_remain, minVolume: 1 });
      }
    }
  }

  const effectiveBuyMax = stationBuyMax > 0 ? stationBuyMax : buyMax;
  const activeBuySource = stationBuyOrders.length > 0 ? stationBuyOrders : regionalBuyOrders;
  const activeSellSource = stationSellOrders.length > 0 ? stationSellOrders : regionalSellOrders;

  const buyLevels = activeBuySource
    .sort((a, b) => b.price - a.price)
    .slice(0, 20);

  // Merge same-price sell tiers for clean compact storage while keeping ascending order
  const sellBucketMap = new Map<number, number>();
  for (const s of activeSellSource) {
    sellBucketMap.set(s.price, (sellBucketMap.get(s.price) ?? 0) + s.volume);
  }
  const sellLevels: OrderBookLevel[] = Array.from(sellBucketMap.entries())
    .sort((a, b) => a[0] - b[0])
    .slice(0, 20)
    .map(([price, volume]) => ({ price, volume, minVolume: 1 }));

  const topBuyFloor = effectiveBuyMax * 0.95;
  const topBuyDepthUnits = buyLevels
    .filter((lvl) => lvl.price >= topBuyFloor)
    .reduce((sum, lvl) => sum + lvl.volume, 0);

  return {
    sellMin: Number.isFinite(stationSellMin)
      ? stationSellMin
      : Number.isFinite(sellMin)
        ? sellMin
        : 0,
    sellVolume: stationSellVol > 0 ? stationSellVol : sellVolume,
    buyMax: effectiveBuyMax,
    buyVolume: stationBuyVol > 0 ? stationBuyVol : buyVolume,
    topBuyDepthUnits,
    buyLevels,
    sellLevels,
  };
}

export async function scanMarketOrderBatch(
  typeIds: number[],
  force = false
): Promise<{
  quotes: Record<number, MarketQuote>;
  corridorOrders: CorridorOrder[];
  liveCount: number;
  esiRateLimit: EsiRateLimitState;
}> {
  const cleanIds = Array.from(
    new Set(typeIds.filter((id) => Number.isInteger(id) && id > 0))
  ).slice(0, 25);

  const quotes: Record<number, MarketQuote> = {};
  const corridorOrders: CorridorOrder[] = [];
  let liveCount = 0;
  const now = Date.now();

  const toFetch: number[] = [];
  for (const id of cleanIds) {
    const cached = !force ? esiBatchQuoteCache.get(id) : undefined;
    if (cached && now < cached.expiresAtMs) {
      esiTelemetryState.zeroTokenHits += 1;
      quotes[id] = cached.quote;
      corridorOrders.push(...cached.corridorOrders);
      if (cached.quote.source === 'live') liveCount += 1;
    } else {
      toFetch.push(id);
    }
  }

  // Scan up to 6 typeIds concurrently inside each 15-20 item batch
  let cursor = 0;
  const concurrency = 6;

  const worker = async () => {
    while (cursor < toFetch.length) {
      if (getEsiRateLimitState().paused) return;
      const typeId = toFetch[cursor++];
      const priorQuote = esiBatchQuoteCache.get(typeId)?.quote;

      const [jitaRes, dodixieRes] = await Promise.all([
        esiCachedFetchJson<RawEsiOrder[]>(
          `https://esi.evetech.net/markets/${EVE_ANCHORS.THE_FORGE_REGION_ID}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`,
          {},
          { timeoutMs: 7000, fallbackTtlMs: ORDER_CACHE_TTL_MS, forceRevalidate: force }
        ),
        esiCachedFetchJson<RawEsiOrder[]>(
          `https://esi.evetech.net/markets/${EVE_ANCHORS.SINQ_LAISON_REGION_ID}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`,
          {},
          { timeoutMs: 7000, fallbackTtlMs: ORDER_CACHE_TTL_MS, forceRevalidate: force }
        ),
      ]);

      if (getEsiRateLimitState().paused) return;

      const jitaOrders = Array.isArray(jitaRes.data) ? jitaRes.data : [];
      const dodixieOrders = Array.isArray(dodixieRes.data) ? dodixieRes.data : [];

      const jAgg = aggregateStationOrders(jitaOrders, EVE_ANCHORS.JITA_STATION_ID);
      const dAgg = aggregateStationOrders(dodixieOrders, EVE_ANCHORS.DODIXIE_STATION_ID);
      const base = ITEM_BY_ID[typeId];

      const hasLive =
        jAgg.sellMin > 0 || jAgg.buyMax > 0 || dAgg.sellMin > 0 || dAgg.buyMax > 0;

      // Cross-check real 7-day average daily trading volume + yesterday's daily avg from ESI history
      let jitaStats: { avgDailyVol7d?: number; yesterdayAvgPrice?: number } = {};
      let dodixieStats: { avgDailyVol7d?: number; yesterdayAvgPrice?: number } = {};
      if (hasLive && !getEsiRateLimitState().paused) {
        [jitaStats, dodixieStats] = await Promise.all([
          fetch7DayHistoryStats(EVE_ANCHORS.THE_FORGE_REGION_ID, typeId),
          fetch7DayHistoryStats(EVE_ANCHORS.SINQ_LAISON_REGION_ID, typeId),
        ]);
      }

      // Capture 1-jump & 2-jump corridor orders from The Forge response at zero extra ESI cost
      const itemCorridor: CorridorOrder[] = [];
      for (const o of jitaOrders) {
        const sys = CORRIDOR_SYSTEM_MAP[o.system_id];
        if (!sys) continue;
        itemCorridor.push({
          orderId: o.order_id,
          typeId: o.type_id,
          systemId: o.system_id,
          systemName: sys.name,
          jumpsFromJita: sys.jumpsFromJita,
          jumpsFromIshisomo: sys.jumpsFromIshisomo,
          isBuyOrder: o.is_buy_order,
          price: o.price,
          volumeRemain: o.volume_remain,
          locationId: o.location_id,
        });
      }

      const estDailyJitaVol =
        jitaStats.avgDailyVol7d !== undefined
          ? jitaStats.avgDailyVol7d
          : base?.estDailyJitaVol ??
            Math.round((jAgg.sellVolume + jAgg.buyVolume) * 0.12);
      const estDailyDodixieVol =
        dodixieStats.avgDailyVol7d !== undefined
          ? dodixieStats.avgDailyVol7d
          : base?.estDailyDodixieVol ??
            Math.round((dAgg.sellVolume + dAgg.buyVolume) * 0.12);

      const newJitaSell = jAgg.sellMin > 0 ? jAgg.sellMin : base?.baseJitaSell ?? 0;
      const newJitaBuy = jAgg.buyMax > 0 ? jAgg.buyMax : base?.baseJitaBuy ?? 0;
      const newDodixieSell = dAgg.sellMin > 0 ? dAgg.sellMin : base?.baseDodixieSell ?? 0;
      const newDodixieBuy = dAgg.buyMax > 0 ? dAgg.buyMax : base?.baseDodixieBuy ?? 0;

      const quote: MarketQuote = {
        typeId,
        jita: {
          sellMin: newJitaSell,
          sellVolume: jAgg.sellVolume,
          buyMax: newJitaBuy,
          buyVolume: jAgg.buyVolume,
          sellPercentile: newJitaSell,
          buyPercentile: newJitaBuy,
          topBuyDepthUnits: jAgg.topBuyDepthUnits,
          buyLevels: jAgg.buyLevels,
          sellLevels: jAgg.sellLevels,
          avgDailyVol7d: jitaStats.avgDailyVol7d,
          yesterdayAvgPrice: jitaStats.yesterdayAvgPrice,
          prevSessionSellMin:
            priorQuote && priorQuote.jita.sellMin > 0 && priorQuote.jita.sellMin !== newJitaSell
              ? priorQuote.jita.sellMin
              : priorQuote?.jita.prevSessionSellMin,
          prevSessionBuyMax:
            priorQuote && priorQuote.jita.buyMax > 0 && priorQuote.jita.buyMax !== newJitaBuy
              ? priorQuote.jita.buyMax
              : priorQuote?.jita.prevSessionBuyMax,
        },
        dodixie: {
          sellMin: newDodixieSell,
          sellVolume: dAgg.sellVolume,
          buyMax: newDodixieBuy,
          buyVolume: dAgg.buyVolume,
          sellPercentile: newDodixieSell,
          buyPercentile: newDodixieBuy,
          topBuyDepthUnits: dAgg.topBuyDepthUnits,
          buyLevels: dAgg.buyLevels,
          sellLevels: dAgg.sellLevels,
          avgDailyVol7d: dodixieStats.avgDailyVol7d,
          yesterdayAvgPrice: dodixieStats.yesterdayAvgPrice,
          prevSessionSellMin:
            priorQuote && priorQuote.dodixie.sellMin > 0 && priorQuote.dodixie.sellMin !== newDodixieSell
              ? priorQuote.dodixie.sellMin
              : priorQuote?.dodixie.prevSessionSellMin,
          prevSessionBuyMax:
            priorQuote && priorQuote.dodixie.buyMax > 0 && priorQuote.dodixie.buyMax !== newDodixieBuy
              ? priorQuote.dodixie.buyMax
              : priorQuote?.dodixie.prevSessionBuyMax,
        },
        estDailyJitaVol,
        estDailyDodixieVol,
        source: hasLive ? 'live' : 'baseline',
      };

      const oneJumpSells = itemCorridor
        .filter((o) => !o.isBuyOrder && o.jumpsFromJita === 1)
        .sort((a, b) => a.price - b.price);
      if (oneJumpSells.length > 0) {
        const best = oneJumpSells[0];
        quote.oneJumpCheapestSell = {
          systemId: best.systemId,
          systemName: best.systemName,
          price: best.price,
          volumeRemain: best.volumeRemain,
          jumpsFromJita: best.jumpsFromJita,
        };
      }

      const sortedBuy = itemCorridor
        .filter((o) => o.isBuyOrder)
        .sort((a, b) => b.price - a.price);
      const sortedSell = itemCorridor
        .filter((o) => !o.isBuyOrder)
        .sort((a, b) => a.price - b.price);
      if (sortedBuy.length > 0) quote.corridorBestBuy = sortedBuy[0];
      if (sortedSell.length > 0) quote.corridorBestSell = sortedSell[0];

      const expiresAtMs = Math.min(jitaRes.expiresAtMs, dodixieRes.expiresAtMs);

      if (hasLive) {
        liveCount += 1;
        esiBatchQuoteCache.set(typeId, {
          quote,
          corridorOrders: itemCorridor,
          fetchedAt: Date.now(),
          expiresAtMs,
        });
      }

      quotes[typeId] = quote;
      corridorOrders.push(...itemCorridor);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, toFetch.length) }, () => worker()));

  return {
    quotes,
    corridorOrders,
    liveCount,
    esiRateLimit: getEsiRateLimitState(),
  };
}
