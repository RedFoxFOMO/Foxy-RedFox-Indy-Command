import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  KeyRound,
  Route,
  ScrollText,
  Settings,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { ActionCard } from './components/ActionCard.tsx';
import { AdvisorSidebar } from './components/AdvisorSidebar.tsx';
import { BlueprintLibraryPanel } from './components/BlueprintLibraryPanel.tsx';
import { CategorySkuModal } from './components/CategorySkuModal.tsx';
import { InspectDrawer } from './components/InspectDrawer.tsx';
import { JitaDodixieChart } from './components/JitaDodixieChart.tsx';
import { MarketHistoryModal } from './components/MarketHistoryModal.tsx';
import { MarketScopeBar } from './components/MarketScopeBar.tsx';
import { OverviewProfitChart } from './components/OverviewProfitChart.tsx';
import { RouteOptimizerSidebar } from './components/RouteOptimizerSidebar.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import { TopBar } from './components/TopBar.tsx';
import type { WorkspaceView } from './components/TopBar.tsx';
import {
  DEFAULT_SIMULATION_PROFILE,
  ITEM_BY_ID,
  SCOPE_PRESETS,
} from './data/eveCatalog.ts';
import {
  formatIsk,
  formatM3,
  formatPct,
  getEffectiveOrderFees,
  getQuote,
  runAllDecisionEngines,
} from './engines/decisionEngines.ts';
import type {
  ActionCardData,
  AdvisorAction,
  AppStateSummary,
  ChatMessage,
  CorridorOrder,
  CustomShoppingItem,
  DynamicMarketCatalog,
  EngineId,
  EsiRateLimitState,
  MarketCategoryDef,
  MarketCategoryId,
  MarketQuote,
  MarketScanProgress,
  MarketSnapshot,
  OrderExecutionMode,
  PilotProfile,
  ShoppingListLine,
} from './types/eve.ts';
import { buildEveAuthorizeUrl } from './utils/evePkce.ts';
import {
  CATALOG_REBUILD_COOLDOWN_MS,
  MARKET_REFRESH_COOLDOWN_MS,
  buildBaselineCatalog,
  clearCachedCatalog,
  getCooldownUntil,
  loadCachedCatalog,
  saveCachedCatalog,
  setCooldownUntil,
} from './utils/marketCatalogCache.ts';

const ENGINE_SECTIONS: { id: EngineId; index: string; title: string; subtitle: string }[] = [
  {
    id: 'indy_invention',
    index: '01.',
    title: 'Ishisomo Industry & T2 Copy / Invention Planner',
    subtitle: 'State War Academy manufacturing (NPC 0% structure ME) & Propel Dynamics vanilla T2 invention (no decryptors).',
  },
  {
    id: 'reprocessing',
    index: '02.',
    title: 'Ore, Ice & Scrap Reprocessing Arbitrage',
    subtitle: 'Level 5 reprocessing yield vs. Jita Sell Order acquisition, 50/50 split vs. direct build supply.',
  },
  {
    id: 'pipeline_corridor',
    index: '03.',
    title: 'Pipeline & Sub-Hub Arbitrage (2-Jump Corridor)',
    subtitle: 'ESI regional scan within 2 jumps of Ishisomo <-> Jita for discounted pickups and return sub-hub stocking.',
  },
  {
    id: 'regional_trade',
    index: '04.',
    title: 'Regional Trade Manifesto (Jita <-> Dodixie)',
    subtitle: 'Ranked outbound & backhaul manifests capped by active ISK float, hull m³, and Dodixie daily turnover.',
  },
  {
    id: 'pi_factory',
    index: '05.',
    title: 'PI Factory Planet Evaluator (NPC POCO Tax)',
    subtitle: 'Weekly P0->P1, P1->P2, P2->P3, and P3->P4 high-sec factory setups priced on live Jita feeds.',
  },
];

function nowTimeLabel(): string {
  return new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function createWelcomeMessage(profile: PilotProfile): ChatMessage {
  return {
    id: 'welcome-msg',
    role: 'assistant',
    timestamp: nowTimeLabel(),
    content: [
      `Command link active for **${profile.characterName}** (${profile.currentSystemName} · ${formatIsk(profile.activeCapitalCap)} cap).`,
      '1. Toggle **Market Scope checkboxes** above to filter live Fuzzwork/ESI sync and all five profit engines.',
      '2. Click **Inspect Data** on any Action Card for full BOMs, mineral yields, or hauling manifests.',
      '3. Ask me for numbered execution plans — I query your live engines via Function Calling before answering.',
    ].join('\n'),
  };
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('overview');
  const [checkedCategories, setCheckedCategories] = useState<MarketCategoryId[]>(
    SCOPE_PRESETS.all
  );
  const [scopeExpanded, setScopeExpanded] = useState(true);
  const [profile, setProfile] = useState<PilotProfile>(DEFAULT_SIMULATION_PROFILE);

  const [snapshot, setSnapshot] = useState<MarketSnapshot>({
    quotes: {},
    corridorOrders: [],
    lastSyncedAt: null,
    liveItemCount: 0,
    sourceMode: 'baseline',
    syncError: null,
  });
  const [isSyncing, setIsSyncing] = useState(false);

  // Dynamic 19-Category EVE ESI Market Group Catalog (7-day localStorage cache)
  const [catalog, setCatalog] = useState<DynamicMarketCatalog>(
    () => loadCachedCatalog() ?? buildBaselineCatalog()
  );
  const [isCatalogLoading, setIsCatalogLoading] = useState(false);
  const [inspectedSkuCategory, setInspectedSkuCategory] =
    useState<MarketCategoryDef | null>(null);
  const [minDailyVolume, setMinDailyVolume] = useState<number>(20);

  // Strict ESI Fair-Use Cooldowns (5m market refresh, 1h catalog rebuild) + Rate-Limit Guard
  const [marketCooldownUntil, setMarketCooldownUntil] = useState<number>(() =>
    getCooldownUntil('market')
  );
  const [catalogCooldownUntil, setCatalogCooldownUntil] = useState<number>(() =>
    getCooldownUntil('catalog')
  );
  const [esiRateLimit, setEsiRateLimit] = useState<EsiRateLimitState | null>(null);
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [scanProgress, setScanProgress] = useState<MarketScanProgress>({
    active: false,
    completedItems: 0,
    totalItems: 0,
    completedBatches: 0,
    totalBatches: 0,
    liveFound: 0,
  });
  const scanAbortRef = useRef(false);

  const [inspectedCard, setInspectedCard] = useState<ActionCardData | null>(null);
  const [showShoppingListDrawer, setShowShoppingListDrawer] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{ typeId: number; name: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<'sso' | 'profile' | 'assets'>('sso');

  const openSettingsTab = useCallback((tab: 'sso' | 'profile' | 'assets') => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleOpenHistory = useCallback((typeId: number, name: string) => {
    setHistoryTarget({ typeId, name });
  }, []);

  // EVE SSO PKCE & Full Blueprint Scanner state
  const [eveClientId, setEveClientId] = useState<string>(() => {
    try {
      return localStorage.getItem('new_eden_eve_client_id') || '';
    } catch {
      return '';
    }
  });
  const [callbackUrl, setCallbackUrl] = useState<string>(
    `${window.location.origin}/auth/callback`
  );
  const [ssoStatusMsg, setSsoStatusMsg] = useState<string | null>(null);
  const [isSsoConnecting, setIsSsoConnecting] = useState(false);
  const [eveAccessToken, setEveAccessToken] = useState<string | null>(null);
  const [includeCorpBlueprints, setIncludeCorpBlueprints] = useState(false);
  const includeCorpRef = useRef(false);
  const [isScanningBlueprints, setIsScanningBlueprints] = useState(false);
  const [blueprintScanError, setBlueprintScanError] = useState<string | null>(null);
  const [isRefreshingWalletOrders, setIsRefreshingWalletOrders] = useState(false);
  const pkceRef = useRef<{ codeVerifier: string; state: string; clientId: string } | null>(null);

  useEffect(() => {
    includeCorpRef.current = includeCorpBlueprints;
  }, [includeCorpBlueprints]);

  // Right-hand docked sidebar mode ('advisor' | 'route' | 'collapsed') & Route Queue state
  const [rightSidebarMode, setRightSidebarMode] = useState<'advisor' | 'route' | 'collapsed'>('advisor');
  const [queuedRouteIds, setQueuedRouteIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createWelcomeMessage(DEFAULT_SIMULATION_PROFILE),
  ]);
  const [isAdvisorLoading, setIsAdvisorLoading] = useState(false);
  const [appliedActionIds, setAppliedActionIds] = useState<string[]>([]);
  const [customShoppingItems, setCustomShoppingItems] = useState<CustomShoppingItem[]>([]);
  const [actionToast, setActionToast] = useState<string | null>(null);

  // Fetch SSO config from server
  useEffect(() => {
    fetch('/api/eve/sso-config')
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg: { callbackUrl?: string; serverClientId?: string } | null) => {
        if (!cfg) return;
        if (cfg.callbackUrl && cfg.callbackUrl.startsWith('http')) {
          setCallbackUrl(cfg.callbackUrl);
        } else {
          setCallbackUrl(`${window.location.origin}/auth/callback`);
        }
        if (cfg.serverClientId && !eveClientId) {
          setEveClientId(cfg.serverClientId);
        }
      })
      .catch(() => {
        setCallbackUrl(`${window.location.origin}/auth/callback`);
      });
  }, []);

  // Live 1-second countdown ticker while any ESI cooldown or rate-limit pause is active
  const marketCooldownRemainingSec =
    marketCooldownUntil > nowTick
      ? Math.ceil((marketCooldownUntil - nowTick) / 1000)
      : 0;
  const catalogCooldownRemainingSec =
    catalogCooldownUntil > nowTick
      ? Math.ceil((catalogCooldownUntil - nowTick) / 1000)
      : 0;
  const rateLimitPauseRemainingSec =
    esiRateLimit?.paused && (esiRateLimit.pausedUntilMs ?? 0) > nowTick
      ? Math.ceil(((esiRateLimit.pausedUntilMs ?? 0) - nowTick) / 1000)
      : 0;

  useEffect(() => {
    const hasActiveTimer =
      marketCooldownUntil > Date.now() ||
      catalogCooldownUntil > Date.now() ||
      Boolean(esiRateLimit?.paused && (esiRateLimit.pausedUntilMs ?? 0) > Date.now());
    if (!hasActiveTimer) return;

    const interval = window.setInterval(() => {
      const now = Date.now();
      setNowTick(now);
      setEsiRateLimit((prev) =>
        prev?.paused && (prev.pausedUntilMs ?? 0) <= now
          ? { ...prev, paused: false, pausedUntilMs: undefined, pauseReason: undefined }
          : prev
      );
    }, 1000);
    return () => window.clearInterval(interval);
  }, [marketCooldownUntil, catalogCooldownUntil, esiRateLimit]);

  // Fetch & 7-day localStorage-cache official EVE ESI Market Group catalogs on first visit
  useEffect(() => {
    const cached = loadCachedCatalog();
    if (cached) return;

    let cancelled = false;
    setIsCatalogLoading(true);
    fetch('/api/catalog/market-groups')
      .then(async (res) => {
        const data = (await res.json()) as DynamicMarketCatalog & { error?: string };
        if (cancelled) return;
        if (data.esiRateLimit) {
          setEsiRateLimit(data.esiRateLimit);
          setNowTick(Date.now());
        }
        if (res.ok && data.categories) {
          setCatalog(data);
          if (data.source === 'esi_live') {
            saveCachedCatalog(data);
          }
        }
      })
      .catch(() => {
        // Keep baseline catalog gracefully if ESI is unreachable
      })
      .finally(() => {
        if (!cancelled) setIsCatalogLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Sync live Fuzzwork + EVE ESI market data for checked categories (initial load / category toggle)
  const syncLiveMarkets = useCallback(
    async (cats: MarketCategoryId[], force = false) => {
      if (cats.length === 0) {
        setSnapshot((prev) => ({
          ...prev,
          liveItemCount: 0,
          lastSyncedAt: new Date().toISOString(),
        }));
        return;
      }

      setIsSyncing(true);
      try {
        const qs = new URLSearchParams({
          categories: cats.join(','),
          force: force ? 'true' : 'false',
        });
        const res = await fetch(`/api/market/sync?${qs.toString()}`);
        if (!res.ok) {
          throw new Error(`Market sync returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as MarketSnapshot;
        if (data.esiRateLimit) {
          setEsiRateLimit(data.esiRateLimit);
          setNowTick(Date.now());
        }
        setSnapshot((prev) => {
          const mergedQuotes: Record<number, MarketQuote> = {
            ...prev.quotes,
            ...data.quotes,
          };
          const orderMap = new Map<number, CorridorOrder>();
          for (const o of prev.corridorOrders) orderMap.set(o.orderId, o);
          for (const o of data.corridorOrders) orderMap.set(o.orderId, o);
          const mergedOrders = Array.from(orderMap.values());
          const liveItemCount = Object.values(mergedQuotes).filter(
            (q) => q.source === 'live'
          ).length;

          return {
            ...data,
            quotes: mergedQuotes,
            corridorOrders: mergedOrders,
            liveItemCount,
            sourceMode:
              liveItemCount > 0 ? data.sourceMode : prev.sourceMode,
            syncError: null,
          };
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Unable to reach market proxy.';
        setSnapshot((prev) => ({
          ...prev,
          syncError: message,
        }));
      } finally {
        setIsSyncing(false);
      }
    },
    []
  );

  // Protected "Refresh Market Prices" — Throttled 18-item parallel batch ESI order scanner (5-min cooldown)
  const handleRefreshMarketPrices = useCallback(async () => {
    if (
      marketCooldownRemainingSec > 0 ||
      scanProgress.active ||
      rateLimitPauseRemainingSec > 0 ||
      checkedCategories.length === 0
    ) {
      return;
    }

    // Prioritize baseline Indy/Reproc/PI items first, followed by all dynamic ESI SKUs in ticked categories
    const baselineIds: number[] = [];
    const dynamicIds: number[] = [];
    const seen = new Set<number>();

    for (const catId of checkedCategories) {
      for (const sku of catalog.categories[catId] ?? []) {
        if (seen.has(sku.typeId)) continue;
        seen.add(sku.typeId);
        if (sku.isBaseline) {
          baselineIds.push(sku.typeId);
        } else {
          dynamicIds.push(sku.typeId);
        }
      }
    }

    const orderedTypeIds = [...baselineIds, ...dynamicIds];
    if (orderedTypeIds.length === 0) return;

    const BATCH_SIZE = 18;
    const batches: number[][] = [];
    for (let i = 0; i < orderedTypeIds.length; i += BATCH_SIZE) {
      batches.push(orderedTypeIds.slice(i, i + BATCH_SIZE));
    }

    scanAbortRef.current = false;
    setIsSyncing(true);
    setSnapshot((prev) => ({ ...prev, syncError: null }));
    setScanProgress({
      active: true,
      completedItems: 0,
      totalItems: orderedTypeIds.length,
      completedBatches: 0,
      totalBatches: batches.length,
      liveFound: 0,
    });

    let completedItems = 0;
    let completedBatches = 0;
    let liveFound = 0;
    let rateLimited = false;

    try {
      for (const batch of batches) {
        if (scanAbortRef.current) break;

        const res = await fetch('/api/market/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ typeIds: batch, force: true }),
        });

        const data = (await res.json()) as {
          quotes?: Record<number, MarketQuote>;
          corridorOrders?: CorridorOrder[];
          liveCount?: number;
          esiRateLimit?: EsiRateLimitState;
          error?: string;
        };

        if (data.esiRateLimit) {
          setEsiRateLimit(data.esiRateLimit);
          setNowTick(Date.now());
        }

        if (data.quotes && Object.keys(data.quotes).length > 0) {
          setSnapshot((prev) => {
            const mergedQuotes: Record<number, MarketQuote> = {
              ...prev.quotes,
              ...data.quotes,
            };
            const orderMap = new Map<number, CorridorOrder>();
            for (const o of prev.corridorOrders) orderMap.set(o.orderId, o);
            for (const o of data.corridorOrders ?? []) orderMap.set(o.orderId, o);
            const liveItemCount = Object.values(mergedQuotes).filter(
              (q) => q.source === 'live'
            ).length;
            return {
              ...prev,
              quotes: mergedQuotes,
              corridorOrders: Array.from(orderMap.values()),
              liveItemCount,
              sourceMode: liveItemCount > 0 ? 'live' : prev.sourceMode,
              lastSyncedAt: new Date().toISOString(),
              syncError: null,
            };
          });
        }

        completedItems += batch.length;
        completedBatches += 1;
        liveFound += data.liveCount ?? 0;
        setScanProgress({
          active: true,
          completedItems,
          totalItems: orderedTypeIds.length,
          completedBatches,
          totalBatches: batches.length,
          liveFound,
        });

        // Immediately pause scanning if ESI error/rate-limit guard tripped (HTTP 429 or <20 budget)
        if (res.status === 429 || data.esiRateLimit?.paused) {
          rateLimited = true;
          break;
        }
        if (!res.ok) {
          throw new Error(data.error || `Batch scan returned HTTP ${res.status}`);
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Market batch scan interrupted.';
      setSnapshot((prev) => ({ ...prev, syncError: msg }));
    } finally {
      setIsSyncing(false);
      setScanProgress((prev) => ({ ...prev, active: false }));
      if (completedBatches > 0 && !rateLimited) {
        const until = Date.now() + MARKET_REFRESH_COOLDOWN_MS;
        setCooldownUntil('market', until);
        setMarketCooldownUntil(until);
        setNowTick(Date.now());
        setActionToast(
          `Scanned ${completedItems.toLocaleString()} SKUs (${liveFound.toLocaleString()} live Jita/Dodixie quotes). 5-min ESI cooldown active.`
        );
        window.setTimeout(() => setActionToast(null), 4000);
      }
    }
  }, [
    catalog.categories,
    checkedCategories,
    marketCooldownRemainingSec,
    rateLimitPauseRemainingSec,
    scanProgress.active,
  ]);

  // Protected "Rebuild Item Catalog" — Clears localStorage & rebuilds ESI Market Group tree (1-hour cooldown)
  const handleRebuildCatalog = useCallback(async () => {
    if (
      catalogCooldownRemainingSec > 0 ||
      isCatalogLoading ||
      rateLimitPauseRemainingSec > 0
    ) {
      return;
    }

    clearCachedCatalog();
    setIsCatalogLoading(true);
    try {
      const res = await fetch('/api/catalog/market-groups?force=true');
      const data = (await res.json()) as DynamicMarketCatalog & { error?: string };
      if (data.esiRateLimit) {
        setEsiRateLimit(data.esiRateLimit);
        setNowTick(Date.now());
      }
      if (res.status === 429 || data.esiRateLimit?.paused) {
        return;
      }
      if (!res.ok || !data.categories) {
        throw new Error(data.error || `Catalog rebuild returned HTTP ${res.status}`);
      }
      setCatalog(data);
      if (data.source === 'esi_live') {
        saveCachedCatalog(data);
      }
      const until = Date.now() + CATALOG_REBUILD_COOLDOWN_MS;
      setCooldownUntil('catalog', until);
      setCatalogCooldownUntil(until);
      setNowTick(Date.now());
      setActionToast(
        `Rebuilt EVE ESI catalog: ${data.totalSkus.toLocaleString()} SKUs across 19 categories (cached 7 days, 1-hour rebuild cooldown active).`
      );
      window.setTimeout(() => setActionToast(null), 4500);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to rebuild EVE ESI catalog.';
      setSnapshot((prev) => ({ ...prev, syncError: msg }));
    } finally {
      setIsCatalogLoading(false);
    }
  }, [catalogCooldownRemainingSec, isCatalogLoading, rateLimitPauseRemainingSec]);

  // Initial sync & re-sync whenever checked categories change (debounced slightly)
  useEffect(() => {
    const timer = setTimeout(() => {
      syncLiveMarkets(checkedCategories, false);
    }, 180);
    return () => clearTimeout(timer);
  }, [checkedCategories, syncLiveMarkets]);

  // Listen for EVE SSO popup callback postMessage
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }
      const data = event.data as {
        type?: string;
        code?: string;
        state?: string;
        error?: string;
      };
      if (data?.type !== 'EVE_SSO_CALLBACK') return;

      if (data.error) {
        setIsSsoConnecting(false);
        setSsoStatusMsg(`EVE SSO authorization cancelled: ${data.error}`);
        return;
      }

      const pending = pkceRef.current;
      if (!pending || !data.code || data.state !== pending.state) {
        setIsSsoConnecting(false);
        setSsoStatusMsg('EVE SSO state mismatch. Please retry authentication.');
        return;
      }

      try {
        setSsoStatusMsg('Exchanging PKCE authorization code with EVE SSO...');
        const tokenRes = await fetch('/api/eve/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: data.code,
            codeVerifier: pending.codeVerifier,
            clientId: pending.clientId,
          }),
        });
        const tokenJson = (await tokenRes.json()) as {
          accessToken?: string;
          characterId?: number;
          characterName?: string;
          error?: string;
        };

        if (!tokenRes.ok || !tokenJson.accessToken || !tokenJson.characterId) {
          throw new Error(tokenJson.error || 'Token exchange failed.');
        }

        setSsoStatusMsg(`Syncing ESI skills, all blueprint pages (X-Pages), wallet & assets for ${tokenJson.characterName}...`);

        const syncRes = await fetch('/api/eve/sync-character', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${tokenJson.accessToken}`,
          },
          body: JSON.stringify({
            characterId: tokenJson.characterId,
            characterName: tokenJson.characterName,
            includeCorpBlueprints: includeCorpRef.current,
          }),
        });
        const charJson = (await syncRes.json()) as Partial<PilotProfile> & { error?: string };
        if (!syncRes.ok) {
          throw new Error(charJson.error || 'ESI character sync failed.');
        }

        setEveAccessToken(tokenJson.accessToken);
        setBlueprintScanError(null);
        setProfile((prev) => ({
          ...prev,
          mode: 'eve_sso',
          characterId: charJson.characterId ?? tokenJson.characterId,
          corporationId: charJson.corporationId ?? prev.corporationId,
          characterName: charJson.characterName ?? tokenJson.characterName ?? prev.characterName,
          totalSp: charJson.totalSp ?? prev.totalSp,
          walletBalance: charJson.walletBalance ?? prev.walletBalance,
          currentSystemId: charJson.currentSystemId ?? prev.currentSystemId,
          currentSystemName: charJson.currentSystemName ?? prev.currentSystemName,
          currentStationId: charJson.currentStationId ?? prev.currentStationId,
          currentStationName: charJson.currentStationName ?? prev.currentStationName,
          skills: charJson.skills ?? prev.skills,
          haulingSkills: charJson.haulingSkills ?? prev.haulingSkills,
          blueprints: Array.isArray(charJson.blueprints)
            ? charJson.blueprints
            : prev.blueprints,
          blueprintSyncMeta: charJson.blueprintSyncMeta ?? prev.blueprintSyncMeta,
          activeOrders: Array.isArray(charJson.activeOrders)
            ? charJson.activeOrders
            : prev.activeOrders,
          activeOrdersSyncedAt:
            charJson.activeOrdersSyncedAt ?? prev.activeOrdersSyncedAt,
          hulls:
            charJson.hulls && charJson.hulls.length > 0 ? charJson.hulls : prev.hulls,
        }));

        const bpCount = Array.isArray(charJson.blueprints) ? charJson.blueprints.length : 0;
        const pagesCount = charJson.blueprintSyncMeta?.pagesScanned ?? 1;
        setSsoStatusMsg(
          `Connected to ${tokenJson.characterName} via EVE ESI — loaded ${bpCount.toLocaleString()} blueprints across ${pagesCount} page${pagesCount === 1 ? '' : 's'}.`
        );
      } catch (err) {
        setSsoStatusMsg(
          err instanceof Error ? err.message : 'Failed to complete EVE SSO login.'
        );
      } finally {
        setIsSsoConnecting(false);
        pkceRef.current = null;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleChangeClientId = (val: string) => {
    setEveClientId(val);
    try {
      localStorage.setItem('new_eden_eve_client_id', val);
    } catch {
      // ignore storage errors
    }
  };

  const handleConnectEveSso = async () => {
    const trimmedId = eveClientId.trim();
    if (!trimmedId) {
      setSettingsOpen(true);
      setSsoStatusMsg('Enter your EVE Developer Application CLIENT_ID first.');
      return;
    }

    setIsSsoConnecting(true);
    setSsoStatusMsg(null);
    try {
      const { authUrl, codeVerifier, state } = await buildEveAuthorizeUrl({
        clientId: trimmedId,
        redirectUri: callbackUrl,
      });
      pkceRef.current = { codeVerifier, state, clientId: trimmedId };

      const popup = window.open(
        authUrl,
        'eve_sso_popup',
        'width=560,height=720,scrollbars=yes'
      );
      if (!popup) {
        setIsSsoConnecting(false);
        setSsoStatusMsg(
          'Popup window was blocked by the browser. Allow popups for this site and click Connect EVE SSO again.'
        );
      }
    } catch (err) {
      setIsSsoConnecting(false);
      setSsoStatusMsg(
        err instanceof Error ? err.message : 'Unable to start PKCE authentication.'
      );
    }
  };

  const handleSwitchToSimulation = () => {
    setEveAccessToken(null);
    setBlueprintScanError(null);
    setProfile(DEFAULT_SIMULATION_PROFILE);
    setSsoStatusMsg('Switched to Simulation / Offline Profile Mode (187M SP, 1B ISK cap).');
  };

  // Dedicated full X-Pages blueprint rescan (personal + optional corporation hangars)
  const handleScanBlueprints = useCallback(
    async (nextIncludeCorp: boolean) => {
      if (profile.mode !== 'eve_sso' || !eveAccessToken || !profile.characterId) {
        return;
      }
      setIsScanningBlueprints(true);
      setBlueprintScanError(null);
      try {
        const res = await fetch('/api/eve/blueprints', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${eveAccessToken}`,
          },
          body: JSON.stringify({
            characterId: profile.characterId,
            corporationId: profile.corporationId,
            includeCorpBlueprints: nextIncludeCorp,
          }),
        });
        const data = (await res.json()) as {
          corporationId?: number;
          blueprints?: PilotProfile['blueprints'];
          blueprintSyncMeta?: PilotProfile['blueprintSyncMeta'];
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || `Blueprint scan returned HTTP ${res.status}`);
        }
        setProfile((prev) => ({
          ...prev,
          corporationId: data.corporationId ?? prev.corporationId,
          blueprints: Array.isArray(data.blueprints) ? data.blueprints : prev.blueprints,
          blueprintSyncMeta: data.blueprintSyncMeta ?? prev.blueprintSyncMeta,
        }));
      } catch (err) {
        setBlueprintScanError(
          err instanceof Error ? err.message : 'Failed to scan ESI blueprints.'
        );
      } finally {
        setIsScanningBlueprints(false);
      }
    },
    [eveAccessToken, profile.characterId, profile.corporationId, profile.mode]
  );

  const handleToggleCorpBlueprints = useCallback(
    (next: boolean) => {
      setIncludeCorpBlueprints(next);
      includeCorpRef.current = next;
      if (profile.mode === 'eve_sso' && eveAccessToken && profile.characterId) {
        handleScanBlueprints(next);
      }
    },
    [eveAccessToken, handleScanBlueprints, profile.characterId, profile.mode]
  );

  // Live refresh of character wallet balance + active market orders (esi-markets.read_character_orders.v1)
  const handleRefreshWalletOrders = useCallback(async () => {
    if (profile.mode !== 'eve_sso' || !eveAccessToken || !profile.characterId) {
      return;
    }
    setIsRefreshingWalletOrders(true);
    try {
      const res = await fetch('/api/eve/wallet-orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eveAccessToken}`,
        },
        body: JSON.stringify({ characterId: profile.characterId }),
      });
      const data = (await res.json()) as {
        walletBalance?: number;
        activeOrders?: PilotProfile['activeOrders'];
        activeOrdersSyncedAt?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Wallet/orders sync returned HTTP ${res.status}`);
      }
      setProfile((prev) => ({
        ...prev,
        walletBalance:
          typeof data.walletBalance === 'number' ? data.walletBalance : prev.walletBalance,
        activeOrders: Array.isArray(data.activeOrders) ? data.activeOrders : prev.activeOrders,
        activeOrdersSyncedAt: data.activeOrdersSyncedAt ?? prev.activeOrdersSyncedAt,
      }));
    } catch {
      // Keep last synced wallet/orders gracefully
    } finally {
      setIsRefreshingWalletOrders(false);
    }
  }, [eveAccessToken, profile.characterId, profile.mode]);

  const handleChangeExecutionMode = useCallback((mode: OrderExecutionMode) => {
    setProfile((prev) =>
      prev.orderExecutionMode === mode ? prev : { ...prev, orderExecutionMode: mode }
    );
  }, []);

  const effectiveFees = useMemo(() => getEffectiveOrderFees(profile), [profile]);
  const activeSellOrderCount = useMemo(
    () => (profile.activeOrders ?? []).filter((o) => !o.isBuyOrder).length,
    [profile.activeOrders]
  );

  // Run all 5 deterministic decision engines reactively
  const engineBundle = useMemo(
    () =>
      runAllDecisionEngines(checkedCategories, snapshot, profile, {
        catalog,
        minDailyVolume,
      }),
    [checkedCategories, snapshot, profile, catalog, minDailyVolume]
  );

  // Merge engine-generated Jita shopping list with any items added via Gemini Advisor actions
  const mergedShopping = useMemo(() => {
    const byId = new Map<number, ShoppingListLine>();
    for (const line of engineBundle.consolidatedShoppingList) {
      byId.set(line.typeId, { ...line });
    }

    for (const custom of customShoppingItems) {
      const existing = byId.get(custom.typeId);
      const itemMeta = ITEM_BY_ID[custom.typeId];
      const q = itemMeta ? getQuote(snapshot, custom.typeId) : null;
      const unitPrice = q?.jita.sellMin ?? itemMeta?.baseJitaSell ?? 0;
      const unitVol = itemMeta?.volume ?? 0.1;

      if (existing) {
        const nextQty = existing.quantity + custom.quantity;
        byId.set(custom.typeId, {
          ...existing,
          quantity: nextQty,
          totalCostJita: nextQty * existing.unitPriceJita,
          volumeM3: nextQty * unitVol,
          addedByAdvisor: true,
        });
      } else {
        const nearby = q?.oneJumpCheapestSell;
        let cheaperNearby: ShoppingListLine['cheaperNearby'];
        if (nearby && nearby.price > 0 && nearby.price < unitPrice * 0.992) {
          const usableQty = Math.min(custom.quantity, nearby.volumeRemain);
          const savingsIsk = (unitPrice - nearby.price) * usableQty;
          if (savingsIsk > 25_000) {
            cheaperNearby = {
              systemName: nearby.systemName,
              jumpsFromJita: nearby.jumpsFromJita,
              unitPrice: nearby.price,
              savingsIsk,
              availableQty: nearby.volumeRemain,
            };
          }
        }
        byId.set(custom.typeId, {
          typeId: custom.typeId,
          name: custom.name,
          quantity: custom.quantity,
          unitPriceJita: unitPrice,
          totalCostJita: custom.quantity * unitPrice,
          volumeM3: custom.quantity * unitVol,
          addedByAdvisor: true,
          cheaperNearby,
        });
      }
    }

    const lines = Array.from(byId.values()).sort(
      (a, b) => b.totalCostJita - a.totalCostJita
    );
    const totalIsk = lines.reduce((s, l) => s + l.totalCostJita, 0);
    const totalM3 = lines.reduce((s, l) => s + l.volumeM3, 0);
    const savingsIsk = lines.reduce(
      (s, l) => s + (l.cheaperNearby?.savingsIsk ?? 0),
      0
    );

    return { lines, totalIsk, totalM3, savingsIsk };
  }, [engineBundle.consolidatedShoppingList, customShoppingItems, snapshot]);

  const visibleCardsByEngine = useMemo(() => {
    const grouped: Record<EngineId, ActionCardData[]> = {
      indy_invention: [],
      reprocessing: [],
      pipeline_corridor: [],
      regional_trade: [],
      pi_factory: [],
    };
    for (const c of engineBundle.cards) {
      grouped[c.engine].push(c);
    }
    return grouped;
  }, [engineBundle.cards]);

  const topActionCard = useMemo(() => {
    if (engineBundle.cards.length === 0) return null;
    return [...engineBundle.cards].sort((a, b) => b.netProfitIsk - a.netProfitIsk)[0];
  }, [engineBundle.cards]);

  // Cumulative "if you complete everything selected" profit metrics
  const selectedTotals = useMemo(() => {
    const profitableCards = engineBundle.cards.filter((c) => c.netProfitIsk > 0);
    const totalProjectedProfitIsk = profitableCards.reduce(
      (sum, c) => sum + c.netProfitIsk,
      0
    );
    const totalAllCardsNetProfitIsk = engineBundle.cards.reduce(
      (sum, c) => sum + c.netProfitIsk,
      0
    );
    const totalRequiredCapitalIsk = profitableCards.reduce(
      (sum, c) => sum + c.requiredCapitalIsk,
      0
    );
    const totalCargoVolumeM3 = profitableCards.reduce(
      (sum, c) => sum + c.totalVolumeM3,
      0
    );
    const blendedRoiPct =
      totalRequiredCapitalIsk > 0
        ? (totalProjectedProfitIsk / totalRequiredCapitalIsk) * 100
        : 0;
    return {
      totalCardCount: engineBundle.cards.length,
      profitableCardCount: profitableCards.length,
      totalProjectedProfitIsk,
      totalAllCardsNetProfitIsk,
      totalRequiredCapitalIsk,
      totalCargoVolumeM3,
      blendedRoiPct,
    };
  }, [engineBundle.cards]);

  const activeTabLabel = useMemo(() => {
    switch (activeView) {
      case 'overview':
        return 'Overview';
      case 'indy_invention':
        return 'Indy & T2';
      case 'reprocessing':
        return 'Reprocessing';
      case 'corridor_trade':
      case 'pipeline_corridor':
      case 'regional_trade':
        return 'Jita–Dodixie';
      case 'pi_factory':
        return 'PI Factories';
      default:
        return 'Overview';
    }
  }, [activeView]);

  // Build structured JSON summary of current app state sent automatically with every Advisor message
  const buildAppStateSummary = useCallback((): AppStateSummary => {
    const topRanked = [...engineBundle.cards]
      .sort((a, b) => b.netProfitIsk - a.netProfitIsk)
      .slice(0, 10)
      .map((c) => ({
        id: c.id,
        engine: c.engine,
        engineLabel: c.engineLabel,
        title: c.title,
        stationAnchor: c.stationAnchor,
        recommendedHull: c.recommendedHull,
        requiredCapitalIsk: Math.round(c.requiredCapitalIsk),
        totalVolumeM3: Number(c.totalVolumeM3.toFixed(2)),
        netProfitIsk: Math.round(c.netProfitIsk),
        roiPct: Number(c.roiPct.toFixed(2)),
      }));

    return {
      activeTab: activeTabLabel,
      character: {
        name: profile.characterName,
        mode: profile.mode,
        totalSp: profile.totalSp,
        walletBalanceIsk: Math.round(profile.walletBalance),
        activeCapitalCapIsk: Math.round(profile.activeCapitalCap),
        currentSystem: profile.currentSystemName,
        currentStation: profile.currentStationName,
        pocoImportTaxPct: profile.pocoImportTaxPct,
        pocoExportTaxPct: profile.pocoExportTaxPct,
        skills: profile.skills,
        hulls: profile.hulls.map((h) => ({
          name: h.name,
          hullClass: h.hullClass,
          capacityM3: h.capacityM3,
        })),
        blueprints: profile.blueprints.slice(0, 40).map((bp) => ({
          productName: bp.productName,
          isBpo: bp.isBpo,
          me: bp.me,
          te: bp.te,
          runs: bp.runs,
          locationName: bp.locationName,
        })),
      },
      marketScope: {
        checkedCategories,
        activeTrackedItemCount: engineBundle.activeTrackedItemCount,
        sourceMode: snapshot.sourceMode,
        lastSyncedAt: snapshot.lastSyncedAt,
      },
      selectedOpportunitiesSummary: {
        totalCardCount: selectedTotals.totalCardCount,
        profitableCardCount: selectedTotals.profitableCardCount,
        totalProjectedProfitIsk: Math.round(selectedTotals.totalProjectedProfitIsk),
        totalRequiredCapitalIsk: Math.round(selectedTotals.totalRequiredCapitalIsk),
        totalCargoVolumeM3: Number(selectedTotals.totalCargoVolumeM3.toFixed(2)),
        blendedRoiPct: Number(selectedTotals.blendedRoiPct.toFixed(2)),
      },
      topRankedOpportunities: topRanked,
      consolidatedShoppingList: {
        totalIsk: Math.round(mergedShopping.totalIsk),
        totalM3: Number(mergedShopping.totalM3.toFixed(2)),
        oneJumpSavingsIsk: Math.round(mergedShopping.savingsIsk),
        itemCount: mergedShopping.lines.length,
        items: mergedShopping.lines.slice(0, 25).map((l) => ({
          typeId: l.typeId,
          name: l.name,
          quantity: l.quantity,
          unitPriceJita: Number(l.unitPriceJita.toFixed(2)),
          totalCostJita: Math.round(l.totalCostJita),
          addedByAdvisor: l.addedByAdvisor,
          cheaperNearby: l.cheaperNearby
            ? `${l.cheaperNearby.systemName} (-${formatIsk(l.cheaperNearby.savingsIsk)})`
            : undefined,
        })),
      },
    };
  }, [activeTabLabel, checkedCategories, engineBundle, mergedShopping, profile, selectedTotals, snapshot]);

  const handleToggleCategory = (id: MarketCategoryId) => {
    setCheckedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  };

  const handleApplyPreset = (ids: MarketCategoryId[]) => {
    setCheckedCategories(ids);
  };

  // Execute structured action buttons returned by Gemini Advisor
  const handleExecuteAdvisorAction = (action: AdvisorAction) => {
    if (action.type === 'switch_tab') {
      setActiveView(action.targetTab);
      setActionToast(`Switched tab to ${action.label.replace(/^Switch Tab:\s*/i, '')}`);
      setTimeout(() => setActionToast(null), 2600);
      return;
    }

    if (action.type === 'add_to_shopping_list') {
      setCustomShoppingItems((prev) => {
        const map = new Map<number, CustomShoppingItem>();
        for (const it of prev) map.set(it.typeId, { ...it });
        for (const incoming of action.items) {
          const existing = map.get(incoming.typeId);
          if (existing) {
            map.set(incoming.typeId, {
              ...existing,
              quantity: existing.quantity + incoming.quantity,
            });
          } else {
            map.set(incoming.typeId, {
              typeId: incoming.typeId,
              name: incoming.name,
              quantity: incoming.quantity,
            });
          }
        }
        return Array.from(map.values());
      });
      setAppliedActionIds((prev) =>
        prev.includes(action.id) ? prev : [...prev, action.id]
      );
      setActionToast(
        `Added ${action.items.length} item line${action.items.length > 1 ? 's' : ''} to Consolidated Jita Shopping List`
      );
      setTimeout(() => setActionToast(null), 3200);
    }
  };

  // Gemini AI Strategic Advisor messaging (auto-attaches live JSON appStateSummary)
  const handleSendAdvisorMessage = async (prompt: string) => {
    if (rightSidebarMode !== 'advisor') setRightSidebarMode('advisor');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: nowTimeLabel(),
    };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setIsAdvisorLoading(true);

    try {
      const appStateSummary = buildAppStateSummary();
      const res = await fetch('/api/advisor/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextHistory.map((m) => ({ role: m.role, content: m.content })),
          checkedCategories,
          snapshot,
          profile,
          appStateSummary,
        }),
      });
      const data = (await res.json()) as {
        text?: string;
        toolsUsed?: string[];
        actions?: AdvisorAction[];
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || `Advisor returned HTTP ${res.status}`);
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.text || 'No response received.',
          timestamp: nowTimeLabel(),
          toolsUsed: data.toolsUsed,
          actions: data.actions,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          content:
            err instanceof Error
              ? err.message
              : 'Failed to contact Gemini Strategic Advisor.',
          timestamp: nowTimeLabel(),
          error: true,
        },
      ]);
    } finally {
      setIsAdvisorLoading(false);
    }
  };

  const handleAskAdvisorAboutCard = (card: ActionCardData) => {
    const prompt = `Give me a tight, step-by-step execution checklist for "${card.title}" (${card.engineLabel}) starting from ${profile.currentSystemName}. Verify capital (${formatIsk(card.requiredCapitalIsk)}), hull (${card.recommendedHull.split(' (')[0]}), and attach a "+ Add to Jita Shopping List" button if inputs should be purchased.`;
    handleSendAdvisorMessage(prompt);
  };

  const freshnessText = snapshot.lastSyncedAt
    ? new Date(snapshot.lastSyncedAt).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'Syncing...';

  const sectionsToRender =
    activeView === 'overview'
      ? ENGINE_SECTIONS
      : activeView === 'corridor_trade'
        ? ENGINE_SECTIONS.filter(
            (s) => s.id === 'pipeline_corridor' || s.id === 'regional_trade'
          )
        : ENGINE_SECTIONS.filter((s) => s.id === activeView);

  // Active cards currently visible in the main workspace (for "Select All Visible")
  const visibleCardsList = useMemo(() => {
    const list: ActionCardData[] = [];
    for (const sec of sectionsToRender) {
      const cards = visibleCardsByEngine[sec.id];
      const shown = activeView === 'overview' ? cards.slice(0, 3) : cards;
      list.push(...shown);
    }
    return list;
  }, [sectionsToRender, visibleCardsByEngine, activeView]);

  // Active queued cards derived strictly from queuedRouteIds + live engineBundle.cards
  const queuedRouteCards = useMemo(
    () => engineBundle.cards.filter((c) => queuedRouteIds.includes(c.id)),
    [engineBundle.cards, queuedRouteIds]
  );
  const queuedProfitSum = useMemo(
    () => queuedRouteCards.reduce((s, c) => s + c.netProfitIsk, 0),
    [queuedRouteCards]
  );

  const handleToggleQueueCard = useCallback((cardId: string, nextChecked: boolean) => {
    setQueuedRouteIds((prev) => {
      if (nextChecked) {
        return prev.includes(cardId) ? prev : [...prev, cardId];
      }
      return prev.filter((id) => id !== cardId);
    });
    if (nextChecked) {
      setRightSidebarMode((mode) => (mode === 'collapsed' ? 'route' : mode));
    }
  }, []);

  const handleRemoveQueuedCard = useCallback((cardId: string) => {
    setQueuedRouteIds((prev) => prev.filter((id) => id !== cardId));
  }, []);

  const handleSelectAllVisible = useCallback(() => {
    const visibleIds = visibleCardsList.map((c) => c.id);
    if (visibleIds.length === 0) return;
    setQueuedRouteIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    setRightSidebarMode('route');
  }, [visibleCardsList]);

  const handleClearRouteQueue = useCallback(() => {
    setQueuedRouteIds([]);
  }, []);

  const handleApplyAutoFilledRoute = useCallback((cardIds: string[]) => {
    setQueuedRouteIds(cardIds);
    setRightSidebarMode('route');
  }, []);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0b0e14] text-slate-100 lg:overflow-hidden">
      {/* Strict 3-Zone Top Navigation Bar */}
      <TopBar
        activeView={activeView}
        onSelectView={setActiveView}
        onSyncMarkets={handleRefreshMarketPrices}
        isSyncing={isSyncing || scanProgress.active}
        marketCooldownRemainingSec={marketCooldownRemainingSec}
        isRateLimitPaused={rateLimitPauseRemainingSec > 0}
        routePanelOpen={rightSidebarMode === 'route'}
        queuedRouteCount={queuedRouteCards.length}
        onToggleRoutePanel={() =>
          setRightSidebarMode((mode) => (mode === 'route' ? 'collapsed' : 'route'))
        }
      />

      {/* Main Split Command Workspace (Center Workspace + Right Docked AI Sidebar) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Main Center Workspace */}
        <main className="flex-1 min-w-0 lg:overflow-y-auto px-5 py-5 space-y-5">
          {/* Compact Pilot & Data Freshness Context Ribbon */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-400">
              <span className="text-slate-100 font-medium">{profile.characterName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-300">
                {(profile.totalSp / 1e6).toFixed(1)}M SP
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Location: <strong className="text-slate-200 font-medium">{profile.currentSystemName}</strong>
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-amber-300">
                Cap {formatIsk(profile.activeCapitalCap)}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-400">
                Feed:{' '}
                <span
                  className={
                    snapshot.sourceMode === 'live'
                      ? 'text-emerald-400'
                      : snapshot.sourceMode === 'partial'
                        ? 'text-amber-300'
                        : 'text-slate-400'
                  }
                >
                  {snapshot.sourceMode === 'live'
                    ? 'Fuzzwork + ESI Live'
                    : snapshot.sourceMode === 'partial'
                      ? 'Partial Live + Baseline'
                      : 'Offline Baseline'}
                </span>{' '}
                ({freshnessText})
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => openSettingsTab('assets')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700/90 bg-[#131822] text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ScrollText className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                <span>
                  Blueprints ({profile.blueprints.length.toLocaleString()})
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setInspectedCard(null);
                  setShowShoppingListDrawer(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700/90 bg-[#131822] text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <ShoppingCart className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>
                  Jita Shopping List ({mergedShopping.lines.length})
                </span>
              </button>

              <button
                type="button"
                onClick={() => openSettingsTab('sso')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {profile.mode === 'eve_sso' ? 'EVE SSO Connected' : 'Connect EVE SSO'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => openSettingsTab('profile')}
                aria-label="Open Pilot Calibration and Tax Settings"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-800 bg-[#131822] text-slate-300 hover:border-slate-700 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Settings</span>
              </button>
            </div>
          </div>

          {actionToast && (
            <div className="px-4 py-2 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 flex items-center justify-between gap-3">
              <span>{actionToast}</span>
              <button
                type="button"
                onClick={() => {
                  setInspectedCard(null);
                  setShowShoppingListDrawer(true);
                }}
                className="text-emerald-300 hover:text-emerald-100 font-medium underline cursor-pointer shrink-0"
              >
                View Shopping List
              </button>
            </div>
          )}

          {snapshot.syncError && (
            <div className="px-4 py-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
              Market sync warning: {snapshot.syncError} — using cached/baseline prices until retry.
            </div>
          )}

          {/* Mobile / Tablet Engine Switcher */}
          <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-1">
            {(['overview', ...ENGINE_SECTIONS.map((s) => s.id)] as WorkspaceView[]).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setActiveView(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded border whitespace-nowrap shrink-0 cursor-pointer ${
                  activeView === v
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#131822] border-slate-800 text-slate-400'
                }`}
              >
                {v === 'overview'
                  ? 'Overview'
                  : v === 'indy_invention'
                    ? 'Indy & T2'
                    : v === 'reprocessing'
                      ? 'Reprocessing'
                      : v === 'pipeline_corridor'
                        ? 'Corridor'
                        : v === 'regional_trade'
                          ? 'Jita-Dodixie'
                          : 'PI Factories'}
              </button>
            ))}
          </div>

          {/* Collapsible Market Scope & Category Checkboxes Matrix */}
          <MarketScopeBar
            checkedCategories={checkedCategories}
            onToggleCategory={handleToggleCategory}
            onApplyPreset={handleApplyPreset}
            isExpanded={scopeExpanded}
            onToggleExpand={() => setScopeExpanded((v) => !v)}
            activeTrackedItemCount={engineBundle.activeTrackedItemCount}
            catalog={catalog}
            isCatalogLoading={isCatalogLoading}
            onInspectCategorySkus={(cat) => setInspectedSkuCategory(cat)}
            marketCooldownRemainingSec={marketCooldownRemainingSec}
            catalogCooldownRemainingSec={catalogCooldownRemainingSec}
            scanProgress={scanProgress}
            onRefreshMarketPrices={handleRefreshMarketPrices}
            onCancelMarketScan={() => {
              scanAbortRef.current = true;
            }}
            onRebuildCatalog={handleRebuildCatalog}
            esiRateLimit={esiRateLimit}
            rateLimitPauseRemainingSec={rateLimitPauseRemainingSec}
            minDailyVolume={minDailyVolume}
            onChangeMinDailyVolume={setMinDailyVolume}
          />

          {/* 5-Column Command Telemetry Strip (Single-Elevation Hairline Bar) */}
          <section
            aria-label="Command Summary Metrics"
            className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 bg-[#131822] border border-slate-800/90 rounded-lg divide-y xl:divide-y-0 md:divide-x divide-slate-800/80"
          >
            <div className="p-4">
              <div className="text-xs text-slate-400">Top Ranked Opportunity</div>
              <div className="font-mono tabular-nums text-lg font-semibold text-emerald-400 mt-1">
                {topActionCard ? `+${formatIsk(topActionCard.netProfitIsk)}` : '—'}
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5 truncate" title={topActionCard?.title}>
                {topActionCard
                  ? `${topActionCard.title} (${formatPct(topActionCard.roiPct)})`
                  : 'Select at least one category'}
              </div>
            </div>

            <div
              className="p-4"
              title={`Cumulative net profit if all ${selectedTotals.profitableCardCount} profitable selected opportunities are completed (${formatIsk(selectedTotals.totalRequiredCapitalIsk)} combined capital, ${formatM3(selectedTotals.totalCargoVolumeM3)} total cargo).`}
            >
              <div className="text-xs text-slate-400">Total Profit (All Selected)</div>
              <div className="font-mono tabular-nums text-lg font-semibold text-emerald-300 mt-1">
                {selectedTotals.profitableCardCount > 0
                  ? `+${formatIsk(selectedTotals.totalProjectedProfitIsk)}`
                  : '—'}
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                {selectedTotals.totalCardCount === 0
                  ? 'Select categories above'
                  : selectedTotals.profitableCardCount === selectedTotals.totalCardCount
                    ? `All ${selectedTotals.totalCardCount} cards · ${formatPct(selectedTotals.blendedRoiPct)} ROI`
                    : `${selectedTotals.profitableCardCount} of ${selectedTotals.totalCardCount} profitable · ${formatPct(selectedTotals.blendedRoiPct)}`}
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs text-slate-400">Consolidated Jita Shopping List</div>
              <div className="font-mono tabular-nums text-lg font-semibold text-amber-300 mt-1">
                {formatIsk(mergedShopping.totalIsk)}
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                {formatM3(mergedShopping.totalM3)} · 1j savings{' '}
                <span className="text-emerald-400">
                  {formatIsk(mergedShopping.savingsIsk)}
                </span>
              </div>
            </div>

            <div className="p-4">
              <div className="text-xs text-slate-400">Active Scope &amp; Action Cards</div>
              <div className="font-mono tabular-nums text-lg font-semibold text-slate-100 mt-1">
                {engineBundle.cards.length} Cards
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                {engineBundle.activeTrackedItemCount} tracked SKUs · {snapshot.liveItemCount} live
              </div>
            </div>

            <div className="p-4 col-span-2 md:col-span-1">
              <div className="text-xs text-slate-400">Ishisomo Hangar Fleet</div>
              <div className="font-mono tabular-nums text-lg font-semibold text-cyan-300 mt-1">
                {profile.hulls.length} Hulls Ready
              </div>
              <div className="text-[11px] text-slate-400 font-mono tabular-nums mt-0.5 truncate">
                BR 10.2k · DST 62.5k · Orca 187.5k m³
              </div>
            </div>
          </section>

          {/* Compact Route Queue Control Bar */}
          {checkedCategories.length > 0 && (
            <section
              aria-label="Route Queue Controls"
              className="px-4 py-2.5 bg-[#131822] border border-slate-800/90 rounded-lg flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex flex-wrap items-center gap-2.5 text-xs">
                <Route className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
                <span className="font-display font-semibold text-slate-100">
                  Route Queue:{' '}
                  <span className="font-mono tabular-nums text-cyan-300">
                    {queuedRouteCards.length} {queuedRouteCards.length === 1 ? 'Card' : 'Cards'} Selected
                  </span>
                </span>
                {queuedRouteCards.length > 0 && (
                  <>
                    <span className="text-slate-600" aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-emerald-400">
                      {queuedProfitSum >= 0 ? '+' : ''}
                      {formatIsk(queuedProfitSum)} queued profit
                    </span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {/* Global Skill-Adjusted Tax/Broker Execution Mode Toggle */}
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-800 bg-[#0b0e14] text-[11px]"
                  title={`Accounting Lv.${profile.skills.accounting} (Sales Tax ${effectiveFees.salesTaxPct.toFixed(2)}%) · Broker Relations Lv.${profile.skills.brokerRelations} (NPC Broker ${effectiveFees.brokerFeePct.toFixed(2)}%)`}
                >
                  <span className="font-mono tabular-nums text-slate-400 hidden sm:inline">
                    Tax {effectiveFees.salesTaxPct.toFixed(2)}% · Broker{' '}
                    {effectiveFees.brokerFeePct.toFixed(2)}%
                  </span>
                  <div className="inline-flex rounded bg-[#131822] p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleChangeExecutionMode('list_orders')}
                      className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        effectiveFees.executionMode === 'list_orders'
                          ? 'bg-cyan-500/20 text-cyan-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      List Orders
                    </button>
                    <button
                      type="button"
                      onClick={() => handleChangeExecutionMode('instant_fill')}
                      className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        effectiveFees.executionMode === 'instant_fill'
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Instant Fill
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  disabled={visibleCardsList.length === 0}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-700/90 bg-[#0e131b] text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                  <span>Select All Visible ({visibleCardsList.length})</span>
                </button>

                <button
                  type="button"
                  onClick={handleClearRouteQueue}
                  disabled={queuedRouteIds.length === 0 && queuedRouteCards.length === 0}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    queuedRouteCards.length > 0
                      ? 'border-rose-500/45 bg-rose-500/12 text-rose-200 hover:bg-rose-500/25 hover:border-rose-400/70'
                      : 'border-slate-800 bg-[#0e131b] text-slate-400 hover:border-rose-400/50 hover:text-rose-200'
                  }`}
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Clear Route</span>
                </button>

                {rightSidebarMode !== 'route' && (
                  <button
                    type="button"
                    onClick={() => setRightSidebarMode('route')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <span>Open Route Sidebar</span>
                  </button>
                )}
              </div>
            </section>
          )}

          {/* Empty State if all checkboxes cleared */}
          {checkedCategories.length === 0 ? (
            <div className="bg-[#131822] border border-slate-800/90 rounded-lg p-10 text-center space-y-3">
              <h2 className="font-display text-lg font-semibold text-slate-100">
                No Market Scope Categories Selected
              </h2>
              <p className="text-sm text-slate-400 max-w-md mx-auto">
                Check one or more categories in the Market Scope matrix above to fetch live Jita &amp; Dodixie market prices and generate ranked Action Cards.
              </p>
              <button
                type="button"
                onClick={() => handleApplyPreset(SCOPE_PRESETS.all)}
                className="px-4 py-2 text-xs font-medium rounded-md bg-cyan-500/20 border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/30 transition-colors cursor-pointer"
              >
                Select All Tracked Categories
              </button>
            </div>
          ) : (
            /* Market Visualizations + 5 Decision Engine Action Card Sections */
            <div className="space-y-8 pb-8">
              {activeView === 'overview' && engineBundle.cards.length > 0 && (
                <OverviewProfitChart
                  cards={engineBundle.cards}
                  onOpenHistory={handleOpenHistory}
                  onInspectCard={(c) => {
                    setShowShoppingListDrawer(false);
                    setInspectedCard(c);
                  }}
                />
              )}

              {(activeView === 'corridor_trade' || activeView === 'regional_trade') && (
                <JitaDodixieChart
                  checkedCategories={checkedCategories}
                  snapshot={snapshot}
                  profile={profile}
                  catalog={catalog}
                  minDailyVolume={minDailyVolume}
                  onOpenHistory={handleOpenHistory}
                />
              )}

              {sectionsToRender.map((sec) => {
                const cards = visibleCardsByEngine[sec.id];
                const shownCards = activeView === 'overview' ? cards.slice(0, 3) : cards;
                const sectionProfit = cards
                  .filter((c) => c.netProfitIsk > 0)
                  .reduce((sum, c) => sum + c.netProfitIsk, 0);

                return (
                  <section key={sec.id} className="space-y-3.5">
                    <div className="flex flex-wrap items-end justify-between gap-3">
                      <div>
                        <h2 className="font-display text-base font-semibold text-slate-100 flex items-center gap-2">
                          <span className="font-mono text-cyan-400 text-sm">{sec.index}</span>
                          <span>{sec.title}</span>
                        </h2>
                        <p className="text-xs text-slate-400 mt-0.5">{sec.subtitle}</p>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {cards.length > 0 && (
                          <span className="text-xs font-mono tabular-nums text-slate-400 whitespace-nowrap">
                            Section total:{' '}
                            <span className="text-emerald-400 font-medium">
                              +{formatIsk(sectionProfit)}
                            </span>{' '}
                            ({cards.length} {cards.length === 1 ? 'card' : 'cards'})
                          </span>
                        )}
                        {activeView === 'overview' && cards.length > 3 && (
                          <button
                            type="button"
                            onClick={() => setActiveView(sec.id)}
                            className="text-xs text-cyan-400 hover:text-cyan-300 font-medium whitespace-nowrap cursor-pointer"
                          >
                            View all {cards.length} opportunities →
                          </button>
                        )}
                      </div>
                    </div>

                    {shownCards.length === 0 ? (
                      <div className="bg-[#131822]/70 border border-slate-800/80 rounded-lg p-5 text-xs text-slate-400">
                        No opportunities in this engine match your currently checked Market Scope categories. Enable related categories above to compute this engine.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 gap-4">
                        {shownCards.map((card, idx) => (
                          <ActionCard
                            key={card.id}
                            card={card}
                            rank={idx + 1}
                            profile={profile}
                            eveAccessToken={eveAccessToken}
                            isQueuedForRoute={queuedRouteIds.includes(card.id)}
                            onToggleQueueForRoute={handleToggleQueueCard}
                            onChangeExecutionMode={handleChangeExecutionMode}
                            onInspect={(c) => {
                              setShowShoppingListDrawer(false);
                              setInspectedCard(c);
                            }}
                            onAskAdvisor={handleAskAdvisorAboutCard}
                            onOpenHistory={handleOpenHistory}
                            onOpenSsoSettings={() => openSettingsTab('sso')}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}

              {activeView === 'indy_invention' && (
                <section className="space-y-2.5 pt-2">
                  <BlueprintLibraryPanel
                    blueprints={profile.blueprints}
                    syncMeta={profile.blueprintSyncMeta}
                    pilotMode={profile.mode}
                    indyCards={visibleCardsByEngine.indy_invention}
                    includeCorpBlueprints={includeCorpBlueprints}
                    isScanning={isScanningBlueprints}
                    scanError={blueprintScanError}
                    onToggleCorpBlueprints={handleToggleCorpBlueprints}
                    onRescanBlueprints={() => handleScanBlueprints(includeCorpBlueprints)}
                    onOpenHistory={handleOpenHistory}
                  />
                </section>
              )}
            </div>
          )}
        </main>

        {/* Collapsible Right Docked Panel: Fleet Logistics & Autopilot OR Gemini Strategic Advisor */}
        {rightSidebarMode === 'route' ? (
          <RouteOptimizerSidebar
            queuedCards={queuedRouteCards}
            allCandidateCards={visibleCardsList}
            pilotSystemId={profile.currentSystemId}
            pilotSystemName={profile.currentSystemName}
            pilotStationId={profile.currentStationId}
            pilotStationName={profile.currentStationName}
            pilotMode={profile.mode}
            eveAccessToken={eveAccessToken}
            walletBalance={profile.walletBalance}
            activeSellOrderCount={activeSellOrderCount}
            isRefreshingWalletOrders={isRefreshingWalletOrders}
            onRefreshWalletOrders={handleRefreshWalletOrders}
            hulls={profile.hulls}
            onRemoveCard={handleRemoveQueuedCard}
            onClearQueue={handleClearRouteQueue}
            onSelectAllVisible={handleSelectAllVisible}
            onApplyAutoFilledRoute={handleApplyAutoFilledRoute}
            onSwitchToAdvisor={() => setRightSidebarMode('advisor')}
            onOpenSsoSettings={() => openSettingsTab('sso')}
            onCollapse={() => setRightSidebarMode('collapsed')}
          />
        ) : (
          <AdvisorSidebar
            isCollapsed={rightSidebarMode === 'collapsed'}
            onToggleCollapse={() =>
              setRightSidebarMode((mode) =>
                mode === 'collapsed' ? 'advisor' : 'collapsed'
              )
            }
            queuedRouteCount={queuedRouteCards.length}
            onSwitchToRoute={() => setRightSidebarMode('route')}
            messages={messages}
            isLoading={isAdvisorLoading}
            onSendMessage={handleSendAdvisorMessage}
            onResetChat={() => {
              setMessages([createWelcomeMessage(profile)]);
              setAppliedActionIds([]);
            }}
            onExecuteAction={handleExecuteAdvisorAction}
            appliedActionIds={appliedActionIds}
            currentSystemName={profile.currentSystemName}
            activeCategoryCount={checkedCategories.length}
            activeTabLabel={activeTabLabel}
          />
        )}
      </div>

      {/* High-Density Inspection Drawer */}
      <InspectDrawer
        card={inspectedCard}
        profile={profile}
        eveAccessToken={eveAccessToken}
        shoppingListMode={showShoppingListDrawer}
        shoppingList={mergedShopping.lines}
        shoppingTotalIsk={mergedShopping.totalIsk}
        shoppingTotalM3={mergedShopping.totalM3}
        shoppingSavingsIsk={mergedShopping.savingsIsk}
        customItemCount={customShoppingItems.length}
        onClearCustomShoppingItems={() => {
          setCustomShoppingItems([]);
          setAppliedActionIds([]);
        }}
        onOpenHistory={handleOpenHistory}
        onOpenSsoSettings={() => openSettingsTab('sso')}
        onClose={() => {
          setInspectedCard(null);
          setShowShoppingListDrawer(false);
        }}
      />

      {/* Clickable Category SKU Catalog Inspector Modal */}
      <CategorySkuModal
        category={inspectedSkuCategory}
        skus={
          inspectedSkuCategory
            ? (catalog.categories[inspectedSkuCategory.id] ?? [])
            : []
        }
        catalogSource={catalog.source}
        catalogBuiltAt={catalog.builtAt}
        snapshot={snapshot}
        minDailyVolume={minDailyVolume}
        onOpenHistory={handleOpenHistory}
        onClose={() => setInspectedSkuCategory(null)}
      />

      {/* 30-Day Regional ESI Market History Modal */}
      <MarketHistoryModal
        target={historyTarget}
        onClose={() => setHistoryTarget(null)}
      />

      {/* EVE SSO & Pilot Profile Settings Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        onUpdateProfile={setProfile}
        eveClientId={eveClientId}
        onChangeEveClientId={handleChangeClientId}
        callbackUrl={callbackUrl}
        onConnectEveSso={handleConnectEveSso}
        onSwitchToSimulation={handleSwitchToSimulation}
        ssoStatusMsg={ssoStatusMsg}
        isSsoConnecting={isSsoConnecting}
        indyCards={visibleCardsByEngine.indy_invention}
        includeCorpBlueprints={includeCorpBlueprints}
        isScanningBlueprints={isScanningBlueprints}
        blueprintScanError={blueprintScanError}
        onToggleCorpBlueprints={handleToggleCorpBlueprints}
        onRescanBlueprints={() => handleScanBlueprints(includeCorpBlueprints)}
        onOpenHistory={handleOpenHistory}
      />
    </div>
  );
}
