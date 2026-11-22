import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BookmarkCheck,
  Bot,
  Check,
  CheckSquare,
  Compass,
  Copy,
  Download,
  ExternalLink,
  Flame,
  Map as MapIcon,
  MapPin,
  Navigation,
  PanelRightClose,
  Printer,
  RefreshCw,
  RotateCcw,
  Send,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Ship,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import { EVE_ANCHORS, EVE_ITEMS } from '../data/eveCatalog.ts';
import {
  assessGankRisk,
  evaluateHullForCargo,
  recommendBestHullFromFleet,
} from '../data/eveFleetCatalog.ts';
import { formatIsk, formatM3, getHubQuote } from '../engines/decisionEngines.ts';
import { getDotlanMultiRouteUrl, resolveHubIdFromSystemOrRegion } from '../utils/dotlan.ts';
import { buildDepthAwareOrderLines } from '../utils/v22Engines.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  AutoFillLoopSummary,
  EndHubTarget,
  HangarHull,
  MarketSnapshot,
  OptimizedRouteResult,
  RoutingPreference,
  SavedRouteRecord,
} from '../types/eve.ts';
import {
  KNOWN_EVE_SYSTEMS,
  ensureRouteIntelLoaded,
  matchKnownSystem,
  optimizeQueuedRoute,
  solveBestLoop,
} from '../utils/routeOptimizer.ts';
import type { RouteIntelMatrix } from '../utils/routeOptimizer.ts';
import { copyTextToClipboard, formatEveMultibuyText } from '../utils/eveMultibuy.ts';
import { VisualRouteMap } from './VisualRouteMap.tsx';

type EndHubChoice =
  | 'any'
  | 'return_to_start'
  | 'jita'
  | 'dodixie'
  | 'ishisomo'
  | 'amarr';

interface RouteOptimizerSidebarProps {
  queuedCards: ActionCardData[];
  allCandidateCards: ActionCardData[];
  snapshot?: MarketSnapshot;
  appSettings?: AppSettingsV22;
  savedRoutes?: SavedRouteRecord[];
  onSaveCommittedRoute?: (record: SavedRouteRecord) => void;
  onMarkRouteCompleted?: (id: string) => void;
  onDeleteSavedRoute?: (id: string) => void;
  onRestoreRoute?: (record: SavedRouteRecord) => void;
  cardTransportMap?: Record<string, { transportIsk: number; minDesiredProfitIsk: number }>;
  haulOverrides?: Record<string, number>;
  onSetHaulOverride?: (cardId: string, haulCostIsk: number) => void;
  onClearHaulOverride?: (cardId: string) => void;
  pilotSystemId: number;
  pilotSystemName: string;
  pilotStationId?: number;
  pilotStationName: string;
  pilotMode: 'simulation' | 'eve_sso';
  eveAccessToken: string | null;
  walletBalance: number;
  activeSellOrderCount: number;
  isRefreshingWalletOrders: boolean;
  onRefreshWalletOrders: () => void;
  hulls: HangarHull[];
  onRemoveCard: (cardId: string) => void;
  onClearQueue: () => void;
  onSelectAllVisible: () => void;
  onApplyAutoFilledRoute: (cardIds: string[]) => void;
  onSwitchToAdvisor: () => void;
  onOpenSsoSettings: () => void;
  onCollapse: () => void;
}

const EMPTY_INTEL: RouteIntelMatrix = {
  distances: {},
  waypointsByPair: {},
  hotSystemsByPair: {},
};

export function RouteOptimizerSidebar({
  queuedCards,
  allCandidateCards,
  snapshot,
  appSettings,
  savedRoutes = [],
  onSaveCommittedRoute,
  onMarkRouteCompleted,
  onDeleteSavedRoute,
  onRestoreRoute,
  cardTransportMap = {},
  haulOverrides = {},
  onSetHaulOverride,
  onClearHaulOverride,
  pilotSystemId,
  pilotSystemName,
  pilotStationId,
  pilotStationName,
  pilotMode,
  eveAccessToken,
  walletBalance,
  activeSellOrderCount,
  isRefreshingWalletOrders,
  onRefreshWalletOrders,
  hulls,
  onRemoveCard,
  onClearQueue,
  onSelectAllVisible,
  onApplyAutoFilledRoute,
  onSwitchToAdvisor,
  onOpenSsoSettings,
  onCollapse,
}: RouteOptimizerSidebarProps) {
  const [lifecycleTab, setLifecycleTab] = useState<'live' | 'committed' | 'completed'>('live');
  const [commitRouteName, setCommitRouteName] = useState('');
  const [depthAwareCopy, setDepthAwareCopy] = useState(true);
  const [exportingDiscord, setExportingDiscord] = useState(false);

  // Manual starting hub override (null => live connected EVE character ESI location)
  const [overrideSystem, setOverrideSystem] = useState<{
    systemId: number;
    systemName: string;
  } | null>(null);
  const [hubInput, setHubInput] = useState<string>(pilotSystemName);
  const [hubLookupError, setHubLookupError] = useState<string | null>(null);
  const [isResolvingHub, setIsResolvingHub] = useState(false);

  // Optional End Station / Return Hub + Max Cargo ISK Risk Cap + Auto-Fill Solver state
  const [endHubChoice, setEndHubChoice] = useState<EndHubChoice>('any');
  const [maxCargoIskCapOverride, setMaxCargoIskCapOverride] = useState<number | null>(null);
  const [isSolvingLoop, setIsSolvingLoop] = useState(false);
  const [autoFillSummary, setAutoFillSummary] = useState<AutoFillLoopSummary | null>(null);

  // Routing Preference & Gatecamp Avoidance
  const [preference, setPreference] = useState<RoutingPreference>('Safer');
  const [avoidHotSystems, setAvoidHotSystems] = useState<boolean>(false);
  const [knownHotIdsToAvoid, setKnownHotIdsToAvoid] = useState<number[]>([]);

  // Selected Hull ('auto' uses Cargo-Type Matcher & Gank-Risk Recommender; or explicit hull.id)
  const [selectedHullId, setSelectedHullId] = useState<string>('auto');
  const [manualCargoOverride, setManualCargoOverride] = useState<number | null>(null);

  // Live ESI route + kill intel matrix
  const [routeIntel, setRouteIntel] = useState<RouteIntelMatrix>(EMPTY_INTEL);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  // Autopilot status & feedback toast
  const [autopilotBusyId, setAutopilotBusyId] = useState<string | null>(null);
  const [autopilotToast, setAutopilotToast] = useState<{
    kind: 'success' | 'warn' | 'error';
    message: string;
    needsSso?: boolean;
  } | null>(null);

  // Per-stop "Copy for EVE Multibuy" 2-second confirmation state
  const [copiedMultibuy, setCopiedMultibuy] = useState<{
    stopKey: string;
    itemCount: number;
  } | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopyStopMultibuy = async (
    stopKey: string,
    buys: { typeId?: number; name: string; quantity: number }[],
    stopSystemId?: number
  ) => {
    let text = '';
    let itemCount = buys.length;
    if (depthAwareCopy && snapshot) {
      const hubId = resolveHubIdFromSystemOrRegion(stopSystemId);
      const splitRes = buildDepthAwareOrderLines(
        buys.map((b) => ({ typeId: b.typeId, name: b.name, quantity: b.quantity, side: 'buy' as const })),
        snapshot,
        hubId
      );
      text = splitRes.eveMultibuyText;
      itemCount = splitRes.lines.length;
    } else {
      const res = formatEveMultibuyText(buys);
      text = res.text;
      itemCount = res.itemCount;
    }
    if (!text || itemCount === 0) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) {
      showToast('error', 'Clipboard access was blocked by the browser.');
      return;
    }
    setCopiedMultibuy({ stopKey, itemCount });
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedMultibuy((prev) => (prev?.stopKey === stopKey ? null : prev));
    }, 2000);
  };

  // Visual Route Map toggle + In-game EVE Market Details button busy state
  const [showRouteMap, setShowRouteMap] = useState<boolean>(true);
  const [marketBusyKey, setMarketBusyKey] = useState<string | null>(null);

  const handleOpenMarketInEve = async (
    rawTypeId: number | undefined,
    itemName: string,
    busyKey: string
  ) => {
    if (pilotMode !== 'eve_sso' || !eveAccessToken) {
      showToast(
        'warn',
        `Connect EVE SSO (with esi-ui.open_window.v1) to open "${itemName}" directly in your EVE Online Market window.`,
        true
      );
      return;
    }

    const resolvedTypeId =
      rawTypeId && rawTypeId > 0
        ? rawTypeId
        : EVE_ITEMS.find((it) => it.name.toLowerCase() === itemName.trim().toLowerCase())?.typeId;

    setMarketBusyKey(busyKey);
    try {
      const res = await fetch('/api/eve/ui/open-market', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eveAccessToken}`,
        },
        body: JSON.stringify({
          typeId: resolvedTypeId,
          itemName,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `ESI returned HTTP ${res.status}`);
      }
      showToast('success', `Opened "${itemName}" Market Details in your EVE Online client.`);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Unable to open Market Details window in EVE.',
        true
      );
    } finally {
      setMarketBusyKey(null);
    }
  };

  const originSystemId = overrideSystem?.systemId ?? pilotSystemId;
  const originSystemName = overrideSystem?.systemName ?? pilotSystemName;
  const originStationId = overrideSystem ? undefined : pilotStationId;
  const originStationName = overrideSystem ? undefined : pilotStationName;

  const endHub: EndHubTarget = useMemo(() => {
    switch (endHubChoice) {
      case 'return_to_start':
        return {
          mode: 'return_to_start',
          systemId: originSystemId,
          systemName: originSystemName,
          stationId: originStationId,
          stationName: originStationName || `${originSystemName} Station`,
        };
      case 'jita':
        return {
          mode: 'custom',
          systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
          systemName: 'Jita',
          stationId: EVE_ANCHORS.JITA_STATION_ID,
          stationName: EVE_ANCHORS.JITA_STATION_NAME,
        };
      case 'dodixie':
        return {
          mode: 'custom',
          systemId: EVE_ANCHORS.DODIXIE_SYSTEM_ID,
          systemName: 'Dodixie',
          stationId: EVE_ANCHORS.DODIXIE_STATION_ID,
          stationName: EVE_ANCHORS.DODIXIE_STATION_NAME,
        };
      case 'ishisomo':
        return {
          mode: 'custom',
          systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
          systemName: EVE_ANCHORS.ISHISOMO_SYSTEM_NAME,
          stationId: EVE_ANCHORS.ISHISOMO_MFG_STATION_ID,
          stationName: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
        };
      case 'amarr':
        return {
          mode: 'custom',
          systemId: 30002187,
          systemName: 'Amarr',
          stationId: 60008494,
          stationName: 'Amarr VIII (Oris) - Emperor Family Academy',
        };
      default:
        return { mode: 'any' };
    }
  }, [endHubChoice, originSystemId, originSystemName, originStationId, originStationName]);

  useEffect(() => {
    if (!overrideSystem) {
      setHubInput(pilotSystemName);
    }
  }, [pilotSystemName, overrideSystem]);

  // Collect all unique solar system IDs across queued cards, origin, end hub, AND parked fleet hulls
  const requiredSystemIds = useMemo(() => {
    const ids = new Set<number>([originSystemId]);
    if (endHub.systemId && endHub.systemId > 0) ids.add(endHub.systemId);
    for (const card of queuedCards) {
      for (const chain of card.routeChains || []) {
        for (const leg of chain.legs) {
          if (leg.systemId > 0) ids.add(leg.systemId);
        }
      }
    }
    for (const h of hulls) {
      if (h.systemId && h.systemId > 0) ids.add(h.systemId);
    }
    return Array.from(ids).sort((a, b) => a - b);
  }, [queuedCards, originSystemId, endHub.systemId, hulls]);

  const systemIdsKey = requiredSystemIds.join(',');
  const activeAvoidList = useMemo(
    () => (avoidHotSystems ? knownHotIdsToAvoid : []),
    [avoidHotSystems, knownHotIdsToAvoid]
  );
  const avoidKey = activeAvoidList.join(',');

  // Fetch ESI route jump counts, intermediate waypoints, and live system_kills gatecamp intel
  useEffect(() => {
    if (queuedCards.length === 0) {
      setRouteIntel(EMPTY_INTEL);
      setKnownHotIdsToAvoid([]);
      setAvoidHotSystems(false);
      setRouteError(null);
      setIsRouting(false);
      return;
    }
    if (requiredSystemIds.length <= 1) {
      setRouteError(null);
      setIsRouting(false);
      return;
    }

    let cancelled = false;
    setIsRouting(true);
    setRouteError(null);

    ensureRouteIntelLoaded(requiredSystemIds, preference, activeAvoidList)
      .then((intel) => {
        if (cancelled) return;
        setRouteIntel(intel);
        // Remember hot intermediate systems discovered on non-avoided routes so the toggle can avoid them
        if (!avoidHotSystems) {
          const foundHot = new Set<number>();
          for (const list of Object.values(intel.hotSystemsByPair)) {
            for (const hs of list) {
              foundHot.add(hs.systemId);
            }
          }
          setKnownHotIdsToAvoid(Array.from(foundHot).sort((a, b) => a - b));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setRouteError(
          err instanceof Error
            ? err.message
            : 'Unable to fetch EVE ESI route waypoints & kill intel.'
        );
      })
      .finally(() => {
        if (!cancelled) setIsRouting(false);
      });

    return () => {
      cancelled = true;
    };
  }, [systemIdsKey, preference, avoidKey, avoidHotSystems, queuedCards.length]);

  // First pass: calculate baseline cargo mix & peak ISK so the Fleet Recommender picks the ideal hull
  const baselineRoute: OptimizedRouteResult = useMemo(
    () =>
      optimizeQueuedRoute({
        selectedCards: queuedCards,
        originSystemId,
        originSystemName,
        originStationId,
        originStationName,
        endHub,
        preference,
        avoidHotSystems,
        maxCargoM3: 62500,
        activeHull: null,
        routeIntel,
      }),
    [
      queuedCards,
      originSystemId,
      originSystemName,
      originStationId,
      originStationName,
      endHub,
      preference,
      avoidHotSystems,
      routeIntel,
    ]
  );

  // Recommend best available hull from scanned fleet
  const hullRecommendation = useMemo(
    () =>
      recommendBestHullFromFleet({
        hulls,
        cargoByBucket: baselineRoute.peakCargoByBucket,
        peakCargoM3: baselineRoute.peakCargoM3,
        peakCargoIsk: baselineRoute.peakCargoIsk,
        originSystemId,
        originStationName: overrideSystem ? undefined : pilotStationName,
        jumpMatrix: routeIntel.distances,
      }),
    [
      hulls,
      baselineRoute.peakCargoByBucket,
      baselineRoute.peakCargoM3,
      baselineRoute.peakCargoIsk,
      originSystemId,
      overrideSystem,
      pilotStationName,
      routeIntel.distances,
    ]
  );

  // Active hull (either auto-recommended or manually chosen by pilot)
  const activeHull: HangarHull | null = useMemo(() => {
    if (selectedHullId === 'auto') {
      return hullRecommendation?.hull ?? hulls[0] ?? null;
    }
    return hulls.find((h) => h.id === selectedHullId) ?? hullRecommendation?.hull ?? hulls[0] ?? null;
  }, [selectedHullId, hulls, hullRecommendation]);

  const activeHullFit = useMemo(() => {
    if (!activeHull) return null;
    return evaluateHullForCargo(activeHull, baselineRoute.peakCargoByBucket);
  }, [activeHull, baselineRoute.peakCargoByBucket]);

  const effectiveMaxCargoM3 = useMemo(() => {
    if (manualCargoOverride !== null && manualCargoOverride > 0) {
      return manualCargoOverride;
    }
    if (activeHullFit && activeHullFit.effectiveCapacityM3 > 0) {
      return activeHullFit.effectiveCapacityM3;
    }
    return activeHull?.capacityM3 ?? 62500;
  }, [manualCargoOverride, activeHullFit, activeHull]);

  const effectiveMaxCargoIskCap = useMemo(() => {
    if (maxCargoIskCapOverride !== null && maxCargoIskCapOverride > 0) {
      return maxCargoIskCapOverride;
    }
    return activeHull?.safeIskThreshold ?? 750_000_000;
  }, [maxCargoIskCapOverride, activeHull]);

  // Final optimized route evaluated against the active hull's exact fitted cargo + gank thresholds
  const optimized: OptimizedRouteResult = useMemo(
    () =>
      optimizeQueuedRoute({
        selectedCards: queuedCards,
        originSystemId,
        originSystemName,
        originStationId,
        originStationName,
        endHub,
        preference,
        avoidHotSystems,
        maxCargoM3: Math.max(1, effectiveMaxCargoM3),
        activeHull,
        routeIntel,
      }),
    [
      queuedCards,
      originSystemId,
      originSystemName,
      originStationId,
      originStationName,
      endHub,
      preference,
      avoidHotSystems,
      effectiveMaxCargoM3,
      activeHull,
      routeIntel,
    ]
  );

  // Prep Step 0 info for the active hull (if parked away from current system/station)
  const prepStep0 = useMemo(() => {
    if (!activeHull || queuedCards.length === 0) return null;
    const hullSystemId = activeHull.systemId ?? originSystemId;
    const pairKey = `${originSystemId}:${hullSystemId}`;
    const pickupJumps =
      hullSystemId === originSystemId ? 0 : routeIntel.distances[pairKey] ?? 3;
    const sameStation =
      activeHull.isActiveShip ||
      (hullSystemId === originSystemId &&
        (!pilotStationName ||
          overrideSystem !== null ||
          activeHull.location.toLowerCase().includes(pilotStationName.slice(0, 14).toLowerCase()) ||
          pilotStationName.toLowerCase().includes(activeHull.location.slice(0, 14).toLowerCase())));

    if (!sameStation || pickupJumps > 0) {
      return {
        hull: activeHull,
        jumps: pickupJumps,
        destinationId: activeHull.stationId ?? hullSystemId,
        stationName: activeHull.location,
        systemName: activeHull.systemName || 'Hangar System',
      };
    }
    return null;
  }, [activeHull, queuedCards.length, originSystemId, routeIntel.distances, pilotStationName, overrideSystem]);

  const overallGankRisk = useMemo(
    () => assessGankRisk(optimized.peakCargoIsk, activeHull),
    [optimized.peakCargoIsk, activeHull]
  );

  const showToast = (
    kind: 'success' | 'warn' | 'error',
    message: string,
    needsSso = false
  ) => {
    setAutopilotToast({ kind, message, needsSso });
  };

  useEffect(() => {
    if (!autopilotToast) return;
    const t = setTimeout(() => setAutopilotToast(null), 5000);
    return () => clearTimeout(t);
  }, [autopilotToast]);

  // One-click "Set Destination" for any individual stop or Prep Step 0
  const handleSetDestination = async (
    destinationId: number,
    label: string,
    busyKey: string
  ) => {
    if (pilotMode !== 'eve_sso' || !eveAccessToken) {
      showToast(
        'warn',
        `Connect EVE SSO (with esi-ui.write_waypoint.v1) to set "${label}" directly in your EVE client.`,
        true
      );
      return;
    }

    setAutopilotBusyId(busyKey);
    try {
      const res = await fetch('/api/eve/autopilot/waypoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eveAccessToken}`,
        },
        body: JSON.stringify({
          destinationId,
          clearOtherWaypoints: true,
          addToBeginning: false,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `ESI returned HTTP ${res.status}`);
      }
      showToast('success', `In-game destination set to ${label} (cleared previous waypoints).`);
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Unable to push destination to EVE Autopilot.',
        true
      );
    } finally {
      setAutopilotBusyId(null);
    }
  };

  // One-click "Push Full Loop to EVE Autopilot" (Stop #1 clears; subsequent stops append in order)
  const handlePushFullLoop = async () => {
    if (optimized.stops.length === 0) return;
    if (pilotMode !== 'eve_sso' || !eveAccessToken) {
      showToast(
        'warn',
        'Connect EVE SSO (with esi-ui.write_waypoint.v1) to push the full loop to your EVE Online autopilot.',
        true
      );
      return;
    }

    const waypoints: number[] = [];
    if (prepStep0) {
      waypoints.push(prepStep0.destinationId);
    }
    for (const stop of optimized.stops) {
      if (waypoints[waypoints.length - 1] !== stop.destinationId) {
        waypoints.push(stop.destinationId);
      }
    }
    if (
      optimized.returnLegDestinationId &&
      optimized.returnLegJumps &&
      optimized.returnLegJumps > 0 &&
      waypoints[waypoints.length - 1] !== optimized.returnLegDestinationId
    ) {
      waypoints.push(optimized.returnLegDestinationId);
    }

    setAutopilotBusyId('full-loop');
    try {
      const res = await fetch('/api/eve/autopilot/waypoint', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eveAccessToken}`,
        },
        body: JSON.stringify({ waypoints }),
      });
      const json = (await res.json()) as { ok?: boolean; pushed?: number; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `ESI returned HTTP ${res.status}`);
      }
      showToast(
        'success',
        `Pushed ${json.pushed ?? waypoints.length} waypoint${(json.pushed ?? waypoints.length) === 1 ? '' : 's'} to EVE Online Autopilot in exact loop order.`
      );
    } catch (err) {
      showToast(
        'error',
        err instanceof Error ? err.message : 'Failed to push loop to EVE Autopilot.',
        true
      );
    } finally {
      setAutopilotBusyId(null);
    }
  };

  // Auto-Fill Best Loop Solver: picks optimal subset maximizing True After-Tax Net ISK/Jump
  const handleAutoFillBestLoop = async () => {
    if (isSolvingLoop) return;
    setIsSolvingLoop(true);
    setRouteError(null);
    try {
      const candidateIds = new Set<number>([originSystemId]);
      if (endHub.systemId && endHub.systemId > 0) candidateIds.add(endHub.systemId);
      for (const h of hulls) {
        if (h.systemId && h.systemId > 0) candidateIds.add(h.systemId);
      }
      for (const card of allCandidateCards) {
        if (card.netProfitIsk <= 0) continue;
        for (const ch of card.routeChains || []) {
          for (const leg of ch.legs) {
            if (leg.systemId > 0) candidateIds.add(leg.systemId);
          }
        }
      }

      const freshIntel =
        candidateIds.size > 1
          ? await ensureRouteIntelLoaded(
              Array.from(candidateIds),
              preference,
              activeAvoidList
            )
          : routeIntel;

      setRouteIntel(freshIntel);

      const summary = solveBestLoop({
        candidateCards: allCandidateCards,
        originSystemId,
        originSystemName,
        originStationId,
        originStationName,
        endHub,
        preference,
        avoidHotSystems,
        maxCargoM3: Math.max(1, effectiveMaxCargoM3),
        activeHull,
        availableWalletIsk: walletBalance,
        maxCargoIskRiskCap: effectiveMaxCargoIskCap,
        routeIntel: freshIntel,
      });

      setAutoFillSummary(summary);
      if (summary.selectedCardIds.length > 0) {
        onApplyAutoFilledRoute(summary.selectedCardIds);
        showToast(
          'success',
          `Auto-filled ${summary.selectedCardIds.length} card${summary.selectedCardIds.length === 1 ? '' : 's'} (+${formatIsk(summary.totalNetProfitIsk)} · ${formatIsk(summary.netIskPerJump)}/jump).`
        );
      } else {
        showToast('warn', summary.reason);
      }
    } catch (err) {
      setRouteError(
        err instanceof Error ? err.message : 'Auto-Fill Best Loop solver failed.'
      );
    } finally {
      setIsSolvingLoop(false);
    }
  };

  const handleApplyStartingHub = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = hubInput.trim();
    setHubLookupError(null);

    if (!q || q.toLowerCase() === pilotSystemName.toLowerCase()) {
      setOverrideSystem(null);
      setHubInput(pilotSystemName);
      return;
    }

    const known = matchKnownSystem(q);
    if (known) {
      setOverrideSystem({ systemId: known.systemId, systemName: known.name });
      setHubInput(known.name);
      return;
    }

    setIsResolvingHub(true);
    try {
      const res = await fetch(`/api/route/resolve-system?q=${encodeURIComponent(q)}`);
      const json = (await res.json()) as {
        systemId?: number;
        systemName?: string;
        error?: string;
      };
      if (!res.ok || !json.systemId) {
        throw new Error(json.error || `System "${q}" not found.`);
      }
      setOverrideSystem({
        systemId: json.systemId,
        systemName: json.systemName || q,
      });
      setHubInput(json.systemName || q);
    } catch (err) {
      setHubLookupError(
        err instanceof Error ? err.message : 'Unable to resolve EVE system.'
      );
    } finally {
      setIsResolvingHub(false);
    }
  };

  const totalHotFlagged = optimized.totalHotSystemsFlagged;
  const canToggleAvoid = knownHotIdsToAvoid.length > 0 || avoidHotSystems;
  const walletShortfallIsk =
    queuedCards.length > 0 && optimized.totalBuyIsk > walletBalance
      ? optimized.totalBuyIsk - walletBalance
      : 0;
  const exceedsRiskCap =
    queuedCards.length > 0 &&
    effectiveMaxCargoIskCap > 0 &&
    optimized.peakCargoIsk > effectiveMaxCargoIskCap;
  const profitableVisibleCount = useMemo(
    () => allCandidateCards.filter((c) => c.netProfitIsk > 0).length,
    [allCandidateCards]
  );

  const totalHaulCostDeductionIsk = useMemo(() => {
    return queuedCards.reduce((sum, c) => {
      const ov = haulOverrides[c.id];
      if (typeof ov === 'number' && ov >= 0) return sum + ov;
      const cardT = cardTransportMap[c.id]?.transportIsk ?? 0;
      return sum + Math.max(0, cardT);
    }, 0);
  }, [queuedCards, haulOverrides, cardTransportMap]);

  const netProfitAfterHaulIsk = optimized.totalNetProfitIsk - totalHaulCostDeductionIsk;

  const dotlanMultiUrl = useMemo(() => {
    const seq = [originSystemName, ...optimized.stops.map((s) => s.systemName)];
    if (optimized.returnLegSystemName) seq.push(optimized.returnLegSystemName);
    return getDotlanMultiRouteUrl(seq);
  }, [originSystemName, optimized.stops, optimized.returnLegSystemName]);

  const committedRoutes = useMemo(
    () => savedRoutes.filter((r) => r.tier === 'committed'),
    [savedRoutes]
  );
  const completedRoutes = useMemo(
    () => savedRoutes.filter((r) => r.tier === 'completed'),
    [savedRoutes]
  );
  const archiveTotalProfit = useMemo(
    () => completedRoutes.reduce((s, r) => s + r.totalNetProfitIsk, 0),
    [completedRoutes]
  );

  const buildRouteExportText = () => {
    const lines: string[] = [
      `FOXY REDFOX INDY COMMAND v2.2.0 — ROUTE MANIFEST`,
      `Origin: ${originSystemName} | Stops: ${optimized.stops.length} | Jumps: ${optimized.totalJumps} (${preference})`,
      `Hull: ${activeHull?.name || 'Auto'} | Peak Cargo: ${formatM3(optimized.peakCargoM3)} | Peak Value: ${formatIsk(optimized.peakCargoIsk)}`,
      `Buy Capital: ${formatIsk(optimized.totalBuyIsk)} | Net Profit (after haul): ${formatIsk(netProfitAfterHaulIsk)}`,
      `DOTLAN: ${dotlanMultiUrl}`,
      '',
    ];
    for (const stop of optimized.stops) {
      lines.push(`STOP ${stop.stopNumber}: ${stop.systemName} (${stop.jumpsFromPrev}j) — ${stop.stationName}`);
      if (stop.hotSystems.length > 0) {
        lines.push(`  ! HOT: ${stop.hotSystems.map((h) => `${h.systemName} (${h.shipKills}s/${h.podKills}p)`).join(', ')}`);
      }
      for (const b of stop.buys) {
        lines.push(`  BUY  ${b.quantity}x ${b.name} (${formatIsk(b.iskAmount)})`);
      }
      for (const s of stop.sells) {
        lines.push(`  SELL ${s.quantity}x ${s.name} (+${formatIsk(s.iskAmount)})`);
      }
    }
    return lines.join('\n');
  };

  const buildRouteExportCsv = () => {
    const header = 'Stop,System,Station,Action,Item,Quantity,ISK,JumpsFromPrev';
    const rows: string[] = [header];
    for (const stop of optimized.stops) {
      for (const b of stop.buys) {
        rows.push(
          `${stop.stopNumber},"${stop.systemName}","${stop.stationName.replace(/"/g, '""')}",BUY,"${b.name.replace(/"/g, '""')}",${b.quantity},${Math.round(b.iskAmount)},${stop.jumpsFromPrev}`
        );
      }
      for (const s of stop.sells) {
        rows.push(
          `${stop.stopNumber},"${stop.systemName}","${stop.stationName.replace(/"/g, '""')}",SELL,"${s.name.replace(/"/g, '""')}",${s.quantity},${Math.round(s.iskAmount)},${stop.jumpsFromPrev}`
        );
      }
    }
    return rows.join('\n');
  };

  const triggerDownload = (filename: string, content: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('success', `Downloaded ${filename}`);
  };

  const handleExportClipboard = async (format: 'text' | 'csv') => {
    const content = format === 'csv' ? buildRouteExportCsv() : buildRouteExportText();
    const ok = await copyTextToClipboard(content);
    showToast(ok ? 'success' : 'error', ok ? `Copied route (${format.toUpperCase()}) to clipboard.` : 'Clipboard blocked.');
  };

  const handleExportSharePayload = async () => {
    const payload = {
      app: 'Foxy RedFox Indy Command',
      version: '2.2.0',
      origin: originSystemName,
      jumps: optimized.totalJumps,
      netProfitIsk: Math.round(netProfitAfterHaulIsk),
      dotlan: dotlanMultiUrl,
      stops: optimized.stops.map((s) => ({
        stop: s.stopNumber,
        system: s.systemName,
        station: s.stationName,
        buys: s.buys.length,
        sells: s.sells.length,
      })),
    };
    const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
    const base = appSettings?.sharePasteUrl?.trim();
    const shareText = base && base.startsWith('https://')
      ? `${base}${base.includes('?') ? '&' : '?'}route=${encoded}`
      : `${window.location.origin}${window.location.pathname}#route=${encoded}`;
    const ok = await copyTextToClipboard(shareText);
    showToast(ok ? 'success' : 'error', ok ? 'Copied shareable route link payload to clipboard.' : 'Clipboard blocked.');
  };

  const handlePushDiscord = async () => {
    const webhookUrl = appSettings?.discordWebhookUrl?.trim() || '';
    if (!webhookUrl) {
      showToast('warn', 'Add your Discord Channel Webhook URL in Settings -> Connections & APIs first.', true);
      return;
    }
    setExportingDiscord(true);
    try {
      const stopSummary = optimized.stops
        .slice(0, 6)
        .map((s) => `**#${s.stopNumber} ${s.systemName}** (${s.jumpsFromPrev}j): ${s.buys.length} buy / ${s.sells.length} sell`)
        .join('\n');
      const res = await fetch('/api/integrations/discord-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl,
          title: `Route Manifest: ${originSystemName} (${optimized.totalJumps}j · ${optimized.stops.length} stops)`,
          description: `${stopSummary}\n\n[Open Route in DOTLAN](${dotlanMultiUrl})`,
          fields: [
            { name: 'Net Profit (After Haul)', value: `${netProfitAfterHaulIsk >= 0 ? '+' : ''}${formatIsk(netProfitAfterHaulIsk)}`, inline: true },
            { name: 'Buy Capital', value: formatIsk(optimized.totalBuyIsk), inline: true },
            { name: 'Peak Hold / Value', value: `${formatM3(optimized.peakCargoM3)} · ${formatIsk(optimized.peakCargoIsk)}`, inline: true },
          ],
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      showToast('success', 'Posted Route Manifest embed to Discord channel.');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Discord push failed.');
    } finally {
      setExportingDiscord(false);
    }
  };

  const handleCommitCurrentRoute = () => {
    if (!onSaveCommittedRoute || queuedCards.length === 0) return;
    const label =
      commitRouteName.trim() ||
      `${originSystemName} Loop (${optimized.stops.length} stops · ${optimized.totalJumps}j)`;
    const record: SavedRouteRecord = {
      id: `rt-${Date.now()}`,
      name: label,
      tier: 'committed',
      createdAt: new Date().toISOString(),
      stopCount: optimized.stops.length,
      totalJumps: optimized.totalJumps,
      totalVolumeM3: optimized.peakCargoM3,
      totalCapitalIsk: optimized.totalBuyIsk,
      totalNetProfitIsk: netProfitAfterHaulIsk,
      cardIds: queuedCards.map((c) => c.id),
      cardTitles: queuedCards.map((c) => c.title),
      multibuySummary: `${optimized.stops.length} stops · ${optimized.totalJumps}j from ${originSystemName}`,
    };
    onSaveCommittedRoute(record);
    setCommitRouteName('');
    setLifecycleTab('committed');
    showToast('success', `Committed route "${label}" (${new Date().toLocaleTimeString()}).`);
  };

  return (
    <aside
      aria-label="Fleet Logistics, Threat Intel and Autopilot Planner"
      className="print-route-area w-full shrink-0 bg-[#0e131b] border-t lg:border-t-0 flex flex-col h-[640px] lg:h-full"
    >
      {/* Sidebar Header + Right-Rail Switcher */}
      <div className="px-4 py-3 border-b border-slate-800/90 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <h2 className="font-display text-sm font-semibold text-slate-100 truncate">
              Fleet Logistics &amp; Autopilot
            </h2>
          </div>
          <div className="text-[11px] text-slate-400 font-mono tabular-nums truncate mt-0.5">
            {queuedCards.length} queued · {optimized.stops.length} stops · {optimized.totalJumps}j ({preference}
            {avoidHotSystems ? ' · Avoid Hot' : ''})
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {queuedCards.length > 0 && (
            <button
              type="button"
              onClick={onClearQueue}
              title="Clear all queued cards and reset route stops"
              className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium rounded border border-rose-500/45 bg-rose-500/12 text-rose-200 hover:bg-rose-500/25 hover:border-rose-400/70 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" aria-hidden="true" />
              <span>Clear Route</span>
            </button>
          )}
          <button
            type="button"
            onClick={onSwitchToAdvisor}
            title="Switch right sidebar to Gemini AI Advisor"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-slate-300 hover:text-cyan-200 rounded border border-slate-800 hover:border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Bot className="w-3.5 h-3.5" aria-hidden="true" />
            <span>AI Advisor</span>
          </button>
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse Planner"
            aria-label="Collapse Planner"
            className="p-1.5 text-slate-400 hover:text-cyan-300 rounded border border-slate-800 hover:border-slate-700 transition-colors shrink-0 cursor-pointer"
          >
            <PanelRightClose className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Live Liquid Wallet Balance & Open Orders Strip */}
      <div className="px-4 py-2 border-b border-slate-800/80 bg-[#0c1118] flex items-center justify-between gap-2 text-[11px] shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Wallet className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          <div className="min-w-0 truncate">
            <span className="text-slate-400">Liquid Wallet: </span>
            <span
              className={`font-mono tabular-nums font-semibold ${
                walletShortfallIsk > 0 ? 'text-rose-400' : 'text-emerald-300'
              }`}
            >
              {formatIsk(walletBalance)}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="font-mono tabular-nums text-[10px] text-slate-400"
            title="Active character sell orders tracked via esi-markets.read_character_orders.v1"
          >
            {activeSellOrderCount} open sell{activeSellOrderCount === 1 ? '' : 's'}
          </span>
          {pilotMode === 'eve_sso' && (
            <button
              type="button"
              onClick={onRefreshWalletOrders}
              disabled={isRefreshingWalletOrders}
              title="Refresh live EVE ESI wallet balance and active character market orders"
              className="p-1 rounded border border-slate-800 text-slate-400 hover:text-cyan-300 hover:border-cyan-400/50 disabled:opacity-50 transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`w-3 h-3 ${isRefreshingWalletOrders ? 'animate-spin text-cyan-400' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>

      {/* Wallet Capital Deficit Alert */}
      {walletShortfallIsk > 0 && (
        <div className="mx-4 mt-2.5 px-3 py-2 rounded border border-rose-500/55 bg-rose-500/12 text-[11px] text-rose-200 flex items-start gap-2 shrink-0">
          <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="leading-snug">
            <span className="font-semibold text-rose-300">Insufficient Liquid ISK:</span>{' '}
            Upfront BUY capital ({formatIsk(optimized.totalBuyIsk)}) exceeds wallet balance by{' '}
            <span className="font-mono tabular-nums font-semibold text-rose-300">
              {formatIsk(walletShortfallIsk)}
            </span>
            . Remove a card or run Auto-Fill Best Loop.
          </div>
        </div>
      )}

      {/* Autopilot Feedback Toast */}
      {autopilotToast && (
        <div
          className={`mx-4 mt-2.5 px-3 py-2 rounded border text-[11px] flex items-start justify-between gap-2 shrink-0 ${
            autopilotToast.kind === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-200'
              : autopilotToast.kind === 'warn'
                ? 'bg-amber-500/10 border-amber-500/40 text-amber-200'
                : 'bg-rose-500/10 border-rose-500/40 text-rose-200'
          }`}
        >
          <span className="leading-snug">{autopilotToast.message}</span>
          {autopilotToast.needsSso && (
            <button
              type="button"
              onClick={onOpenSsoSettings}
              className="text-cyan-300 hover:text-cyan-200 underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              EVE SSO
            </button>
          )}
        </div>
      )}

      {/* Controls: Starting Hub, Hull Selector, Max Cargo, Safer/Shorter, Avoid Hot Systems */}
      <div className="px-4 py-3 border-b border-slate-800/80 bg-[#131822]/70 space-y-2.5 shrink-0">
        {/* Starting Hub Override */}
        <form onSubmit={handleApplyStartingHub} className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <label
              htmlFor="route-start-hub"
              className="text-slate-400 font-medium inline-flex items-center gap-1"
            >
              <MapPin className="w-3 h-3 text-cyan-400" aria-hidden="true" />
              <span>Starting System</span>
              <span className="font-mono text-slate-500">({originSystemId})</span>
            </label>
            {overrideSystem ? (
              <button
                type="button"
                onClick={() => {
                  setOverrideSystem(null);
                  setHubInput(pilotSystemName);
                  setHubLookupError(null);
                }}
                className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
              >
                Reset to {pilotSystemName}
              </button>
            ) : (
              <span className="text-slate-500 font-mono">
                {pilotMode === 'eve_sso' ? 'Live ESI Location' : 'Sim Location'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <input
              id="route-start-hub"
              type="text"
              list="eve-known-hubs"
              value={hubInput}
              onChange={(e) => setHubInput(e.target.value)}
              placeholder="System name (Jita, Amarr) or ID..."
              className="flex-1 min-w-0 bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded px-2.5 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
            />
            <datalist id="eve-known-hubs">
              {KNOWN_EVE_SYSTEMS.map((sys) => (
                <option key={sys.systemId} value={sys.name}>
                  {sys.label}
                </option>
              ))}
            </datalist>
            <button
              type="submit"
              disabled={isResolvingHub}
              className="px-2.5 py-1.5 text-xs font-medium rounded border border-slate-700 bg-[#0e131b] text-slate-200 hover:border-cyan-400/60 hover:text-cyan-200 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isResolvingHub ? '...' : 'Set'}
            </button>
          </div>
          {hubLookupError && (
            <div className="text-[11px] text-rose-400">{hubLookupError}</div>
          )}
        </form>

        {/* Fleet Hull Selector (Fitted Cargo + Specialized Bays) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px]">
            <label
              htmlFor="route-hull-select"
              className="text-slate-400 font-medium inline-flex items-center gap-1"
            >
              <Ship className="w-3 h-3 text-cyan-400" aria-hidden="true" />
              <span>Assigned Fleet Hull ({hulls.length})</span>
            </label>
            {activeHull && (
              <span className="font-mono text-[10px] text-slate-400 truncate max-w-[180px]">
                {activeHull.isCloaky
                  ? 'CovOps Cloak'
                  : activeHull.isTanked
                    ? 'Tanked'
                    : 'Standard Fit'}
              </span>
            )}
          </div>
          <select
            id="route-hull-select"
            value={selectedHullId}
            onChange={(e) => {
              setSelectedHullId(e.target.value);
              setManualCargoOverride(null);
            }}
            className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded px-2.5 py-1.5 text-xs text-slate-100"
          >
            <option value="auto">
              Auto-Recommend Best Hull
              {hullRecommendation ? ` → ${hullRecommendation.hull.name}` : ''}
            </option>
            {hulls.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} · {formatM3(h.capacityM3)}
                {h.isActiveShip ? ' [Active]' : h.systemName ? ` (${h.systemName})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Max Cargo Override + Safer/Shorter + Avoid Hot Systems */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="route-max-cargo"
              className="block text-[11px] text-slate-400 font-medium mb-1"
            >
              Effective Cargo (m³)
            </label>
            <input
              id="route-max-cargo"
              type="number"
              min={100}
              step={500}
              value={Math.round(effectiveMaxCargoM3)}
              onChange={(e) => {
                const v = Number(e.target.value);
                setManualCargoOverride(v > 0 ? v : null);
              }}
              className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded px-2.5 py-1.5 text-xs font-mono tabular-nums text-slate-100"
            />
          </div>

          <div>
            <div className="text-[11px] text-slate-400 font-medium mb-1">
              2026 ESI Route
            </div>
            <div className="grid grid-cols-3 rounded border border-slate-800 bg-[#0b0e14] p-0.5">
              <button
                type="button"
                onClick={() => setPreference('Safer')}
                className={`py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                  preference === 'Safer'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Safer
              </button>
              <button
                type="button"
                onClick={() => setPreference('Shorter')}
                className={`py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                  preference === 'Shorter'
                    ? 'bg-amber-500/20 text-amber-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Short
              </button>
              <button
                type="button"
                onClick={() => setPreference('LessSecure')}
                title="Prefer Low-Sec / Null-Sec (POST /route preference: LessSecure)"
                className={`py-1 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                  preference === 'LessSecure'
                    ? 'bg-rose-500/20 text-rose-300'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                LowSec
              </button>
            </div>
          </div>
        </div>

        {/* End Hub / Return Destination + Max Cargo ISK Gank-Risk Cap */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label
              htmlFor="route-end-hub"
              className="block text-[11px] text-slate-400 font-medium mb-1"
            >
              Optional End / Return Hub
            </label>
            <select
              id="route-end-hub"
              value={endHubChoice}
              onChange={(e) => setEndHubChoice(e.target.value as EndHubChoice)}
              className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="any">Any Destination</option>
              <option value="return_to_start">Return to {originSystemName}</option>
              <option value="jita">Jita 4-4</option>
              <option value="dodixie">Dodixie IX-20</option>
              <option value="ishisomo">Ishisomo VIII</option>
              <option value="amarr">Amarr VIII</option>
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <label htmlFor="route-isk-cap" className="text-slate-400 font-medium">
                Max Cargo Cap
              </label>
              <span className="font-mono text-[10px] text-amber-300 tabular-nums">
                {formatIsk(effectiveMaxCargoIskCap)}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                id="route-isk-cap"
                type="number"
                min={25}
                step={50}
                value={Math.round(effectiveMaxCargoIskCap / 1_000_000)}
                onChange={(e) => {
                  const m = Number(e.target.value);
                  setMaxCargoIskCapOverride(m > 0 ? m * 1_000_000 : null);
                }}
                title="Max Cargo ISK Risk Cap in Millions ISK (e.g. 750 = 750M ISK)"
                className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded px-2 py-1.5 text-xs font-mono tabular-nums text-slate-100"
              />
              <span className="text-[10px] font-mono text-slate-400 shrink-0">M</span>
            </div>
          </div>
        </div>

        {/* Auto-Fill Best Loop + Push Full Loop Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
          <button
            type="button"
            onClick={handleAutoFillBestLoop}
            disabled={isSolvingLoop || profitableVisibleCount === 0}
            title="Automatically select the optimal combination of visible profitable cards fitting 100% inside hull bays, liquid wallet ISK, and Max Cargo ISK risk cap to maximize True After-Tax Net ISK/Jump"
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded border border-emerald-400/55 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-45 transition-colors cursor-pointer"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${isSolvingLoop ? 'animate-pulse text-emerald-300' : 'text-emerald-300'}`}
              aria-hidden="true"
            />
            <span>{isSolvingLoop ? 'Solving Loop...' : 'Auto-Fill Best Loop'}</span>
          </button>

          <button
            type="button"
            onClick={handlePushFullLoop}
            disabled={autopilotBusyId === 'full-loop' || optimized.stops.length === 0}
            className="inline-flex items-center justify-center gap-1.5 px-2.5 py-2 text-xs font-semibold rounded border border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            <span>
              {autopilotBusyId === 'full-loop'
                ? 'Pushing Loop...'
                : 'Push Full Loop to EVE'}
            </span>
          </button>
        </div>

        {/* Live Gatecamp Avoidance + Visual Route Map Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
          <label
            className={`inline-flex items-center gap-1.5 text-[11px] select-none ${
              canToggleAvoid ? 'text-slate-200 cursor-pointer' : 'text-slate-500 cursor-not-allowed'
            }`}
            title={
              canToggleAvoid
                ? 'Re-query EVE ESI route excluding intermediate systems with recent ship/pod kills'
                : 'No hot intermediate systems detected on current route'
            }
          >
            <input
              type="checkbox"
              checked={avoidHotSystems}
              disabled={!canToggleAvoid}
              onChange={(e) => setAvoidHotSystems(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-amber-400 cursor-pointer disabled:opacity-40"
            />
            <Flame
              className={`w-3.5 h-3.5 ${
                avoidHotSystems
                  ? 'text-amber-400'
                  : totalHotFlagged > 0
                    ? 'text-rose-400'
                    : 'text-slate-500'
              }`}
              aria-hidden="true"
            />
            <span>
              Avoid Hot Systems
              {knownHotIdsToAvoid.length > 0 ? ` (${knownHotIdsToAvoid.length})` : ''}
            </span>
          </label>

          <button
            type="button"
            onClick={() => setShowRouteMap((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              showRouteMap
                ? 'border-cyan-400/55 bg-cyan-500/15 text-cyan-200'
                : 'border-slate-700 bg-[#0b0e14] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{showRouteMap ? 'Hide Route Map' : 'Visual Route Map'}</span>
          </button>
        </div>
      </div>

      {/* Route Lifecycle Tiers Bar (Live Session / Committed / Completed Archive) */}
      <div className="no-print px-4 py-2 border-b border-slate-800/80 bg-[#0c1118] flex items-center justify-between gap-1.5 shrink-0">
        <div className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setLifecycleTab('live')}
            className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
              lifecycleTab === 'live' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Live ({queuedCards.length})
          </button>
          <button
            type="button"
            onClick={() => setLifecycleTab('committed')}
            className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
              lifecycleTab === 'committed' ? 'bg-amber-500/20 text-amber-200' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Committed ({committedRoutes.length})
          </button>
          <button
            type="button"
            onClick={() => setLifecycleTab('completed')}
            className={`px-2 py-0.5 rounded font-medium cursor-pointer ${
              lifecycleTab === 'completed' ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Archive ({completedRoutes.length})
          </button>
        </div>

        <a
          href={dotlanMultiUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="Open entire multi-stop route in DOTLAN EveMaps"
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-slate-800 bg-[#131822] text-[10px] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
        >
          <Compass className="w-3 h-3 text-cyan-400" />
          <span>DOTLAN</span>
        </a>
      </div>

      {/* Committed / Completed Archive Sub-Panel */}
      {lifecycleTab !== 'live' && (
        <div className="no-print px-4 py-3 border-b border-slate-800/80 bg-[#0d121a] space-y-2 max-h-56 overflow-y-auto shrink-0">
          {lifecycleTab === 'completed' && (
            <div className="flex items-center justify-between text-[11px] bg-emerald-500/10 border border-emerald-500/30 rounded px-2.5 py-1.5">
              <span className="text-emerald-200 font-medium">Completed Ledger ({completedRoutes.length})</span>
              <span className="font-mono font-semibold text-emerald-300">
                +{formatIsk(archiveTotalProfit)}
              </span>
            </div>
          )}
          {(lifecycleTab === 'committed' ? committedRoutes : completedRoutes).length === 0 ? (
            <div className="text-[11px] text-slate-500 text-center py-2">
              {lifecycleTab === 'committed'
                ? 'No committed routes yet. Save your active route below.'
                : 'No completed archive routes yet.'}
            </div>
          ) : (
            (lifecycleTab === 'committed' ? committedRoutes : completedRoutes).map((rec) => (
              <div
                key={rec.id}
                className="p-2 rounded border border-slate-800 bg-[#131822] text-[11px] space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-100 truncate">{rec.name}</span>
                  <span className="font-mono text-emerald-400 shrink-0">
                    {rec.totalNetProfitIsk >= 0 ? '+' : ''}
                    {formatIsk(rec.totalNetProfitIsk)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <span>
                    {new Date(rec.createdAt).toLocaleString()} · {rec.totalJumps}j · {rec.cardIds.length} cards
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pt-1">
                  {onRestoreRoute && (
                    <button
                      type="button"
                      onClick={() => {
                        onRestoreRoute(rec);
                        setLifecycleTab('live');
                      }}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 text-[10px] cursor-pointer"
                    >
                      <RotateCcw className="w-2.5 h-2.5" />
                      <span>Load</span>
                    </button>
                  )}
                  {rec.tier === 'committed' && onMarkRouteCompleted && (
                    <button
                      type="button"
                      onClick={() => onMarkRouteCompleted(rec.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20 text-[10px] cursor-pointer"
                    >
                      <Archive className="w-2.5 h-2.5" />
                      <span>Mark Completed</span>
                    </button>
                  )}
                  {onDeleteSavedRoute && (
                    <button
                      type="button"
                      onClick={() => onDeleteSavedRoute(rec.id)}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 text-slate-400 hover:text-rose-300 text-[10px] ml-auto cursor-pointer"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Totals Strip (Single-Elevation Hairline Bar) */}
      {queuedCards.length > 0 && (
        <div className="grid grid-cols-2 border-b border-slate-800/90 divide-x divide-y divide-slate-800/80 bg-[#0f141d] shrink-0">
          <div className="px-3.5 py-2">
            <div className="text-[10px] text-slate-400">Route &amp; Threat Intel</div>
            <div className="font-mono tabular-nums text-xs font-semibold text-slate-100 mt-0.5 flex items-center gap-1.5">
              <span>{optimized.totalJumps}j</span>
              <span className="text-slate-500 font-normal">· {optimized.stops.length} stops</span>
              {totalHotFlagged > 0 ? (
                <span className="text-rose-400">· {totalHotFlagged} hot</span>
              ) : (
                <span className="text-emerald-400">· Clear</span>
              )}
              {isRouting && (
                <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin" aria-hidden="true" />
              )}
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="text-[10px] text-slate-400">Peak Hold / Value</div>
            <div className="font-mono tabular-nums text-xs font-semibold mt-0.5 flex items-center gap-1.5">
              <span
                className={
                  optimized.overCapacityStops > 0 ? 'text-rose-400' : 'text-cyan-300'
                }
              >
                {formatM3(optimized.peakCargoM3)}
              </span>
              <span className="text-slate-600">·</span>
              <span
                className={
                  overallGankRisk.level === 'critical'
                    ? 'text-rose-400'
                    : overallGankRisk.level === 'warning'
                      ? 'text-amber-300'
                      : 'text-slate-300'
                }
              >
                {formatIsk(optimized.peakCargoIsk)}
              </span>
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="text-[10px] text-slate-400">
              Buy Capital {totalHaulCostDeductionIsk > 0 ? `(+${formatIsk(totalHaulCostDeductionIsk)} Haul)` : ''}
            </div>
            <div
              className={`font-mono tabular-nums text-xs font-semibold mt-0.5 ${
                walletShortfallIsk > 0 ? 'text-rose-400' : 'text-amber-300'
              }`}
            >
              {formatIsk(optimized.totalBuyIsk)}
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="text-[10px] text-slate-400">Net Profit · ISK/Jump</div>
            <div className="font-mono tabular-nums text-xs font-semibold mt-0.5 flex items-center gap-1.5">
              <span
                className={
                  netProfitAfterHaulIsk >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }
              >
                {netProfitAfterHaulIsk >= 0 ? '+' : ''}
                {formatIsk(netProfitAfterHaulIsk)}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-cyan-300 text-[11px]">
                {formatIsk(optimized.totalJumps > 0 ? netProfitAfterHaulIsk / optimized.totalJumps : netProfitAfterHaulIsk)}/j
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Execution Manifest + Fleet/Gank Intel Banners */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {routeError && (
          <div className="px-3 py-2 rounded bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-200">
            {routeError}
          </div>
        )}

        {autoFillSummary && (
          <div className="px-3 py-2 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-[11px] text-emerald-200 flex items-start justify-between gap-2">
            <div className="space-y-0.5 min-w-0">
              <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>
                  Auto-Fill Solver: {autoFillSummary.selectedCardIds.length} Card
                  {autoFillSummary.selectedCardIds.length === 1 ? '' : 's'} Selected
                  {autoFillSummary.netIskPerJump > 0
                    ? ` (${formatIsk(autoFillSummary.netIskPerJump)}/jump)`
                    : ''}
                </span>
              </div>
              <p className="text-[11px] text-emerald-100/85 leading-snug">
                {autoFillSummary.reason}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setAutoFillSummary(null)}
              aria-label="Dismiss solver summary"
              className="text-emerald-300/70 hover:text-emerald-200 shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        {queuedCards.length === 0 ? (
          <div className="border border-slate-800/90 bg-[#131822]/70 rounded-lg p-6 text-center space-y-3">
            <Navigation className="w-6 h-6 text-slate-500 mx-auto" aria-hidden="true" />
            <div className="font-display text-sm font-semibold text-slate-200">
              No Opportunities Queued
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Click <strong className="text-emerald-300">Auto-Fill Best Loop</strong> above to pack the highest ISK/jump route within your hull bays, liquid wallet, and risk cap — or manually tick <strong className="text-slate-200">Add to Route</strong> on any card.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleAutoFillBestLoop}
                disabled={isSolvingLoop || profitableVisibleCount === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-md border border-emerald-500/45 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-45 transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Auto-Fill Best Loop</span>
              </button>
              <button
                type="button"
                onClick={onSelectAllVisible}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer"
              >
                <CheckSquare className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Select All Visible</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Queued Cards Roster + Per-Card Route Haul Cost Override + Commit Route */}
            <div className="no-print bg-[#131822] border border-slate-800/90 rounded-lg px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-slate-300">
                  Queued Cards &amp; Haul Override ({queuedCards.length})
                </span>
                <button
                  type="button"
                  onClick={onClearQueue}
                  className="text-rose-300 hover:text-rose-200 font-medium inline-flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  <span>Clear All</span>
                </button>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {queuedCards.map((card) => {
                  const hasOverride = typeof haulOverrides[card.id] === 'number';
                  const effectiveHaul = hasOverride
                    ? haulOverrides[card.id]
                    : cardTransportMap[card.id]?.transportIsk ?? 0;
                  return (
                    <div
                      key={card.id}
                      className="flex items-center justify-between gap-2 px-2 py-1 rounded border border-slate-800 bg-[#0b0e14] text-[11px]"
                    >
                      <span className="truncate text-slate-200 min-w-0 flex-1" title={card.title}>
                        {card.title}
                      </span>
                      {onSetHaulOverride && (
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[10px] text-slate-500">Haul M:</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={Number((effectiveHaul / 1_000_000).toFixed(2))}
                            onChange={(e) =>
                              onSetHaulOverride(
                                card.id,
                                Math.max(0, Number(e.target.value) || 0) * 1_000_000
                              )
                            }
                            title="Route Haul Cost Override (M ISK). Supersedes card transport cost; clearing restores previous value."
                            className={`w-14 bg-[#131822] border rounded px-1 py-0.5 text-right font-mono text-[10px] ${
                              hasOverride
                                ? 'border-amber-400/70 text-amber-200'
                                : 'border-slate-700 text-slate-300'
                            }`}
                          />
                          {hasOverride && onClearHaulOverride && (
                            <button
                              type="button"
                              onClick={() => onClearHaulOverride(card.id)}
                              title="Clear Route Override and restore previous card transport cost"
                              className="text-amber-300 hover:text-amber-200 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => onRemoveCard(card.id)}
                        aria-label={`Remove ${card.title} from route`}
                        className="text-slate-400 hover:text-rose-300 transition-colors shrink-0 cursor-pointer"
                      >
                        <X className="w-3 h-3" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Save/Commit Current Route + Export Bar */}
              {onSaveCommittedRoute && (
                <div className="flex items-center gap-1.5 pt-1 border-t border-slate-800/80">
                  <input
                    type="text"
                    value={commitRouteName}
                    onChange={(e) => setCommitRouteName(e.target.value)}
                    placeholder="Route name to commit..."
                    className="flex-1 min-w-0 bg-[#0b0e14] border border-slate-800 rounded px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500"
                  />
                  <button
                    type="button"
                    onClick={handleCommitCurrentRoute}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 text-[11px] font-medium whitespace-nowrap cursor-pointer"
                  >
                    <BookmarkCheck className="w-3 h-3" />
                    <span>Commit</span>
                  </button>
                </div>
              )}

              {/* Export Targets: Clipboard (Text/CSV), File (.txt/.csv/.json), PDF Print, Share Link, Discord Push */}
              <div className="flex flex-wrap items-center gap-1 pt-1 border-t border-slate-800/80">
                <button
                  type="button"
                  onClick={() => handleExportClipboard('text')}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Copy full route manifest as plain text"
                >
                  <Copy className="w-2.5 h-2.5" />
                  <span>Txt</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExportClipboard('csv')}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Copy route manifest as CSV"
                >
                  <Copy className="w-2.5 h-2.5" />
                  <span>CSV</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerDownload('foxy-route.txt', buildRouteExportText(), 'text/plain')}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Download route .txt file"
                >
                  <Download className="w-2.5 h-2.5" />
                  <span>.txt</span>
                </button>
                <button
                  type="button"
                  onClick={() => triggerDownload('foxy-route.csv', buildRouteExportCsv(), 'text/csv')}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Download route .csv file"
                >
                  <Download className="w-2.5 h-2.5" />
                  <span>.csv</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    triggerDownload(
                      'foxy-route.json',
                      JSON.stringify({ origin: originSystemName, optimized, haulOverrides }, null, 2),
                      'application/json'
                    )
                  }
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Download route .json file"
                >
                  <Download className="w-2.5 h-2.5" />
                  <span>.json</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Print or Save Route Manifest & Visual Map as PDF"
                >
                  <Printer className="w-2.5 h-2.5" />
                  <span>PDF</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportSharePayload}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-[10px] text-slate-300 hover:text-cyan-200 cursor-pointer"
                  title="Copy shareable route link payload"
                >
                  <Share2 className="w-2.5 h-2.5" />
                  <span>Share</span>
                </button>
                <button
                  type="button"
                  onClick={handlePushDiscord}
                  disabled={exportingDiscord}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-indigo-500/45 bg-indigo-500/15 text-[10px] text-indigo-200 hover:bg-indigo-500/25 cursor-pointer disabled:opacity-50"
                  title="Push route manifest summary to your configured Discord Webhook"
                >
                  <Send className="w-2.5 h-2.5" />
                  <span>{exportingDiscord ? '...' : 'Discord'}</span>
                </button>
                <label className="inline-flex items-center gap-1 ml-auto text-[10px] text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={depthAwareCopy}
                    onChange={(e) => setDepthAwareCopy(e.target.checked)}
                    className="accent-cyan-400"
                  />
                  <span>Depth-Split</span>
                </label>
              </div>
            </div>

            {/* Active Hull Telemetry & Fitted Bay Summary */}
            {activeHull && (
              <div className="bg-[#131822] border border-slate-800/90 rounded-lg px-3.5 py-2.5 space-y-1.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-cyan-300 flex items-center gap-1.5">
                      <Ship className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{activeHull.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                      {hullRecommendation && activeHull.id === hullRecommendation.hull.id
                        ? hullRecommendation.reason
                        : activeHull.notes}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-[11px] shrink-0">
                    <div className="text-slate-200 font-medium">
                      {formatM3(effectiveMaxCargoM3)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      Safe ≤ {formatIsk(activeHull.safeIskThreshold ?? 750_000_000)}
                    </div>
                  </div>
                </div>

                {/* Fitted bays & modules readout */}
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-mono text-slate-400 pt-1 border-t border-slate-800/70">
                  {activeHull.fittedCargoM3 !== undefined && (
                    <span>Cargo: {formatM3(activeHull.fittedCargoM3)}</span>
                  )}
                  {activeHull.fleetHangarM3 !== undefined && activeHull.fleetHangarM3 > 0 && (
                    <span className="text-cyan-300/90">
                      Fleet Hangar: {formatM3(activeHull.fleetHangarM3)}
                    </span>
                  )}
                  {(activeHull.specialBays || []).map((bay) => (
                    <span key={bay.name} className="text-emerald-300/90">
                      {bay.name}: {formatM3(bay.capacityM3)}
                    </span>
                  ))}
                </div>
                {((activeHull.fittedModules && activeHull.fittedModules.length > 0) ||
                  (activeHull.fittedRigs && activeHull.fittedRigs.length > 0)) && (
                  <div className="text-[10px] text-slate-500 truncate">
                    Fit: {[...(activeHull.fittedModules || []), ...(activeHull.fittedRigs || [])].slice(0, 4).join(' · ')}
                  </div>
                )}
              </div>
            )}

            {/* Prep Step 0: Pick up Recommended/Selected Hull if parked away */}
            {prepStep0 && (
              <div className="bg-cyan-500/10 border border-cyan-500/40 rounded-lg px-3.5 py-2.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-cyan-200 flex items-center gap-1.5">
                      <span className="font-mono">PREP STEP 0</span>
                      <span className="text-cyan-500">·</span>
                      <span className="truncate">Pick up {prepStep0.hull.name}</span>
                    </div>
                    <div className="text-[11px] text-slate-300 mt-0.5 truncate" title={prepStep0.stationName}>
                      {prepStep0.stationName}
                    </div>
                    <div className="text-[10px] font-mono text-cyan-300/80 mt-0.5">
                      {prepStep0.jumps === 0
                        ? `Local dock in ${prepStep0.systemName}`
                        : `${prepStep0.jumps} jump${prepStep0.jumps === 1 ? '' : 's'} from ${originSystemName}`}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleSetDestination(
                        prepStep0.destinationId,
                        `${prepStep0.stationName}`,
                        'prep-0'
                      )
                    }
                    disabled={autopilotBusyId === 'prep-0'}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium rounded border border-cyan-400/50 bg-[#0b0e14]/80 text-cyan-200 hover:bg-cyan-500/20 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Navigation className="w-3 h-3" aria-hidden="true" />
                    <span>{autopilotBusyId === 'prep-0' ? 'Setting...' : 'Set Destination'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* ISK Gank-Risk Threshold Alert Banner */}
            {overallGankRisk.level !== 'safe' || exceedsRiskCap ? (
              <div
                className={`print-gank-alert px-3.5 py-2.5 rounded-lg border text-[11px] space-y-1 ${
                  overallGankRisk.level === 'critical' || exceedsRiskCap
                    ? 'bg-rose-500/12 border-rose-500/50 text-rose-200'
                    : 'bg-amber-500/12 border-amber-500/50 text-amber-200'
                }`}
              >
                <div className="font-semibold flex items-center gap-1.5">
                  <ShieldAlert
                    className={`w-3.5 h-3.5 shrink-0 ${
                      overallGankRisk.level === 'critical' || exceedsRiskCap
                        ? 'text-rose-400'
                        : 'text-amber-400'
                    }`}
                    aria-hidden="true"
                  />
                  <span>
                    {exceedsRiskCap
                      ? `Peak cargo (${formatIsk(optimized.peakCargoIsk)}) exceeds your ${formatIsk(effectiveMaxCargoIskCap)} Max Cargo Cap`
                      : overallGankRisk.headline}
                  </span>
                </div>
                <p className="text-[11px] opacity-90 leading-snug">
                  {overallGankRisk.recommendation}
                </p>
              </div>
            ) : (
              <div className="px-3 py-1.5 rounded border border-emerald-500/30 bg-emerald-500/5 text-[11px] text-emerald-300/90 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>
                  Gank-Risk Check: Peak cargo {formatIsk(optimized.peakCargoIsk)} is within {formatIsk(effectiveMaxCargoIskCap)} risk cap &amp; hull threshold.
                </span>
              </div>
            )}

            {/* Over-Capacity Warning */}
            {optimized.overCapacityStops > 0 && (
              <div className="px-3 py-2 rounded bg-rose-500/10 border border-rose-500/40 text-[11px] text-rose-200 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" aria-hidden="true" />
                <span>
                  Cargo exceeds {formatM3(effectiveMaxCargoM3)} on {optimized.overCapacityStops} stop
                  {optimized.overCapacityStops > 1 ? 's' : ''}. Switch hull or split load.
                </span>
              </div>
            )}

            {/* Toggleable Interactive 2D Visual Buy/Sell Route Map (Real EVE ESI x, z Coordinates) */}
            {showRouteMap && optimized.stops.length > 0 && (
              <VisualRouteMap
                optimized={optimized}
                routeIntel={routeIntel}
                originSystemId={originSystemId}
                originSystemName={originSystemName}
                prepStep0={
                  prepStep0
                    ? {
                        hullName: prepStep0.hull.name,
                        jumps: prepStep0.jumps,
                        systemId: prepStep0.hull.systemId ?? originSystemId,
                        systemName: prepStep0.systemName,
                        stationName: prepStep0.stationName,
                      }
                    : null
                }
              />
            )}

            {/* Station-by-Station Execution Manifest */}
            {optimized.stops.map((stop) => {
              const cargoPct =
                effectiveMaxCargoM3 > 0
                  ? Math.min(100, (stop.peakCargoM3 / effectiveMaxCargoM3) * 100)
                  : 0;
              const rawPct =
                effectiveMaxCargoM3 > 0
                  ? Math.round((stop.peakCargoM3 / effectiveMaxCargoM3) * 100)
                  : 0;
              const busyKey = `stop-${stop.stopNumber}`;

              return (
                <div
                  key={`${stop.stopNumber}-${stop.systemId}-${stop.stationName}`}
                  className={`bg-[#131822] border rounded-lg overflow-hidden ${
                    stop.isOverCapacity || stop.gankRisk.level === 'critical'
                      ? 'border-rose-500/60'
                      : stop.hotSystems.length > 0 || stop.gankRisk.level === 'warning'
                        ? 'border-amber-500/50'
                        : 'border-slate-800/90'
                  }`}
                >
                  {/* Stop Header + One-Click Set Destination */}
                  <div className="px-3.5 py-2.5 border-b border-slate-800/80 flex items-start justify-between gap-2 bg-[#0f141d]/70">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="font-mono tabular-nums font-semibold text-cyan-400">
                          STOP {String(stop.stopNumber).padStart(2, '0')}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="font-semibold text-slate-100">
                          {stop.systemName}
                        </span>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono tabular-nums text-slate-300">
                          {stop.jumpsFromPrev === 0
                            ? '0j'
                            : `${stop.jumpsFromPrev}j`}
                        </span>
                      </div>
                      <div
                        className="text-[11px] text-slate-400 truncate mt-0.5"
                        title={stop.stationName}
                      >
                        {stop.stationName}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleSetDestination(
                          stop.destinationId,
                          stop.stationName,
                          busyKey
                        )
                      }
                      disabled={autopilotBusyId === busyKey}
                      title={`Set in-game EVE Autopilot destination to ${stop.stationName}`}
                      className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Navigation className="w-3 h-3" aria-hidden="true" />
                      <span>
                        {autopilotBusyId === busyKey ? '...' : 'Set Destination'}
                      </span>
                    </button>
                  </div>

                  {/* Live Gatecamp Scanner: HOT SYSTEM Warnings with zKillboard Link */}
                  {stop.hotSystems.length > 0 && (
                    <div className="px-3.5 py-2 border-b border-rose-500/25 bg-rose-500/10 space-y-1.5">
                      {stop.hotSystems.map((hs) => (
                        <div
                          key={hs.systemId}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0 text-rose-200">
                            <Flame
                              className={`w-3.5 h-3.5 shrink-0 ${
                                hs.severity === 'critical' ? 'text-rose-400' : 'text-amber-400'
                              }`}
                              aria-hidden="true"
                            />
                            <span className="truncate font-mono tabular-nums">
                              <strong className="text-rose-300">HOT SYSTEM:</strong>{' '}
                              {hs.systemName} ({hs.shipKills} ship / {hs.podKills} pod kills 1h)
                            </span>
                          </div>
                          <a
                            href={hs.zkillUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-300 hover:text-amber-200 underline whitespace-nowrap shrink-0"
                          >
                            <span>Check Gatecamp Intel</span>
                            <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                          </a>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Per-Leg Gank Target Risk Warning */}
                  {stop.gankRisk.level !== 'safe' && (
                    <div
                      className={`px-3.5 py-1.5 border-b text-[11px] flex items-center gap-1.5 ${
                        stop.gankRisk.level === 'critical'
                          ? 'bg-rose-500/10 border-rose-500/25 text-rose-300'
                          : 'bg-amber-500/10 border-amber-500/25 text-amber-300'
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate font-mono tabular-nums">
                        {stop.gankRisk.headline}
                      </span>
                    </div>
                  )}

                  {/* Exact BUY Instructions */}
                  {stop.buys.length > 0 && (() => {
                    const stopCopyKey = `${stop.stopNumber}-${stop.systemId}-${stop.stationName}`;
                    const isCopiedThisStop = copiedMultibuy?.stopKey === stopCopyKey;
                    const copiedCount = copiedMultibuy?.itemCount ?? stop.buys.length;
                    return (
                      <div className="px-3.5 py-2.5 border-b border-slate-800/70 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-semibold text-amber-300 tracking-wide">
                              BUY ({stop.buys.length} {stop.buys.length === 1 ? 'item' : 'items'})
                            </span>
                            <span className="font-mono tabular-nums text-amber-300">
                              -{formatIsk(stop.totalBuyIsk)}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleCopyStopMultibuy(stopCopyKey, stop.buys, stop.systemId)}
                            title={
                              depthAwareCopy
                                ? 'Copy Depth-Aware tier-split BUY items for EVE Online Multibuy'
                                : 'Copy all BUY items for this station as <Item Name><TAB><Quantity> for EVE Online Multibuy'
                            }
                            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              isCopiedThisStop
                                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                                : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 hover:border-cyan-400/60'
                            }`}
                          >
                            {isCopiedThisStop ? (
                              <Check className="w-3 h-3 text-emerald-300 shrink-0" aria-hidden="true" />
                            ) : (
                              <Copy className="w-3 h-3 shrink-0" aria-hidden="true" />
                            )}
                            <span>
                              {isCopiedThisStop
                                ? `Copied ${copiedCount} ${copiedCount === 1 ? 'item' : 'items'} (${depthAwareCopy ? 'Depth-Split' : 'Standard'})`
                                : depthAwareCopy
                                  ? 'Copy Depth-Split Multibuy'
                                  : 'Copy for EVE Multibuy'}
                            </span>
                          </button>
                        </div>
                        <ul className="space-y-1.5 text-xs">
                          {stop.buys.map((item, idx) => {
                            const itemBusyKey = `buy-${stop.stopNumber}-${item.typeId ?? item.name}-${idx}`;
                            return (
                              <li
                                key={`${item.name}-${idx}`}
                                className="flex items-center justify-between gap-2 text-slate-300"
                              >
                                <span className="truncate min-w-0">
                                  <span className="font-mono tabular-nums text-slate-100 font-medium">
                                    {item.quantity.toLocaleString('en-US')}×
                                  </span>{' '}
                                  {item.name}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="font-mono tabular-nums text-[11px] text-slate-400">
                                    {formatIsk(item.iskAmount)}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleOpenMarketInEve(item.typeId, item.name, itemBusyKey)
                                    }
                                    disabled={marketBusyKey === itemBusyKey}
                                    title={`Open ${item.name} market order book inside EVE Online (esi-ui.open_window.v1)`}
                                    className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-slate-700/90 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/15 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                                  >
                                    <ExternalLink className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                                    <span>{marketBusyKey === itemBusyKey ? '...' : 'Open in EVE'}</span>
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })()}

                  {/* Manufacturing / PI Staging Instructions */}
                  {stop.processes.length > 0 && (
                    <div className="px-3.5 py-2.5 border-b border-slate-800/70 space-y-1.5 bg-[#0f141d]/30">
                      <div className="text-[11px] font-semibold text-cyan-300 tracking-wide">
                        BUILD / STAGE ({stop.processes.length})
                      </div>
                      <ul className="space-y-1 text-[11px] text-slate-300">
                        {stop.processes.map((proc, idx) => (
                          <li key={idx} className="leading-snug">
                            <span className="text-slate-100 font-medium">{proc.cardTitle}:</span>{' '}
                            <span className="text-slate-400">{proc.note}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Exact SELL Instructions */}
                  {stop.sells.length > 0 && (
                    <div className="px-3.5 py-2.5 border-b border-slate-800/70 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-emerald-400 tracking-wide">
                          SELL ({stop.sells.length} {stop.sells.length === 1 ? 'item' : 'items'})
                        </span>
                        <span className="font-mono tabular-nums text-emerald-400">
                          +{formatIsk(stop.totalSellIsk)}
                        </span>
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        {stop.sells.map((item, idx) => {
                          const itemBusyKey = `sell-${stop.stopNumber}-${item.typeId ?? item.name}-${idx}`;
                          return (
                            <li
                              key={`${item.name}-${idx}`}
                              className="flex items-center justify-between gap-2 text-slate-300"
                            >
                              <span className="truncate min-w-0">
                                <span className="font-mono tabular-nums text-slate-100 font-medium">
                                  {item.quantity.toLocaleString('en-US')}×
                                </span>{' '}
                                {item.name}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="font-mono tabular-nums text-[11px] text-emerald-300/90">
                                  +{formatIsk(item.iskAmount)}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenMarketInEve(item.typeId, item.name, itemBusyKey)
                                  }
                                  disabled={marketBusyKey === itemBusyKey}
                                  title={`Open ${item.name} market order book inside EVE Online (esi-ui.open_window.v1)`}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border border-slate-700/90 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/15 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                                >
                                  <ExternalLink className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                                  <span>{marketBusyKey === itemBusyKey ? '...' : 'Open in EVE'}</span>
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}

                  {/* Running Cargo Hold m3 Bar + Cumulative Net Profit */}
                  <div className="px-3.5 py-2.5 bg-[#0d1118]/70 space-y-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                        <span
                          className={
                            stop.isOverCapacity ? 'text-rose-400 font-semibold' : 'text-slate-400'
                          }
                        >
                          {stop.isOverCapacity ? 'CARGO OVER LIMIT' : 'Cargo Hold'}
                        </span>
                        <span
                          className={
                            stop.isOverCapacity ? 'text-rose-400 font-semibold' : 'text-slate-200'
                          }
                        >
                          {formatM3(stop.peakCargoM3)} / {formatM3(effectiveMaxCargoM3)} ({rawPct}%)
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full transition-all ${
                            stop.isOverCapacity
                              ? 'bg-rose-500'
                              : rawPct >= 85
                                ? 'bg-amber-400'
                                : 'bg-cyan-400'
                          }`}
                          style={{ width: `${cargoPct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-slate-800/70">
                      <span className="text-slate-400">Cumulative Net Profit</span>
                      <span
                        className={`font-mono tabular-nums font-semibold ${
                          stop.cumulativeNetProfitIsk >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {stop.cumulativeNetProfitIsk >= 0 ? '+' : ''}
                        {formatIsk(stop.cumulativeNetProfitIsk)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Optional Final Return / End Hub Leg */}
            {optimized.returnLegDestinationId &&
              optimized.returnLegJumps !== undefined &&
              optimized.returnLegJumps > 0 && (
                <div className="bg-[#131822] border border-cyan-500/35 rounded-lg px-3.5 py-2.5 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className="font-mono font-semibold text-cyan-300">END HUB</span>
                      <span className="text-slate-600">·</span>
                      <span className="font-semibold text-slate-100">
                        {optimized.returnLegSystemName}
                      </span>
                      <span className="text-slate-600">·</span>
                      <span className="font-mono tabular-nums text-slate-300">
                        {optimized.returnLegJumps}j
                      </span>
                    </div>
                    <div
                      className="text-[11px] text-slate-400 truncate mt-0.5"
                      title={optimized.returnLegStationName}
                    >
                      {optimized.returnLegStationName} (Empty return / staging leg)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      handleSetDestination(
                        optimized.returnLegDestinationId!,
                        optimized.returnLegStationName || optimized.returnLegSystemName || 'End Hub',
                        'return-hub'
                      )
                    }
                    disabled={autopilotBusyId === 'return-hub'}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Navigation className="w-3 h-3" aria-hidden="true" />
                    <span>
                      {autopilotBusyId === 'return-hub' ? '...' : 'Set Destination'}
                    </span>
                  </button>
                </div>
              )}
          </>
        )}
      </div>

      {/* Footer Clear Action */}
      {queuedCards.length > 0 && (
        <div className="px-4 py-2.5 border-t border-slate-800/90 bg-[#0d1118] flex items-center justify-between gap-2 shrink-0">
          <span className="text-[11px] text-slate-500 font-mono flex items-center gap-1">
            <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
            <span>ESI Route + Kill Intel Live</span>
          </span>
          <button
            type="button"
            onClick={onClearQueue}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-800 text-slate-300 hover:border-rose-500/50 hover:text-rose-300 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Clear Route</span>
          </button>
        </div>
      )}
    </aside>
  );
}
