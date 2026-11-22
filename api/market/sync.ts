import {
  EMPIRE_HUB_MAP,
  ITEM_BY_ID,
  MARKET_CATEGORIES,
  getTypeIdsToFetch,
} from '../../src/data/eveCatalog.ts';
import type {
  HubQuote,
  MarketCategoryId,
  MarketQuote,
  MarketSnapshot,
  TradeHubId,
} from '../../src/types/eve.ts';

interface ServerlessReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  setHeader?(name: string, value: string): void;
  json(payload: unknown): void;
}

interface FuzzworkStat {
  min?: string;
  max?: string;
  volume?: string;
  percentile?: string;
}

interface FuzzworkAgg {
  buy?: FuzzworkStat;
  sell?: FuzzworkStat;
}

async function fetchFuzzworkStation(
  stationId: number,
  typeIds: number[]
): Promise<Record<number, FuzzworkAgg>> {
  const out: Record<number, FuzzworkAgg> = {};
  for (let i = 0; i < typeIds.length; i += 75) {
    const chunk = typeIds.slice(i, i + 75);
    try {
      const r = await fetch(
        `https://market.fuzzwork.co.uk/aggregates/?station=${stationId}&types=${chunk.join(',')}`,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent':
              'Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)',
          },
        }
      );
      if (!r.ok) continue;
      const json = (await r.json()) as Record<string, FuzzworkAgg>;
      for (const [k, v] of Object.entries(json)) {
        out[Number(k)] = v;
      }
    } catch {
      // Ignore transient hub failure
    }
  }
  return out;
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const rawCatsParam = req.query?.categories;
    const rawCats = Array.isArray(rawCatsParam) ? rawCatsParam[0] : rawCatsParam || '';
    const rawHubsParam = req.query?.hubs;
    const rawHubs = Array.isArray(rawHubsParam) ? rawHubsParam[0] : rawHubsParam || 'jita,dodixie';

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
      res.status(200).json({
        quotes: {},
        corridorOrders: [],
        lastSyncedAt: new Date().toISOString(),
        liveItemCount: 0,
        sourceMode: 'baseline',
      } satisfies MarketSnapshot);
      return;
    }

    const typeIds = getTypeIdsToFetch(categories);
    const hubDataMap: Partial<Record<TradeHubId, Record<number, FuzzworkAgg>>> = {};

    const results = await Promise.all(
      requestedHubs.map(async (hubId) => {
        const data = await fetchFuzzworkStation(EMPIRE_HUB_MAP[hubId].stationId, typeIds);
        return [hubId, data] as const;
      })
    );
    for (const [hubId, data] of results) {
      hubDataMap[hubId] = data;
    }

    const buildHubQuote = (
      agg: FuzzworkAgg | undefined,
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
      const jAgg = hubDataMap.jita?.[id];
      const dAgg = hubDataMap.dodixie?.[id];
      const jSellMin = Number(jAgg?.sell?.min || 0);
      const jBuyMax = Number(jAgg?.buy?.max || 0);
      const hasLiveJita = jSellMin > 0 || jBuyMax > 0;
      const baseJitaSell = jSellMin > 0 ? jSellMin : item?.baseJitaSell ?? 1000;
      const baseJitaBuy = jBuyMax > 0 ? jBuyMax : item?.baseJitaBuy ?? baseJitaSell * 0.9;

      const jitaQuote = buildHubQuote(jAgg, baseJitaSell, baseJitaBuy, item?.estDailyJitaVol ?? 0);
      const dodixieQuote = buildHubQuote(
        dAgg,
        item?.baseDodixieSell ?? baseJitaSell * 1.12,
        item?.baseDodixieBuy ?? baseJitaBuy * 1.02,
        item?.estDailyDodixieVol ?? 0
      );

      const hubs: Partial<Record<TradeHubId, HubQuote>> = {
        jita: jitaQuote,
        dodixie: dodixieQuote,
      };
      for (const hubId of requestedHubs) {
        if (hubId === 'jita' || hubId === 'dodixie') continue;
        const mult = hubId === 'amarr' ? 1.07 : hubId === 'rens' ? 1.15 : 1.17;
        hubs[hubId] = buildHubQuote(
          hubDataMap[hubId]?.[id],
          baseJitaSell * mult,
          baseJitaBuy * (mult - 0.08),
          Math.max(1, Math.round((item?.estDailyDodixieVol ?? 10) * 0.7))
        );
      }

      if (hasLiveJita) liveCount += 1;
      quotes[id] = {
        typeId: id,
        jita: jitaQuote,
        dodixie: dodixieQuote,
        hubs,
        source: hasLiveJita ? 'live' : 'baseline',
      };
    }

    const snapshot: MarketSnapshot = {
      quotes,
      corridorOrders: [],
      lastSyncedAt: new Date().toISOString(),
      liveItemCount: liveCount,
      sourceMode: liveCount === typeIds.length ? 'live' : liveCount > 0 ? 'partial' : 'baseline',
    };

    res.setHeader?.('Cache-Control', 's-maxage=90, stale-while-revalidate=180');
    res.status(200).json(snapshot);
  } catch (err) {
    console.error('Vercel market sync error:', err);
    res.status(500).json({ error: 'Failed to synchronize EVE market endpoints.' });
  }
}
