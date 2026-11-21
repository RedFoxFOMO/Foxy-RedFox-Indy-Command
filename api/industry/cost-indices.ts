import { EVE_ITEMS } from '../../src/data/eveCatalog.ts';
import type { IndustryCostSnapshot, SystemCostIndices } from '../../src/types/eve.ts';

interface ServerlessReq {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}

interface ServerlessRes {
  status(code: number): ServerlessRes;
  setHeader?(name: string, value: string): void;
  json(payload: unknown): void;
}

export default async function handler(req: ServerlessReq, res: ServerlessRes) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const [sysRes, pricesRes] = await Promise.all([
      fetch('https://esi.evetech.net/latest/industry/systems/?datasource=tranquility', {
        headers: { Accept: 'application/json', 'User-Agent': 'FoxyRedFoxIndyCommand/2.0' },
      }),
      fetch('https://esi.evetech.net/latest/markets/prices/?datasource=tranquility', {
        headers: { Accept: 'application/json', 'User-Agent': 'FoxyRedFoxIndyCommand/2.0' },
      }),
    ]);

    const trackedSystemIds = new Set<number>([
      30000137, 30000142, 30000144, 30002187, 30002659, 30002510, 30002053,
    ]);
    const rawSysParam = req.query?.systemIds;
    const rawSysStr = Array.isArray(rawSysParam) ? rawSysParam[0] : rawSysParam || '';
    for (const s of rawSysStr.split(',')) {
      const id = Number(s.trim());
      if (Number.isInteger(id) && id > 0) trackedSystemIds.add(id);
    }

    const costIndicesBySystem: Record<number, SystemCostIndices> = {};
    if (sysRes.ok) {
      const rawSystems = (await sysRes.json()) as {
        solar_system_id: number;
        cost_indices: { activity: string; cost_index: number }[];
      }[];
      for (const entry of Array.isArray(rawSystems) ? rawSystems : []) {
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

    const adjustedPricesByType: Record<number, number> = {};
    if (pricesRes.ok) {
      const knownItemIds = new Set(EVE_ITEMS.map((i) => i.typeId));
      const rawPrices = (await pricesRes.json()) as {
        type_id: number;
        adjusted_price?: number;
        average_price?: number;
      }[];
      for (const p of Array.isArray(rawPrices) ? rawPrices : []) {
        if (!knownItemIds.has(p.type_id)) continue;
        const val = p.adjusted_price ?? p.average_price ?? 0;
        if (val > 0) adjustedPricesByType[p.type_id] = val;
      }
    }

    const payload: IndustryCostSnapshot = {
      costIndicesBySystem,
      adjustedPricesByType,
      fetchedAt: new Date().toISOString(),
      source: Object.keys(costIndicesBySystem).length > 0 ? 'esi_live' : 'baseline',
    };

    res.setHeader?.('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json(payload);
  } catch (err) {
    console.error('Vercel industry cost indices error:', err);
    res.status(500).json({ error: 'Unable to fetch live CCP system cost indices.' });
  }
}
