import { CORRIDOR_SYSTEMS, EVE_ANCHORS, ITEM_BY_ID } from '../data/eveCatalog.ts';
import {
  assessGankRisk,
  classifyCategoryToCargoBucket,
  createEmptyCargoBuckets,
  evaluateHullForCargo,
} from '../data/eveFleetCatalog.ts';
import type {
  ActionCardData,
  AutoFillLoopSummary,
  CargoBucket,
  EndHubTarget,
  HangarHull,
  HotSystemIntel,
  OptimizedRouteResult,
  OptimizedStop,
  RouteChain,
  RouteItemSpec,
  RouteLeg,
  RoutingPreference,
} from '../types/eve.ts';

export interface RouteIntelMatrix {
  distances: Record<string, number>;
  waypointsByPair: Record<string, number[]>;
  hotSystemsByPair: Record<string, HotSystemIntel[]>;
  killFeedUpdatedAt?: string;
}

// Client-side in-memory cache for ESI route jump counts, waypoints & kill intel
// Keyed by `${origin}:${destination}:${preference}:${avoidKey}`
interface CachedPairIntel {
  jumps: number;
  waypoints: number[];
  hotSystems: HotSystemIntel[];
  fetchedAt: number;
}

const clientRouteCache = new Map<string, CachedPairIntel>();
const CLIENT_INTEL_TTL_MS = 5 * 60 * 1000; // Refresh kill intel after 5 minutes

export interface KnownHub {
  systemId: number;
  name: string;
  label: string;
}

export const KNOWN_EVE_SYSTEMS: KnownHub[] = [
  { systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID, name: 'Ishisomo', label: 'Ishisomo (Home Indy)' },
  { systemId: EVE_ANCHORS.JITA_SYSTEM_ID, name: 'Jita', label: 'Jita (The Forge)' },
  { systemId: EVE_ANCHORS.DODIXIE_SYSTEM_ID, name: 'Dodixie', label: 'Dodixie (Sinq Laison)' },
  { systemId: 30002187, name: 'Amarr', label: 'Amarr (Domain)' },
  { systemId: 30002510, name: 'Rens', label: 'Rens (Heimatar)' },
  { systemId: 30002053, name: 'Hek', label: 'Hek (Metropolis)' },
  ...CORRIDOR_SYSTEMS.filter((s) => s.systemId !== EVE_ANCHORS.ISHISOMO_SYSTEM_ID).map((s) => ({
    systemId: s.systemId,
    name: s.name,
    label: `${s.name} (${s.jumpsFromJita}j Jita)`,
  })),
];

export function matchKnownSystem(query: string): KnownHub | null {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    return KNOWN_EVE_SYSTEMS.find((s) => s.systemId === id) ?? null;
  }
  const lower = trimmed.toLowerCase();
  const exact = KNOWN_EVE_SYSTEMS.find((s) => s.name.toLowerCase() === lower);
  if (exact) return exact;
  return KNOWN_EVE_SYSTEMS.find((s) => s.name.toLowerCase().startsWith(lower)) ?? null;
}

/**
 * Fetches any uncached origin->destination jump distances, intermediate waypoints,
 * and live ESI system_kills gatecamp intel from `/api/route/distances`
 * and caches results in memory.
 */
export async function ensureRouteIntelLoaded(
  systemIds: number[],
  preference: RoutingPreference,
  avoidSystems: number[] = []
): Promise<RouteIntelMatrix> {
  const uniqueIds = Array.from(new Set(systemIds.filter((id) => Number.isInteger(id) && id > 0)));
  const cleanAvoid = Array.from(
    new Set(avoidSystems.filter((id) => Number.isInteger(id) && id > 0))
  ).sort((a, b) => a - b);
  const avoidKey = cleanAvoid.join(',');

  const missingPairs: { origin: number; destination: number }[] = [];
  const distances: Record<string, number> = {};
  const waypointsByPair: Record<string, number[]> = {};
  const hotSystemsByPair: Record<string, HotSystemIntel[]> = {};
  const now = Date.now();

  for (const a of uniqueIds) {
    for (const b of uniqueIds) {
      const pairKey = `${a}:${b}`;
      if (a === b) {
        distances[pairKey] = 0;
        waypointsByPair[pairKey] = [a];
        hotSystemsByPair[pairKey] = [];
        continue;
      }
      const cacheKey = `${pairKey}:${preference}:${avoidKey}`;
      const cached = clientRouteCache.get(cacheKey);
      if (cached && now - cached.fetchedAt < CLIENT_INTEL_TTL_MS) {
        distances[pairKey] = cached.jumps;
        waypointsByPair[pairKey] = cached.waypoints;
        hotSystemsByPair[pairKey] = cached.hotSystems;
      } else {
        missingPairs.push({ origin: a, destination: b });
      }
    }
  }

  let killFeedUpdatedAt: string | undefined;

  if (missingPairs.length > 0) {
    const res = await fetch('/api/route/distances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairs: missingPairs,
        preference,
        avoidSystems: cleanAvoid,
      }),
    });

    if (res.ok) {
      const json = (await res.json()) as {
        distances?: Record<string, number>;
        waypointsByPair?: Record<string, number[]>;
        hotSystemsByPair?: Record<string, HotSystemIntel[]>;
        killFeedUpdatedAt?: string;
      };
      killFeedUpdatedAt = json.killFeedUpdatedAt;

      const respDistances = json.distances ?? {};
      const respWaypoints = json.waypointsByPair ?? {};
      const respHot = json.hotSystemsByPair ?? {};

      for (const [pairKey, jumps] of Object.entries(respDistances)) {
        if (typeof jumps === 'number' && Number.isFinite(jumps)) {
          const waypoints = respWaypoints[pairKey] ?? [];
          const hotSystems = respHot[pairKey] ?? [];
          clientRouteCache.set(`${pairKey}:${preference}:${avoidKey}`, {
            jumps,
            waypoints,
            hotSystems,
            fetchedAt: Date.now(),
          });
          distances[pairKey] = jumps;
          waypointsByPair[pairKey] = waypoints;
          hotSystemsByPair[pairKey] = hotSystems;
        }
      }
    }
  }

  return { distances, waypointsByPair, hotSystemsByPair, killFeedUpdatedAt };
}

function getJumpDistance(
  origin: number,
  destination: number,
  distances: Record<string, number>
): number {
  if (origin === destination) return 0;
  const key = `${origin}:${destination}`;
  if (distances[key] !== undefined) return distances[key];
  return 4;
}

function resolveItemCargoBucket(item: RouteItemSpec): CargoBucket {
  if (item.cargoBucket) return item.cargoBucket;
  if (item.typeId && ITEM_BY_ID[item.typeId]) {
    return classifyCategoryToCargoBucket(ITEM_BY_ID[item.typeId].category);
  }
  const lower = item.name.toLowerCase();
  if (lower.includes('ore') || lower.includes('veldspar') || lower.includes('scordite') || lower.includes('pyroxeres') || lower.includes('plagioclase')) {
    return 'ores';
  }
  if (lower.includes('ice') || lower.includes('isotope') || lower.includes('heavy water')) {
    return 'ice';
  }
  if (lower.includes('fuel block')) return 'infrastructure';
  if (lower.includes('shuttle')) return 'ships';
  if (lower.includes('missile') || lower.includes('charge') || lower.includes('bomb') || lower.includes('probe') || lower.includes('script')) {
    return 'ammo';
  }
  return 'general';
}

function mergeManifestItems(existing: RouteItemSpec[], incoming: RouteItemSpec[]): RouteItemSpec[] {
  const map = new Map<string, RouteItemSpec>();
  for (const item of [...existing, ...incoming]) {
    const key = item.typeId ? `id:${item.typeId}` : `name:${item.name.toLowerCase()}`;
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        ...prev,
        quantity: prev.quantity + item.quantity,
        iskAmount: prev.iskAmount + item.iskAmount,
        volumeM3: prev.volumeM3 + item.volumeM3,
      });
    } else {
      map.set(key, { ...item, cargoBucket: resolveItemCargoBucket(item) });
    }
  }
  return Array.from(map.values()).sort((a, b) => b.iskAmount - a.iskAmount);
}

function addBuckets(
  target: Record<CargoBucket, number>,
  items: RouteItemSpec[],
  sign: 1 | -1
): Record<CargoBucket, number> {
  const next = { ...target };
  for (const item of items) {
    const b = resolveItemCargoBucket(item);
    next[b] = Math.max(0, (next[b] || 0) + sign * Math.max(0, item.volumeM3 || 0));
  }
  return next;
}

function maxBuckets(
  a: Record<CargoBucket, number>,
  b: Record<CargoBucket, number>
): Record<CargoBucket, number> {
  const out = createEmptyCargoBuckets();
  (Object.keys(out) as CargoBucket[]).forEach((k) => {
    out[k] = Math.max(a[k] || 0, b[k] || 0);
  });
  return out;
}

function sumBuckets(b: Record<CargoBucket, number>): number {
  return (Object.keys(b) as CargoBucket[]).reduce((s, k) => s + (b[k] || 0), 0);
}

/**
 * Precedence-constrained multi-stop route optimizer with live ESI gatecamp intel,
 * specialized cargo bay tracking, and per-leg ISK gank-risk evaluation.
 */
export function optimizeQueuedRoute(params: {
  selectedCards: ActionCardData[];
  originSystemId: number;
  originSystemName: string;
  originStationId?: number;
  originStationName?: string;
  endHub?: EndHubTarget;
  preference: RoutingPreference;
  avoidHotSystems: boolean;
  maxCargoM3: number;
  activeHull?: HangarHull | null;
  routeIntel: RouteIntelMatrix;
}): OptimizedRouteResult {
  const {
    selectedCards,
    originSystemId,
    originSystemName,
    originStationId,
    originStationName,
    endHub,
    preference,
    avoidHotSystems,
    maxCargoM3,
    activeHull,
    routeIntel,
  } = params;

  const activeChains: { chain: RouteChain; nextIdx: number; inHoldIsk: number }[] = [];
  for (const card of selectedCards) {
    for (const chain of card.routeChains || []) {
      if (chain.legs.length > 0) {
        activeChains.push({ chain, nextIdx: 0, inHoldIsk: 0 });
      }
    }
  }

  if (activeChains.length === 0) {
    return {
      originSystemId,
      originSystemName,
      endHub,
      preference,
      avoidHotSystems,
      maxCargoM3,
      stops: [],
      totalJumps: 0,
      netIskPerJump: 0,
      totalBuyIsk: 0,
      totalSellIsk: 0,
      totalNetProfitIsk: 0,
      peakCargoM3: 0,
      peakCargoIsk: 0,
      peakCargoByBucket: createEmptyCargoBuckets(),
      overCapacityStops: 0,
      gankRiskStops: 0,
      totalHotSystemsFlagged: 0,
      hotSystemIdsOnRoute: [],
    };
  }

  const stops: OptimizedStop[] = [];
  let currentSystemId = originSystemId;
  let runningCargoM3 = 0;
  let runningCargoIsk = 0;
  let runningBuckets = createEmptyCargoBuckets();
  let cumulativeNetProfitIsk = 0;
  let totalJumps = 0;
  let totalBuyIsk = 0;
  let totalSellIsk = 0;
  let overallPeakCargoM3 = 0;
  let overallPeakCargoIsk = 0;
  let overallPeakBuckets = createEmptyCargoBuckets();
  let overCapacityStops = 0;
  let gankRiskStops = 0;
  const allHotSystemIds = new Set<number>();

  let safety = 0;
  while (safety++ < 120) {
    const remaining = activeChains.filter((c) => c.nextIdx < c.chain.legs.length);
    if (remaining.length === 0) break;

    const stationBuckets = new Map<
      string,
      {
        systemId: number;
        systemName: string;
        stationId?: number;
        stationName: string;
        legs: { entry: { chain: RouteChain; nextIdx: number; inHoldIsk: number }; leg: RouteLeg }[];
      }
    >();

    for (const entry of remaining) {
      const leg = entry.chain.legs[entry.nextIdx];
      const key = `${leg.systemId}::${leg.stationName}`;
      const bucket = stationBuckets.get(key) ?? {
        systemId: leg.systemId,
        systemName: leg.systemName,
        stationId: leg.stationId,
        stationName: leg.stationName,
        legs: [],
      };
      if (!bucket.stationId && leg.stationId) bucket.stationId = leg.stationId;
      bucket.legs.push({ entry, leg });
      stationBuckets.set(key, bucket);
    }

    let bestBucket = Array.from(stationBuckets.values())[0];
    let bestJumps = getJumpDistance(currentSystemId, bestBucket.systemId, routeIntel.distances);
    let bestHasSell = bestBucket.legs.some((l) => l.leg.action === 'sell');
    let bestCount = bestBucket.legs.length;

    for (const bucket of stationBuckets.values()) {
      const jumps = getJumpDistance(currentSystemId, bucket.systemId, routeIntel.distances);
      const hasSell = bucket.legs.some((l) => l.leg.action === 'sell');
      const count = bucket.legs.length;

      const isBetter =
        jumps < bestJumps ||
        (jumps === bestJumps && hasSell && !bestHasSell) ||
        (jumps === bestJumps && hasSell === bestHasSell && count > bestCount);

      if (isBetter) {
        bestBucket = bucket;
        bestJumps = jumps;
        bestHasSell = hasSell;
        bestCount = count;
      }
    }

    const pairKey = `${currentSystemId}:${bestBucket.systemId}`;
    const waypointsFromPrev =
      routeIntel.waypointsByPair[pairKey] ?? [currentSystemId, bestBucket.systemId];
    const hotSystems = routeIntel.hotSystemsByPair[pairKey] ?? [];
    for (const hs of hotSystems) {
      allHotSystemIds.add(hs.systemId);
    }

    const chosenKey = `${bestBucket.systemId}::${bestBucket.stationName}`;
    let stopBuys: RouteItemSpec[] = [];
    let stopSells: RouteItemSpec[] = [];
    const stopProcesses: { cardTitle: string; note: string; unloadM3: number; loadM3: number }[] = [];
    let stopBuyIsk = 0;
    let stopSellIsk = 0;
    let stopNetProfitIsk = 0;

    // Track peak cargo & cargo ISK value arriving at OR departing from this stop
    let stopPeakCargoM3 = runningCargoM3;
    let stopPeakBuckets = { ...runningBuckets };
    let stopPeakCargoIsk = runningCargoIsk;

    let progressedAtStation = true;
    while (progressedAtStation) {
      progressedAtStation = false;
      const actionOrder: RouteLeg['action'][] = ['sell', 'process', 'buy'];

      for (const act of actionOrder) {
        for (const entry of activeChains) {
          if (entry.nextIdx >= entry.chain.legs.length) continue;
          const leg = entry.chain.legs[entry.nextIdx];
          const legKey = `${leg.systemId}::${leg.stationName}`;
          if (legKey !== chosenKey || leg.action !== act) continue;

          if (leg.action === 'buy') {
            stopBuys = mergeManifestItems(stopBuys, leg.items);
            const legCost = leg.iskCost ?? leg.items.reduce((s, it) => s + it.iskAmount, 0);
            stopBuyIsk += legCost;
            runningCargoM3 = Math.max(0, runningCargoM3 + leg.cargoDeltaM3);
            runningBuckets = addBuckets(runningBuckets, leg.items, 1);

            // Only count ISK in hold if this chain actually transits to another system/station
            const nextLeg = entry.chain.legs[entry.nextIdx + 1];
            const staysAtSameStation =
              nextLeg &&
              nextLeg.systemId === leg.systemId &&
              nextLeg.stationName === leg.stationName;
            if (!staysAtSameStation) {
              entry.inHoldIsk += legCost;
              runningCargoIsk += legCost;
            }

            stopPeakCargoM3 = Math.max(stopPeakCargoM3, runningCargoM3, sumBuckets(runningBuckets));
            stopPeakBuckets = maxBuckets(stopPeakBuckets, runningBuckets);
            stopPeakCargoIsk = Math.max(stopPeakCargoIsk, runningCargoIsk);
          } else if (leg.action === 'process') {
            const unloadM3 = leg.items.reduce((s, it) => s + (it.volumeM3 > 0 ? it.volumeM3 : 0), 0);
            const nextCargo = Math.max(0, runningCargoM3 + leg.cargoDeltaM3);
            const loadM3 = Math.max(0, unloadM3 + leg.cargoDeltaM3);
            stopProcesses.push({
              cardTitle: entry.chain.cardTitle,
              note: leg.processNote || 'Deliver inputs & load finished output',
              unloadM3,
              loadM3,
            });

            // Remove input buckets and load next sell leg's output buckets
            runningBuckets = addBuckets(runningBuckets, leg.items, -1);
            const nextSellLeg = entry.chain.legs[entry.nextIdx + 1];
            if (nextSellLeg?.items) {
              runningBuckets = addBuckets(runningBuckets, nextSellLeg.items, 1);
            }

            stopPeakCargoM3 = Math.max(stopPeakCargoM3, runningCargoM3, nextCargo, sumBuckets(runningBuckets));
            stopPeakBuckets = maxBuckets(stopPeakBuckets, runningBuckets);
            runningCargoM3 = nextCargo;

            // Update carried ISK value to finished output payout when departing factory
            if (nextSellLeg && nextSellLeg.action === 'sell') {
              const outVal =
                nextSellLeg.iskPayout ??
                nextSellLeg.items.reduce((s, it) => s + it.iskAmount, 0);
              runningCargoIsk = Math.max(0, runningCargoIsk - entry.inHoldIsk + outVal);
              entry.inHoldIsk = outVal;
              stopPeakCargoIsk = Math.max(stopPeakCargoIsk, runningCargoIsk);
            }
          } else if (leg.action === 'sell') {
            stopSells = mergeManifestItems(stopSells, leg.items);
            const legPayout = leg.iskPayout ?? leg.items.reduce((s, it) => s + it.iskAmount, 0);
            stopSellIsk += legPayout;
            stopNetProfitIsk += leg.netProfitIsk ?? 0;
            runningCargoM3 = Math.max(0, runningCargoM3 + leg.cargoDeltaM3);
            runningBuckets = addBuckets(runningBuckets, leg.items, -1);
            runningCargoIsk = Math.max(0, runningCargoIsk - entry.inHoldIsk);
            entry.inHoldIsk = 0;
          }

          entry.nextIdx += 1;
          progressedAtStation = true;
        }
      }
    }

    totalJumps += bestJumps;
    totalBuyIsk += stopBuyIsk;
    totalSellIsk += stopSellIsk;
    cumulativeNetProfitIsk += stopNetProfitIsk;
    overallPeakCargoM3 = Math.max(overallPeakCargoM3, stopPeakCargoM3, runningCargoM3);
    overallPeakCargoIsk = Math.max(overallPeakCargoIsk, stopPeakCargoIsk);
    overallPeakBuckets = maxBuckets(overallPeakBuckets, stopPeakBuckets);

    // Evaluate over-capacity using specialized bays + fitted general cargo when a hull is active
    let isOverCapacity = false;
    if (activeHull) {
      const fitEval = evaluateHullForCargo(activeHull, stopPeakBuckets);
      isOverCapacity = !fitEval.fits || (maxCargoM3 > 0 && stopPeakCargoM3 > Math.max(maxCargoM3, fitEval.effectiveCapacityM3));
    } else {
      isOverCapacity = maxCargoM3 > 0 && (stopPeakCargoM3 > maxCargoM3 || runningCargoM3 > maxCargoM3);
    }
    if (isOverCapacity) overCapacityStops += 1;

    // Evaluate ISK Gank-Risk Threshold for this stop/leg
    const gankRisk = assessGankRisk(stopPeakCargoIsk, activeHull);
    if (gankRisk.level !== 'safe') gankRiskStops += 1;

    stops.push({
      stopNumber: stops.length + 1,
      systemId: bestBucket.systemId,
      systemName: bestBucket.systemName,
      stationId: bestBucket.stationId,
      stationName: bestBucket.stationName,
      destinationId: bestBucket.stationId ?? bestBucket.systemId,
      jumpsFromPrev: bestJumps,
      waypointsFromPrev,
      hotSystems,
      buys: stopBuys,
      totalBuyIsk: stopBuyIsk,
      processes: stopProcesses,
      sells: stopSells,
      totalSellIsk: stopSellIsk,
      peakCargoM3: stopPeakCargoM3,
      endingCargoM3: runningCargoM3,
      transitCargoIsk: stopPeakCargoIsk,
      peakCargoByBucket: stopPeakBuckets,
      isOverCapacity,
      gankRisk,
      stopNetProfitIsk,
      cumulativeNetProfitIsk,
    });

    currentSystemId = bestBucket.systemId;
  }

  // Optional End Station / Return Hub leg calculation
  let returnLegJumps = 0;
  let returnLegDestinationId: number | undefined;
  let returnLegStationName: string | undefined;
  let returnLegSystemName: string | undefined;

  if (endHub && endHub.mode !== 'any' && stops.length > 0) {
    const targetSysId =
      endHub.mode === 'return_to_start' ? originSystemId : endHub.systemId;
    const targetSysName =
      endHub.mode === 'return_to_start' ? originSystemName : endHub.systemName;
    const targetStationId =
      endHub.mode === 'return_to_start' ? originStationId : endHub.stationId;
    const targetStationName =
      endHub.mode === 'return_to_start'
        ? originStationName || `${originSystemName} Start Station`
        : endHub.stationName || `${targetSysName || 'End Hub'} Station`;

    if (targetSysId && targetSysId > 0 && currentSystemId !== targetSysId) {
      returnLegJumps = getJumpDistance(currentSystemId, targetSysId, routeIntel.distances);
      totalJumps += returnLegJumps;
      returnLegDestinationId = targetStationId ?? targetSysId;
      returnLegStationName = targetStationName;
      returnLegSystemName = targetSysName;
    }
  }

  const netIskPerJump =
    totalJumps > 0 ? cumulativeNetProfitIsk / totalJumps : cumulativeNetProfitIsk;

  return {
    originSystemId,
    originSystemName,
    endHub,
    returnLegJumps: returnLegJumps > 0 ? returnLegJumps : undefined,
    returnLegDestinationId,
    returnLegStationName,
    returnLegSystemName,
    preference,
    avoidHotSystems,
    maxCargoM3,
    stops,
    totalJumps,
    netIskPerJump,
    totalBuyIsk,
    totalSellIsk,
    totalNetProfitIsk: cumulativeNetProfitIsk,
    peakCargoM3: overallPeakCargoM3,
    peakCargoIsk: overallPeakCargoIsk,
    peakCargoByBucket: overallPeakBuckets,
    overCapacityStops,
    gankRiskStops,
    totalHotSystemsFlagged: allHotSystemIds.size,
    hotSystemIdsOnRoute: Array.from(allHotSystemIds),
  };
}

/**
 * Auto-Fill Best Loop Solver:
 * Evaluates all visible profitable opportunity cards and finds the optimal combination that:
 * (a) Fits 100% inside the selected hull's specialized bays + general cargo/fleet hangar m3 across every leg,
 * (b) Stays within available liquid wallet ISK and the Max Cargo ISK gank-risk ceiling on every leg,
 * (c) Maximizes True After-Tax Net ISK per Jump while bundling shared pickup/drop-off stations and honoring optional End Hub.
 */
export function solveBestLoop(params: {
  candidateCards: ActionCardData[];
  originSystemId: number;
  originSystemName: string;
  originStationId?: number;
  originStationName?: string;
  endHub: EndHubTarget;
  preference: RoutingPreference;
  avoidHotSystems: boolean;
  maxCargoM3: number;
  activeHull: HangarHull | null;
  availableWalletIsk: number;
  maxCargoIskRiskCap: number;
  routeIntel: RouteIntelMatrix;
}): AutoFillLoopSummary {
  const {
    candidateCards,
    originSystemId,
    originSystemName,
    originStationId,
    originStationName,
    endHub,
    preference,
    avoidHotSystems,
    maxCargoM3,
    activeHull,
    availableWalletIsk,
    maxCargoIskRiskCap,
    routeIntel,
  } = params;

  const eligible = candidateCards.filter(
    (c) =>
      c.netProfitIsk > 0 &&
      Array.isArray(c.routeChains) &&
      c.routeChains.some((ch) => ch.legs.length > 0)
  );

  if (eligible.length === 0) {
    return {
      selectedCardIds: [],
      evaluatedCardCount: 0,
      totalNetProfitIsk: 0,
      totalJumps: 0,
      netIskPerJump: 0,
      totalBuyIsk: 0,
      peakCargoM3: 0,
      peakCargoIsk: 0,
      reason: 'No profitable opportunity cards with executable trade routes are currently visible.',
    };
  }

  const walletCap = Math.max(0, availableWalletIsk);
  const gankCap = Math.max(0, maxCargoIskRiskCap);

  const evaluateSubset = (cards: ActionCardData[]) => {
    const res = optimizeQueuedRoute({
      selectedCards: cards,
      originSystemId,
      originSystemName,
      originStationId,
      originStationName,
      endHub,
      preference,
      avoidHotSystems,
      maxCargoM3,
      activeHull,
      routeIntel,
    });

    if (res.stops.length === 0 || res.totalNetProfitIsk <= 0) return null;
    // (a) 100% hull specialized bays + general cargo/fleet hangar fit across every leg
    if (res.overCapacityStops > 0) return null;
    if (activeHull) {
      for (const stop of res.stops) {
        const fit = evaluateHullForCargo(activeHull, stop.peakCargoByBucket);
        if (!fit.fits) return null;
      }
    } else if (maxCargoM3 > 0 && res.peakCargoM3 > maxCargoM3) {
      return null;
    }

    // (b) Liquid wallet ISK & Max Cargo ISK gank-risk ceiling on every leg
    if (res.totalBuyIsk > walletCap) return null;
    if (gankCap > 0 && res.peakCargoIsk > gankCap) return null;

    const effectiveJumps = Math.max(1, res.totalJumps);
    const iskPerJump = res.totalNetProfitIsk / effectiveJumps;
    const conflictPenalty = cards.some((c) => (c.activeOrderConflicts?.length ?? 0) > 0)
      ? 0.96
      : 1.0;

    // Primary objective: True After-Tax Net ISK / Jump; slight bonus for bundling profit on same jumps
    const score = iskPerJump * conflictPenalty + res.totalNetProfitIsk * 0.0001;
    return { cards, res, iskPerJump, score };
  };

  // Pre-filter individually feasible cards & group by shared pickup->dropoff signature for corridor bundling
  type EvalCandidate = NonNullable<ReturnType<typeof evaluateSubset>>;
  const feasibleSingles: EvalCandidate[] = [];
  const corridorClusters = new Map<string, ActionCardData[]>();

  for (const card of eligible) {
    const ev = evaluateSubset([card]);
    if (!ev) continue;
    feasibleSingles.push(ev);

    const sysSig = Array.from(
      new Set(
        card.routeChains.flatMap((ch) => ch.legs.map((l) => l.systemId))
      )
    )
      .sort((a, b) => a - b)
      .join('-');
    const arr = corridorClusters.get(sysSig) ?? [];
    arr.push(card);
    corridorClusters.set(sysSig, arr);
  }

  if (feasibleSingles.length === 0) {
    return {
      selectedCardIds: [],
      evaluatedCardCount: eligible.length,
      totalNetProfitIsk: 0,
      totalJumps: 0,
      netIskPerJump: 0,
      totalBuyIsk: 0,
      peakCargoM3: 0,
      peakCargoIsk: 0,
      reason:
        'No visible profitable card fits within your current hull bays, liquid wallet ISK, and Max Cargo ISK gank-risk cap. Try selecting a larger hull or raising the risk cap.',
    };
  }

  feasibleSingles.sort((a, b) => b.score - a.score);
  const pool = feasibleSingles.slice(0, 28).map((s) => s.cards[0]);

  const expandGreedy = (seedCards: ActionCardData[]): EvalCandidate | null => {
    let current = evaluateSubset(seedCards);
    if (!current) return null;

    const usedIds = new Set(seedCards.map((c) => c.id));
    let improved = true;

    while (improved && current.cards.length < 12) {
      improved = false;
      let bestNext: EvalCandidate | null = null;

      for (const candidate of pool) {
        if (usedIds.has(candidate.id)) continue;
        // Quick pruning before full route simulation
        if (current.res.totalBuyIsk + candidate.requiredCapitalIsk > walletCap) continue;

        const nextEval = evaluateSubset([...current.cards, candidate]);
        if (!nextEval) continue;

        // Accept if it improves Net ISK/Jump score, OR bundles onto the exact same or fewer jumps with strictly more net profit
        const sameJumpsMoreProfit =
          nextEval.res.totalJumps <= current.res.totalJumps &&
          nextEval.res.totalNetProfitIsk > current.res.totalNetProfitIsk;

        if (
          (nextEval.score > current.score || sameJumpsMoreProfit) &&
          (!bestNext || nextEval.score > bestNext.score)
        ) {
          bestNext = nextEval;
        }
      }

      if (bestNext) {
        current = bestNext;
        usedIds.add(bestNext.cards[bestNext.cards.length - 1].id);
        improved = true;
      }
    }

    // 1-drop local polish to remove any detour card that drags down Net ISK/Jump
    if (current.cards.length > 1) {
      let pruned = true;
      while (pruned && current.cards.length > 1) {
        pruned = false;
        for (let i = 0; i < current.cards.length; i++) {
          const reduced = current.cards.filter((_, idx) => idx !== i);
          const ev = evaluateSubset(reduced);
          if (ev && ev.score > current.score) {
            current = ev;
            pruned = true;
            break;
          }
        }
      }
    }

    return current;
  };

  let globalBest: EvalCandidate = feasibleSingles[0];

  // Multi-start from top single cards
  for (const single of feasibleSingles.slice(0, 10)) {
    const expanded = expandGreedy(single.cards);
    if (expanded && expanded.score > globalBest.score) {
      globalBest = expanded;
    }
  }

  // Also seed from shared-station corridor clusters (packs multiple cards sharing Jita<->Ishisomo or Jita<->Dodixie)
  for (const clusterCards of corridorClusters.values()) {
    if (clusterCards.length < 2) continue;
    const sortedCluster = [...clusterCards].sort((a, b) => b.netProfitIsk - a.netProfitIsk);
    const seed: ActionCardData[] = [];
    for (const c of sortedCluster) {
      const test = evaluateSubset([...seed, c]);
      if (test) seed.push(c);
    }
    if (seed.length > 0) {
      const expanded = expandGreedy(seed);
      if (expanded && expanded.score > globalBest.score) {
        globalBest = expanded;
      }
    }
  }

  const endDesc =
    endHub.mode === 'return_to_start'
      ? `returning to ${originSystemName}`
      : endHub.mode === 'custom' && endHub.systemName
        ? `ending at ${endHub.systemName}`
        : 'open destination';

  return {
    selectedCardIds: globalBest.cards.map((c) => c.id),
    evaluatedCardCount: eligible.length,
    totalNetProfitIsk: globalBest.res.totalNetProfitIsk,
    totalJumps: globalBest.res.totalJumps,
    netIskPerJump: globalBest.iskPerJump,
    totalBuyIsk: globalBest.res.totalBuyIsk,
    peakCargoM3: globalBest.res.peakCargoM3,
    peakCargoIsk: globalBest.res.peakCargoIsk,
    reason: `Bundled ${globalBest.cards.length} of ${eligible.length} profitable cards (${endDesc}) fitting 100% within hull bays, wallet, and gank-risk cap.`,
  };
}
