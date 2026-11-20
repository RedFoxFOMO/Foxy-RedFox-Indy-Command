import {
  CORRIDOR_SYSTEM_MAP,
  EVE_ANCHORS,
  EVE_ITEMS,
  ITEM_BY_ID,
  MARKET_CATEGORIES,
} from '../data/eveCatalog.ts';
import type {
  CatalogSku,
  CorridorOrder,
  DynamicMarketCatalog,
  EsiRateLimitState,
  MarketCategoryId,
  MarketQuote,
} from '../types/eve.ts';

const CATALOG_SCHEMA_VERSION = 2;
const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ORDER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (matches CCP ESI cache)
const ESI_USER_AGENT = 'FoxyRedFoxIndyCommand/1.0 (AI Studio)';

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

// --- Batch ESI Name Resolution (with 404 bisection) ---

async function resolveNamesChunk(ids: number[], out: Map<number, string>): Promise<void> {
  if (ids.length === 0 || getEsiRateLimitState().paused) return;

  const res = await esiFetchTracked(
    'https://esi.evetech.net/latest/universe/names/?datasource=tranquility',
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
    'https://esi.evetech.net/latest/markets/groups/?datasource=tranquility',
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
        `https://esi.evetech.net/latest/markets/groups/${id}/?datasource=tranquility`,
        {},
        5500
      );
      if (!res && !getEsiRateLimitState().paused) {
        // Single lightweight retry on transient timeout
        res = await esiFetchTracked(
          `https://esi.evetech.net/latest/markets/groups/${id}/?datasource=tranquility`,
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
}

const esiBatchQuoteCache = new Map<
  number,
  { quote: MarketQuote; corridorOrders: CorridorOrder[]; fetchedAt: number }
>();

const avg7dVolCache = new Map<string, { avgDailyVol7d: number; fetchedAt: number }>();
const HISTORY_7D_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetch7DayAvgVolume(
  regionId: number,
  typeId: number
): Promise<number | undefined> {
  const key = `${regionId}:${typeId}`;
  const cached = avg7dVolCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < HISTORY_7D_CACHE_TTL_MS) {
    return cached.avgDailyVol7d;
  }
  const rl = getEsiRateLimitState();
  if (rl.paused || (rl.errorLimitRemain !== null && rl.errorLimitRemain < 35)) {
    return cached?.avgDailyVol7d;
  }

  const res = await esiFetchTracked(
    `https://esi.evetech.net/latest/markets/${regionId}/history/?datasource=tranquility&type_id=${typeId}`,
    {},
    5000
  );
  if (!res || !res.ok) return cached?.avgDailyVol7d;

  try {
    const raw = (await res.json()) as { date: string; volume: number }[];
    if (!Array.isArray(raw) || raw.length === 0) {
      avg7dVolCache.set(key, { avgDailyVol7d: 0, fetchedAt: Date.now() });
      return 0;
    }
    const last7 = raw.slice(-7);
    const totalVol = last7.reduce((s, d) => s + (Number(d.volume) || 0), 0);
    const avgDailyVol7d = Math.round(totalVol / 7);
    avg7dVolCache.set(key, { avgDailyVol7d, fetchedAt: Date.now() });
    return avgDailyVol7d;
  } catch {
    return cached?.avgDailyVol7d;
  }
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
  buyLevels: { price: number; volume: number }[];
} {
  let sellMin = Infinity;
  let sellVolume = 0;
  let buyMax = 0;
  let buyVolume = 0;

  // Prefer exact trade hub station; fall back to regional orders if station has no orders
  let stationSellMin = Infinity;
  let stationSellVol = 0;
  let stationBuyMax = 0;
  let stationBuyVol = 0;

  const stationBuyBuckets = new Map<number, number>();
  const regionalBuyBuckets = new Map<number, number>();

  for (const o of orders) {
    if (!o || o.price <= 0 || o.volume_remain <= 0) continue;
    if (o.is_buy_order) {
      buyVolume += o.volume_remain;
      if (o.price > buyMax) buyMax = o.price;
      const roundedPrice = Math.round(o.price * 100) / 100;
      regionalBuyBuckets.set(
        roundedPrice,
        (regionalBuyBuckets.get(roundedPrice) ?? 0) + o.volume_remain
      );
      if (o.location_id === stationId) {
        stationBuyVol += o.volume_remain;
        if (o.price > stationBuyMax) stationBuyMax = o.price;
        stationBuyBuckets.set(
          roundedPrice,
          (stationBuyBuckets.get(roundedPrice) ?? 0) + o.volume_remain
        );
      }
    } else {
      sellVolume += o.volume_remain;
      if (o.price < sellMin) sellMin = o.price;
      if (o.location_id === stationId) {
        stationSellVol += o.volume_remain;
        if (o.price < stationSellMin) stationSellMin = o.price;
      }
    }
  }

  const effectiveBuyMax = stationBuyMax > 0 ? stationBuyMax : buyMax;
  const activeBuyMap =
    stationBuyBuckets.size > 0 ? stationBuyBuckets : regionalBuyBuckets;
  const buyLevels = Array.from(activeBuyMap.entries())
    .sort((a, b) => b[0] - a[0])
    .slice(0, 15)
    .map(([price, volume]) => ({ price, volume }));

  // Top buy-order depth within 5% of top buy price
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
    if (cached && now - cached.fetchedAt < ORDER_CACHE_TTL_MS) {
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

      const [jitaRes, dodixieRes] = await Promise.all([
        esiFetchTracked(
          `https://esi.evetech.net/latest/markets/${EVE_ANCHORS.THE_FORGE_REGION_ID}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`,
          {},
          7000
        ),
        esiFetchTracked(
          `https://esi.evetech.net/latest/markets/${EVE_ANCHORS.SINQ_LAISON_REGION_ID}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`,
          {},
          7000
        ),
      ]);

      if (getEsiRateLimitState().paused) return;

      let jitaOrders: RawEsiOrder[] = [];
      let dodixieOrders: RawEsiOrder[] = [];

      if (jitaRes && jitaRes.ok) {
        try {
          const parsed = (await jitaRes.json()) as RawEsiOrder[];
          if (Array.isArray(parsed)) jitaOrders = parsed;
        } catch {
          // ignore
        }
      }
      if (dodixieRes && dodixieRes.ok) {
        try {
          const parsed = (await dodixieRes.json()) as RawEsiOrder[];
          if (Array.isArray(parsed)) dodixieOrders = parsed;
        } catch {
          // ignore
        }
      }

      const jAgg = aggregateStationOrders(jitaOrders, EVE_ANCHORS.JITA_STATION_ID);
      const dAgg = aggregateStationOrders(dodixieOrders, EVE_ANCHORS.DODIXIE_STATION_ID);
      const base = ITEM_BY_ID[typeId];

      const hasLive =
        jAgg.sellMin > 0 || jAgg.buyMax > 0 || dAgg.sellMin > 0 || dAgg.buyMax > 0;

      // Cross-check real 7-day average daily trading volume from ESI /markets/{region_id}/history/
      // when live quotes exist and ESI budget is healthy (cached 6h)
      let jitaAvg7d: number | undefined;
      let dodixieAvg7d: number | undefined;
      if (hasLive && !getEsiRateLimitState().paused) {
        [jitaAvg7d, dodixieAvg7d] = await Promise.all([
          fetch7DayAvgVolume(EVE_ANCHORS.THE_FORGE_REGION_ID, typeId),
          fetch7DayAvgVolume(EVE_ANCHORS.SINQ_LAISON_REGION_ID, typeId),
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
        jitaAvg7d !== undefined
          ? jitaAvg7d
          : base?.estDailyJitaVol ??
            Math.round((jAgg.sellVolume + jAgg.buyVolume) * 0.12);
      const estDailyDodixieVol =
        dodixieAvg7d !== undefined
          ? dodixieAvg7d
          : base?.estDailyDodixieVol ??
            Math.round((dAgg.sellVolume + dAgg.buyVolume) * 0.12);

      const quote: MarketQuote = {
        typeId,
        jita: {
          sellMin: jAgg.sellMin > 0 ? jAgg.sellMin : base?.baseJitaSell ?? 0,
          sellVolume: jAgg.sellVolume,
          buyMax: jAgg.buyMax > 0 ? jAgg.buyMax : base?.baseJitaBuy ?? 0,
          buyVolume: jAgg.buyVolume,
          sellPercentile: jAgg.sellMin > 0 ? jAgg.sellMin : base?.baseJitaSell ?? 0,
          buyPercentile: jAgg.buyMax > 0 ? jAgg.buyMax : base?.baseJitaBuy ?? 0,
          topBuyDepthUnits: jAgg.topBuyDepthUnits,
          buyLevels: jAgg.buyLevels,
          avgDailyVol7d: jitaAvg7d,
        },
        dodixie: {
          sellMin: dAgg.sellMin > 0 ? dAgg.sellMin : base?.baseDodixieSell ?? 0,
          sellVolume: dAgg.sellVolume,
          buyMax: dAgg.buyMax > 0 ? dAgg.buyMax : base?.baseDodixieBuy ?? 0,
          buyVolume: dAgg.buyVolume,
          sellPercentile: dAgg.sellMin > 0 ? dAgg.sellMin : base?.baseDodixieSell ?? 0,
          buyPercentile: dAgg.buyMax > 0 ? dAgg.buyMax : base?.baseDodixieBuy ?? 0,
          topBuyDepthUnits: dAgg.topBuyDepthUnits,
          buyLevels: dAgg.buyLevels,
          avgDailyVol7d: dodixieAvg7d,
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

      if (hasLive) {
        liveCount += 1;
        esiBatchQuoteCache.set(typeId, {
          quote,
          corridorOrders: itemCorridor,
          fetchedAt: Date.now(),
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
