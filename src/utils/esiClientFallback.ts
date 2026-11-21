// Client-side direct EVE ESI & Fuzzwork fallback helpers.
// Ensures 100% live functionality on Vercel serverless/static deployments
// whenever an Express endpoint is unavailable, while keeping Express primary on Cloud Run.

import { EMPIRE_HUB_MAP, EVE_ANCHORS } from '../data/eveCatalog.ts';
import { computeEve4SigFigTick } from './eveMarketMath.ts';
import type {
  CharacterIndustryJob,
  HubQuote,
  IndustryCostSnapshot,
  MarketCacheTelemetry,
  MarketQuote,
  MarketSnapshot,
  OrderMonitorEntry,
  OrderMonitorSnapshot,
  SystemCostIndices,
  TradeHubId,
  WalletTransactionEntry,
} from '../types/eve.ts';

const ESI_BASE = 'https://esi.evetech.net/latest';

export const ACTIVITY_LABEL_MAP: Record<number, string> = {
  1: 'Manufacturing',
  3: 'TE Research',
  4: 'ME Research',
  5: 'Copying',
  7: 'Reverse Engineering',
  8: 'Invention',
  9: 'Reaction',
  11: 'Reaction',
};

/**
 * EVE Online 4-significant-figure market tick calculation.
 * Returns the exact next valid price tick above (for buy) or below (for sell) targetPrice.
 */
export function computeEveMarketTick(price: number, direction: 'undercut_sell' | 'outbid_buy'): number {
  return computeEve4SigFigTick(price, direction);
}

export async function fetchIndustryCostIndicesClient(): Promise<IndustryCostSnapshot> {
  // Try Express / Vercel API first, fall back directly to public CORS-enabled EVE ESI
  try {
    const apiRes = await fetch('/api/industry/cost-indices');
    if (apiRes.ok) {
      const json = (await apiRes.json()) as IndustryCostSnapshot;
      if (json && json.costIndicesBySystem) return json;
    }
  } catch {
    // Fall through to direct ESI
  }

  const [sysRes, priceRes] = await Promise.all([
    fetch(`${ESI_BASE}/industry/systems/?datasource=tranquility`),
    fetch(`${ESI_BASE}/markets/prices/?datasource=tranquility`),
  ]);

  const costIndicesBySystem: Record<number, SystemCostIndices> = {};
  if (sysRes.ok) {
    const rows = (await sysRes.json()) as {
      solar_system_id: number;
      cost_indices: { activity: string; cost_index: number }[];
    }[];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const entry: SystemCostIndices = {
          systemId: row.solar_system_id,
          manufacturing: 0.02,
          invention: 0.02,
          copying: 0.01,
          researching_material_efficiency: 0.01,
          researching_time_efficiency: 0.01,
          reaction: 0.02,
        };
        for (const ci of row.cost_indices || []) {
          if (ci.activity === 'manufacturing') entry.manufacturing = ci.cost_index;
          else if (ci.activity === 'invention') entry.invention = ci.cost_index;
          else if (ci.activity === 'copying') entry.copying = ci.cost_index;
          else if (ci.activity === 'researching_material_efficiency')
            entry.researching_material_efficiency = ci.cost_index;
          else if (ci.activity === 'researching_time_efficiency')
            entry.researching_time_efficiency = ci.cost_index;
          else if (ci.activity === 'reaction') entry.reaction = ci.cost_index;
        }
        costIndicesBySystem[row.solar_system_id] = entry;
      }
    }
  }

  const adjustedPricesByType: Record<number, number> = {};
  if (priceRes.ok) {
    const rows = (await priceRes.json()) as {
      type_id: number;
      adjusted_price?: number;
      average_price?: number;
    }[];
    if (Array.isArray(rows)) {
      for (const row of rows) {
        const p = Number(row.adjusted_price || row.average_price || 0);
        if (row.type_id > 0 && p > 0) {
          adjustedPricesByType[row.type_id] = p;
        }
      }
    }
  }

  return {
    costIndicesBySystem,
    adjustedPricesByType,
    fetchedAt: new Date().toISOString(),
    source: Object.keys(costIndicesBySystem).length > 0 ? 'esi_live' : 'baseline',
  };
}

interface FuzzworkAggRaw {
  buy?: { max?: string; volume?: string; percentile?: string };
  sell?: { min?: string; volume?: string; percentile?: string };
}

async function fetchFuzzworkStationDirect(
  stationId: number,
  typeIds: number[]
): Promise<Record<number, FuzzworkAggRaw>> {
  const result: Record<number, FuzzworkAggRaw> = {};
  const chunkSize = 75;
  const chunks: number[][] = [];
  for (let i = 0; i < typeIds.length; i += chunkSize) {
    chunks.push(typeIds.slice(i, i + chunkSize));
  }
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await fetch(
          `https://market.fuzzwork.co.uk/aggregates/?station=${stationId}&types=${chunk.join(',')}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as Record<string, FuzzworkAggRaw>;
        for (const [k, v] of Object.entries(json)) {
          const id = Number(k);
          if (Number.isFinite(id) && v) result[id] = v;
        }
      } catch {
        // graceful degrade
      }
    })
  );
  return result;
}

export async function fetchHubQuotesDirect(
  hubIds: TradeHubId[],
  typeIds: number[],
  existingQuotes: Record<number, MarketQuote>
): Promise<Partial<MarketSnapshot>> {
  const uniqueHubs = Array.from(new Set(hubIds));
  const stationResults = await Promise.all(
    uniqueHubs.map(async (hubId) => {
      const def = EMPIRE_HUB_MAP[hubId];
      const data = await fetchFuzzworkStationDirect(def.stationId, typeIds);
      return [hubId, data] as const;
    })
  );

  const quotes: Record<number, MarketQuote> = {};
  let liveCount = 0;

  for (const typeId of typeIds) {
    const prev = existingQuotes[typeId];
    const hubs: Partial<Record<TradeHubId, HubQuote>> = { ...(prev?.hubs ?? {}) };
    let anyLive = prev?.source === 'live';

    for (const [hubId, map] of stationResults) {
      const agg = map[typeId];
      if (!agg) continue;
      const sellMin = Number(agg.sell?.min || 0);
      const buyMax = Number(agg.buy?.max || 0);
      if (sellMin > 0 || buyMax > 0) {
        anyLive = true;
        hubs[hubId] = {
          sellMin,
          sellVolume: Number(agg.sell?.volume || 0),
          buyMax,
          buyVolume: Number(agg.buy?.volume || 0),
          sellPercentile: Number(agg.sell?.percentile || sellMin || 0),
          buyPercentile: Number(agg.buy?.percentile || buyMax || 0),
        };
      }
    }

    if (anyLive) liveCount += 1;

    quotes[typeId] = {
      typeId,
      jita: hubs.jita ?? prev?.jita ?? {
        sellMin: 0,
        sellVolume: 0,
        buyMax: 0,
        buyVolume: 0,
        sellPercentile: 0,
        buyPercentile: 0,
      },
      dodixie: hubs.dodixie ?? prev?.dodixie ?? {
        sellMin: 0,
        sellVolume: 0,
        buyMax: 0,
        buyVolume: 0,
        sellPercentile: 0,
        buyPercentile: 0,
      },
      hubs,
      source: anyLive ? 'live' : 'baseline',
    };
  }

  return {
    quotes,
    liveItemCount: liveCount,
    lastSyncedAt: new Date().toISOString(),
    sourceMode: liveCount > 0 ? 'live' : 'baseline',
  };
}

export async function fetchCharacterIndustryJobsClient(
  characterId: number,
  accessToken: string
): Promise<CharacterIndustryJob[]> {
  try {
    const apiRes = await fetch('/api/eve/industry-jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ characterId }),
    });
    if (apiRes.ok) {
      const json = (await apiRes.json()) as { jobs?: CharacterIndustryJob[] };
      if (Array.isArray(json.jobs)) return json.jobs;
    }
  } catch {
    // Fall through to direct ESI
  }

  const res = await fetch(
    `${ESI_BASE}/characters/${characterId}/industry/jobs/?datasource=tranquility&include_completed=false`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) {
    throw new Error(`ESI industry jobs returned HTTP ${res.status}`);
  }
  const raw = (await res.json()) as {
    job_id: number;
    activity_id: number;
    blueprint_id: number;
    blueprint_type_id: number;
    product_type_id?: number;
    runs: number;
    cost?: number;
    facility_id: number;
    status: string;
    start_date: string;
    end_date: string;
  }[];

  const idsToResolve = new Set<number>();
  for (const j of raw) {
    if (j.blueprint_type_id) idsToResolve.add(j.blueprint_type_id);
    if (j.product_type_id) idsToResolve.add(j.product_type_id);
    if (j.facility_id && j.facility_id < 1_000_000_000) idsToResolve.add(j.facility_id);
  }

  const nameMap = new Map<number, string>();
  if (idsToResolve.size > 0) {
    try {
      const nRes = await fetch(`${ESI_BASE}/universe/names/?datasource=tranquility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(idsToResolve).slice(0, 500)),
      });
      if (nRes.ok) {
        const entries = (await nRes.json()) as { id: number; name: string }[];
        for (const e of entries) nameMap.set(e.id, e.name);
      }
    } catch {
      // ignore
    }
  }

  return (Array.isArray(raw) ? raw : []).map((j) => {
    const bpName = nameMap.get(j.blueprint_type_id) || `Blueprint #${j.blueprint_type_id}`;
    const prodName =
      (j.product_type_id ? nameMap.get(j.product_type_id) : undefined) ||
      bpName.replace(/\s+Blueprint$/i, '');
    return {
      jobId: j.job_id,
      activityId: j.activity_id,
      activityLabel: ACTIVITY_LABEL_MAP[j.activity_id] || `Activity ${j.activity_id}`,
      blueprintId: j.blueprint_id,
      blueprintTypeId: j.blueprint_type_id,
      blueprintName: bpName,
      productTypeId: j.product_type_id,
      productName: prodName,
      runs: j.runs,
      cost: j.cost,
      facilityId: j.facility_id,
      facilityName:
        nameMap.get(j.facility_id) ||
        (j.facility_id >= 1_000_000_000
          ? `Upwell Structure (${j.facility_id})`
          : `Station ${j.facility_id}`),
      status: j.status,
      startDate: j.start_date,
      endDate: j.end_date,
    };
  });
}

export async function fetchOrderMonitorClient(
  characterId: number,
  accessToken: string,
  salesTaxRate: number
): Promise<OrderMonitorSnapshot> {
  try {
    const apiRes = await fetch('/api/eve/order-monitor', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ characterId, salesTaxRate }),
    });
    if (apiRes.ok) {
      return (await apiRes.json()) as OrderMonitorSnapshot;
    }
  } catch {
    // Fall through to direct ESI
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
  const [ordersRes, txRes] = await Promise.all([
    fetch(`${ESI_BASE}/characters/${characterId}/orders/?datasource=tranquility`, { headers }),
    fetch(`${ESI_BASE}/characters/${characterId}/wallet/transactions/?datasource=tranquility`, {
      headers,
    }),
  ]);

  const rawOrders = ordersRes.ok
    ? ((await ordersRes.json()) as {
        order_id: number;
        type_id: number;
        region_id: number;
        location_id: number;
        is_buy_order?: boolean;
        price: number;
        volume_remain: number;
        volume_total: number;
        issued: string;
      }[])
    : [];
  const rawTx = txRes.ok
    ? ((await txRes.json()) as {
        transaction_id: number;
        date: string;
        type_id: number;
        is_buy: boolean;
        quantity: number;
        unit_price: number;
        location_id: number;
      }[])
    : [];

  const idsToName = new Set<number>();
  for (const o of rawOrders) {
    idsToName.add(o.type_id);
    if (o.location_id < 1_000_000_000) idsToName.add(o.location_id);
  }
  for (const t of rawTx.slice(0, 80)) idsToName.add(t.type_id);

  const nameMap = new Map<number, string>();
  if (idsToName.size > 0) {
    try {
      const nRes = await fetch(`${ESI_BASE}/universe/names/?datasource=tranquility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Array.from(idsToName).slice(0, 500)),
      });
      if (nRes.ok) {
        const list = (await nRes.json()) as { id: number; name: string }[];
        for (const e of list) nameMap.set(e.id, e.name);
      }
    } catch {
      // ignore
    }
  }

  // Fetch regional top-of-book for up to 20 unique (region, type) order pairs
  const pairSet = new Map<string, { regionId: number; typeId: number }>();
  for (const o of rawOrders) {
    const key = `${o.region_id}:${o.type_id}`;
    if (!pairSet.has(key) && pairSet.size < 20) {
      pairSet.set(key, { regionId: o.region_id, typeId: o.type_id });
    }
  }

  const bestPrices = new Map<
    string,
    { bestSell: number; bestBuy: number; sellPrices: number[]; buyPrices: number[] }
  >();
  await Promise.all(
    Array.from(pairSet.entries()).map(async ([key, { regionId, typeId }]) => {
      try {
        const r = await fetch(
          `${ESI_BASE}/markets/${regionId}/orders/?datasource=tranquility&order_type=all&type_id=${typeId}`
        );
        if (!r.ok) return;
        const list = (await r.json()) as { is_buy_order: boolean; price: number }[];
        let bestSell = Infinity;
        let bestBuy = 0;
        const sellPrices: number[] = [];
        const buyPrices: number[] = [];
        for (const m of list) {
          if (m.is_buy_order) {
            buyPrices.push(m.price);
            if (m.price > bestBuy) bestBuy = m.price;
          } else {
            sellPrices.push(m.price);
            if (m.price < bestSell) bestSell = m.price;
          }
        }
        bestPrices.set(key, {
          bestSell: Number.isFinite(bestSell) ? bestSell : 0,
          bestBuy,
          sellPrices,
          buyPrices,
        });
      } catch {
        // ignore
      }
    })
  );

  const REGION_NAMES: Record<number, string> = {
    [EVE_ANCHORS.THE_FORGE_REGION_ID]: 'The Forge (Jita)',
    [EVE_ANCHORS.DOMAIN_REGION_ID]: 'Domain (Amarr)',
    [EVE_ANCHORS.SINQ_LAISON_REGION_ID]: 'Sinq Laison (Dodixie)',
    [EVE_ANCHORS.HEIMATAR_REGION_ID]: 'Heimatar (Rens)',
    [EVE_ANCHORS.METROPOLIS_REGION_ID]: 'Metropolis (Hek)',
  };

  const orders: OrderMonitorEntry[] = rawOrders.map((o) => {
    const isBuy = Boolean(o.is_buy_order);
    const bp = bestPrices.get(`${o.region_id}:${o.type_id}`);
    const marketBest = isBuy ? bp?.bestBuy || o.price : bp?.bestSell || o.price;
    const isUndercut = isBuy ? marketBest > o.price + 0.005 : marketBest > 0 && marketBest < o.price - 0.005;
    const suggestedReclaimPrice = isUndercut
      ? computeEveMarketTick(marketBest, isBuy ? 'outbid_buy' : 'undercut_sell')
      : o.price;
    const deltaIsk = isUndercut ? Number((suggestedReclaimPrice - o.price).toFixed(2)) : 0;
    const competitorsAhead = bp
      ? isBuy
        ? bp.buyPrices.filter((p) => p > o.price + 0.005).length
        : bp.sellPrices.filter((p) => p < o.price - 0.005).length
      : 0;

    return {
      orderId: o.order_id,
      typeId: o.type_id,
      itemName: nameMap.get(o.type_id) || `Type #${o.type_id}`,
      regionId: o.region_id,
      regionName: REGION_NAMES[o.region_id] || `Region ${o.region_id}`,
      locationId: o.location_id,
      stationName: nameMap.get(o.location_id) || `Location ${o.location_id}`,
      isBuyOrder: isBuy,
      myPrice: o.price,
      marketBestPrice: marketBest,
      isUndercut,
      suggestedReclaimPrice,
      deltaIsk,
      competitorsAhead,
      volumeRemain: o.volume_remain,
      volumeTotal: o.volume_total,
      issued: o.issued,
    };
  });

  orders.sort((a, b) => Number(b.isUndercut) - Number(a.isUndercut) || Math.abs(b.deltaIsk) - Math.abs(a.deltaIsk));

  const now = Date.now();
  const dayMs = 24 * 3600_000;
  const weekMs = 7 * dayMs;

  const avgBuyByType = new Map<number, { cost: number; qty: number }>();
  for (const t of rawTx) {
    if (t.is_buy) {
      const prev = avgBuyByType.get(t.type_id) ?? { cost: 0, qty: 0 };
      prev.cost += t.quantity * t.unit_price;
      prev.qty += t.quantity;
      avgBuyByType.set(t.type_id, prev);
    }
  }

  let realizedRevenue24hIsk = 0;
  let realizedSpend24hIsk = 0;
  let realizedProfit24hIsk = 0;
  let realizedProfit7dIsk = 0;

  const recentTransactions: WalletTransactionEntry[] = rawTx.slice(0, 50).map((t) => {
    const ts = new Date(t.date).getTime();
    const total = t.quantity * t.unit_price;
    if (now - ts <= dayMs) {
      if (t.is_buy) realizedSpend24hIsk += total;
      else realizedRevenue24hIsk += total;
    }
    if (!t.is_buy) {
      const avgBuyRec = avgBuyByType.get(t.type_id);
      const estCostBasis =
        avgBuyRec && avgBuyRec.qty > 0 ? avgBuyRec.cost / avgBuyRec.qty : t.unit_price * 0.85;
      const netSale = total * (1 - salesTaxRate) - t.quantity * estCostBasis;
      if (now - ts <= dayMs) realizedProfit24hIsk += netSale;
      if (now - ts <= weekMs) realizedProfit7dIsk += netSale;
    }
    return {
      transactionId: t.transaction_id,
      date: t.date,
      typeId: t.type_id,
      itemName: nameMap.get(t.type_id) || `Type #${t.type_id}`,
      isBuy: t.is_buy,
      quantity: t.quantity,
      unitPrice: t.unit_price,
      totalIsk: total,
      locationId: t.location_id,
    };
  });

  return {
    orders,
    undercutCount: orders.filter((o) => o.isUndercut).length,
    recentTransactions,
    realizedRevenue24hIsk,
    realizedSpend24hIsk,
    realizedProfit24hIsk,
    realizedProfit7dIsk,
    syncedAt: new Date().toISOString(),
  };
}

/**
 * Low-token background Undercut Watchdog.
 * Polls ONLY the character's open market order type_ids respecting ESI's 5-minute ETag cache.
 */
export async function pollUndercutWatchdogClient(
  characterId: number,
  accessToken: string,
  salesTaxRate: number
): Promise<{
  orders: OrderMonitorEntry[];
  undercutCount: number;
  syncedAt: string;
  cacheMeta?: MarketCacheTelemetry;
}> {
  try {
    const apiRes = await fetch('/api/eve/undercut-watchdog', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ characterId }),
    });
    if (apiRes.ok) {
      return (await apiRes.json()) as {
        orders: OrderMonitorEntry[];
        undercutCount: number;
        syncedAt: string;
        cacheMeta?: MarketCacheTelemetry;
      };
    }
  } catch {
    // Fall back to full client monitor if serverless lacks watchdog route
  }

  const full = await fetchOrderMonitorClient(characterId, accessToken, salesTaxRate);
  return {
    orders: full.orders,
    undercutCount: full.undercutCount,
    syncedAt: full.syncedAt,
    cacheMeta: {
      expiresAtMs: Date.now() + 5 * 60 * 1000,
      lastRefreshedAt: full.syncedAt,
      ratelimitRemaining: null,
      retryAfterSec: null,
      from304Count: 0,
      zeroTokenHits: 0,
      mode: 'background_watchdog',
    },
  };
}
