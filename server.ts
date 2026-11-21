import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type { Content, FunctionDeclaration, Part } from '@google/genai';
import {
  CORRIDOR_SYSTEM_MAP,
  EMPIRE_HUB_MAP,
  EVE_ANCHORS,
  EVE_ITEMS,
  ITEM_BY_ID,
  MARKET_CATEGORIES,
  getTypeIdsToFetch,
} from './src/data/eveCatalog.ts';
import {
  formatIsk,
  formatM3,
  formatPct,
  getQuote,
  runAllDecisionEngines,
} from './src/engines/decisionEngines.ts';
import {
  ALL_HAULING_SKILL_ID_LIST,
  HAULER_HULL_CATALOG,
  calculateFittedHull,
} from './src/data/eveFleetCatalog.ts';
import {
  getEsiRateLimitState,
  getOrBuildDynamicMarketCatalog,
  scanMarketOrderBatch,
} from './src/server/esiMarketCatalog.ts';
import type {
  AdvisorAction,
  AdvisorTargetTab,
  AppStateSummary,
  BlueprintEntry,
  BlueprintSyncMeta,
  CharacterIndustryJob,
  CorridorOrder,
  HangarHull,
  HangarStockEntry,
  HotSystemIntel,
  HubQuote,
  IndustryCostSnapshot,
  MarketCategoryId,
  MarketHistoryDay,
  MarketHistoryResponse,
  MarketQuote,
  MarketSnapshot,
  OrderMonitorEntry,
  OrderMonitorSnapshot,
  PilotProfile,
  SystemCostIndices,
  TradeHubId,
  WalletTransactionEntry,
} from './src/types/eve.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '4mb' }));

// --- Simple In-Memory Market Cache (90s TTL) ---

interface CacheEntry {
  quote: MarketQuote;
  fetchedAt: number;
}

const quoteCache = new Map<number, CacheEntry>();
const corridorOrderCache = new Map<number, { orders: CorridorOrder[]; fetchedAt: number }>();
const historyCache = new Map<string, { payload: MarketHistoryResponse; fetchedAt: number }>();
const routePathCache = new Map<string, { jumps: number; waypoints: number[]; fetchedAt: number }>();
const systemLookupCache = new Map<string, { systemId: number; systemName: string }>();
const entityNameCache = new Map<number, string>();
const stationInfoCache = new Map<number, { name: string; systemId: number; systemName: string }>();

interface SystemKillRaw {
  system_id: number;
  ship_kills: number;
  pod_kills: number;
  npc_kills: number;
}
let systemKillsCache: { map: Map<number, SystemKillRaw>; fetchedAt: number } | null = null;

const CACHE_TTL_MS = 90_000;
const HISTORY_CACHE_TTL_MS = 15 * 60 * 1000;
const ROUTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SYSTEM_KILLS_TTL_MS = 5 * 60 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 8500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'FoxyRedFoxIndyCommand/1.0 (AI Studio)',
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

interface FuzzworkStat {
  min?: string;
  max?: string;
  volume?: string;
  percentile?: string;
}

interface FuzzworkItemAgg {
  buy?: FuzzworkStat;
  sell?: FuzzworkStat;
}

async function fetchFuzzworkStation(
  stationId: number,
  typeIds: number[]
): Promise<Record<number, FuzzworkItemAgg>> {
  const result: Record<number, FuzzworkItemAgg> = {};
  const chunkSize = 75;
  const chunks: number[][] = [];
  for (let i = 0; i < typeIds.length; i += chunkSize) {
    chunks.push(typeIds.slice(i, i + chunkSize));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const url = `https://market.fuzzwork.co.uk/aggregates/?station=${stationId}&types=${chunk.join(',')}`;
        const res = await fetchWithTimeout(url, {}, 8000);
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, FuzzworkItemAgg>;
        for (const [k, v] of Object.entries(data)) {
          const id = Number(k);
          if (Number.isFinite(id) && v) {
            result[id] = v;
          }
        }
      } catch {
        // Silently degrade per chunk; caller tracks live vs baseline count
      }
    })
  );

  return result;
}

interface EsiOrderRaw {
  order_id: number;
  type_id: number;
  system_id: number;
  location_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
}

async function fetchEsiCorridorOrdersForTypes(
  typeIds: number[],
  forceRefresh: boolean
): Promise<CorridorOrder[]> {
  const now = Date.now();
  const collected: CorridorOrder[] = [];
  const toFetch: number[] = [];

  // Limit per-sync ESI type scans to 14 key active items to keep latency fast & polite to ESI
  const scanIds = typeIds.slice(0, 14);

  for (const id of scanIds) {
    const cached = corridorOrderCache.get(id);
    if (!forceRefresh && cached && now - cached.fetchedAt < CACHE_TTL_MS * 2) {
      collected.push(...cached.orders);
    } else {
      toFetch.push(id);
    }
  }

  // Fetch in small parallel batches of 5
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5);
    await Promise.all(
      batch.map(async (typeId) => {
        try {
          const url = `https://esi.evetech.net/latest/markets/${EVE_ANCHORS.THE_FORGE_REGION_ID}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`;
          const res = await fetchWithTimeout(url, {}, 6500);
          if (!res.ok) return;
          const rawOrders = (await res.json()) as EsiOrderRaw[];
          const corridorMatches: CorridorOrder[] = [];

          for (const o of rawOrders) {
            const sys = CORRIDOR_SYSTEM_MAP[o.system_id];
            if (!sys) continue;
            corridorMatches.push({
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

          corridorOrderCache.set(typeId, { orders: corridorMatches, fetchedAt: Date.now() });
          collected.push(...corridorMatches);
        } catch {
          // Graceful fallback if ESI throttles or times out
        }
      })
    );
  }

  return collected;
}

// --- Route 1: Live Market Sync (Fuzzwork Aggregates + EVE ESI Regional Corridor) ---

app.get('/api/market/sync', async (req, res) => {
  try {
    const rawCats = String(req.query.categories || '');
    const rawHubs = String(req.query.hubs || 'jita,dodixie');
    const force = req.query.force === 'true';
    const validCatSet = new Set(MARKET_CATEGORIES.map((c) => c.id));
    const categories = rawCats
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is MarketCategoryId => validCatSet.has(s as MarketCategoryId));

    const validHubIds: TradeHubId[] = ['jita', 'amarr', 'dodixie', 'rens', 'hek'];
    const requestedHubs = Array.from(
      new Set<TradeHubId>([
        'jita',
        'dodixie',
        ...rawHubs
          .split(',')
          .map((h) => h.trim().toLowerCase())
          .filter((h): h is TradeHubId => validHubIds.includes(h as TradeHubId)),
      ])
    );

    if (categories.length === 0) {
      const emptySnapshot: MarketSnapshot = {
        quotes: {},
        corridorOrders: [],
        lastSyncedAt: new Date().toISOString(),
        liveItemCount: 0,
        sourceMode: 'baseline',
      };
      res.json(emptySnapshot);
      return;
    }

    const typeIds = getTypeIdsToFetch(categories);
    const now = Date.now();
    const uncachedIds = force
      ? typeIds
      : typeIds.filter((id) => {
          const entry = quoteCache.get(id);
          if (!entry || now - entry.fetchedAt > CACHE_TTL_MS) return true;
          // Re-fetch if any requested non-core hub isn't cached yet on this quote
          return requestedHubs.some((h) => h !== 'jita' && h !== 'dodixie' && !entry.quote.hubs?.[h]);
        });

    const hubDataMap: Partial<Record<TradeHubId, Record<number, FuzzworkItemAgg>>> = {};

    if (uncachedIds.length > 0) {
      const hubResults = await Promise.all(
        requestedHubs.map(async (hubId) => {
          const stationId = EMPIRE_HUB_MAP[hubId].stationId;
          const data = await fetchFuzzworkStation(stationId, uncachedIds);
          return [hubId, data] as const;
        })
      );
      for (const [hubId, data] of hubResults) {
        hubDataMap[hubId] = data;
      }
    }

    // Scan ESI regional orders for 2-jump corridor & 1-jump Jita discounts
    const corridorOrders = await fetchEsiCorridorOrdersForTypes(typeIds, force);

    const corridorByType = new Map<number, CorridorOrder[]>();
    for (const o of corridorOrders) {
      const arr = corridorByType.get(o.typeId) ?? [];
      arr.push(o);
      corridorByType.set(o.typeId, arr);
    }

    const buildHubQuote = (
      agg: FuzzworkItemAgg | undefined,
      fallbackSell: number,
      fallbackBuy: number,
      fallbackVol: number
    ): HubQuote => {
      const sellMin = Number(agg?.sell?.min || 0);
      const buyMax = Number(agg?.buy?.max || 0);
      return {
        sellMin: sellMin > 0 ? sellMin : fallbackSell,
        sellVolume: Number(agg?.sell?.volume || fallbackVol || 0),
        buyMax: buyMax > 0 ? buyMax : fallbackBuy,
        buyVolume: Number(agg?.buy?.volume || fallbackVol || 0),
        sellPercentile: Number(agg?.sell?.percentile || sellMin || fallbackSell),
        buyPercentile: Number(agg?.buy?.percentile || buyMax || fallbackBuy),
      };
    };

    const quotes: Record<number, MarketQuote> = {};
    let liveCount = 0;

    for (const id of typeIds) {
      const item = ITEM_BY_ID[id];
      const cached = !force ? quoteCache.get(id) : undefined;
      const missingExtraHub =
        cached && requestedHubs.some((h) => h !== 'jita' && h !== 'dodixie' && !cached.quote.hubs?.[h]);
      let quote: MarketQuote;

      if (cached && !missingExtraHub && now - cached.fetchedAt <= CACHE_TTL_MS) {
        quote = { ...cached.quote, hubs: { ...(cached.quote.hubs || {}) } };
      } else {
        const jAgg = hubDataMap.jita?.[id];
        const dAgg = hubDataMap.dodixie?.[id];

        const jSellMin = Number(jAgg?.sell?.min || 0);
        const jBuyMax = Number(jAgg?.buy?.max || 0);
        const baseJitaSell = jSellMin > 0 ? jSellMin : item?.baseJitaSell ?? 1000;
        const baseJitaBuy = jBuyMax > 0 ? jBuyMax : item?.baseJitaBuy ?? baseJitaSell * 0.9;

        const hasLiveJita = jSellMin > 0 || jBuyMax > 0;

        const jitaQuote = buildHubQuote(jAgg, baseJitaSell, baseJitaBuy, item?.estDailyJitaVol ?? 0);
        const dodixieQuote = buildHubQuote(
          dAgg,
          item?.baseDodixieSell ?? baseJitaSell * 1.12,
          item?.baseDodixieBuy ?? baseJitaBuy * 1.02,
          item?.estDailyDodixieVol ?? 0
        );

        const hubs: Partial<Record<TradeHubId, HubQuote>> = {
          ...(cached?.quote.hubs || {}),
          jita: jitaQuote,
          dodixie: dodixieQuote,
        };

        for (const hubId of requestedHubs) {
          if (hubId === 'jita' || hubId === 'dodixie') continue;
          const agg = hubDataMap[hubId]?.[id];
          const hubMult =
            hubId === 'amarr' ? 1.07 : hubId === 'rens' ? 1.15 : hubId === 'hek' ? 1.17 : 1.12;
          hubs[hubId] = buildHubQuote(
            agg,
            baseJitaSell * hubMult,
            baseJitaBuy * (hubMult - 0.08),
            Math.max(1, Math.round((item?.estDailyDodixieVol ?? 10) * 0.7))
          );
        }

        quote = {
          typeId: id,
          jita: jitaQuote,
          dodixie: dodixieQuote,
          hubs,
          source: hasLiveJita ? 'live' : 'baseline',
        };

        if (hasLiveJita) {
          quoteCache.set(id, { quote, fetchedAt: now });
        }
      }

      // Attach cheapest 1-jump outside Jita sell order from ESI corridor scan
      const cOrders = corridorByType.get(id) ?? [];
      const oneJumpSells = cOrders
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

      if (quote.source === 'live') liveCount += 1;
      quotes[id] = quote;
    }

    const sourceMode: MarketSnapshot['sourceMode'] =
      liveCount === typeIds.length ? 'live' : liveCount > 0 ? 'partial' : 'baseline';

    const snapshot: MarketSnapshot = {
      quotes,
      corridorOrders,
      lastSyncedAt: new Date().toISOString(),
      liveItemCount: liveCount,
      sourceMode,
      esiRateLimit: getEsiRateLimitState(),
    };

    res.json(snapshot);
  } catch (err) {
    console.error('Market sync error:', err);
    res.status(500).json({ error: 'Failed to synchronize EVE market endpoints.' });
  }
});

// --- Route 1a-0: Live CCP System Cost Indices (/industry/systems/) & Adjusted Base Prices (/markets/prices/) ---

let industryCostsCache: { payload: IndustryCostSnapshot; fetchedAt: number } | null = null;
const INDUSTRY_COSTS_TTL_MS = 60 * 60 * 1000;

app.get('/api/industry/cost-indices', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    if (!force && industryCostsCache && Date.now() - industryCostsCache.fetchedAt < INDUSTRY_COSTS_TTL_MS) {
      res.json(industryCostsCache.payload);
      return;
    }

    const [sysRes, pricesRes] = await Promise.all([
      fetchWithTimeout('https://esi.evetech.net/latest/industry/systems/?datasource=tranquility', {}, 12000),
      fetchWithTimeout('https://esi.evetech.net/latest/markets/prices/?datasource=tranquility', {}, 12000),
    ]);

    const costIndicesBySystem: Record<number, SystemCostIndices> = {};
    const trackedSystemIds = new Set<number>([
      30000137, // Ishisomo
      30000142, // Jita
      30000144, // Perimeter
      30002187, // Amarr
      30002659, // Dodixie
      30002510, // Rens
      30002053, // Hek
      ...Object.keys(CORRIDOR_SYSTEM_MAP).map(Number),
    ]);
    const reqSystemsRaw = String(req.query.systemIds || '');
    for (const s of reqSystemsRaw.split(',')) {
      const id = Number(s.trim());
      if (Number.isInteger(id) && id > 0) trackedSystemIds.add(id);
    }

    if (sysRes.ok) {
      const rawSystems = (await sysRes.json()) as {
        solar_system_id: number;
        cost_indices: { activity: string; cost_index: number }[];
      }[];
      if (Array.isArray(rawSystems)) {
        for (const entry of rawSystems) {
          if (!trackedSystemIds.has(entry.solar_system_id)) continue;
          const idx: SystemCostIndices = {
            systemId: entry.solar_system_id,
            manufacturing: 0.04,
            copying: 0.015,
            invention: 0.02,
            researching_material_efficiency: 0.015,
            researching_time_efficiency: 0.015,
            reaction: 0.03,
          };
          for (const ci of entry.cost_indices || []) {
            if (ci.activity === 'manufacturing') idx.manufacturing = ci.cost_index;
            else if (ci.activity === 'copying') idx.copying = ci.cost_index;
            else if (ci.activity === 'invention') idx.invention = ci.cost_index;
            else if (ci.activity === 'researching_material_efficiency')
              idx.researching_material_efficiency = ci.cost_index;
            else if (ci.activity === 'researching_time_efficiency')
              idx.researching_time_efficiency = ci.cost_index;
            else if (ci.activity === 'reaction') idx.reaction = ci.cost_index;
          }
          costIndicesBySystem[entry.solar_system_id] = idx;
        }
      }
    }

    const adjustedPricesByType: Record<number, number> = {};
    if (pricesRes.ok) {
      const rawPrices = (await pricesRes.json()) as {
        type_id: number;
        adjusted_price?: number;
        average_price?: number;
      }[];
      if (Array.isArray(rawPrices)) {
        const knownItemIds = new Set(EVE_ITEMS.map((i) => i.typeId));
        for (const p of rawPrices) {
          if (!knownItemIds.has(p.type_id)) continue;
          const val = p.adjusted_price ?? p.average_price ?? 0;
          if (val > 0) adjustedPricesByType[p.type_id] = val;
        }
      }
    }

    const payload: IndustryCostSnapshot = {
      costIndicesBySystem,
      adjustedPricesByType,
      fetchedAt: new Date().toISOString(),
      source: Object.keys(costIndicesBySystem).length > 0 ? 'esi_live' : 'baseline',
    };

    if (payload.source === 'esi_live') {
      industryCostsCache = { payload, fetchedAt: Date.now() };
    }
    res.json(payload);
  } catch (err) {
    console.error('ESI industry cost indices error:', err);
    res.status(500).json({ error: 'Unable to fetch live CCP system cost indices.' });
  }
});

// --- Route 1a-i: Dynamic 19-Category EVE ESI Market Group Catalog ---

app.get('/api/catalog/market-groups', async (req, res) => {
  try {
    const force = req.query.force === 'true';
    const rl = getEsiRateLimitState();
    if (force && rl.paused) {
      res.status(429).json({
        error: rl.pauseReason || 'EVE ESI rate-limit protection active.',
        esiRateLimit: rl,
      });
      return;
    }
    const catalog = await getOrBuildDynamicMarketCatalog(force);
    res.json(catalog);
  } catch (err) {
    console.error('ESI market catalog build error:', err);
    res.status(500).json({
      error: 'Failed to build EVE ESI market group catalog.',
      esiRateLimit: getEsiRateLimitState(),
    });
  }
});

// --- Route 1a-ii: Throttled Parallel Batch ESI Order Scanner (Jita 10000002 + Dodixie 10000032) ---

app.post('/api/market/batch', async (req, res) => {
  try {
    const body = (req.body || {}) as { typeIds?: number[]; force?: boolean };
    const typeIds = Array.isArray(body.typeIds)
      ? body.typeIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
      : [];
    const force = Boolean(body.force);

    const rl = getEsiRateLimitState();
    if (rl.paused) {
      res.status(429).json({
        error: rl.pauseReason || 'EVE ESI rate-limit protection active.',
        esiRateLimit: rl,
      });
      return;
    }

    if (typeIds.length === 0) {
      res.json({
        quotes: {},
        corridorOrders: [],
        liveCount: 0,
        esiRateLimit: rl,
      });
      return;
    }

    const result = await scanMarketOrderBatch(typeIds, force);
    if (result.esiRateLimit.paused) {
      res.status(429).json({
        ...result,
        error: result.esiRateLimit.pauseReason || 'EVE ESI rate-limit guard triggered.',
      });
      return;
    }
    res.json(result);
  } catch (err) {
    console.error('ESI batch market scan error:', err);
    res.status(500).json({
      error: 'Failed to scan ESI market order batch.',
      esiRateLimit: getEsiRateLimitState(),
    });
  }
});

// --- Route 1b: 30-Day Regional Market History (EVE ESI Public History Endpoint) ---

app.get('/api/market/history', async (req, res) => {
  try {
    const typeId = Number(req.query.typeId);
    const regionId = Number(req.query.regionId || EVE_ANCHORS.THE_FORGE_REGION_ID);

    if (!Number.isInteger(typeId) || typeId <= 0) {
      res.status(400).json({ error: 'Valid EVE item typeId is required.' });
      return;
    }

    const allowedRegions = new Set<number>([
      EVE_ANCHORS.THE_FORGE_REGION_ID,
      EVE_ANCHORS.SINQ_LAISON_REGION_ID,
      EVE_ANCHORS.DOMAIN_REGION_ID,
      EVE_ANCHORS.HEIMATAR_REGION_ID,
      EVE_ANCHORS.METROPOLIS_REGION_ID,
    ]);
    const allowedRegion = allowedRegions.has(regionId)
      ? regionId
      : EVE_ANCHORS.THE_FORGE_REGION_ID;

    const cacheKey = `${allowedRegion}:${typeId}`;
    const cached = historyCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < HISTORY_CACHE_TTL_MS) {
      res.json(cached.payload);
      return;
    }

    const url = `https://esi.evetech.net/latest/markets/${allowedRegion}/history/?datasource=tranquility&type_id=${typeId}`;
    const esiRes = await fetchWithTimeout(url, {}, 8500);

    if (esiRes.status === 400 || esiRes.status === 404) {
      const emptyPayload: MarketHistoryResponse = {
        regionId: allowedRegion,
        typeId,
        days: [],
        avgDailyVolume30d: 0,
        avgPrice30d: 0,
        high30d: 0,
        low30d: 0,
        trendPct: 0,
        emptyReason: `No recent market history recorded on EVE ESI for Type #${typeId} in ${
          allowedRegion === EVE_ANCHORS.SINQ_LAISON_REGION_ID ? 'Sinq Laison (Dodixie)' : 'The Forge (Jita)'
        } (ESI HTTP ${esiRes.status}).`,
      };
      historyCache.set(cacheKey, { payload: emptyPayload, fetchedAt: Date.now() });
      res.json(emptyPayload);
      return;
    }

    if (!esiRes.ok) {
      res.status(502).json({
        error: `EVE ESI market history returned HTTP ${esiRes.status}. Try again shortly.`,
      });
      return;
    }

    const rawDays = (await esiRes.json()) as MarketHistoryDay[];
    const sorted = Array.isArray(rawDays)
      ? [...rawDays].sort((a, b) => a.date.localeCompare(b.date))
      : [];
    const last30 = sorted.slice(-30);

    if (last30.length === 0) {
      const emptyPayload: MarketHistoryResponse = {
        regionId: allowedRegion,
        typeId,
        days: [],
        avgDailyVolume30d: 0,
        avgPrice30d: 0,
        high30d: 0,
        low30d: 0,
        trendPct: 0,
        emptyReason: `Zero trades recorded in the last 30 days in ${
          allowedRegion === EVE_ANCHORS.SINQ_LAISON_REGION_ID ? 'Sinq Laison (Dodixie)' : 'The Forge (Jita)'
        }.`,
      };
      historyCache.set(cacheKey, { payload: emptyPayload, fetchedAt: Date.now() });
      res.json(emptyPayload);
      return;
    }

    const totalVol = last30.reduce((s, d) => s + Number(d.volume || 0), 0);
    const avgDailyVolume30d = totalVol / last30.length;
    const avgPrice30d =
      last30.reduce((s, d) => s + Number(d.average || 0), 0) / last30.length;
    const high30d = Math.max(...last30.map((d) => Number(d.highest || d.average || 0)));
    const low30d = Math.min(...last30.map((d) => Number(d.lowest || d.average || 0)));
    const firstAvg = last30[0]?.average || 0;
    const lastAvg = last30[last30.length - 1]?.average || 0;
    const trendPct = firstAvg > 0 ? ((lastAvg - firstAvg) / firstAvg) * 100 : 0;

    const payload: MarketHistoryResponse = {
      regionId: allowedRegion,
      typeId,
      days: last30,
      avgDailyVolume30d,
      avgPrice30d,
      high30d,
      low30d,
      trendPct,
    };

    historyCache.set(cacheKey, { payload, fetchedAt: Date.now() });
    res.json(payload);
  } catch (err) {
    console.error('Market history error:', err);
    res.status(500).json({ error: 'Unable to fetch 30-day market history from EVE ESI.' });
  }
});

// --- Route 1c: EVE Online Public ESI Route Waypoints + Live Gatecamp Scanner ---

async function postUniverseNamesChunk(chunk: number[]): Promise<{ id: number; name: string }[]> {
  if (chunk.length === 0) return [];
  try {
    const res = await fetchWithTimeout(
      'https://esi.evetech.net/latest/universe/names/?datasource=tranquility',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk),
      },
      8500
    );
    if (res.ok) {
      const entries = (await res.json()) as { id: number; name: string }[];
      return Array.isArray(entries) ? entries : [];
    }
    // ESI /universe/names/ returns 404 for the entire batch if even ONE ID is invalid/obsolete.
    // Bisect down so all valid IDs still resolve cleanly!
    if (res.status === 404 && chunk.length > 1) {
      const mid = Math.floor(chunk.length / 2);
      const [left, right] = await Promise.all([
        postUniverseNamesChunk(chunk.slice(0, mid)),
        postUniverseNamesChunk(chunk.slice(mid)),
      ]);
      return [...left, ...right];
    }
    // Single-ID fallback via /universe/types/{id}/ for special blueprint types not indexed by /universe/names/
    if (res.status === 404 && chunk.length === 1) {
      const typeRes = await fetchWithTimeout(
        `https://esi.evetech.net/latest/universe/types/${chunk[0]}/?datasource=tranquility`,
        {},
        5000
      );
      if (typeRes.ok) {
        const typeJson = (await typeRes.json()) as { type_id?: number; name?: string };
        if (typeJson?.name) {
          return [{ id: chunk[0], name: typeJson.name }];
        }
      }
    }
  } catch {
    // Graceful fallback handled by caller
  }
  return [];
}

async function resolveUniverseNames(ids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  const missing: number[] = [];

  for (const id of ids) {
    if (!Number.isInteger(id) || id <= 0) continue;
    const cached = entityNameCache.get(id);
    if (cached) {
      result.set(id, cached);
    } else if (CORRIDOR_SYSTEM_MAP[id]) {
      entityNameCache.set(id, CORRIDOR_SYSTEM_MAP[id].name);
      result.set(id, CORRIDOR_SYSTEM_MAP[id].name);
    } else {
      missing.push(id);
    }
  }

  const uniqueMissing = Array.from(new Set(missing));
  for (let i = 0; i < uniqueMissing.length; i += 500) {
    const chunk = uniqueMissing.slice(i, i + 500);
    const entries = await postUniverseNamesChunk(chunk);
    for (const e of entries) {
      if (e?.id && e?.name) {
        entityNameCache.set(e.id, e.name);
        result.set(e.id, e.name);
      }
    }
  }

  return result;
}

async function getLiveSystemKills(): Promise<{ map: Map<number, SystemKillRaw>; fetchedAt: number }> {
  const now = Date.now();
  if (systemKillsCache && now - systemKillsCache.fetchedAt < SYSTEM_KILLS_TTL_MS) {
    return systemKillsCache;
  }

  const map = new Map<number, SystemKillRaw>();
  try {
    const res = await fetchWithTimeout(
      'https://esi.evetech.net/latest/universe/system_kills/?datasource=tranquility',
      {},
      8000
    );
    if (res.ok) {
      const rows = (await res.json()) as SystemKillRaw[];
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (row && typeof row.system_id === 'number') {
            map.set(row.system_id, {
              system_id: row.system_id,
              ship_kills: Number(row.ship_kills || 0),
              pod_kills: Number(row.pod_kills || 0),
              npc_kills: Number(row.npc_kills || 0),
            });
          }
        }
      }
      systemKillsCache = { map, fetchedAt: now };
      return systemKillsCache;
    }
  } catch {
    // Return stale cache or empty map on transient failure
  }

  return systemKillsCache ?? { map, fetchedAt: now };
}

async function fetchEsiRoutePath(
  origin: number,
  destination: number,
  preference: 'Safer' | 'Shorter',
  avoidSystems: number[]
): Promise<{ jumps: number; waypoints: number[] }> {
  if (origin === destination) return { jumps: 0, waypoints: [origin] };

  // Never avoid origin or destination themselves
  const cleanAvoid = Array.from(
    new Set(
      avoidSystems.filter(
        (id) => Number.isInteger(id) && id > 0 && id !== origin && id !== destination
      )
    )
  ).sort((a, b) => a - b);

  const avoidKey = cleanAvoid.join(',');
  const cacheKey = `${origin}:${destination}:${preference}:${avoidKey}`;
  const cached = routePathCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ROUTE_CACHE_TTL_MS) {
    return { jumps: cached.jumps, waypoints: cached.waypoints };
  }

  // Primary: POST https://esi.evetech.net/route/{origin}/{destination}
  try {
    const postUrl = `https://esi.evetech.net/route/${origin}/${destination}`;
    const postPayload: { preference: 'Safer' | 'Shorter'; avoid_systems?: number[] } = {
      preference,
    };
    if (cleanAvoid.length > 0) {
      postPayload.avoid_systems = cleanAvoid;
    }

    const postRes = await fetchWithTimeout(
      postUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(postPayload),
      },
      7000
    );

    if (postRes.ok) {
      const data = (await postRes.json()) as unknown;
      let routeArr: number[] | null = null;
      if (Array.isArray(data)) {
        routeArr = data.map(Number).filter((n) => Number.isInteger(n) && n > 0);
      } else if (
        data &&
        typeof data === 'object' &&
        Array.isArray((data as { route?: unknown[] }).route)
      ) {
        routeArr = (data as { route: unknown[] }).route
          .map(Number)
          .filter((n) => Number.isInteger(n) && n > 0);
      }
      if (routeArr && routeArr.length > 0) {
        const jumps = Math.max(0, routeArr.length - 1);
        routePathCache.set(cacheKey, { jumps, waypoints: routeArr, fetchedAt: Date.now() });
        return { jumps, waypoints: routeArr };
      }
    }
  } catch {
    // Fall through to GET route endpoint
  }

  // Fallback: GET https://esi.evetech.net/latest/route/{origin}/{destination}/?flag=secure|shortest&avoid=...
  const flag = preference === 'Safer' ? 'secure' : 'shortest';
  const qs = new URLSearchParams({ datasource: 'tranquility', flag });
  for (const avoidId of cleanAvoid.slice(0, 40)) {
    qs.append('avoid', String(avoidId));
  }
  const getUrl = `https://esi.evetech.net/latest/route/${origin}/${destination}/?${qs.toString()}`;
  try {
    const getRes = await fetchWithTimeout(getUrl, {}, 7500);
    if (getRes.ok) {
      const arr = (await getRes.json()) as unknown;
      if (Array.isArray(arr) && arr.length > 0) {
        const waypoints = arr.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        const jumps = Math.max(0, waypoints.length - 1);
        routePathCache.set(cacheKey, { jumps, waypoints, fetchedAt: Date.now() });
        return { jumps, waypoints };
      }
    }
    // If avoiding hot systems yields 404 (no path exists), retry without avoid so pilot still gets a route
    if (getRes.status === 404 && cleanAvoid.length > 0) {
      return fetchEsiRoutePath(origin, destination, preference, []);
    }
  } catch {
    // Fall through to deterministic heuristic
  }

  // Deterministic fallback if ESI is temporarily unreachable
  const cOrigin = CORRIDOR_SYSTEM_MAP[origin];
  const cDest = CORRIDOR_SYSTEM_MAP[destination];
  let fallbackJumps = 4;
  if (origin === EVE_ANCHORS.JITA_SYSTEM_ID && cDest) fallbackJumps = cDest.jumpsFromJita;
  else if (destination === EVE_ANCHORS.JITA_SYSTEM_ID && cOrigin) fallbackJumps = cOrigin.jumpsFromJita;
  else if (
    (origin === EVE_ANCHORS.JITA_SYSTEM_ID && destination === EVE_ANCHORS.DODIXIE_SYSTEM_ID) ||
    (origin === EVE_ANCHORS.DODIXIE_SYSTEM_ID && destination === EVE_ANCHORS.JITA_SYSTEM_ID)
  ) {
    fallbackJumps = preference === 'Safer' ? 15 : 12;
  }
  return { jumps: fallbackJumps, waypoints: [origin, destination] };
}

app.post('/api/route/distances', async (req, res) => {
  try {
    const { pairs, preference, avoidSystems } = req.body as {
      pairs?: { origin: number; destination: number }[];
      preference?: 'Safer' | 'Shorter';
      avoidSystems?: number[];
    };

    const pref: 'Safer' | 'Shorter' = preference === 'Shorter' ? 'Shorter' : 'Safer';
    const avoidList = Array.isArray(avoidSystems)
      ? avoidSystems.map(Number).filter((n) => Number.isInteger(n) && n > 0)
      : [];

    if (!Array.isArray(pairs) || pairs.length === 0) {
      res.json({
        preference: pref,
        distances: {},
        waypointsByPair: {},
        hotSystemsByPair: {},
        killFeedUpdatedAt: new Date().toISOString(),
      });
      return;
    }

    // Deduplicate valid pairs (cap at 64 pairs per request for safety)
    const uniquePairs = new Map<string, { origin: number; destination: number }>();
    for (const p of pairs.slice(0, 120)) {
      const o = Number(p?.origin);
      const d = Number(p?.destination);
      if (!Number.isInteger(o) || !Number.isInteger(d) || o <= 0 || d <= 0) continue;
      const key = `${o}:${d}`;
      if (!uniquePairs.has(key)) {
        uniquePairs.set(key, { origin: o, destination: d });
      }
      if (uniquePairs.size >= 64) break;
    }

    const entries = Array.from(uniquePairs.entries());
    const distances: Record<string, number> = {};
    const waypointsByPair: Record<string, number[]> = {};

    // Start live kill feed fetch concurrently with route calculations
    const killsPromise = getLiveSystemKills();

    // Fetch routes in parallel chunks of 8 to be polite to ESI
    for (let i = 0; i < entries.length; i += 8) {
      const batch = entries.slice(i, i + 8);
      await Promise.all(
        batch.map(async ([key, pair]) => {
          const result = await fetchEsiRoutePath(pair.origin, pair.destination, pref, avoidList);
          distances[key] = result.jumps;
          waypointsByPair[key] = result.waypoints;
        })
      );
    }

    const killsData = await killsPromise;
    const hotSystemIdsToName = new Set<number>();
    const rawHotByPair: Record<string, { systemId: number; kill: SystemKillRaw }[]> = {};

    // Cross-reference every intermediate solar system along each leg against live ESI system_kills
    for (const [key, waypoints] of Object.entries(waypointsByPair)) {
      const intermediate = waypoints.length > 2 ? waypoints.slice(1, -1) : [];
      const flagged: { systemId: number; kill: SystemKillRaw }[] = [];
      for (const sysId of intermediate) {
        const kill = killsData.map.get(sysId);
        if (!kill) continue;
        // Flag as HOT SYSTEM if >= 2 ship kills OR >= 1 pod kill in the last hour
        if (kill.ship_kills >= 2 || kill.pod_kills >= 1) {
          flagged.push({ systemId: sysId, kill });
          hotSystemIdsToName.add(sysId);
        }
      }
      if (flagged.length > 0) {
        rawHotByPair[key] = flagged;
      }
    }

    const resolvedNames =
      hotSystemIdsToName.size > 0
        ? await resolveUniverseNames(Array.from(hotSystemIdsToName))
        : new Map<number, string>();

    const hotSystemsByPair: Record<string, HotSystemIntel[]> = {};
    for (const [key, list] of Object.entries(rawHotByPair)) {
      hotSystemsByPair[key] = list
        .map(({ systemId, kill }): HotSystemIntel => {
          const severity: 'hot' | 'critical' =
            kill.ship_kills + kill.pod_kills >= 10 || kill.pod_kills >= 3 ? 'critical' : 'hot';
          return {
            systemId,
            systemName: resolvedNames.get(systemId) || `System ${systemId}`,
            shipKills: kill.ship_kills,
            podKills: kill.pod_kills,
            npcKills: kill.npc_kills,
            severity,
            zkillUrl: `https://zkillboard.com/system/${systemId}/`,
          };
        })
        .sort((a, b) => b.shipKills + b.podKills - (a.shipKills + a.podKills));
    }

    res.json({
      preference: pref,
      distances,
      waypointsByPair,
      hotSystemsByPair,
      killFeedUpdatedAt: new Date(killsData.fetchedAt).toISOString(),
    });
  } catch (err) {
    console.error('ESI route distances error:', err);
    res.status(500).json({ error: 'Unable to query EVE ESI route distances & kill feed.' });
  }
});

// Permanent in-memory cache of real EVE Online solar system (x, y, z) coordinates from ESI
interface CachedSystemCoord {
  systemId: number;
  name: string;
  x: number;
  y: number;
  z: number;
  securityStatus: number;
}
const systemCoordCache = new Map<number, CachedSystemCoord>();

async function fetchSolarSystemCoord(systemId: number): Promise<CachedSystemCoord | null> {
  const cached = systemCoordCache.get(systemId);
  if (cached) return cached;

  try {
    const res = await fetchWithTimeout(
      `https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility`,
      {},
      7000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      system_id?: number;
      name?: string;
      security_status?: number;
      position?: { x: number; y: number; z: number };
    };
    if (
      !data.position ||
      typeof data.position.x !== 'number' ||
      typeof data.position.z !== 'number'
    ) {
      return null;
    }
    const entry: CachedSystemCoord = {
      systemId: data.system_id ?? systemId,
      name: data.name || `System ${systemId}`,
      x: data.position.x,
      y: data.position.y ?? 0,
      z: data.position.z,
      securityStatus:
        typeof data.security_status === 'number'
          ? Number(data.security_status.toFixed(2))
          : 0.5,
    };
    systemCoordCache.set(systemId, entry);
    return entry;
  } catch {
    return null;
  }
}

app.post('/api/route/system-coords', async (req, res) => {
  try {
    const { systemIds } = req.body as { systemIds?: number[] };
    const cleanIds = Array.isArray(systemIds)
      ? Array.from(
          new Set(systemIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))
        ).slice(0, 120)
      : [];

    if (cleanIds.length === 0) {
      res.json({ systems: {} });
      return;
    }

    const systems: Record<number, CachedSystemCoord> = {};
    const missing: number[] = [];

    for (const id of cleanIds) {
      const hit = systemCoordCache.get(id);
      if (hit) {
        systems[id] = hit;
      } else {
        missing.push(id);
      }
    }

    // Fetch uncached solar systems in polite parallel batches of 10
    for (let i = 0; i < missing.length; i += 10) {
      const batch = missing.slice(i, i + 10);
      const results = await Promise.all(batch.map((id) => fetchSolarSystemCoord(id)));
      for (const item of results) {
        if (item) {
          systems[item.systemId] = item;
        }
      }
    }

    res.json({ systems });
  } catch (err) {
    console.error('ESI system coordinates error:', err);
    res.status(500).json({ error: 'Unable to fetch EVE solar system coordinates.' });
  }
});

// Permanent caches for solar system -> region_id and station names (for live order book & remote range)
const systemRegionCache = new Map<number, number>([
  [EVE_ANCHORS.JITA_SYSTEM_ID, EVE_ANCHORS.THE_FORGE_REGION_ID],
  [EVE_ANCHORS.ISHISOMO_SYSTEM_ID, EVE_ANCHORS.THE_FORGE_REGION_ID],
  [EVE_ANCHORS.DODIXIE_SYSTEM_ID, EVE_ANCHORS.SINQ_LAISON_REGION_ID],
  [30002187, 10000043], // Amarr -> Domain
  [30002510, 10000030], // Rens -> Heimatar
  [30002053, 10000042], // Hek -> Metropolis
  ...Object.values(CORRIDOR_SYSTEM_MAP).map((s): [number, number] => [
    s.systemId,
    EVE_ANCHORS.THE_FORGE_REGION_ID,
  ]),
]);
const constellationRegionCache = new Map<number, number>();
const orderBookStationCache = new Map<number, string>([
  [EVE_ANCHORS.JITA_STATION_ID, EVE_ANCHORS.JITA_STATION_NAME],
  [EVE_ANCHORS.DODIXIE_STATION_ID, EVE_ANCHORS.DODIXIE_STATION_NAME],
  [EVE_ANCHORS.ISHISOMO_MFG_STATION_ID, EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME],
  [EVE_ANCHORS.ISHISOMO_RES_STATION_ID, EVE_ANCHORS.ISHISOMO_RES_STATION_NAME],
  [60008494, 'Amarr VIII (Oris) - Emperor Family Academy'],
  [60004588, 'Rens VI - Moon 8 - Brutor Tribe Treasury'],
  [60005686, 'Hek VIII - Moon 12 - Boundless Creation Factory'],
]);
const REGION_LABEL_MAP: Record<number, string> = {
  10000002: 'The Forge (Jita)',
  10000032: 'Sinq Laison (Dodixie)',
  10000043: 'Domain (Amarr)',
  10000030: 'Heimatar (Rens)',
  10000042: 'Metropolis (Hek)',
};

async function resolveSystemRegionId(systemId: number): Promise<number | null> {
  if (!Number.isInteger(systemId) || systemId <= 0) return null;
  const cached = systemRegionCache.get(systemId);
  if (cached) return cached;

  try {
    const sysRes = await fetchWithTimeout(
      `https://esi.evetech.net/latest/universe/systems/${systemId}/?datasource=tranquility`,
      {},
      6000
    );
    if (!sysRes.ok) return null;
    const sysJson = (await sysRes.json()) as { constellation_id?: number };
    const constId = sysJson.constellation_id;
    if (!constId) return null;

    const cachedConst = constellationRegionCache.get(constId);
    if (cachedConst) {
      systemRegionCache.set(systemId, cachedConst);
      return cachedConst;
    }

    const constRes = await fetchWithTimeout(
      `https://esi.evetech.net/latest/universe/constellations/${constId}/?datasource=tranquility`,
      {},
      6000
    );
    if (!constRes.ok) return null;
    const constJson = (await constRes.json()) as { region_id?: number };
    if (constJson.region_id) {
      constellationRegionCache.set(constId, constJson.region_id);
      systemRegionCache.set(systemId, constJson.region_id);
      return constJson.region_id;
    }
  } catch {
    // ignore
  }
  return null;
}

interface EsiMarketOrderRaw {
  order_id: number;
  price: number;
  volume_remain: number;
  volume_total: number;
  min_volume: number;
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  range?: string;
}

interface OrderBookCacheEntry {
  fetchedAt: number;
  sellOrders: EsiMarketOrderRaw[];
  buyOrders: EsiMarketOrderRaw[];
}
const liveOrderBookCache = new Map<string, OrderBookCacheEntry>();
const ORDER_BOOK_TTL_MS = 45_000;

async function fetchTopRegionalOrders(
  regionId: number,
  typeId: number,
  orderType: 'sell' | 'buy'
): Promise<EsiMarketOrderRaw[]> {
  const cacheKey = `${regionId}:${typeId}:${orderType}`;
  const cached = liveOrderBookCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < ORDER_BOOK_TTL_MS) {
    return orderType === 'sell' ? cached.sellOrders : cached.buyOrders;
  }

  const url = `https://esi.evetech.net/latest/markets/${regionId}/orders/?datasource=tranquility&order_type=${orderType}&type_id=${typeId}`;
  const res = await fetchWithTimeout(url, {}, 8000);
  if (!res.ok) return [];

  const rows = (await res.json()) as EsiMarketOrderRaw[];
  if (!Array.isArray(rows)) return [];

  const sorted =
    orderType === 'sell'
      ? rows
          .filter((o) => !o.is_buy_order && o.volume_remain > 0)
          .sort((a, b) => a.price - b.price)
          .slice(0, 8)
      : rows
          .filter((o) => o.is_buy_order && o.volume_remain > 0)
          .sort((a, b) => b.price - a.price)
          .slice(0, 8);

  liveOrderBookCache.set(cacheKey, {
    fetchedAt: Date.now(),
    sellOrders: orderType === 'sell' ? sorted : [],
    buyOrders: orderType === 'buy' ? sorted : [],
  });
  return sorted;
}

app.get('/api/market/orderbook', async (req, res) => {
  try {
    const typeId = Number(req.query.typeId);
    const buyRegionId = Number(req.query.buyRegionId) || EVE_ANCHORS.THE_FORGE_REGION_ID;
    const sellRegionId = Number(req.query.sellRegionId) || EVE_ANCHORS.SINQ_LAISON_REGION_ID;
    const buySystemId = Number(req.query.buySystemId) || 0;
    const pilotSystemId = Number(req.query.pilotSystemId) || 0;

    if (!Number.isInteger(typeId) || typeId <= 0) {
      res.status(400).json({ error: 'Valid typeId is required.' });
      return;
    }

    const [
      topSellRaw,
      topBuyRaw,
      pilotRegionId,
      buySystemRegionId,
      routeToBuy,
    ] = await Promise.all([
      fetchTopRegionalOrders(buyRegionId, typeId, 'sell'),
      fetchTopRegionalOrders(sellRegionId, typeId, 'buy'),
      pilotSystemId > 0 ? resolveSystemRegionId(pilotSystemId) : Promise.resolve(null),
      buySystemId > 0 ? resolveSystemRegionId(buySystemId) : Promise.resolve(buyRegionId),
      pilotSystemId > 0 && buySystemId > 0
        ? fetchEsiRoutePath(pilotSystemId, buySystemId, 'Shorter', [])
        : Promise.resolve(null),
    ]);

    // Resolve all unique NPC station names & system names (for Upwell structure fallback labels)
    const npcStationIds = new Set<number>();
    const structureSystemIds = new Set<number>();
    for (const o of [...topSellRaw, ...topBuyRaw]) {
      if (orderBookStationCache.has(o.location_id)) continue;
      if (o.location_id < 1_000_000_000) {
        npcStationIds.add(o.location_id);
      } else if (o.system_id > 0) {
        structureSystemIds.add(o.system_id);
      }
    }

    const idsToResolve = Array.from(new Set([...npcStationIds, ...structureSystemIds]));
    const resolvedNames =
      idsToResolve.length > 0
        ? await resolveUniverseNames(idsToResolve)
        : new Map<number, string>();

    for (const stId of npcStationIds) {
      const name = resolvedNames.get(stId);
      if (name) orderBookStationCache.set(stId, name);
    }

    const mapOrder = (o: EsiMarketOrderRaw) => {
      let stationName = orderBookStationCache.get(o.location_id);
      if (!stationName) {
        if (o.location_id >= 1_000_000_000) {
          const sysName = resolvedNames.get(o.system_id);
          stationName = sysName
            ? `${sysName} — Player Structure`
            : `Player Structure (${o.location_id})`;
        } else {
          stationName = `Station ${o.location_id}`;
        }
      }
      return {
        orderId: o.order_id,
        price: o.price,
        volumeRemain: o.volume_remain,
        volumeTotal: o.volume_total,
        minVolume: o.min_volume ?? 1,
        locationId: o.location_id,
        stationName,
        systemId: o.system_id,
        isBuyOrder: o.is_buy_order,
        range: o.range,
      };
    };

    const effectiveBuyRegion = buySystemRegionId ?? buyRegionId;
    const sameRegion =
      pilotRegionId !== null ? pilotRegionId === effectiveBuyRegion : undefined;

    res.json({
      typeId,
      buyRegionId,
      buyRegionName: REGION_LABEL_MAP[buyRegionId] || `Region ${buyRegionId}`,
      sellRegionId,
      sellRegionName: REGION_LABEL_MAP[sellRegionId] || `Region ${sellRegionId}`,
      topSellOrdersAtBuyHub: topSellRaw.map(mapOrder),
      topBuyOrdersAtSellHub: topBuyRaw.map(mapOrder),
      pilotSystemId: pilotSystemId > 0 ? pilotSystemId : undefined,
      pilotRegionId: pilotRegionId ?? undefined,
      buySystemId: buySystemId > 0 ? buySystemId : undefined,
      buySystemRegionId: effectiveBuyRegion,
      jumpsToBuySystem: routeToBuy ? routeToBuy.jumps : undefined,
      sameRegion,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('ESI live orderbook error:', err);
    res.status(500).json({ error: 'Unable to load live EVE ESI regional order book.' });
  }
});

app.get('/api/route/resolve-system', async (req, res) => {
  try {
    const raw = String(req.query.q || '').trim();
    if (!raw) {
      res.status(400).json({ error: 'Enter a solar system name or ID.' });
      return;
    }

    const cacheKey = raw.toLowerCase();
    const cached = systemLookupCache.get(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    // Numeric solarSystemId lookup via ESI /universe/systems/{id}
    if (/^\d{7,9}$/.test(raw)) {
      const id = Number(raw);
      const sysRes = await fetchWithTimeout(
        `https://esi.evetech.net/latest/universe/systems/${id}/?datasource=tranquility`,
        {},
        7000
      );
      if (!sysRes.ok) {
        res.status(404).json({ error: `Solar system ID ${id} was not found on EVE ESI.` });
        return;
      }
      const sysJson = (await sysRes.json()) as { name?: string };
      const resolved = { systemId: id, systemName: sysJson.name || `System ${id}` };
      systemLookupCache.set(cacheKey, resolved);
      res.json(resolved);
      return;
    }

    // Exact name lookup via ESI POST /universe/ids/
    const idRes = await fetchWithTimeout(
      'https://esi.evetech.net/latest/universe/ids/?datasource=tranquility',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify([raw]),
      },
      7000
    );

    if (!idRes.ok) {
      res.status(502).json({ error: `EVE ESI system lookup returned HTTP ${idRes.status}.` });
      return;
    }

    const idJson = (await idRes.json()) as {
      systems?: { id: number; name: string }[];
    };
    const match = idJson.systems?.[0];
    if (!match) {
      res.status(404).json({
        error: `Solar system "${raw}" not found. Enter an exact EVE system name (e.g., Jita, Dodixie, Amarr, Ishisomo) or Solar System ID.`,
      });
      return;
    }

    const resolved = { systemId: match.id, systemName: match.name };
    systemLookupCache.set(cacheKey, resolved);
    res.json(resolved);
  } catch (err) {
    console.error('Resolve system error:', err);
    res.status(500).json({ error: 'Unable to resolve solar system via EVE ESI.' });
  }
});

// --- Route 2: EVE Online SSO OAuth2 PKCE Helpers & Character Sync ---

app.get('/api/eve/sso-config', (_req, res) => {
  const baseUrl = (process.env.APP_URL || '').replace(/\/+$/, '');
  const envEveClientId = (process.env.EVE_CLIENT_ID || '').trim();
  const envGeminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const hasEnvGeminiKey = Boolean(envGeminiKey && envGeminiKey !== 'MY_GEMINI_API_KEY');
  res.json({
    callbackUrl: baseUrl ? `${baseUrl}/` : '/',
    serverClientId: envEveClientId,
    hasEnvEveClientId: Boolean(envEveClientId),
    hasEnvGeminiKey,
  });
});

const handleOAuthCallback: express.RequestHandler = (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const error = typeof req.query.error === 'string' ? req.query.error : '';

  const payload = JSON.stringify({
    type: 'EVE_SSO_CALLBACK',
    code,
    state,
    error,
  }).replace(/</g, '\\u003c');

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html>
  <head>
    <title>EVE SSO Authentication</title>
    <style>
      body { background: #0b0e14; color: #e2e8f0; font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
      .box { background: #131822; border: 1px solid #1e293b; padding: 24px 32px; border-radius: 8px; text-align: center; max-width: 380px; }
    </style>
  </head>
  <body>
    <div class="box">
      <p style="font-weight:600; margin:0 0 8px;">${error ? 'EVE SSO Authorization Cancelled' : 'EVE SSO Authorized'}</p>
      <p style="font-size:13px; color:#94a3b8; margin:0;">Returning to Foxy RedFox Indy Command...</p>
    </div>
    <script>
      (function() {
        var data = ${payload};
        if (window.opener) {
          window.opener.postMessage(data, window.location.origin);
          setTimeout(function() { window.close(); }, 350);
        }
      })();
    </script>
  </body>
</html>`);
};

app.get(['/auth/callback', '/auth/callback/'], handleOAuthCallback);

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

app.post('/api/eve/token', async (req, res) => {
  try {
    const { code, codeVerifier, clientId } = req.body as {
      code?: string;
      codeVerifier?: string;
      clientId?: string;
    };

    const envClientId = (process.env.EVE_CLIENT_ID || '').trim();
    const customClientId = typeof clientId === 'string' ? clientId.trim() : '';
    const resolvedClientId = envClientId || customClientId;
    if (!code || !codeVerifier || !resolvedClientId) {
      res.status(400).json({ error: 'Missing authorization code, PKCE verifier, or EVE Client ID.' });
      return;
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: resolvedClientId,
      code_verifier: codeVerifier,
    });

    const tokenRes = await fetchWithTimeout(
      'https://login.eveonline.com/v2/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Host: 'login.eveonline.com',
        },
        body: body.toString(),
      },
      10_000
    );

    const tokenJson = (await tokenRes.json()) as Record<string, unknown>;
    if (!tokenRes.ok || !tokenJson.access_token) {
      res.status(tokenRes.status || 400).json({
        error: String(tokenJson.error_description || tokenJson.error || 'EVE SSO token exchange failed.'),
      });
      return;
    }

    const accessToken = String(tokenJson.access_token);
    const jwt = decodeJwtPayload(accessToken);
    const sub = String(jwt?.sub || '');
    const charIdMatch = sub.match(/CHARACTER:EVE:(\d+)/);
    const characterId = charIdMatch ? Number(charIdMatch[1]) : 0;
    const characterName = String(jwt?.name || 'EVE Capsuleer');

    res.json({
      accessToken,
      refreshToken: tokenJson.refresh_token ? String(tokenJson.refresh_token) : undefined,
      expiresIn: Number(tokenJson.expires_in || 1199),
      characterId,
      characterName,
    });
  } catch (err) {
    console.error('EVE token exchange error:', err);
    res.status(500).json({ error: 'Failed to contact EVE Online SSO token server.' });
  }
});

async function resolveStationInfo(
  stationId: number
): Promise<{ name: string; systemId: number; systemName: string } | null> {
  if (!Number.isInteger(stationId) || stationId <= 0) return null;
  const cached = stationInfoCache.get(stationId);
  if (cached) return cached;

  // Fast-path canonical stations
  if (stationId === EVE_ANCHORS.JITA_STATION_ID) {
    const info = { name: EVE_ANCHORS.JITA_STATION_NAME, systemId: EVE_ANCHORS.JITA_SYSTEM_ID, systemName: 'Jita' };
    stationInfoCache.set(stationId, info);
    return info;
  }
  if (stationId === EVE_ANCHORS.DODIXIE_STATION_ID) {
    const info = { name: EVE_ANCHORS.DODIXIE_STATION_NAME, systemId: EVE_ANCHORS.DODIXIE_SYSTEM_ID, systemName: 'Dodixie' };
    stationInfoCache.set(stationId, info);
    return info;
  }
  if (stationId === EVE_ANCHORS.ISHISOMO_MFG_STATION_ID) {
    const info = { name: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME, systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID, systemName: 'Ishisomo' };
    stationInfoCache.set(stationId, info);
    return info;
  }
  if (stationId === EVE_ANCHORS.ISHISOMO_RES_STATION_ID) {
    const info = { name: EVE_ANCHORS.ISHISOMO_RES_STATION_NAME, systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID, systemName: 'Ishisomo' };
    stationInfoCache.set(stationId, info);
    return info;
  }

  // NPC stations are in the 60,000,000–69,999,999 range
  if (stationId >= 60_000_000 && stationId < 70_000_000) {
    try {
      const stRes = await fetchWithTimeout(
        `https://esi.evetech.net/latest/universe/stations/${stationId}/?datasource=tranquility`,
        {},
        6500
      );
      if (stRes.ok) {
        const stJson = (await stRes.json()) as { name?: string; system_id?: number };
        const systemId = Number(stJson.system_id || 0);
        const sysNames = systemId > 0 ? await resolveUniverseNames([systemId]) : new Map<number, string>();
        const info = {
          name: stJson.name || `Station ${stationId}`,
          systemId,
          systemName: sysNames.get(systemId) || `System ${systemId}`,
        };
        stationInfoCache.set(stationId, info);
        return info;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

interface EsiAssetRaw {
  item_id: number;
  type_id: number;
  location_id: number;
  location_flag?: string;
  location_type?: string;
  quantity?: number;
  is_singleton?: boolean;
}

interface EsiBlueprintRaw {
  item_id: number;
  type_id: number;
  material_efficiency: number;
  time_efficiency: number;
  runs: number;
  quantity: number;
  location_id: number;
  location_flag?: string;
}

// Fast lookup table from normalized EVE product name -> catalog product typeId
const PRODUCT_ID_BY_NORM_NAME = new Map<string, number>(
  EVE_ITEMS.map((item) => [item.name.toLowerCase().trim(), item.typeId])
);

function stripBlueprintSuffix(name: string): string {
  return name
    .replace(/\s+Reaction Formula$/i, '')
    .replace(/\s+Blueprint$/i, '')
    .replace(/\s+Formula$/i, '')
    .trim();
}

/**
 * Full sequential ESI X-Pages pagination for personal or corporation blueprints.
 * Reads the X-Pages response header on page 1 and loops sequentially through ?page=2..X-Pages.
 */
async function fetchAllPaginatedBlueprints(
  endpointUrl: string,
  esiHeaders: Record<string, string>
): Promise<{ rows: EsiBlueprintRaw[]; pagesScanned: number; status: number }> {
  const page1Res = await fetchWithTimeout(
    `${endpointUrl}?datasource=tranquility&page=1`,
    { headers: esiHeaders },
    10_000
  );

  if (!page1Res.ok) {
    return { rows: [], pagesScanned: 0, status: page1Res.status };
  }

  const page1Data = (await page1Res.json()) as EsiBlueprintRaw[];
  const rows: EsiBlueprintRaw[] = Array.isArray(page1Data) ? [...page1Data] : [];

  const rawXPages = page1Res.headers.get('x-pages') || page1Res.headers.get('X-Pages') || '1';
  const totalPages = Math.max(1, Number.parseInt(rawXPages, 10) || 1);
  let pagesScanned = 1;

  for (let page = 2; page <= totalPages; page++) {
    try {
      const pageRes = await fetchWithTimeout(
        `${endpointUrl}?datasource=tranquility&page=${page}`,
        { headers: esiHeaders },
        10_000
      );
      if (!pageRes.ok) {
        // Stop on 404/403, otherwise continue trying remaining pages
        if (pageRes.status === 404 || pageRes.status === 403) break;
        continue;
      }
      const pageData = (await pageRes.json()) as EsiBlueprintRaw[];
      if (Array.isArray(pageData)) {
        rows.push(...pageData);
      }
      pagesScanned += 1;
    } catch {
      // Continue remaining pages on single transient timeout
    }
  }

  return { rows, pagesScanned, status: 200 };
}

/**
 * Hydrates 100% of fetched ESI blueprints (zero truncation, zero dropping) by:
 * 1) Batching all unique blueprint type_ids into POST /universe/names/
 * 2) Resolving NPC station locations (walking asset container parents when available)
 * 3) Mapping BPO vs BPC strictly via ESI runs === -1 (BPO) vs runs > 0 (BPC)
 */
async function hydrateEsiBlueprints(params: {
  personalRaw: EsiBlueprintRaw[];
  corpRaw: EsiBlueprintRaw[];
  assetById?: Map<number, EsiAssetRaw>;
}): Promise<BlueprintEntry[]> {
  const { personalRaw, corpRaw, assetById } = params;

  const combined: { raw: EsiBlueprintRaw; source: 'personal' | 'corporation' }[] = [
    ...personalRaw.map((raw) => ({ raw, source: 'personal' as const })),
    ...corpRaw.map((raw) => ({ raw, source: 'corporation' as const })),
  ];

  if (combined.length === 0) return [];

  // 1. Batch ALL unique blueprint type_ids into POST /universe/names/
  const allTypeIds = Array.from(new Set(combined.map((c) => c.raw.type_id)));
  const resolvedNames = await resolveUniverseNames(allTypeIds);

  // 2. Walk container chains (if assets loaded) & resolve unique NPC stations
  const resolveRootLoc = (locId: number): number => {
    if (!assetById) return locId;
    let cur = locId;
    let hops = 0;
    while (hops++ < 5 && assetById.has(cur)) {
      cur = assetById.get(cur)!.location_id;
    }
    return cur;
  };

  const uniqueNpcStationIds = Array.from(
    new Set(
      combined
        .map((c) => resolveRootLoc(c.raw.location_id))
        .filter((id) => id >= 60_000_000 && id < 70_000_000)
    )
  ).slice(0, 40);

  if (uniqueNpcStationIds.length > 0) {
    await Promise.all(uniqueNpcStationIds.map((stId) => resolveStationInfo(stId)));
  }

  // 3. Build 100% of BlueprintEntry records
  const entries: BlueprintEntry[] = combined.map(({ raw, source }) => {
    const esiName = resolvedNames.get(raw.type_id);
    const blueprintName = esiName || `Blueprint Type #${raw.type_id}`;
    const cleanProductName = esiName ? stripBlueprintSuffix(esiName) : blueprintName;
    const matchedProductTypeId = PRODUCT_ID_BY_NORM_NAME.get(
      cleanProductName.toLowerCase().trim()
    );

    const rootLocId = resolveRootLoc(raw.location_id);
    const stInfo = stationInfoCache.get(rootLocId);
    let locationName: string;
    if (stInfo) {
      locationName =
        raw.location_flag && raw.location_flag !== 'Hangar'
          ? `${stInfo.name} (${raw.location_flag})`
          : stInfo.name;
    } else if (rootLocId >= 1_000_000_000_000) {
      locationName =
        source === 'corporation'
          ? `Upwell Structure / Corp Hangar (${raw.location_flag || rootLocId})`
          : `Upwell Structure / Container (${raw.location_flag || rootLocId})`;
    } else {
      locationName =
        source === 'corporation'
          ? `Corp Hangar ${raw.location_flag || raw.location_id}`
          : `Location ${rootLocId}`;
    }

    return {
      itemId: raw.item_id,
      typeId: raw.type_id,
      blueprintName,
      productTypeId: matchedProductTypeId,
      productName: cleanProductName,
      isBpo: raw.runs === -1,
      me: raw.material_efficiency,
      te: raw.time_efficiency,
      runs: raw.runs,
      quantity: raw.quantity,
      locationId: raw.location_id,
      locationFlag: raw.location_flag,
      locationName,
      source,
    };
  });

  // Sort: BPOs first, then highest ME, then alphabetical by real EVE Online name
  entries.sort((a, b) => {
    if (a.isBpo !== b.isBpo) return a.isBpo ? -1 : 1;
    if (b.me !== a.me) return b.me - a.me;
    return (a.blueprintName || a.productName).localeCompare(b.blueprintName || b.productName);
  });

  return entries;
}

app.post('/api/eve/sync-character', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : String((req.body as { accessToken?: string }).accessToken || '');
    const { characterId, characterName, includeCorpBlueprints } = req.body as {
      characterId?: number;
      characterName?: string;
      includeCorpBlueprints?: boolean;
    };

    if (!accessToken || !characterId) {
      res.status(400).json({ error: 'Missing EVE SSO access token or character ID.' });
      return;
    }

    const esiHeaders = { Authorization: `Bearer ${accessToken}` };
    const base = `https://esi.evetech.net/latest/characters/${characterId}`;

    const [
      charInfoRes,
      walletRes,
      ordersRes,
      locRes,
      shipRes,
      skillsRes,
      personalBpResult,
      assetsPage1Res,
      industryJobsRes,
    ] = await Promise.all([
      fetchWithTimeout(`${base}/?datasource=tranquility`),
      fetchWithTimeout(`${base}/wallet/?datasource=tranquility`, { headers: esiHeaders }),
      fetchWithTimeout(`${base}/orders/?datasource=tranquility`, { headers: esiHeaders }),
      fetchWithTimeout(`${base}/location/?datasource=tranquility`, { headers: esiHeaders }),
      fetchWithTimeout(`${base}/ship/?datasource=tranquility`, { headers: esiHeaders }),
      fetchWithTimeout(`${base}/skills/?datasource=tranquility`, { headers: esiHeaders }),
      fetchAllPaginatedBlueprints(`${base}/blueprints/`, esiHeaders),
      fetchWithTimeout(`${base}/assets/?datasource=tranquility&page=1`, { headers: esiHeaders }),
      fetchWithTimeout(`${base}/industry/jobs/?datasource=tranquility&include_completed=false`, {
        headers: esiHeaders,
      }),
    ]);

    let corporationId: number | undefined;
    if (charInfoRes.ok) {
      try {
        const charInfo = (await charInfoRes.json()) as { corporation_id?: number };
        if (typeof charInfo.corporation_id === 'number' && charInfo.corporation_id > 0) {
          corporationId = charInfo.corporation_id;
        }
      } catch {
        // ignore
      }
    }

    const walletBalance = walletRes.ok ? Number(await walletRes.json()) : 1_000_000_000;

    interface RawCharOrder {
      order_id: number;
      type_id: number;
      region_id: number;
      location_id: number;
      is_buy_order?: boolean;
      price: number;
      volume_remain: number;
      volume_total: number;
      issued: string;
    }

    let activeOrders: {
      orderId: number;
      typeId: number;
      regionId: number;
      locationId: number;
      isBuyOrder: boolean;
      price: number;
      volumeRemain: number;
      volumeTotal: number;
      issued: string;
    }[] = [];

    if (ordersRes.ok) {
      try {
        const rawOrders = (await ordersRes.json()) as RawCharOrder[];
        if (Array.isArray(rawOrders)) {
          activeOrders = rawOrders.map((o) => ({
            orderId: o.order_id,
            typeId: o.type_id,
            regionId: o.region_id,
            locationId: o.location_id,
            isBuyOrder: Boolean(o.is_buy_order),
            price: o.price,
            volumeRemain: o.volume_remain,
            volumeTotal: o.volume_total,
            issued: o.issued,
          }));
        }
      } catch {
        activeOrders = [];
      }
    }

    let currentSystemId: number = EVE_ANCHORS.ISHISOMO_SYSTEM_ID;
    let currentSystemName = 'Ishisomo';
    let currentStationId: number | undefined = EVE_ANCHORS.ISHISOMO_MFG_STATION_ID;
    let currentStationName: string = EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME;

    if (locRes.ok) {
      const loc = (await locRes.json()) as {
        solar_system_id?: number;
        station_id?: number;
        structure_id?: number;
      };
      if (loc.solar_system_id) {
        currentSystemId = loc.solar_system_id;
        const sysNames = await resolveUniverseNames([loc.solar_system_id]);
        currentSystemName = sysNames.get(loc.solar_system_id) || currentSystemName;
      }
      if (loc.station_id) {
        currentStationId = loc.station_id;
        const stInfo = await resolveStationInfo(loc.station_id);
        if (stInfo) currentStationName = stInfo.name;
      } else if (loc.structure_id) {
        currentStationId = loc.structure_id;
        currentStationName = `${currentSystemName} Upwell Structure (${loc.structure_id})`;
      } else {
        currentStationId = undefined;
        currentStationName = `${currentSystemName} (In Space)`;
      }
    }

    // Active Ship telemetry (/characters/{id}/ship/)
    let activeShip: { ship_item_id: number; ship_type_id: number; ship_name: string } | null = null;
    if (shipRes.ok) {
      try {
        activeShip = (await shipRes.json()) as {
          ship_item_id: number;
          ship_type_id: number;
          ship_name: string;
        };
      } catch {
        activeShip = null;
      }
    }

    // Parse real skill levels + hauling skill levels from ESI
    let totalSp = 187_000_000;
    const skills = {
      accounting: 5,
      brokerRelations: 5,
      procurement: 0,
      marketing: 0,
      reprocessing: 5,
      reprocessingEfficiency: 5,
      scrapmetalProcessing: 5,
      industry: 5,
      scienceEncryption: 5,
      massProduction: 5,
      advancedMassProduction: 4,
      laboratoryOperation: 5,
      advancedLaboratoryOperation: 4,
    };
    const haulingSkills: Record<number, number> = {};

    if (skillsRes.ok) {
      const skJson = (await skillsRes.json()) as {
        total_sp?: number;
        skills?: { skill_id: number; active_skill_level: number }[];
      };
      if (typeof skJson.total_sp === 'number') totalSp = skJson.total_sp;
      const skillMap = new Map<number, number>();
      for (const s of skJson.skills || []) {
        skillMap.set(s.skill_id, s.active_skill_level);
      }
      if (skillMap.has(16622)) skills.accounting = skillMap.get(16622)!;
      if (skillMap.has(3446)) skills.brokerRelations = skillMap.get(3446)!;
      skills.procurement = skillMap.get(16596) ?? 0;
      skills.marketing = skillMap.get(16598) ?? 0;
      if (skillMap.has(3385)) skills.reprocessing = skillMap.get(3385)!;
      if (skillMap.has(3389)) skills.reprocessingEfficiency = skillMap.get(3389)!;
      if (skillMap.has(12196)) skills.scrapmetalProcessing = skillMap.get(12196)!;
      if (skillMap.has(3380)) skills.industry = skillMap.get(3380)!;
      if (skillMap.has(3402)) skills.scienceEncryption = skillMap.get(3402)!;
      skills.massProduction = skillMap.get(3387) ?? 0;
      skills.advancedMassProduction = skillMap.get(24625) ?? 0;
      skills.laboratoryOperation = skillMap.get(3406) ?? 0;
      skills.advancedLaboratoryOperation = skillMap.get(24624) ?? 0;

      for (const hSkillId of ALL_HAULING_SKILL_ID_LIST) {
        haulingSkills[hSkillId] = skillMap.get(hSkillId) ?? 0;
      }
    }

    // Optional Corporation Hangar Blueprints scan (esi-corporations.read_blueprints.v1)
    let corpBpRaw: EsiBlueprintRaw[] = [];
    let corpPagesScanned = 0;
    let corpStatus: BlueprintSyncMeta['corpStatus'] = includeCorpBlueprints ? 'no_access' : 'disabled';
    let corpMessage: string | undefined;

    if (includeCorpBlueprints && corporationId) {
      const corpResult = await fetchAllPaginatedBlueprints(
        `https://esi.evetech.net/latest/corporations/${corporationId}/blueprints/`,
        esiHeaders
      );
      if (corpResult.status === 200) {
        corpBpRaw = corpResult.rows;
        corpPagesScanned = corpResult.pagesScanned;
        corpStatus = 'loaded';
      } else if (corpResult.status === 403) {
        corpStatus = 'no_access';
        corpMessage =
          'Corporation blueprint access denied (requires Director/Factory Manager role & esi-corporations.read_blueprints.v1 scope).';
      } else {
        corpStatus = 'error';
        corpMessage = `Corporation blueprints endpoint returned HTTP ${corpResult.status}.`;
      }
    }

    // Paginate /characters/{id}/assets/ (up to 10 pages) and scan fitted hauler hulls
    const allAssets: EsiAssetRaw[] = [];
    if (assetsPage1Res.ok) {
      const page1 = (await assetsPage1Res.json()) as EsiAssetRaw[];
      if (Array.isArray(page1)) allAssets.push(...page1);

      const xPages = Math.min(10, Math.max(1, Number(assetsPage1Res.headers.get('x-pages') || 1)));
      if (xPages > 1) {
        const extraPages = await Promise.all(
          Array.from({ length: xPages - 1 }, (_, i) => i + 2).map(async (pageNum) => {
            try {
              const r = await fetchWithTimeout(
                `${base}/assets/?datasource=tranquility&page=${pageNum}`,
                { headers: esiHeaders },
                8000
              );
              if (!r.ok) return [] as EsiAssetRaw[];
              const rows = (await r.json()) as EsiAssetRaw[];
              return Array.isArray(rows) ? rows : [];
            } catch {
              return [] as EsiAssetRaw[];
            }
          })
        );
        for (const p of extraPages) allAssets.push(...p);
      }
    }

    // Build map of fitted modules/rigs keyed by ship item_id
    const fittedByShipItemId = new Map<number, number[]>();
    const haulerAssets: EsiAssetRaw[] = [];
    const assetById = new Map<number, EsiAssetRaw>();

    for (const a of allAssets) {
      assetById.set(a.item_id, a);
    }

    for (const a of allAssets) {
      if (HAULER_HULL_CATALOG[a.type_id]) {
        haulerAssets.push(a);
      }
      const flag = a.location_flag || '';
      if (/^(LoSlot|MedSlot|HiSlot|RigSlot)\d+$/i.test(flag)) {
        const list = fittedByShipItemId.get(a.location_id) ?? [];
        list.push(a.type_id);
        fittedByShipItemId.set(a.location_id, list);
      }
    }

    // Ensure active ship is included if it is a hauler hull not yet listed
    if (
      activeShip &&
      HAULER_HULL_CATALOG[activeShip.ship_type_id] &&
      !haulerAssets.some((a) => a.item_id === activeShip!.ship_item_id)
    ) {
      haulerAssets.unshift({
        item_id: activeShip.ship_item_id,
        type_id: activeShip.ship_type_id,
        location_id: currentStationId ?? currentSystemId,
        location_flag: 'Hangar',
        is_singleton: true,
      });
    }

    // Resolve custom ship names via POST /characters/{id}/assets/names/
    const shipNameMap = new Map<number, string>();
    if (activeShip?.ship_item_id && activeShip?.ship_name) {
      shipNameMap.set(activeShip.ship_item_id, activeShip.ship_name);
    }
    const singletonShipIds = haulerAssets
      .filter((a) => a.is_singleton !== false && a.item_id > 0)
      .map((a) => a.item_id);

    if (singletonShipIds.length > 0) {
      for (let i = 0; i < singletonShipIds.length; i += 500) {
        const chunk = singletonShipIds.slice(i, i + 500);
        try {
          const nameRes = await fetchWithTimeout(
            `${base}/assets/names/?datasource=tranquility`,
            {
              method: 'POST',
              headers: {
                ...esiHeaders,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(chunk),
            },
            7000
          );
          if (nameRes.ok) {
            const entries = (await nameRes.json()) as { item_id: number; name: string }[];
            for (const entry of entries) {
              if (entry?.item_id && entry?.name && entry.name !== 'None') {
                shipNameMap.set(entry.item_id, entry.name);
              }
            }
          }
        } catch {
          // Graceful fallback to hull type name
        }
      }
    }

    // Walk container parent chain to find root station/system location for each ship
    const resolveRootLocationId = (asset: EsiAssetRaw): number => {
      let loc = asset.location_id;
      let hops = 0;
      while (hops++ < 5 && assetById.has(loc)) {
        loc = assetById.get(loc)!.location_id;
      }
      return loc;
    };

    // Resolve docked stations & systems in parallel (capped at 25 unique locations)
    const uniqueStationIds = Array.from(
      new Set(haulerAssets.map(resolveRootLocationId))
    ).slice(0, 25);

    await Promise.all(uniqueStationIds.map((locId) => resolveStationInfo(locId)));

    const detectedHulls: HangarHull[] = [];
    for (const shipAsset of haulerAssets.slice(0, 40)) {
      const rootLocId = resolveRootLocationId(shipAsset);
      const isActive = Boolean(activeShip && shipAsset.item_id === activeShip.ship_item_id);
      const stInfo = stationInfoCache.get(rootLocId);

      const stationId = isActive
        ? currentStationId
        : rootLocId >= 60_000_000
          ? rootLocId
          : undefined;
      const systemId = isActive
        ? currentSystemId
        : stInfo?.systemId ?? (rootLocId >= 30_000_000 && rootLocId < 40_000_000 ? rootLocId : currentSystemId);
      const systemName = isActive
        ? currentSystemName
        : stInfo?.systemName ?? (systemId === currentSystemId ? currentSystemName : `System ${systemId}`);
      const locationLabel = isActive
        ? currentStationName
        : stInfo?.name ?? `Location ${rootLocId}`;

      const fittedTypeIds = fittedByShipItemId.get(shipAsset.item_id) ?? [];
      const customName = shipNameMap.get(shipAsset.item_id);

      const fittedHull = calculateFittedHull({
        id: `esi-hull-${shipAsset.item_id}`,
        itemId: shipAsset.item_id,
        typeId: shipAsset.type_id,
        customName,
        location: locationLabel,
        stationId,
        systemId,
        systemName,
        isActiveShip: isActive,
        fittedTypeIds,
        haulingSkills,
      });

      if (fittedHull) {
        detectedHulls.push(fittedHull);
      }
    }

    // Sort active ship first, then by capacity descending
    detectedHulls.sort((a, b) => {
      if (a.isActiveShip && !b.isActiveShip) return -1;
      if (!a.isActiveShip && b.isActiveShip) return 1;
      return b.capacityM3 - a.capacityM3;
    });

    // Aggregate Jita & Ishisomo hangar item stock from allAssets for Multibuy Hangar Stock Deductor
    const hangarStock: Record<number, HangarStockEntry> = {};
    const jitaStations = new Set<number>([EVE_ANCHORS.JITA_STATION_ID, EVE_ANCHORS.JITA_SYSTEM_ID]);
    const ishisomoStations = new Set<number>([
      EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
      EVE_ANCHORS.ISHISOMO_RES_STATION_ID,
      EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
    ]);
    for (const a of allAssets) {
      const flag = a.location_flag || '';
      if (/^(LoSlot|MedSlot|HiSlot|RigSlot|SubSystemSlot)\d*$/i.test(flag)) continue;
      if (HAULER_HULL_CATALOG[a.type_id]) continue;
      const qty = typeof a.quantity === 'number' && a.quantity > 0 ? a.quantity : 1;
      const rootLocId = resolveRootLocationId(a);
      const isJita = jitaStations.has(rootLocId);
      const isIshisomo = ishisomoStations.has(rootLocId);
      if (!isJita && !isIshisomo) continue;
      const entry = hangarStock[a.type_id] ?? {
        typeId: a.type_id,
        jita: 0,
        ishisomo: 0,
        total: 0,
      };
      if (isJita) entry.jita += qty;
      if (isIshisomo) entry.ishisomo += qty;
      entry.total = entry.jita + entry.ishisomo;
      hangarStock[a.type_id] = entry;
    }

    // Hydrate Active Character Industry Jobs (/characters/{id}/industry/jobs/)
    const activityLabels: Record<number, CharacterIndustryJob['activityLabel']> = {
      1: 'Manufacturing',
      3: 'TE Research',
      4: 'ME Research',
      5: 'Copying',
      8: 'Invention',
      9: 'Reaction',
    };
    let industryJobs: CharacterIndustryJob[] = [];
    if (industryJobsRes.ok) {
      try {
        const rawJobs = (await industryJobsRes.json()) as {
          job_id: number;
          activity_id: number;
          blueprint_type_id: number;
          product_type_id?: number;
          runs: number;
          status: string;
          start_date: string;
          end_date: string;
          duration: number;
          cost?: number;
          facility_id: number;
          station_id: number;
        }[];
        if (Array.isArray(rawJobs) && rawJobs.length > 0) {
          const jobTypeIds = new Set<number>();
          for (const j of rawJobs) {
            if (j.blueprint_type_id > 0) jobTypeIds.add(j.blueprint_type_id);
            if (j.product_type_id && j.product_type_id > 0) jobTypeIds.add(j.product_type_id);
            if (j.station_id > 0 && j.station_id < 1_000_000_000) jobTypeIds.add(j.station_id);
          }
          const jobNames = await resolveUniverseNames(Array.from(jobTypeIds));
          industryJobs = rawJobs
            .map((j): CharacterIndustryJob => {
              const bpName =
                jobNames.get(j.blueprint_type_id) ||
                ITEM_BY_ID[j.blueprint_type_id]?.name ||
                `Blueprint #${j.blueprint_type_id}`;
              const productName = j.product_type_id
                ? jobNames.get(j.product_type_id) ||
                  ITEM_BY_ID[j.product_type_id]?.name ||
                  `Type #${j.product_type_id}`
                : bpName.replace(/\s+Blueprint$/i, '');
              const facilityName =
                orderBookStationCache.get(j.station_id) ||
                jobNames.get(j.station_id) ||
                (j.facility_id >= 1_000_000_000
                  ? `Upwell Structure #${j.facility_id}`
                  : `Station #${j.station_id}`);
              const statusClean: CharacterIndustryJob['status'] =
                j.status === 'active' ||
                j.status === 'paused' ||
                j.status === 'ready' ||
                j.status === 'delivered' ||
                j.status === 'cancelled'
                  ? j.status
                  : 'active';
              return {
                jobId: j.job_id,
                activityId: j.activity_id,
                activityLabel: activityLabels[j.activity_id] ?? 'Other',
                blueprintTypeId: j.blueprint_type_id,
                blueprintName: bpName,
                productTypeId: j.product_type_id,
                productName,
                runs: j.runs,
                status: statusClean,
                startDate: j.start_date,
                endDate: j.end_date,
                durationSeconds: j.duration,
                costIsk: j.cost,
                facilityId: j.facility_id,
                facilityName,
              };
            })
            .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));
        }
      } catch {
        industryJobs = [];
      }
    }

    // Hydrate 100% of personal (+ optional corp) blueprints with real EVE names via POST /universe/names/
    const blueprints = await hydrateEsiBlueprints({
      personalRaw: personalBpResult.rows,
      corpRaw: corpBpRaw,
      assetById,
    });

    const blueprintSyncMeta: BlueprintSyncMeta = {
      personalCount: personalBpResult.rows.length,
      corpCount: corpBpRaw.length,
      pagesScanned: personalBpResult.pagesScanned,
      corpPagesScanned,
      corpStatus,
      corpMessage,
      syncedAt: new Date().toISOString(),
    };

    res.json({
      characterId,
      corporationId,
      characterName: characterName || 'EVE Capsuleer',
      totalSp,
      walletBalance,
      currentSystemId,
      currentSystemName,
      currentStationId,
      currentStationName,
      skills,
      haulingSkills,
      blueprints,
      blueprintSyncMeta,
      hulls: detectedHulls,
      activeOrders,
      activeOrdersSyncedAt: new Date().toISOString(),
      industryJobs,
      industryJobsSyncedAt: new Date().toISOString(),
      hangarStock,
    });
  } catch (err) {
    console.error('ESI character sync error:', err);
    res.status(500).json({ error: 'Failed to synchronize character telemetry from EVE ESI.' });
  }
});

// --- Route 2a-0: On-Demand Live Wallet Balance & Active Character Market Orders Refresh ---

app.post('/api/eve/wallet-orders', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const { characterId } = req.body as { characterId?: number };

    if (!accessToken || !characterId) {
      res.status(401).json({
        error: 'Connect EVE SSO to refresh live wallet balance and active market orders.',
      });
      return;
    }

    const esiHeaders = { Authorization: `Bearer ${accessToken}` };
    const base = `https://esi.evetech.net/latest/characters/${characterId}`;

    const [walletRes, ordersRes] = await Promise.all([
      fetchWithTimeout(`${base}/wallet/?datasource=tranquility`, { headers: esiHeaders }, 7000),
      fetchWithTimeout(`${base}/orders/?datasource=tranquility`, { headers: esiHeaders }, 7000),
    ]);

    let walletBalance: number | undefined;
    if (walletRes.ok) {
      walletBalance = Number(await walletRes.json());
    }

    let activeOrders: {
      orderId: number;
      typeId: number;
      regionId: number;
      locationId: number;
      isBuyOrder: boolean;
      price: number;
      volumeRemain: number;
      volumeTotal: number;
      issued: string;
    }[] = [];

    if (ordersRes.ok) {
      const rawOrders = (await ordersRes.json()) as {
        order_id: number;
        type_id: number;
        region_id: number;
        location_id: number;
        is_buy_order?: boolean;
        price: number;
        volume_remain: number;
        volume_total: number;
        issued: string;
      }[];
      if (Array.isArray(rawOrders)) {
        activeOrders = rawOrders.map((o) => ({
          orderId: o.order_id,
          typeId: o.type_id,
          regionId: o.region_id,
          locationId: o.location_id,
          isBuyOrder: Boolean(o.is_buy_order),
          price: o.price,
          volumeRemain: o.volume_remain,
          volumeTotal: o.volume_total,
          issued: o.issued,
        }));
      }
    }

    res.json({
      walletBalance,
      activeOrders,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('ESI wallet/orders refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh wallet balance and active orders from ESI.' });
  }
});

// --- Route 2a-0b: On-Demand Active Industry Jobs Refresh (esi-industry.read_character_jobs.v1) ---

app.post('/api/eve/industry-jobs', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const { characterId } = req.body as { characterId?: number };

    if (!accessToken || !characterId) {
      res.status(401).json({
        error: 'Connect EVE SSO (with esi-industry.read_character_jobs.v1) to refresh active industry jobs.',
      });
      return;
    }

    const esiHeaders = { Authorization: `Bearer ${accessToken}` };
    const jobsRes = await fetchWithTimeout(
      `https://esi.evetech.net/latest/characters/${characterId}/industry/jobs/?datasource=tranquility&include_completed=false`,
      { headers: esiHeaders },
      9000
    );

    if (jobsRes.status === 401 || jobsRes.status === 403) {
      res.status(jobsRes.status).json({
        error: 'EVE SSO token lacks esi-industry.read_character_jobs.v1 scope. Reconnect EVE SSO to authorize.',
      });
      return;
    }
    if (!jobsRes.ok) {
      res.status(502).json({ error: `EVE ESI industry jobs returned HTTP ${jobsRes.status}.` });
      return;
    }

    const rawJobs = (await jobsRes.json()) as {
      job_id: number;
      activity_id: number;
      blueprint_type_id: number;
      product_type_id?: number;
      runs: number;
      status: string;
      start_date: string;
      end_date: string;
      duration: number;
      cost?: number;
      facility_id: number;
      station_id: number;
    }[];

    const activityLabels: Record<number, CharacterIndustryJob['activityLabel']> = {
      1: 'Manufacturing',
      3: 'TE Research',
      4: 'ME Research',
      5: 'Copying',
      8: 'Invention',
      9: 'Reaction',
    };

    const idsToResolve = new Set<number>();
    for (const j of Array.isArray(rawJobs) ? rawJobs : []) {
      if (j.blueprint_type_id > 0) idsToResolve.add(j.blueprint_type_id);
      if (j.product_type_id && j.product_type_id > 0) idsToResolve.add(j.product_type_id);
      if (j.station_id > 0 && j.station_id < 1_000_000_000) idsToResolve.add(j.station_id);
    }
    const resolved = await resolveUniverseNames(Array.from(idsToResolve));

    const jobs: CharacterIndustryJob[] = (Array.isArray(rawJobs) ? rawJobs : [])
      .map((j): CharacterIndustryJob => {
        const bpName =
          resolved.get(j.blueprint_type_id) ||
          ITEM_BY_ID[j.blueprint_type_id]?.name ||
          `Blueprint #${j.blueprint_type_id}`;
        const productName = j.product_type_id
          ? resolved.get(j.product_type_id) ||
            ITEM_BY_ID[j.product_type_id]?.name ||
            `Type #${j.product_type_id}`
          : bpName.replace(/\s+Blueprint$/i, '');
        const facilityName =
          orderBookStationCache.get(j.station_id) ||
          resolved.get(j.station_id) ||
          (j.facility_id >= 1_000_000_000
            ? `Upwell Structure #${j.facility_id}`
            : `Station #${j.station_id}`);
        const statusClean: CharacterIndustryJob['status'] =
          j.status === 'active' ||
          j.status === 'paused' ||
          j.status === 'ready' ||
          j.status === 'delivered' ||
          j.status === 'cancelled'
            ? j.status
            : 'active';
        return {
          jobId: j.job_id,
          activityId: j.activity_id,
          activityLabel: activityLabels[j.activity_id] ?? 'Other',
          blueprintTypeId: j.blueprint_type_id,
          blueprintName: bpName,
          productTypeId: j.product_type_id,
          productName,
          runs: j.runs,
          status: statusClean,
          startDate: j.start_date,
          endDate: j.end_date,
          durationSeconds: j.duration,
          costIsk: j.cost,
          facilityId: j.facility_id,
          facilityName,
        };
      })
      .sort((a, b) => Date.parse(a.endDate) - Date.parse(b.endDate));

    res.json({
      jobs,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('ESI industry jobs refresh error:', err);
    res.status(500).json({ error: 'Failed to refresh active industry jobs from ESI.' });
  }
});

// --- Route 2a-0c: Undercut & Fill Monitor (Active Orders vs Live Order Books + Wallet Transactions Profit) ---

function computeServerEveTick(price: number): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const digits = Math.floor(Math.log10(price)) + 1;
  if (digits <= 4) return 0.01;
  return Math.pow(10, digits - 4);
}

app.post('/api/eve/order-monitor', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const { characterId } = req.body as { characterId?: number };

    if (!accessToken || !characterId) {
      res.status(401).json({
        error: 'Connect EVE SSO to monitor live undercut orders and realized wallet fills.',
      });
      return;
    }

    const esiHeaders = { Authorization: `Bearer ${accessToken}` };
    const base = `https://esi.evetech.net/latest/characters/${characterId}`;

    const [ordersRes, txRes] = await Promise.all([
      fetchWithTimeout(`${base}/orders/?datasource=tranquility`, { headers: esiHeaders }, 9000),
      fetchWithTimeout(`${base}/wallet/transactions/?datasource=tranquility`, { headers: esiHeaders }, 9000),
    ]);

    const rawOrders: {
      order_id: number;
      type_id: number;
      region_id: number;
      location_id: number;
      is_buy_order?: boolean;
      price: number;
      volume_remain: number;
      volume_total: number;
      issued: string;
    }[] = ordersRes.ok ? ((await ordersRes.json()) as never[]) : [];

    const rawTx: {
      transaction_id: number;
      date: string;
      type_id: number;
      quantity: number;
      unit_price: number;
      is_buy: boolean;
      location_id: number;
    }[] = txRes.ok ? ((await txRes.json()) as never[]) : [];

    const idsToResolve = new Set<number>();
    for (const o of Array.isArray(rawOrders) ? rawOrders : []) {
      idsToResolve.add(o.type_id);
      if (o.location_id > 0 && o.location_id < 1_000_000_000) idsToResolve.add(o.location_id);
    }
    for (const t of (Array.isArray(rawTx) ? rawTx : []).slice(0, 120)) {
      idsToResolve.add(t.type_id);
    }
    const nameMap = await resolveUniverseNames(Array.from(idsToResolve));

    // Fetch live regional order books for up to 35 unique (region, type, side) combinations
    const ordersList = (Array.isArray(rawOrders) ? rawOrders : []).slice(0, 60);
    const uniqueBookKeys = new Map<string, { regionId: number; typeId: number; side: 'sell' | 'buy' }>();
    for (const o of ordersList) {
      const side: 'sell' | 'buy' = o.is_buy_order ? 'buy' : 'sell';
      const key = `${o.region_id}:${o.type_id}:${side}`;
      if (!uniqueBookKeys.has(key) && uniqueBookKeys.size < 35) {
        uniqueBookKeys.set(key, { regionId: o.region_id, typeId: o.type_id, side });
      }
    }

    const bookResults = new Map<string, EsiMarketOrderRaw[]>();
    const bookEntries = Array.from(uniqueBookKeys.entries());
    for (let i = 0; i < bookEntries.length; i += 6) {
      const batch = bookEntries.slice(i, i + 6);
      await Promise.all(
        batch.map(async ([key, reqBook]) => {
          const rows = await fetchTopRegionalOrders(reqBook.regionId, reqBook.typeId, reqBook.side);
          bookResults.set(key, rows);
        })
      );
    }

    const orders: OrderMonitorEntry[] = ordersList.map((o) => {
      const isBuy = Boolean(o.is_buy_order);
      const side: 'sell' | 'buy' = isBuy ? 'buy' : 'sell';
      const bookKey = `${o.region_id}:${o.type_id}:${side}`;
      const book = bookResults.get(bookKey) ?? [];
      const sameStationCompetitors = book.filter(
        (b) => b.order_id !== o.order_id && b.location_id === o.location_id
      );
      const pool = sameStationCompetitors.length > 0 ? sameStationCompetitors : book.filter((b) => b.order_id !== o.order_id);

      let marketBestPrice = o.price;
      let competitorsAhead = 0;
      let isUndercut = false;
      let suggestedReclaimPrice = o.price;

      if (pool.length > 0) {
        if (isBuy) {
          marketBestPrice = Math.max(...pool.map((b) => b.price));
          competitorsAhead = pool.filter((b) => b.price > o.price).length;
          if (marketBestPrice > o.price) {
            isUndercut = true;
            suggestedReclaimPrice = Number(
              (marketBestPrice + computeServerEveTick(marketBestPrice)).toFixed(2)
            );
          }
        } else {
          marketBestPrice = Math.min(...pool.map((b) => b.price));
          competitorsAhead = pool.filter((b) => b.price < o.price).length;
          if (marketBestPrice < o.price) {
            isUndercut = true;
            suggestedReclaimPrice = Math.max(
              0.01,
              Number((marketBestPrice - computeServerEveTick(marketBestPrice)).toFixed(2))
            );
          }
        }
      }

      const deltaIsk = isUndercut
        ? Number((suggestedReclaimPrice - o.price).toFixed(2))
        : 0;
      const stationName =
        orderBookStationCache.get(o.location_id) ||
        nameMap.get(o.location_id) ||
        (o.location_id >= 1_000_000_000 ? `Upwell Structure #${o.location_id}` : `Station #${o.location_id}`);

      return {
        orderId: o.order_id,
        typeId: o.type_id,
        itemName: nameMap.get(o.type_id) || ITEM_BY_ID[o.type_id]?.name || `Type #${o.type_id}`,
        regionId: o.region_id,
        regionName: REGION_LABEL_MAP[o.region_id] || `Region ${o.region_id}`,
        locationId: o.location_id,
        stationName,
        isBuyOrder: isBuy,
        myPrice: o.price,
        marketBestPrice,
        isUndercut,
        suggestedReclaimPrice,
        deltaIsk,
        competitorsAhead,
        volumeRemain: o.volume_remain,
        volumeTotal: o.volume_total,
        issued: o.issued,
      };
    });

    orders.sort((a, b) => {
      if (a.isUndercut !== b.isUndercut) return a.isUndercut ? -1 : 1;
      return b.myPrice * b.volumeRemain - a.myPrice * a.volumeRemain;
    });

    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const txList = (Array.isArray(rawTx) ? rawTx : []).slice(0, 120);

    const avgBuyCostByType = new Map<number, { cost: number; qty: number }>();
    for (const t of txList) {
      if (!t.is_buy) continue;
      const cur = avgBuyCostByType.get(t.type_id) ?? { cost: 0, qty: 0 };
      cur.cost += t.unit_price * t.quantity;
      cur.qty += t.quantity;
      avgBuyCostByType.set(t.type_id, cur);
    }

    let realizedRevenue24hIsk = 0;
    let realizedSpend24hIsk = 0;
    let realizedProfit24hIsk = 0;
    let realizedProfit7dIsk = 0;

    const recentTransactions: WalletTransactionEntry[] = txList.slice(0, 50).map((t) => {
      const totalIsk = t.unit_price * t.quantity;
      const ageMs = nowMs - Date.parse(t.date);
      const buyBasis = avgBuyCostByType.get(t.type_id);
      const unitBasis =
        buyBasis && buyBasis.qty > 0
          ? buyBasis.cost / buyBasis.qty
          : ITEM_BY_ID[t.type_id]?.baseJitaSell ?? t.unit_price * 0.85;

      if (ageMs <= dayMs) {
        if (t.is_buy) realizedSpend24hIsk += totalIsk;
        else {
          realizedRevenue24hIsk += totalIsk;
          realizedProfit24hIsk += (t.unit_price * 0.95 - unitBasis) * t.quantity;
        }
      }
      if (ageMs <= 7 * dayMs && !t.is_buy) {
        realizedProfit7dIsk += (t.unit_price * 0.95 - unitBasis) * t.quantity;
      }

      return {
        transactionId: t.transaction_id,
        date: t.date,
        typeId: t.type_id,
        itemName: nameMap.get(t.type_id) || ITEM_BY_ID[t.type_id]?.name || `Type #${t.type_id}`,
        quantity: t.quantity,
        unitPrice: t.unit_price,
        totalIsk,
        isBuy: t.is_buy,
        locationId: t.location_id,
      };
    });

    const payload: OrderMonitorSnapshot = {
      orders,
      undercutCount: orders.filter((o) => o.isUndercut).length,
      recentTransactions,
      realizedRevenue24hIsk,
      realizedSpend24hIsk,
      realizedProfit24hIsk,
      realizedProfit7dIsk,
      syncedAt: new Date().toISOString(),
    };

    res.json(payload);
  } catch (err) {
    console.error('ESI order monitor error:', err);
    res.status(500).json({ error: 'Failed to scan active orders and wallet fills from ESI.' });
  }
});

// --- Route 2a: On-Demand Full Blueprint Scanner (X-Pages Personal + Optional Corp Hangars) ---

app.post('/api/eve/blueprints', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const { characterId, corporationId: reqCorpId, includeCorpBlueprints } = req.body as {
      characterId?: number;
      corporationId?: number;
      includeCorpBlueprints?: boolean;
    };

    if (!accessToken || !characterId) {
      res.status(401).json({
        error: 'Connect EVE SSO to scan 100% of your personal and corporation blueprints from ESI.',
      });
      return;
    }

    const esiHeaders = { Authorization: `Bearer ${accessToken}` };
    const base = `https://esi.evetech.net/latest/characters/${characterId}`;

    // Resolve corporationId if caller did not pass it yet
    let corporationId = reqCorpId;
    if (includeCorpBlueprints && !corporationId) {
      try {
        const charInfoRes = await fetchWithTimeout(`${base}/?datasource=tranquility`);
        if (charInfoRes.ok) {
          const charInfo = (await charInfoRes.json()) as { corporation_id?: number };
          if (typeof charInfo.corporation_id === 'number' && charInfo.corporation_id > 0) {
            corporationId = charInfo.corporation_id;
          }
        }
      } catch {
        // ignore
      }
    }

    const personalResult = await fetchAllPaginatedBlueprints(`${base}/blueprints/`, esiHeaders);
    if (personalResult.status !== 200) {
      res.status(personalResult.status || 502).json({
        error:
          personalResult.status === 403
            ? 'Missing esi-characters.read_blueprints.v1 permission. Re-connect EVE SSO in Settings.'
            : `EVE ESI personal blueprints returned HTTP ${personalResult.status}.`,
      });
      return;
    }

    let corpRaw: EsiBlueprintRaw[] = [];
    let corpPagesScanned = 0;
    let corpStatus: BlueprintSyncMeta['corpStatus'] = includeCorpBlueprints ? 'no_access' : 'disabled';
    let corpMessage: string | undefined;

    if (includeCorpBlueprints && corporationId) {
      const corpResult = await fetchAllPaginatedBlueprints(
        `https://esi.evetech.net/latest/corporations/${corporationId}/blueprints/`,
        esiHeaders
      );
      if (corpResult.status === 200) {
        corpRaw = corpResult.rows;
        corpPagesScanned = corpResult.pagesScanned;
        corpStatus = 'loaded';
      } else if (corpResult.status === 403) {
        corpStatus = 'no_access';
        corpMessage =
          'Corporation blueprint access denied (requires Director/Factory Manager role and esi-corporations.read_blueprints.v1 scope — reconnect EVE SSO if you recently enabled it).';
      } else {
        corpStatus = 'error';
        corpMessage = `EVE ESI corporation blueprints returned HTTP ${corpResult.status}.`;
      }
    }

    const blueprints = await hydrateEsiBlueprints({
      personalRaw: personalResult.rows,
      corpRaw,
    });

    const blueprintSyncMeta: BlueprintSyncMeta = {
      personalCount: personalResult.rows.length,
      corpCount: corpRaw.length,
      pagesScanned: personalResult.pagesScanned,
      corpPagesScanned,
      corpStatus,
      corpMessage,
      syncedAt: new Date().toISOString(),
    };

    res.json({
      corporationId,
      blueprints,
      blueprintSyncMeta,
    });
  } catch (err) {
    console.error('ESI full blueprint scan error:', err);
    res.status(500).json({ error: 'Failed to scan EVE ESI blueprint library.' });
  }
});

// --- Route 2b: EVE Online In-Game Autopilot Waypoint Proxy (esi-ui.write_waypoint.v1) ---

app.post('/api/eve/autopilot/waypoint', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : '';

    if (!accessToken) {
      res.status(401).json({
        error: 'Connect EVE SSO (with esi-ui.write_waypoint.v1 scope) to push waypoints to your EVE Online client.',
      });
      return;
    }

    const { destinationId, clearOtherWaypoints, addToBeginning, waypoints } = req.body as {
      destinationId?: number;
      clearOtherWaypoints?: boolean;
      addToBeginning?: boolean;
      waypoints?: number[];
    };

    // Mode A: Batch "Push Full Loop to EVE Autopilot"
    if (Array.isArray(waypoints) && waypoints.length > 0) {
      const cleanIds = waypoints
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0);
      if (cleanIds.length === 0) {
        res.status(400).json({ error: 'No valid station or system IDs provided for autopilot push.' });
        return;
      }

      let pushed = 0;
      for (let i = 0; i < cleanIds.length; i++) {
        const destId = cleanIds[i];
        const clear = i === 0;
        const url = `https://esi.evetech.net/latest/ui/autopilot/waypoint/?datasource=tranquility&destination_id=${destId}&clear_other_waypoints=${clear}&add_to_beginning=false`;
        const esiRes = await fetchWithTimeout(
          url,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
          7000
        );

        if (!esiRes.ok) {
          const errText = await esiRes.text().catch(() => '');
          res.status(esiRes.status).json({
            error:
              esiRes.status === 403
                ? 'Missing esi-ui.write_waypoint.v1 permission. Re-connect EVE SSO in Settings to authorize Autopilot.'
                : `EVE ESI Autopilot returned HTTP ${esiRes.status}: ${errText || 'Failed to push waypoint.'}`,
            pushed,
          });
          return;
        }
        pushed += 1;
        if (i < cleanIds.length - 1) {
          await new Promise((r) => setTimeout(r, 120));
        }
      }

      res.json({ ok: true, pushed });
      return;
    }

    // Mode B: Single "Set Destination"
    const dest = Number(destinationId);
    if (!Number.isInteger(dest) || dest <= 0) {
      res.status(400).json({ error: 'Valid destinationId (station or solar system ID) is required.' });
      return;
    }

    const clear = clearOtherWaypoints !== false;
    const addBeg = Boolean(addToBeginning);
    const url = `https://esi.evetech.net/latest/ui/autopilot/waypoint/?datasource=tranquility&destination_id=${dest}&clear_other_waypoints=${clear}&add_to_beginning=${addBeg}`;
    const esiRes = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      7000
    );

    if (!esiRes.ok) {
      const errText = await esiRes.text().catch(() => '');
      res.status(esiRes.status).json({
        error:
          esiRes.status === 403
            ? 'Missing esi-ui.write_waypoint.v1 permission. Re-connect EVE SSO in Settings to authorize Autopilot.'
            : `EVE ESI Autopilot returned HTTP ${esiRes.status}: ${errText || 'Unable to set destination.'}`,
      });
      return;
    }

    res.json({ ok: true, destinationId: dest });
  } catch (err) {
    console.error('ESI autopilot waypoint error:', err);
    res.status(500).json({ error: 'Failed to contact EVE Online ESI Autopilot endpoint.' });
  }
});

// --- Route 2c: EVE Online In-Game Market Details Window Proxy (esi-ui.open_window.v1) ---

app.post('/api/eve/ui/open-market', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';

    if (!accessToken) {
      res.status(401).json({
        error:
          'Connect EVE SSO (with esi-ui.open_window.v1 scope) to open market details directly in your EVE Online client.',
      });
      return;
    }

    const { typeId: rawTypeId, itemName } = req.body as {
      typeId?: number;
      itemName?: string;
    };

    let typeId = Number(rawTypeId);

    // Fallback: resolve type_id by exact EVE item name via ESI /universe/ids/ if needed
    if ((!Number.isInteger(typeId) || typeId <= 0) && itemName && itemName.trim()) {
      try {
        const idRes = await fetchWithTimeout(
          'https://esi.evetech.net/latest/universe/ids/?datasource=tranquility',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([itemName.trim()]),
          },
          6000
        );
        if (idRes.ok) {
          const parsed = (await idRes.json()) as {
            inventory_types?: { id: number; name: string }[];
          };
          const match = parsed.inventory_types?.[0];
          if (match?.id) typeId = match.id;
        }
      } catch {
        // Ignore lookup error and validate below
      }
    }

    if (!Number.isInteger(typeId) || typeId <= 0) {
      res.status(400).json({ error: 'Valid EVE item type_id is required to open Market Details.' });
      return;
    }

    const url = `https://esi.evetech.net/latest/ui/openwindow/marketdetails/?datasource=tranquility&type_id=${typeId}`;
    const esiRes = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
      7000
    );

    if (!esiRes.ok) {
      const errText = await esiRes.text().catch(() => '');
      res.status(esiRes.status).json({
        error:
          esiRes.status === 403
            ? 'Missing esi-ui.open_window.v1 permission. Re-connect EVE SSO in Settings to authorize in-game Market windows.'
            : `EVE ESI Open Market Window returned HTTP ${esiRes.status}: ${errText || 'Unable to open market details.'}`,
      });
      return;
    }

    res.json({ ok: true, typeId });
  } catch (err) {
    console.error('ESI open marketdetails error:', err);
    res.status(500).json({ error: 'Failed to contact EVE Online ESI Open Window endpoint.' });
  }
});

// --- Route 3: Gemini AI Strategic Advisor (Server-Side @google/genai + Function Calling) ---

const ADVISOR_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_market_quote',
    description:
      'Retrieve live Jita 4-4 and Dodixie IX-20 sell/buy prices, spread, daily volume, and 1-jump outside Jita discount check for specific EVE Online items or a checked market category.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        itemQuery: {
          type: Type.STRING,
          description: 'Partial item name (e.g., "Hammerhead II", "Veldspar", "Coolant", "Scourge Fury") or empty to summarize top active tracked items.',
        },
        category: {
          type: Type.STRING,
          description: 'Optional category ID (t1_ammo, t2_ammo, bombs, probes, scripts, fuel_blocks, t1_rigs, t2_rigs, t1_drones, t2_drones, shuttles, implants, scrap_loot, ores, ice, minerals, salvaged, pi_p0_p1, pi_p2_p4).',
        },
      },
    },
  },
  {
    name: 'get_indy_and_invention_plan',
    description:
      'Evaluate Ishisomo T1 manufacturing (State War Academy, NPC 0% ME bonus) and vanilla T2 copy/invention plans (Propel Dynamics Factory, no decryptors) filtered by the user checked categories.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tierFilter: {
          type: Type.STRING,
          description: 'Optional filter: "T1", "T2", or "all".',
        },
      },
    },
  },
  {
    name: 'get_consolidated_shopping_list',
    description:
      'Return the consolidated Jita shopping list across all profitable active Ishisomo manufacturing and T2 invention builds, including 1-jump outside Jita discount alerts.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        maxLines: {
          type: Type.NUMBER,
          description: 'Maximum number of line items to return (default 15).',
        },
      },
    },
  },
  {
    name: 'get_reprocessing_arbitrage',
    description:
      'Evaluate Ore, Ice, and Meta Scrapmetal reprocessing opportunities with Level 5 skills, comparing buy-from-sell-order -> refine -> sell to Jita buy orders vs 50/50 split vs pure build supply.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        focus: {
          type: Type.STRING,
          description: 'Optional filter: "ores", "ice", "scrap_loot", or "all".',
        },
      },
    },
  },
  {
    name: 'get_corridor_arbitrage',
    description:
      'Find profitable pickups along or within 2 jumps of the Ishisomo <-> Jita pipeline to sell in Jita, and Jita consumables to stock nearby sub-hubs.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: {
          type: Type.STRING,
          description: 'Optional filter: "pickup_to_jita", "stock_subhub", or "all".',
        },
      },
    },
  },
  {
    name: 'get_regional_trade_manifest',
    description:
      'Build ranked Jita -> Dodixie and Dodixie -> Jita hauling manifests capped by the pilot active capital cap, ship cargo m³, and Dodixie daily turnover.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        hullClass: {
          type: Type.STRING,
          description: 'Optional hull preference: "blockade_runner", "dst", or "all".',
        },
      },
    },
  },
  {
    name: 'get_pi_factory_analysis',
    description:
      'Evaluate P0->P1, P1->P2, P2->P3, and P3->P4 Planetary Industry factory planet profitability using live Jita prices and configured NPC POCO import/export taxes.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        tier: {
          type: Type.STRING,
          description: 'Optional tier filter like "P1 -> P2", "P2 -> P3", "P3 -> P4", or "all".',
        },
      },
    },
  },
  {
    name: 'propose_add_to_shopping_list',
    description:
      'Attach an interactive "+ Add to Jita Shopping List" action button inside your response so the pilot can add specific EVE Online items and quantities directly to their Jita shopping list state with one click. Use whenever recommending inputs, datacores, minerals, fuel, or haul goods to buy.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        label: {
          type: Type.STRING,
          description:
            'Short button label starting with "+ Add to Jita Shopping List" (e.g., "+ Add to Jita Shopping List (T2 Datacores)").',
        },
        items: {
          type: Type.ARRAY,
          description: 'Array of EVE Online items and exact quantities to add.',
          items: {
            type: Type.OBJECT,
            properties: {
              name: {
                type: Type.STRING,
                description: 'Exact EVE Online item name (e.g., "Morphite", "Datacore - Mechanical Engineering", "Nitrogen Fuel Block").',
              },
              quantity: {
                type: Type.NUMBER,
                description: 'Positive integer quantity to add.',
              },
            },
            required: ['name', 'quantity'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'propose_switch_tab',
    description:
      'Attach an interactive "Switch Tab" button inside your response so the pilot can jump directly to the relevant dashboard tab.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        targetTab: {
          type: Type.STRING,
          description:
            'One of: "overview", "indy_invention", "reprocessing", "corridor_trade", "pi_factory".',
        },
        label: {
          type: Type.STRING,
          description:
            'Concise button label (e.g., "Switch Tab: Indy & T2" or "Switch Tab: Corridor & Trade").',
        },
      },
      required: ['targetTab'],
    },
  },
];

function executeAdvisorTool(
  toolName: string,
  args: Record<string, unknown>,
  checkedCategories: MarketCategoryId[],
  snapshot: MarketSnapshot,
  profile: PilotProfile
): Record<string, unknown> {
  const bundle = runAllDecisionEngines(checkedCategories, snapshot, profile);

  switch (toolName) {
    case 'get_market_quote': {
      const query = String(args.itemQuery || '').toLowerCase().trim();
      const cat = String(args.category || '').trim();
      const matched = EVE_ITEMS.filter((it) => {
        if (cat && it.category !== cat) return false;
        if (query && !it.name.toLowerCase().includes(query)) return false;
        return true;
      }).slice(0, 12);

      return {
        checkedCategories,
        dataSource: snapshot.sourceMode,
        lastSyncedAt: snapshot.lastSyncedAt,
        quotes: matched.map((it) => {
          const q = getQuote(snapshot, it.typeId);
          return {
            name: it.name,
            typeId: it.typeId,
            category: it.category,
            volumeM3: it.volume,
            jitaSell: q.jita.sellMin,
            jitaBuy: q.jita.buyMax,
            dodixieSell: q.dodixie.sellMin,
            dodixieBuy: q.dodixie.buyMax,
            oneJumpCheaper: q.oneJumpCheapestSell ?? null,
          };
        }),
      };
    }

    case 'get_indy_and_invention_plan': {
      const tierFilter = String(args.tierFilter || 'all').toUpperCase();
      const indyCards = bundle.cards
        .filter((c) => c.engine === 'indy_invention')
        .filter((c) =>
          tierFilter === 'ALL'
            ? true
            : tierFilter === 'T2'
              ? c.engineLabel.includes('T2')
              : c.engineLabel.includes('T1')
        )
        .slice(0, 8);

      return {
        stationAnchors: {
          manufacturing: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
          researchAndInvention: EVE_ANCHORS.ISHISOMO_RES_STATION_NAME,
        },
        recommendations: indyCards.map((c) => ({
          title: c.title,
          subtitle: c.subtitle,
          requiredCapital: formatIsk(c.requiredCapitalIsk),
          volume: formatM3(c.totalVolumeM3),
          recommendedHull: c.recommendedHull,
          netProfit: formatIsk(c.netProfitIsk),
          roi: formatPct(c.roiPct),
          steps: c.steps,
        })),
      };
    }

    case 'get_consolidated_shopping_list': {
      const maxLines = Math.min(25, Math.max(5, Number(args.maxLines || 15)));
      return {
        totalCostIsk: formatIsk(bundle.shoppingListTotalIsk),
        totalVolumeM3: formatM3(bundle.shoppingListTotalM3),
        oneJumpSavingsIsk: formatIsk(bundle.shoppingListOneJumpSavingsIsk),
        items: bundle.consolidatedShoppingList.slice(0, maxLines).map((l) => ({
          name: l.name,
          quantity: l.quantity,
          jitaUnit: l.unitPriceJita,
          subtotal: formatIsk(l.totalCostJita),
          volume: formatM3(l.volumeM3),
          cheaper1Jump: l.cheaperNearby ?? null,
        })),
      };
    }

    case 'get_reprocessing_arbitrage': {
      const focus = String(args.focus || 'all');
      const cards = bundle.cards
        .filter((c) => c.engine === 'reprocessing')
        .filter((c) => (focus === 'all' ? true : c.categories.includes(focus as MarketCategoryId)))
        .slice(0, 6);

      return {
        reprocessingSkills: profile.skills,
        opportunities: cards.map((c) => ({
          title: c.title,
          strategy: c.subtitle,
          capital: formatIsk(c.requiredCapitalIsk),
          volume: formatM3(c.totalVolumeM3),
          hull: c.recommendedHull,
          netProfit: formatIsk(c.netProfitIsk),
          roi: formatPct(c.roiPct),
          steps: c.steps,
        })),
      };
    }

    case 'get_corridor_arbitrage': {
      const dir = String(args.direction || 'all');
      const cards = bundle.cards
        .filter((c) => c.engine === 'pipeline_corridor')
        .filter((c) => {
          if (dir === 'pickup_to_jita') return c.id.includes('pickup');
          if (dir === 'stock_subhub') return c.id.includes('stock');
          return true;
        });

      return {
        corridorCards: cards.map((c) => ({
          title: c.title,
          capital: formatIsk(c.requiredCapitalIsk),
          volume: formatM3(c.totalVolumeM3),
          hull: c.recommendedHull,
          netProfit: formatIsk(c.netProfitIsk),
          roi: formatPct(c.roiPct),
          steps: c.steps,
          lots: c.inspection.rows,
        })),
      };
    }

    case 'get_regional_trade_manifest': {
      const hullFilter = String(args.hullClass || 'all');
      const cards = bundle.cards
        .filter((c) => c.engine === 'regional_trade')
        .filter((c) => (hullFilter === 'all' ? true : c.hullClass === hullFilter));

      return {
        activeCapitalCap: formatIsk(profile.activeCapitalCap),
        manifests: cards.map((c) => ({
          title: c.title,
          hull: c.recommendedHull,
          capital: formatIsk(c.requiredCapitalIsk),
          volume: formatM3(c.totalVolumeM3),
          netProfit: formatIsk(c.netProfitIsk),
          roi: formatPct(c.roiPct),
          steps: c.steps,
          skuLines: c.inspection.rows,
        })),
      };
    }

    case 'get_pi_factory_analysis': {
      const tier = String(args.tier || 'all');
      const cards = bundle.cards
        .filter((c) => c.engine === 'pi_factory')
        .filter((c) => (tier === 'all' ? true : c.engineLabel.includes(tier)))
        .slice(0, 6);

      return {
        pocoImportTaxPct: profile.pocoImportTaxPct,
        pocoExportTaxPct: profile.pocoExportTaxPct,
        setups: cards.map((c) => ({
          title: c.title,
          tier: c.engineLabel,
          capital: formatIsk(c.requiredCapitalIsk),
          volume: formatM3(c.totalVolumeM3),
          hull: c.recommendedHull,
          weeklyNetProfit: formatIsk(c.netProfitIsk),
          roi: formatPct(c.roiPct),
          steps: c.steps,
        })),
      };
    }

    default:
      return { error: `Unknown tool ${toolName}` };
  }
}

const VALID_TABS: Record<AdvisorTargetTab, string> = {
  overview: 'Overview',
  indy_invention: 'Indy & T2',
  reprocessing: 'Reprocessing',
  corridor_trade: 'Jita–Dodixie',
  pi_factory: 'PI Factories',
};

function resolveItemByName(name: string) {
  const lower = name.trim().toLowerCase();
  const exact = EVE_ITEMS.find((i) => i.name.toLowerCase() === lower);
  if (exact) return exact;
  return EVE_ITEMS.find((i) => i.name.toLowerCase().includes(lower) || lower.includes(i.name.toLowerCase()));
}

function stableHashTypeId(name: string): number {
  let hash = 900000;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) % 999999;
  }
  return Math.max(900001, hash);
}

app.post('/api/advisor/chat', async (req, res) => {
  try {
    const rawEnvKey = (process.env.GEMINI_API_KEY || '').trim();
    const envApiKey = rawEnvKey && rawEnvKey !== 'MY_GEMINI_API_KEY' ? rawEnvKey : '';
    const headerKeyRaw = req.headers['x-gemini-api-key'];
    const customApiKey =
      typeof headerKeyRaw === 'string' &&
      headerKeyRaw.trim().length > 0 &&
      headerKeyRaw.trim().length <= 256 &&
      /^[\x21-\x7E]+$/.test(headerKeyRaw.trim())
        ? headerKeyRaw.trim()
        : '';
    const apiKey = envApiKey || customApiKey;

    if (!apiKey) {
      res.status(400).json({
        error:
          'No Gemini API key is configured. All market, blueprint, cargo, and route tools work without it — or open "API Setup" in the top navigation bar to add your own optional Gemini API key.',
      });
      return;
    }

    const { messages, checkedCategories, snapshot, profile, appStateSummary } = req.body as {
      messages: { role: 'user' | 'assistant'; content: string }[];
      checkedCategories: MarketCategoryId[];
      snapshot: MarketSnapshot;
      profile: PilotProfile;
      appStateSummary?: AppStateSummary;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'Message history is required.' });
      return;
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });

    const stateJsonBlock = appStateSummary
      ? JSON.stringify(appStateSummary, null, 2)
      : JSON.stringify(
          {
            activeTab: 'overview',
            character: {
              name: profile.characterName,
              mode: profile.mode,
              walletBalanceIsk: profile.walletBalance,
              activeCapitalCapIsk: profile.activeCapitalCap,
              currentSystem: profile.currentSystemName,
              currentStation: profile.currentStationName,
            },
            checkedCategories,
          },
          null,
          2
        );

    const systemInstruction = [
      'You are the Strategic Advisor & Logistics Quartermaster for "Foxy RedFox Indy Command", an elite EVE Online industrialist and high-sec market strategist.',
      'You receive an up-to-date JSON snapshot of the user’s live dashboard state (EVE character wallet balance, current station, active tab, checked market categories, blueprints, top ranked opportunities, and consolidated shopping list) on every message, AND you can invoke Function Calling tools for deeper engine queries.',
      'Format answers concisely with crisp numbered execution steps (1., 2., 3.) referencing exact stations (Jita IV - Moon 4, Dodixie IX - Moon 20, Ishisomo VIII State War Academy, Ishisomo VII Propel Dynamics Factory), hull class (Blockade Runner / DST / Orca), ISK required, m³ volume, net profit, and ROI %.',
      'STRUCTURED ACTION BUTTONS: Whenever you recommend buying materials/items/datacores/fuel or suggest inspecting a specific engine tab, call `propose_add_to_shopping_list` and/or `propose_switch_tab` so interactive buttons render right inside your response card. Do not print raw JSON action payloads in the text.',
      '--- LIVE DASHBOARD APP STATE JSON ---',
      stateJsonBlock,
    ].join('\n');

    const trimmedMessages = messages.slice(-12);
    const firstUserIdx = trimmedMessages.findIndex((m) => m.role === 'user');
    const validTurns =
      firstUserIdx >= 0 ? trimmedMessages.slice(firstUserIdx) : trimmedMessages;

    const contents: Content[] = validTurns.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const toolsUsed: string[] = [];
    const actions: AdvisorAction[] = [];
    let finalText = '';

    let activeModel: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite' =
      'gemini-4-hydrogen';

    const generateWithRetry = async () => {
      const sequence: ('gemini-4-hydrogen' | 'gemini-3.1-flash-lite')[] =
        activeModel === 'gemini-4-hydrogen'
          ? ['gemini-4-hydrogen', 'gemini-3.1-flash-lite']
          : ['gemini-3.1-flash-lite', 'gemini-3.1-flash-lite'];

      let lastErr: unknown;
      for (let i = 0; i < sequence.length; i++) {
        const modelName = sequence[i];
        if (i > 0) {
          await new Promise((r) => setTimeout(r, 400));
        }
        try {
          const config: {
            systemInstruction: string;
            tools: { functionDeclarations: FunctionDeclaration[] }[];
            thinkingConfig?: { thinkingLevel: ThinkingLevel };
          } = {
            systemInstruction,
            tools: [{ functionDeclarations: ADVISOR_TOOLS }],
          };
          if (modelName === 'gemini-4-hydrogen') {
            config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
          }
          const resp = await ai.models.generateContent({
            model: modelName,
            contents,
            config,
          });
          activeModel = modelName;
          return resp;
        } catch (err: unknown) {
          lastErr = err;
          const msg = err instanceof Error ? err.message : String(err);
          const isTransient =
            msg.includes('503') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('high demand') ||
            msg.includes('overloaded');
          if (!isTransient) {
            throw err;
          }
        }
      }
      throw lastErr;
    };

    // Multi-turn function calling loop (up to 4 tool hops)
    for (let turn = 0; turn < 4; turn++) {
      const response = await generateWithRetry();

      const functionCalls = response.functionCalls;
      if (functionCalls && functionCalls.length > 0) {
        const modelContent = response.candidates?.[0]?.content;
        if (modelContent) {
          contents.push(modelContent);
        }

        const responseParts: Part[] = functionCalls.map((fc, idx) => {
          const toolName = fc.name || 'unknown';
          const args = (fc.args as Record<string, unknown>) || {};

          if (toolName === 'propose_add_to_shopping_list') {
            const rawItems = Array.isArray(args.items) ? args.items : [];
            const resolvedItems = rawItems
              .map((entry) => {
                const obj = entry as { name?: string; quantity?: number };
                const cleanName = String(obj.name || '').trim();
                const qty = Math.max(1, Math.round(Number(obj.quantity || 0)));
                if (!cleanName || !Number.isFinite(qty)) return null;
                const matched = resolveItemByName(cleanName);
                const typeId = matched?.typeId ?? stableHashTypeId(cleanName);
                const quote = matched ? getQuote(snapshot, matched.typeId) : null;
                const unitPrice = quote?.jita.sellMin ?? matched?.baseJitaSell ?? 0;
                return {
                  typeId,
                  name: matched?.name ?? cleanName,
                  quantity: qty,
                  estimatedCostIsk: unitPrice * qty,
                };
              })
              .filter((x): x is NonNullable<typeof x> => x !== null);

            if (resolvedItems.length > 0) {
              const rawLabel = String(args.label || '').trim();
              const label = rawLabel
                ? rawLabel.startsWith('+')
                  ? rawLabel
                  : `+ Add to Jita Shopping List (${rawLabel})`
                : `+ Add to Jita Shopping List (${resolvedItems.length} item${resolvedItems.length > 1 ? 's' : ''})`;

              actions.push({
                id: `act-shop-${Date.now()}-${turn}-${idx}`,
                type: 'add_to_shopping_list',
                label,
                items: resolvedItems,
              });
            }

            return {
              functionResponse: {
                id: fc.id,
                name: toolName,
                response: {
                  attached: resolvedItems.length > 0,
                  itemCount: resolvedItems.length,
                  estimatedTotalIsk: formatIsk(
                    resolvedItems.reduce((s, i) => s + i.estimatedCostIsk, 0)
                  ),
                },
              },
            };
          }

          if (toolName === 'propose_switch_tab') {
            const rawTab = String(args.targetTab || '').trim() as AdvisorTargetTab;
            const validTab: AdvisorTargetTab =
              rawTab in VALID_TABS ? rawTab : 'overview';
            const tabTitle = VALID_TABS[validTab];
            const label =
              String(args.label || '').trim() || `Switch Tab: ${tabTitle}`;

            if (!actions.some((a) => a.type === 'switch_tab' && a.targetTab === validTab)) {
              actions.push({
                id: `act-tab-${Date.now()}-${turn}-${idx}`,
                type: 'switch_tab',
                label,
                targetTab: validTab,
              });
            }

            return {
              functionResponse: {
                id: fc.id,
                name: toolName,
                response: {
                  attached: true,
                  targetTab: validTab,
                  tabTitle,
                },
              },
            };
          }

          if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);
          const result = executeAdvisorTool(
            toolName,
            args,
            checkedCategories,
            snapshot,
            profile
          );
          return {
            functionResponse: {
              id: fc.id,
              name: toolName,
              response: result,
            },
          };
        });

        contents.push({ role: 'user', parts: responseParts });
        continue;
      }

      finalText = response.text || '';
      break;
    }

    if (!finalText) {
      finalText =
        'Unable to synthesize a tactical plan from the active market state. Verify your checked Market Scope categories and try again.';
    }

    res.json({
      text: finalText,
      toolsUsed,
      actions,
    });
  } catch (err: unknown) {
    console.error('Gemini advisor error:', err);
    let message =
      err instanceof Error ? err.message : 'Gemini Advisor request failed.';
    // Unwrap nested JSON error messages from the Gemini SDK if present
    try {
      const parsed = JSON.parse(message) as {
        error?: { message?: string; status?: string };
      };
      if (parsed?.error?.message) {
        message = parsed.error.message;
      }
    } catch {
      // Keep raw message if not JSON
    }
    res.status(500).json({ error: message });
  }
});

// --- Vite Dev Middleware / Production Static Hosting ---

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`Foxy RedFox Indy Command listening on http://0.0.0.0:${port}`);
  });
}

startServer();
