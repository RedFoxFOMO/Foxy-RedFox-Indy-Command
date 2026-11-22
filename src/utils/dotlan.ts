// DOTLAN external map helpers, 2026 ESI compliance constants,
// and exact 5-Hub Empire NPC station owner mappings for standing-adjusted broker fees.

import type { NpcStandingsMap, TradeHubId } from '../types/eve.ts';

export const APP_VERSION = '2.2.0';
export const APP_RELEASE_DATE = '2026-11-21';
export const ESI_COMPATIBILITY_DATE = '2026-08-18';
export const ESI_USER_AGENT_V22 =
  'Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)';
export const ESI_BASE_URL = 'https://esi.evetech.net';

export interface HubNpcOwnerInfo {
  hubId: TradeHubId;
  hubName: string;
  stationName: string;
  systemName: string;
  regionName: string;
  npcCorpId: number;
  npcCorpName: string;
  npcFactionId: number;
  npcFactionName: string;
}

export const EMPIRE_HUB_NPC_OWNERS: Record<TradeHubId, HubNpcOwnerInfo> = {
  jita: {
    hubId: 'jita',
    hubName: 'Jita 4-4',
    stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
    systemName: 'Jita',
    regionName: 'The_Forge',
    npcCorpId: 1000035,
    npcCorpName: 'Caldari Navy',
    npcFactionId: 500001,
    npcFactionName: 'Caldari State',
  },
  amarr: {
    hubId: 'amarr',
    hubName: 'Amarr VIII',
    stationName: 'Amarr VIII (Oris) - Emperor Family Academy',
    systemName: 'Amarr',
    regionName: 'Domain',
    npcCorpId: 1000066,
    npcCorpName: 'Emperor Family',
    npcFactionId: 500003,
    npcFactionName: 'Amarr Empire',
  },
  dodixie: {
    hubId: 'dodixie',
    hubName: 'Dodixie IX-20',
    stationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
    systemName: 'Dodixie',
    regionName: 'Sinq_Laison',
    npcCorpId: 1000120,
    npcCorpName: 'Federation Navy',
    npcFactionId: 500004,
    npcFactionName: 'Gallente Federation',
  },
  rens: {
    hubId: 'rens',
    hubName: 'Rens VI-8',
    stationName: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
    systemName: 'Rens',
    regionName: 'Heimatar',
    npcCorpId: 1000051,
    npcCorpName: 'Brutor Tribe',
    npcFactionId: 500002,
    npcFactionName: 'Minmatar Republic',
  },
  hek: {
    hubId: 'hek',
    hubName: 'Hek VIII-12',
    stationName: 'Hek VIII - Moon 12 - Boundless Creation Factory',
    systemName: 'Hek',
    regionName: 'Metropolis',
    npcCorpId: 1000182,
    npcCorpName: 'Boundless Creation',
    npcFactionId: 500002,
    npcFactionName: 'Minmatar Republic',
  },
};

export interface StandingBrokerBreakdown {
  hubId: TradeHubId;
  hubName: string;
  brokerRelationsLvl: number;
  factionStanding: number;
  corpStanding: number;
  factionName: string;
  corpName: string;
  basePct: number;
  skillReductionPct: number;
  factionReductionPct: number;
  corpReductionPct: number;
  effectiveNpcBrokerPct: number;
  usingUpwellCustom: boolean;
  upwellBrokerPct: number;
  sccSurchargePct: number;
  effectiveTotalBrokerPct: number;
}

/**
 * Computes exact EVE Online NPC station broker fee using Broker Relations + Faction + Corp standings:
 * brokerFeePct = Math.max(1.0, 3.0 - (0.3 * brokerRelations) - (0.03 * factionStanding) - (0.02 * corpStanding))
 * Also supports custom Upwell structure broker fee + 0.5% SCC surcharge when configured.
 */
export function computeExactHubBrokerFee(params: {
  hubId: TradeHubId;
  brokerRelationsLvl: number;
  standings?: NpcStandingsMap;
  useCustomUpwellBroker?: boolean;
  customUpwellBrokerPct?: number;
  includeSccSurcharge?: boolean;
}): StandingBrokerBreakdown {
  const owner = EMPIRE_HUB_NPC_OWNERS[params.hubId] ?? EMPIRE_HUB_NPC_OWNERS.jita;
  const lvl = Math.max(0, Math.min(5, Math.floor(params.brokerRelationsLvl || 0)));
  const factionStanding = Number(params.standings?.factions?.[owner.npcFactionId] ?? 0);
  const corpStanding = Number(params.standings?.corps?.[owner.npcCorpId] ?? 0);

  const basePct = 3.0;
  const skillReductionPct = 0.3 * lvl;
  const factionReductionPct = 0.03 * factionStanding;
  const corpReductionPct = 0.02 * corpStanding;

  const effectiveNpcBrokerPct = Math.max(
    1.0,
    Number((basePct - skillReductionPct - factionReductionPct - corpReductionPct).toFixed(4))
  );

  const usingUpwellCustom = Boolean(params.useCustomUpwellBroker);
  const upwellBrokerPct = Math.max(0, Number(params.customUpwellBrokerPct ?? 1.0));
  const sccSurchargePct = usingUpwellCustom && params.includeSccSurcharge !== false ? 0.5 : 0;
  const effectiveTotalBrokerPct = usingUpwellCustom
    ? Number((upwellBrokerPct + sccSurchargePct).toFixed(4))
    : effectiveNpcBrokerPct;

  return {
    hubId: owner.hubId,
    hubName: owner.hubName,
    brokerRelationsLvl: lvl,
    factionStanding: Number(factionStanding.toFixed(2)),
    corpStanding: Number(corpStanding.toFixed(2)),
    factionName: owner.npcFactionName,
    corpName: owner.npcCorpName,
    basePct,
    skillReductionPct,
    factionReductionPct,
    corpReductionPct,
    effectiveNpcBrokerPct,
    usingUpwellCustom,
    upwellBrokerPct,
    sccSurchargePct,
    effectiveTotalBrokerPct,
  };
}

export function resolveHubIdFromSystemOrRegion(
  systemNameOrId?: string | number,
  regionId?: number
): TradeHubId {
  if (typeof systemNameOrId === 'number') {
    if (systemNameOrId === 30002187) return 'amarr';
    if (systemNameOrId === 30002659) return 'dodixie';
    if (systemNameOrId === 30002510) return 'rens';
    if (systemNameOrId === 30002053) return 'hek';
    if (systemNameOrId === 30000142) return 'jita';
  } else if (typeof systemNameOrId === 'string') {
    const lower = systemNameOrId.toLowerCase();
    if (lower.includes('amarr')) return 'amarr';
    if (lower.includes('dodixie')) return 'dodixie';
    if (lower.includes('rens')) return 'rens';
    if (lower.includes('hek')) return 'hek';
    if (lower.includes('jita')) return 'jita';
  }
  if (regionId === 10000043) return 'amarr';
  if (regionId === 10000032) return 'dodixie';
  if (regionId === 10000030) return 'rens';
  if (regionId === 10000042) return 'hek';
  return 'jita';
}

// --- Safe DOTLAN External Map Links ---

function sanitizeDotlanSegment(name: string): string {
  return encodeURIComponent(name.trim().replace(/\s+/g, '_'));
}

export function getDotlanSystemUrl(systemName: string): string {
  const clean = (systemName || 'Jita').trim();
  return `https://evemaps.dotlan.net/system/${sanitizeDotlanSegment(clean)}`;
}

export function getDotlanRegionUrl(regionName: string): string {
  const clean = (regionName || 'The Forge').trim();
  return `https://evemaps.dotlan.net/map/${sanitizeDotlanSegment(clean)}`;
}

export function getDotlanRouteUrl(originSystem: string, destSystem: string): string {
  const orig = sanitizeDotlanSegment(originSystem || 'Jita');
  const dest = sanitizeDotlanSegment(destSystem || 'Dodixie');
  return `https://evemaps.dotlan.net/route/${orig}:${dest}`;
}

export function getDotlanMultiRouteUrl(systems: string[]): string {
  const uniqueSequential: string[] = [];
  for (const s of systems) {
    const clean = (s || '').trim();
    if (!clean) continue;
    if (uniqueSequential[uniqueSequential.length - 1] !== clean) {
      uniqueSequential.push(clean);
    }
  }
  if (uniqueSequential.length === 0) return getDotlanSystemUrl('Jita');
  if (uniqueSequential.length === 1) return getDotlanSystemUrl(uniqueSequential[0]);
  return `https://evemaps.dotlan.net/route/${uniqueSequential.map(sanitizeDotlanSegment).join(':')}`;
}
