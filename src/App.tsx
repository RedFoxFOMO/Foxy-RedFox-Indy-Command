import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  KeyRound,
  RotateCcw,
  Route,
  ScrollText,
  ShoppingCart,
  Trash2,
} from 'lucide-react';
import { AboutInfoPopover } from './components/AboutInfoPopover.tsx';
import { ActionCard } from './components/ActionCard.tsx';
import { AdvisorSidebar } from './components/AdvisorSidebar.tsx';
import { BlueprintLibraryPanel } from './components/BlueprintLibraryPanel.tsx';
import { BuildQueueAndLedgerPanel } from './components/BuildQueueAndLedgerPanel.tsx';
import { CategorySkuModal } from './components/CategorySkuModal.tsx';
import { ContractsTab } from './components/ContractsTab.tsx';
import { GankTab } from './components/GankTab.tsx';
import { HaulerFitFlyout } from './components/HaulerFitFlyout.tsx';
import type { HaulerFlyoutContext } from './components/HaulerFitFlyout.tsx';
import { IndustryFacilityBar } from './components/IndustryFacilityBar.tsx';
import { IndustryJobsPanel } from './components/IndustryJobsPanel.tsx';
import { InspectDrawer } from './components/InspectDrawer.tsx';
import { JitaDodixieChart } from './components/JitaDodixieChart.tsx';
import { MarketHistoryModal } from './components/MarketHistoryModal.tsx';
import { MarketScopeBar } from './components/MarketScopeBar.tsx';
import { OrderMonitorOverlay } from './components/OrderMonitorOverlay.tsx';
import { OverviewProfitChart } from './components/OverviewProfitChart.tsx';
import { PriceProjectionModal } from './components/PriceProjectionModal.tsx';
import { RouteOptimizerSidebar } from './components/RouteOptimizerSidebar.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import type { SettingsTabId } from './components/SettingsModal.tsx';
import { StationTradingTab } from './components/StationTradingTab.tsx';
import { TopBar } from './components/TopBar.tsx';
import type { WorkspaceView } from './components/TopBar.tsx';
import { WatchlistPanel } from './components/WatchlistPanel.tsx';
import {
  DEFAULT_INDUSTRY_STRUCTURE_CONFIG,
  DEFAULT_SIMULATION_PROFILE,
  EMPIRE_HUB_MAP,
  ITEM_BY_ID,
  SCOPE_PRESETS,
  getItemsForCategories,
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
  AiCommentarySettings,
  AppSettingsV22,
  AppStateSummary,
  BuildQueueEntry,
  ChatMessage,
  CorridorOrder,
  CustomShoppingItem,
  DynamicMarketCatalog,
  EngineId,
  EsiRateLimitState,
  IndustryCostSnapshot,
  IndustryStructureConfig,
  MarketCacheTelemetry,
  MarketCategoryDef,
  MarketCategoryId,
  MarketQuote,
  MarketScanProgress,
  MarketSnapshot,
  OrderExecutionMode,
  OrderMonitorSnapshot,
  PilotProfile,
  SavedRouteRecord,
  ShoppingListLine,
  TradeHubId,
  WatchlistItem,
} from './types/eve.ts';
import {
  getCurrentCallbackUrl,
  loadAiCommentarySettings,
  loadAppSettingsV22,
  loadCardTransportMap,
  loadCustomEveClientId,
  loadCustomGeminiKey,
  loadSavedRoutesV22,
  saveAiCommentarySettings,
  saveAppSettingsV22,
  saveCardTransportMap,
  saveCustomEveClientId,
  saveCustomGeminiKey,
  saveSavedRoutesV22,
} from './utils/apiKeys.ts';
import { setManyCardsCollapsed, useCollapsibleCard } from './utils/collapseStore.ts';
import {
  fetchCharacterIndustryJobsClient,
  fetchHubQuotesDirect,
  fetchIndustryCostIndicesClient,
  fetchOrderMonitorClient,
  pollUndercutWatchdogClient,
} from './utils/esiClientFallback.ts';
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
import { loadWatchlist, saveWatchlist } from './utils/watchlistStore.ts';

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

const VALID_HUB_IDS: TradeHubId[] = ['jita', 'amarr', 'dodixie', 'rens', 'hek'];

function loadStoredHub(key: string, fallback: TradeHubId): TradeHubId {
  try {
    const raw = localStorage.getItem(key) as TradeHubId | null;
    if (raw && VALID_HUB_IDS.includes(raw)) return raw;
  } catch {
    // ignore storage restrictions
  }
  return fallback;
}

function loadStoredStructureConfig(): IndustryStructureConfig {
  try {
    const raw = localStorage.getItem('foxy_structure_config_v2');
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<IndustryStructureConfig>;
      if (parsed && typeof parsed.systemId === 'number' && parsed.structureType) {
        return { ...DEFAULT_INDUSTRY_STRUCTURE_CONFIG, ...parsed };
      }
    }
  } catch {
    // ignore
  }
  return DEFAULT_INDUSTRY_STRUCTURE_CONFIG;
}

function loadStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch {
    // ignore
  }
  return fallback;
}

function loadStoredBuildQueue(): BuildQueueEntry[] {
  try {
    const raw = localStorage.getItem('foxy_build_queue_v21');
    if (raw) {
      const parsed = JSON.parse(raw) as BuildQueueEntry[];
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {
    // ignore
  }
  return [];
}

function loadStoredRightPanePct(): number {
  try {
    const raw = Number(localStorage.getItem('foxy_split_pane_right_pct_v21'));
    if (Number.isFinite(raw) && raw >= 24 && raw <= 64) return raw;
  } catch {
    // ignore
  }
  return 34;
}

export default function App() {
  const [activeView, setActiveView] = useState<WorkspaceView>('overview');
  const [checkedCategories, setCheckedCategories] = useState<MarketCategoryId[]>(
    SCOPE_PRESETS.all
  );
  const [scopeCollapsed, toggleScopeCollapsed] = useCollapsibleCard('panel-market-scope', false);
  const scopeExpanded = !scopeCollapsed;
  const [summaryCollapsed, toggleSummaryCollapsed] = useCollapsibleCard('panel-command-summary', false);
  const [allCardsCollapsed, setAllCardsCollapsed] = useState(false);

  // 5-Hub Empire Trade Network state (persisted)
  const [sourceHub, setSourceHub] = useState<TradeHubId>(() =>
    loadStoredHub('foxy_source_hub_v2', 'jita')
  );
  const [destHub, setDestHub] = useState<TradeHubId>(() =>
    loadStoredHub('foxy_dest_hub_v2', 'dodixie')
  );

  // Live CCP System Cost Indices & Upwell Structure Rig Config
  const [structureConfig, setStructureConfig] = useState<IndustryStructureConfig>(
    loadStoredStructureConfig
  );
  const [industryCosts, setIndustryCosts] = useState<IndustryCostSnapshot | null>(null);
  const [isRefreshingCosts, setIsRefreshingCosts] = useState(false);

  // Hangar Stock Deductor Toggle (persisted)
  const [deductHangarStock, setDeductHangarStock] = useState<boolean>(() =>
    loadStoredBoolean('foxy_deduct_hangar_v2', true)
  );

  // Pinned Watchlist & Margin Triggers (persisted)
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => loadWatchlist());

  // Order Monitor Overlay & Active Industry Jobs state
  const [orderMonitorOpen, setOrderMonitorOpen] = useState(false);
  const [orderMonitorData, setOrderMonitorData] = useState<OrderMonitorSnapshot | null>(null);
  const [isRefreshingOrderMonitor, setIsRefreshingOrderMonitor] = useState(false);
  const [orderMonitorError, setOrderMonitorError] = useState<string | null>(null);
  const [isRefreshingJobs, setIsRefreshingJobs] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);

  // v2.1.0 ESI Cache Shield Telemetry, Slicer Single Source of Truth, Multi-Slot Build Queue,
  // Hauler Flyout, Price Projection Modal (with BYOK AI settings), Selected Card, and Split-Pane Divider
  const [cacheTelemetry, setCacheTelemetry] = useState<MarketCacheTelemetry | null>(null);
  const [qtyOverridesByCardId, setQtyOverridesByCardId] = useState<Record<string, number>>({});
  const [buildQueue, setBuildQueue] = useState<BuildQueueEntry[]>(loadStoredBuildQueue);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [haulerFlyoutContext, setHaulerFlyoutContext] = useState<HaulerFlyoutContext | null>(null);
  const [priceProjectionTarget, setPriceProjectionTarget] = useState<{
    typeId: number;
    itemName: string;
    regionId?: number;
    currentPrice?: number;
  } | null>(null);
  const [aiSettings, setAiSettings] = useState<AiCommentarySettings>(() =>
    loadAiCommentarySettings()
  );
  // v2.2.0 Unified App Settings, Route Lifecycle Archive, Per-Card Transport/Haul Overrides,
  // Per-Card Order vs Instant Overrides, External Pinned Cards (Contracts/Station Trading), and Undo Toast
  const [appSettings, setAppSettings] = useState<AppSettingsV22>(() => loadAppSettingsV22());
  const [savedRoutes, setSavedRoutes] = useState<SavedRouteRecord[]>(() => loadSavedRoutesV22());
  const [cardTransportMap, setCardTransportMap] = useState<
    Record<string, { transportIsk: number; minDesiredProfitIsk: number }>
  >(() => loadCardTransportMap());
  const [haulOverrides, setHaulOverrides] = useState<Record<string, number>>({});
  const [cardExecModeOverrides, setCardExecModeOverrides] = useState<
    Record<string, OrderExecutionMode>
  >({});
  const [externalPinnedCards, setExternalPinnedCards] = useState<Record<string, ActionCardData>>(
    {}
  );
  const [undoToast, setUndoToast] = useState<{
    message: string;
    onUndo?: () => void;
  } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  const [rightPanePct, setRightPanePct] = useState<number>(loadStoredRightPanePct);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);

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
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTabId>('connections');

  const openSettingsTab = useCallback((tab: SettingsTabId) => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);

  const handleOpenHistory = useCallback((typeId: number, name: string) => {
    setHistoryTarget({ typeId, name });
  }, []);

  // EVE SSO PKCE, BYOK ("Bring Your Own Keys") & Full Blueprint Scanner state
  const buildEnvEveClientId = (import.meta.env.VITE_EVE_CLIENT_ID || '').trim();
  const [envEveClientId, setEnvEveClientId] = useState<string>(buildEnvEveClientId);
  const [hasEnvGeminiKey, setHasEnvGeminiKey] = useState<boolean>(false);
  const [customEveClientId, setCustomEveClientId] = useState<string>(() => loadCustomEveClientId());
  const [customGeminiKey, setCustomGeminiKey] = useState<string>(() => loadCustomGeminiKey());
  const effectiveEveClientId = (envEveClientId || customEveClientId).trim();

  const [callbackUrl] = useState<string>(() => getCurrentCallbackUrl());
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

  // Fetch env-first public config flags from server (never leaks server GEMINI_API_KEY)
  useEffect(() => {
    fetch('/api/eve/sso-config')
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          cfg: {
            serverClientId?: string;
            hasEnvEveClientId?: boolean;
            hasEnvGeminiKey?: boolean;
          } | null
        ) => {
          if (!cfg) return;
          const serverId = (cfg.serverClientId || '').trim();
          if (serverId) {
            setEnvEveClientId(serverId);
          }
          if (typeof cfg.hasEnvGeminiKey === 'boolean') {
            setHasEnvGeminiKey(cfg.hasEnvGeminiKey);
          }
        }
      )
      .catch(() => {
        // Static/offline deployment fallback: rely on VITE_* or browser localStorage keys
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

  // Persist v2.0.0 user preferences
  const handleChangeSourceHub = useCallback(
    (next: TradeHubId) => {
      if (next === destHub) {
        setDestHub(sourceHub);
        try {
          localStorage.setItem('foxy_dest_hub_v2', sourceHub);
        } catch {
          // ignore
        }
      }
      setSourceHub(next);
      try {
        localStorage.setItem('foxy_source_hub_v2', next);
      } catch {
        // ignore
      }
    },
    [destHub, sourceHub]
  );

  const handleChangeDestHub = useCallback(
    (next: TradeHubId) => {
      if (next === sourceHub) {
        setSourceHub(destHub);
        try {
          localStorage.setItem('foxy_source_hub_v2', destHub);
        } catch {
          // ignore
        }
      }
      setDestHub(next);
      try {
        localStorage.setItem('foxy_dest_hub_v2', next);
      } catch {
        // ignore
      }
    },
    [destHub, sourceHub]
  );

  const handleSwapHubs = useCallback(() => {
    setSourceHub(destHub);
    setDestHub(sourceHub);
    try {
      localStorage.setItem('foxy_source_hub_v2', destHub);
      localStorage.setItem('foxy_dest_hub_v2', sourceHub);
    } catch {
      // ignore
    }
  }, [destHub, sourceHub]);

  const handleChangeStructureConfig = useCallback((next: IndustryStructureConfig) => {
    setStructureConfig(next);
    try {
      localStorage.setItem('foxy_structure_config_v2', JSON.stringify(next));
    } catch {
      // ignore
    }
  }, []);

  const handleToggleDeductHangarStock = useCallback((next: boolean) => {
    setDeductHangarStock(next);
    try {
      localStorage.setItem('foxy_deduct_hangar_v2', String(next));
    } catch {
      // ignore
    }
  }, []);

  // Fetch live CCP /industry/systems/ cost indices & /markets/prices/ adjusted prices on mount
  const handleRefreshIndustryCosts = useCallback(async () => {
    setIsRefreshingCosts(true);
    try {
      const next = await fetchIndustryCostIndicesClient();
      setIndustryCosts(next);
    } catch {
      // Keep baseline/cached values gracefully
    } finally {
      setIsRefreshingCosts(false);
    }
  }, []);

  useEffect(() => {
    void handleRefreshIndustryCosts();
  }, [handleRefreshIndustryCosts]);

  // Watchlist persistence & handlers
  useEffect(() => {
    saveWatchlist(watchlist);
  }, [watchlist]);

  const pinnedTypeIds = useMemo(
    () => new Set(watchlist.map((w) => w.typeId)),
    [watchlist]
  );

  const handleAddWatchlistItem = useCallback((item: WatchlistItem) => {
    setWatchlist((prev) =>
      prev.some((w) => w.typeId === item.typeId) ? prev : [item, ...prev]
    );
  }, []);

  const handleUpdateWatchlistItem = useCallback(
    (typeId: number, patch: Partial<WatchlistItem>) => {
      setWatchlist((prev) =>
        prev.map((w) => (w.typeId === typeId ? { ...w, ...patch } : w))
      );
    },
    []
  );

  const handleRemoveWatchlistItem = useCallback((typeId: number) => {
    setWatchlist((prev) => prev.filter((w) => w.typeId !== typeId));
  }, []);

  const handleTogglePinWatchlist = useCallback(
    (typeId: number, name: string, kind: 'sku' | 'blueprint') => {
      setWatchlist((prev) => {
        if (prev.some((w) => w.typeId === typeId)) {
          return prev.filter((w) => w.typeId !== typeId);
        }
        return [
          {
            id: `wl-${typeId}-${Date.now()}`,
            typeId,
            name,
            kind,
            minRoiPct: 12,
            minIskPerM3: 1500,
            pinnedAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    },
    []
  );

  // Sync live Fuzzwork + EVE ESI market data for checked categories & selected Empire hubs
  // Falls back directly to client-side Fuzzwork aggregates when deployed on static/serverless hosts
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const syncLiveMarkets = useCallback(
    async (
      cats: MarketCategoryId[],
      force = false,
      hubs: TradeHubId[] = ['jita', 'dodixie']
    ) => {
      if (cats.length === 0) {
        setSnapshot((prev) => ({
          ...prev,
          liveItemCount: 0,
          lastSyncedAt: new Date().toISOString(),
        }));
        return;
      }

      const uniqueHubs = Array.from(new Set<TradeHubId>(['jita', 'dodixie', ...hubs]));
      setIsSyncing(true);
      try {
        const qs = new URLSearchParams({
          categories: cats.join(','),
          hubs: uniqueHubs.join(','),
          force: force ? 'true' : 'false',
        });
        const res = await fetch(`/api/market/sync?${qs.toString()}`);
        if (!res.ok) {
          throw new Error(`Market sync returned HTTP ${res.status}`);
        }
        const data = (await res.json()) as MarketSnapshot & {
          cacheTelemetry?: MarketCacheTelemetry;
        };
        if (data.cacheTelemetry) {
          setCacheTelemetry(data.cacheTelemetry);
        }
        if (data.esiRateLimit) {
          setEsiRateLimit(data.esiRateLimit);
          setNowTick(Date.now());
        }
        setSnapshot((prev) => {
          const mergedQuotes: Record<number, MarketQuote> = { ...prev.quotes };
          for (const [k, incoming] of Object.entries(data.quotes)) {
            const id = Number(k);
            const existing = prev.quotes[id];
            mergedQuotes[id] = {
              ...existing,
              ...incoming,
              hubs: {
                ...(existing?.hubs ?? {}),
                ...(incoming.hubs ?? {}),
              },
            };
          }
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
        // Serverless / static fallback: fetch Fuzzwork aggregates directly from the browser
        try {
          const trackedTypeIds = getItemsForCategories(cats).map((i) => i.typeId);
          const direct = await fetchHubQuotesDirect(
            uniqueHubs,
            trackedTypeIds,
            snapshotRef.current.quotes
          );
          if (direct.quotes && Object.keys(direct.quotes).length > 0) {
            setSnapshot((prev) => {
              const mergedQuotes: Record<number, MarketQuote> = {
                ...prev.quotes,
                ...direct.quotes,
              };
              const liveItemCount = Object.values(mergedQuotes).filter(
                (q) => q.source === 'live'
              ).length;
              return {
                ...prev,
                quotes: mergedQuotes,
                liveItemCount,
                lastSyncedAt: direct.lastSyncedAt ?? new Date().toISOString(),
                sourceMode: liveItemCount > 0 ? 'live' : prev.sourceMode,
                syncError: null,
              };
            });
            return;
          }
        } catch {
          // Fall through to warning state
        }
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
          cacheTelemetry?: MarketCacheTelemetry;
          error?: string;
        };

        if (data.cacheTelemetry) {
          setCacheTelemetry(data.cacheTelemetry);
        }
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

  // Initial sync & re-sync whenever checked categories or 5-hub trade pair change
  // Respects document.hidden so hidden browser tabs pause general market browsing
  useEffect(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    const timer = setTimeout(() => {
      syncLiveMarkets(checkedCategories, false, [sourceHub, destHub]);
    }, 180);
    return () => clearTimeout(timer);
  }, [checkedCategories, sourceHub, destHub, syncLiveMarkets]);

  // Persist build queue & BYOK AI commentary settings
  useEffect(() => {
    try {
      localStorage.setItem('foxy_build_queue_v21', JSON.stringify(buildQueue));
    } catch {
      // ignore
    }
  }, [buildQueue]);

  const handleChangeAiSettings = useCallback((next: AiCommentarySettings) => {
    setAiSettings(next);
    saveAiCommentarySettings(next);
    if (next.geminiKey !== undefined) {
      setCustomGeminiKey(next.geminiKey);
      saveCustomGeminiKey(next.geminiKey);
    }
  }, []);

  // v2.2.0 Settings, Route Archive, Transport/Haul Override, and Undo Toast handlers
  const handleChangeAppSettings = useCallback((next: AppSettingsV22) => {
    setAppSettings(next);
    saveAppSettingsV22(next);
  }, []);

  useEffect(() => {
    saveSavedRoutesV22(savedRoutes);
  }, [savedRoutes]);

  useEffect(() => {
    saveCardTransportMap(cardTransportMap);
  }, [cardTransportMap]);

  const triggerUndoToast = useCallback((message: string, onUndo?: () => void) => {
    setUndoToast({ message, onUndo });
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => {
      setUndoToast(null);
      undoTimerRef.current = null;
    }, 6500);
  }, []);

  const handleSaveCommittedRoute = useCallback(
    (record: SavedRouteRecord) => {
      setSavedRoutes((prev) => [record, ...prev]);
      triggerUndoToast(`Committed route "${record.name}" to active routes.`);
    },
    [triggerUndoToast]
  );

  const handleMarkRouteCompleted = useCallback(
    (id: string) => {
      setSavedRoutes((prev) => {
        const target = prev.find((r) => r.id === id);
        if (target) {
          triggerUndoToast(
            `Archived "${target.name}" to Completed Routes.`,
            () =>
              setSavedRoutes((cur) =>
                cur.map((r) =>
                  r.id === id ? { ...r, tier: 'committed', completedAt: undefined } : r
                )
              )
          );
        }
        return prev.map((r) =>
          r.id === id
            ? { ...r, tier: 'completed', completedAt: new Date().toISOString() }
            : r
        );
      });
    },
    [triggerUndoToast]
  );

  const handleDeleteSavedRoute = useCallback(
    (id: string) => {
      setSavedRoutes((prev) => {
        const target = prev.find((r) => r.id === id);
        if (target) {
          triggerUndoToast(`Deleted saved route "${target.name}".`, () =>
            setSavedRoutes((cur) => [target, ...cur])
          );
        }
        return prev.filter((r) => r.id !== id);
      });
    },
    [triggerUndoToast]
  );

  const handleRestoreRoute = useCallback(
    (record: SavedRouteRecord) => {
      setQueuedRouteIds(record.cardIds);
      setRightSidebarMode('route');
      triggerUndoToast(`Loaded "${record.name}" (${record.cardIds.length} cards) into Live Session.`);
    },
    [triggerUndoToast]
  );

  const handleChangeCardTransport = useCallback(
    (cardId: string, transportIsk: number, minDesiredProfitIsk: number) => {
      setCardTransportMap((prev) => ({
        ...prev,
        [cardId]: {
          transportIsk: Math.max(0, transportIsk),
          minDesiredProfitIsk: Math.max(0, minDesiredProfitIsk),
        },
      }));
    },
    []
  );

  const handleSetHaulOverride = useCallback((cardId: string, haulCostIsk: number) => {
    setHaulOverrides((prev) => ({ ...prev, [cardId]: Math.max(0, haulCostIsk) }));
  }, []);

  const handleClearHaulOverride = useCallback(
    (cardId: string) => {
      setHaulOverrides((prev) => {
        const prevOverride = prev[cardId];
        if (prevOverride === undefined) return prev;
        const next = { ...prev };
        delete next[cardId];
        const restoredBase = cardTransportMap[cardId]?.transportIsk ?? 0;
        triggerUndoToast(
          `Cleared route haul override — restored card transport cost (${formatIsk(restoredBase)}).`,
          () => setHaulOverrides((cur) => ({ ...cur, [cardId]: prevOverride }))
        );
        return next;
      });
    },
    [cardTransportMap, triggerUndoToast]
  );

  const handleChangeCardExecutionMode = useCallback(
    (cardId: string, mode: OrderExecutionMode) => {
      setCardExecModeOverrides((prev) => ({ ...prev, [cardId]: mode }));
    },
    []
  );

  const handlePinExternalCardToRoute = useCallback(
    (card: ActionCardData) => {
      setExternalPinnedCards((prev) => ({ ...prev, [card.id]: card }));
      setQueuedRouteIds((prev) => (prev.includes(card.id) ? prev : [...prev, card.id]));
      setRightSidebarMode('route');
      triggerUndoToast(`Pinned "${card.title}" to Route Optimizer.`);
    },
    [triggerUndoToast]
  );

  // Resizable vertical split-pane drag handlers (center workspace <-> right docked panel)
  useEffect(() => {
    if (!isDraggingSplit) return;
    const handleMouseMove = (e: MouseEvent) => {
      const el = splitContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0) return;
      const rightWidthPx = rect.right - e.clientX;
      const pct = Math.max(24, Math.min(64, Number(((rightWidthPx / rect.width) * 100).toFixed(1))));
      setRightPanePct(pct);
    };
    const handleMouseUp = () => {
      setIsDraggingSplit(false);
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingSplit]);

  useEffect(() => {
    try {
      localStorage.setItem('foxy_split_pane_right_pct_v21', String(rightPanePct));
    } catch {
      // ignore
    }
  }, [rightPanePct]);

  // Lightweight Background Undercut Watchdog (5-minute CCP cache aligned):
  // Polls ONLY the user's open order type_ids while the tab is hidden (or idle) without waking full market scans.
  useEffect(() => {
    if (profile.mode !== 'eve_sso' || !eveAccessToken || !profile.characterId) return;

    const runWatchdog = async () => {
      const openOrders = profile.activeOrders ?? [];
      if (openOrders.length === 0) return;
      try {
        const res = await pollUndercutWatchdogClient(
          profile.characterId!,
          eveAccessToken,
          getEffectiveOrderFees(profile, { hubId: destHub, appSettings }).salesTaxPct / 100
        );
        if (res.cacheMeta) {
          setCacheTelemetry({
            ...res.cacheMeta,
            mode: typeof document !== 'undefined' && document.hidden ? 'background_watchdog' : 'active_sync',
            watchdogActive: typeof document !== 'undefined' ? document.hidden : false,
          });
        }
        if (Array.isArray(res.orders) && res.orders.length > 0) {
          setOrderMonitorData((prev) => ({
            syncedAt: res.syncedAt,
            orders: res.orders,
            undercutCount: res.undercutCount,
            recentTransactions: prev?.recentTransactions ?? [],
            realizedRevenue24hIsk: prev?.realizedRevenue24hIsk ?? 0,
            realizedSpend24hIsk: prev?.realizedSpend24hIsk ?? 0,
            realizedProfit24hIsk: prev?.realizedProfit24hIsk ?? 0,
            realizedProfit7dIsk: prev?.realizedProfit7dIsk ?? 0,
            cacheMeta: res.cacheMeta ?? prev?.cacheMeta,
          }));
        }
      } catch {
        // Watchdog stays non-intrusive on transient errors
      }
    };

    const handleVisibilityChange = () => {
      const hidden = typeof document !== 'undefined' && document.hidden;
      setCacheTelemetry((prev) =>
        prev
          ? {
              ...prev,
              mode: hidden ? 'background_watchdog' : 'active_sync',
              watchdogActive: hidden,
            }
          : prev
      );
      if (!hidden) {
        // Tab returned to foreground — allow normal market sync if stale (>5m)
        const lastMs = snapshotRef.current.lastSyncedAt
          ? Date.parse(snapshotRef.current.lastSyncedAt)
          : 0;
        if (Date.now() - lastMs > 300_000) {
          void syncLiveMarkets(checkedCategories, false, [sourceHub, destHub]);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = window.setInterval(() => {
      void runWatchdog();
    }, 300_000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.clearInterval(interval);
    };
  }, [
    checkedCategories,
    destHub,
    eveAccessToken,
    profile,
    sourceHub,
    syncLiveMarkets,
  ]);

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
          industryJobs: Array.isArray(charJson.industryJobs)
            ? charJson.industryJobs
            : prev.industryJobs,
          industryJobsSyncedAt:
            charJson.industryJobsSyncedAt ?? prev.industryJobsSyncedAt,
          hangarStock:
            charJson.hangarStock && Object.keys(charJson.hangarStock).length > 0
              ? charJson.hangarStock
              : prev.hangarStock,
          npcStandings: Array.isArray(charJson.npcStandings)
            ? charJson.npcStandings
            : prev.npcStandings,
          stationAssetsByLocation:
            charJson.stationAssetsByLocation &&
            Object.keys(charJson.stationAssetsByLocation).length > 0
              ? charJson.stationAssetsByLocation
              : prev.stationAssetsByLocation,
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
    setCustomEveClientId(val);
    saveCustomEveClientId(val);
  };

  const handleConnectEveSso = async (overrideClientId?: string) => {
    const trimmedId = (
      envEveClientId ||
      (overrideClientId !== undefined ? overrideClientId : customEveClientId)
    ).trim();

    if (!trimmedId) {
      openSettingsTab('connections');
      setSsoStatusMsg(
        'No EVE Client ID is configured yet. Copy the Callback URL into developers.eveonline.com, paste your Client ID below, and click Connect EVE SSO.'
      );
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

  const handleApplyExecutionModeToAll = useCallback(
    (mode: OrderExecutionMode) => {
      setProfile((prev) =>
        prev.orderExecutionMode === mode ? prev : { ...prev, orderExecutionMode: mode }
      );
      setCardExecModeOverrides({});
      triggerUndoToast(
        `Applied ${mode === 'list_orders' ? 'List Orders' : 'Instant Fill'} mode to all action cards.`
      );
    },
    [triggerUndoToast]
  );

  const effectiveFees = useMemo(
    () => getEffectiveOrderFees(profile, { hubId: destHub, appSettings }),
    [appSettings, destHub, profile]
  );
  const activeSellOrderCount = useMemo(
    () => (profile.activeOrders ?? []).filter((o) => !o.isBuyOrder).length,
    [profile.activeOrders]
  );

  // Live refresh of active character industry jobs (esi-industry.read_character_jobs.v1)
  const handleRefreshIndustryJobs = useCallback(async () => {
    if (profile.mode !== 'eve_sso' || !eveAccessToken || !profile.characterId) {
      return;
    }
    setIsRefreshingJobs(true);
    setJobsError(null);
    try {
      const jobs = await fetchCharacterIndustryJobsClient(profile.characterId, eveAccessToken);
      setProfile((prev) => ({
        ...prev,
        industryJobs: jobs,
        industryJobsSyncedAt: new Date().toISOString(),
      }));
    } catch (err) {
      setJobsError(
        err instanceof Error ? err.message : 'Unable to fetch active character industry jobs.'
      );
    } finally {
      setIsRefreshingJobs(false);
    }
  }, [eveAccessToken, profile.characterId, profile.mode]);

  // Live Undercut & Fill Order Monitor scan
  const handleRefreshOrderMonitor = useCallback(async () => {
    if (profile.mode !== 'eve_sso' || !eveAccessToken || !profile.characterId) {
      return;
    }
    setIsRefreshingOrderMonitor(true);
    setOrderMonitorError(null);
    try {
      const data = await fetchOrderMonitorClient(
        profile.characterId,
        eveAccessToken,
        effectiveFees.salesTaxPct / 100
      );
      setOrderMonitorData(data);
    } catch (err) {
      setOrderMonitorError(
        err instanceof Error ? err.message : 'Unable to scan live order books for undercuts.'
      );
    } finally {
      setIsRefreshingOrderMonitor(false);
    }
  }, [effectiveFees.salesTaxPct, eveAccessToken, profile.characterId, profile.mode]);

  // Open Market Details window inside the active EVE Online client (Express proxy + direct ESI fallback)
  const handleOpenEveMarketWindow = useCallback(
    async (typeId: number) => {
      if (!eveAccessToken) return;
      try {
        const res = await fetch('/api/eve/open-market', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${eveAccessToken}`,
          },
          body: JSON.stringify({ typeId }),
        });
        if (res.ok) return;
      } catch {
        // Fallback to direct ESI UI trigger
      }
      await fetch(
        `https://esi.evetech.net/ui/openwindow/marketdetails/?datasource=tranquility&type_id=${typeId}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${eveAccessToken}`,
            'X-Compatibility-Date': '2026-08-18',
          },
        }
      );
    },
    [eveAccessToken]
  );

  // Run all 5 deterministic decision engines reactively
  const engineBundle = useMemo(
    () =>
      runAllDecisionEngines(checkedCategories, snapshot, profile, {
        catalog,
        minDailyVolume,
        sourceHub,
        destHub,
        structureConfig,
        industryCosts: industryCosts ?? undefined,
        appSettings,
      }),
    [
      checkedCategories,
      snapshot,
      profile,
      catalog,
      minDailyVolume,
      sourceHub,
      destHub,
      structureConfig,
      industryCosts,
      appSettings,
    ]
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
        return '5-Hub Trade';
      case 'station_trading':
        return 'Station Trading';
      case 'contracts':
        return 'Contracts';
      case 'pi_factory':
        return 'PI Factories';
      case 'gank':
        return 'Gank';
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
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (!hasEnvGeminiKey && customGeminiKey.trim()) {
        headers['X-Gemini-Api-Key'] = customGeminiKey.trim();
      }
      const res = await fetch('/api/advisor/chat', {
        method: 'POST',
        headers,
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

  const dynamicSections = useMemo(() => {
    const srcLabel = EMPIRE_HUB_MAP[sourceHub].shortLabel;
    const dstLabel = EMPIRE_HUB_MAP[destHub].shortLabel;
    const structLabel =
      structureConfig.structureType === 'npc_station'
        ? 'NPC Station'
        : structureConfig.structureType.toUpperCase();
    return ENGINE_SECTIONS.map((sec) => {
      if (sec.id === 'indy_invention') {
        return {
          ...sec,
          title: `${structureConfig.systemName} Industry & T2 Copy / Invention Planner`,
          subtitle: `Live CCP cost indices (${structureConfig.systemName} · ${structLabel}) + Upwell rig bonuses & vanilla T2 invention.`,
        };
      }
      if (sec.id === 'regional_trade') {
        return {
          ...sec,
          title: `5-Hub Regional Trade Manifesto (${srcLabel} <-> ${dstLabel})`,
          subtitle: `Ranked outbound & backhaul manifests across ${srcLabel} and ${dstLabel}, capped by ISK float, hull m³, and live book depth.`,
        };
      }
      return sec;
    });
  }, [destHub, sourceHub, structureConfig.structureType, structureConfig.systemName]);

  const sectionsToRender =
    activeView === 'overview'
      ? dynamicSections
      : activeView === 'corridor_trade'
        ? dynamicSections.filter(
            (s) => s.id === 'pipeline_corridor' || s.id === 'regional_trade'
          )
        : dynamicSections.filter((s) => s.id === activeView);

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

  // Map of all live engine cards by ID (used by BuildQueueAndLedgerPanel & Slicer propagation)
  const cardsById = useMemo(() => {
    const m = new Map<string, ActionCardData>();
    for (const c of engineBundle.cards) {
      m.set(c.id, c);
    }
    return m;
  }, [engineBundle.cards]);

  const activeMfgJobCount = useMemo(
    () => (profile.industryJobs ?? []).filter((j) => j.status === 'active' && j.activityId === 1).length,
    [profile.industryJobs]
  );

  const handleCommitCardQty = useCallback((cardId: string, qty: number) => {
    const clamped = Math.max(1, Math.round(qty || 1));
    setQtyOverridesByCardId((prev) => ({ ...prev, [cardId]: clamped }));
    // Keep Build Queue runs in sync automatically when card slicer changes
    setBuildQueue((prev) =>
      prev.some((e) => e.cardId === cardId)
        ? prev.map((e) => (e.cardId === cardId ? { ...e, committedRuns: clamped } : e))
        : prev
    );
  }, []);

  // Build Queue handlers
  const handleAddToBuildQueue = useCallback(
    (card: ActionCardData, runs: number, slots: number) => {
      const cleanRuns = Math.max(1, Math.round(runs || 1));
      const cleanSlots = Math.max(1, Math.round(slots || 1));
      setQtyOverridesByCardId((prev) => ({ ...prev, [card.id]: cleanRuns }));
      setBuildQueue((prev) => {
        const exists = prev.find((e) => e.cardId === card.id);
        if (exists) {
          return prev.map((e) =>
            e.cardId === card.id
              ? { ...e, committedRuns: cleanRuns, allocatedSlots: cleanSlots }
              : e
          );
        }
        return [
          ...prev,
          {
            cardId: card.id,
            title: card.title,
            productTypeId: card.primaryTypeId ?? 0,
            productName: card.primaryItemName || card.title,
            committedRuns: cleanRuns,
            outputPerRun: Math.max(1, card.outputPerRun ?? 1),
            allocatedSlots: cleanSlots,
            priorityOrder: prev.length + 1,
            addedAt: new Date().toISOString(),
          },
        ];
      });
      setActionToast(`Added ${card.title} (${cleanRuns} runs, ${cleanSlots} slot${cleanSlots > 1 ? 's' : ''}) to Multi-Slot Build Queue.`);
      window.setTimeout(() => setActionToast(null), 3200);
    },
    []
  );

  const handleUpdateQueueRuns = useCallback((cardId: string, runs: number) => {
    const clean = Math.max(1, Math.round(runs || 1));
    setQtyOverridesByCardId((prev) => ({ ...prev, [cardId]: clean }));
    setBuildQueue((prev) =>
      prev.map((e) => (e.cardId === cardId ? { ...e, committedRuns: clean } : e))
    );
  }, []);

  const handleUpdateQueueSlots = useCallback((cardId: string, slots: number) => {
    const clean = Math.max(1, Math.round(slots || 1));
    setBuildQueue((prev) =>
      prev.map((e) => (e.cardId === cardId ? { ...e, allocatedSlots: clean } : e))
    );
  }, []);

  const handleMoveQueuePriority = useCallback((cardId: string, direction: 'up' | 'down') => {
    setBuildQueue((prev) => {
      const idx = prev.findIndex((e) => e.cardId === cardId);
      if (idx < 0) return prev;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(idx, 1);
      copy.splice(target, 0, moved);
      return copy.map((e, i) => ({ ...e, priorityOrder: i + 1 }));
    });
  }, []);

  const handleRemoveQueueEntry = useCallback((cardId: string) => {
    setBuildQueue((prev) =>
      prev.filter((e) => e.cardId !== cardId).map((e, i) => ({ ...e, priorityOrder: i + 1 }))
    );
  }, []);

  const handleClearBuildQueue = useCallback(() => {
    setBuildQueue([]);
  }, []);

  // Scale a card's routeChains, volume, capital, and profit when the user edits its Slicer Qty/Runs
  const applyCommittedQtyToCard = useCallback(
    (card: ActionCardData): ActionCardData => {
      const override = qtyOverridesByCardId[card.id];
      const baseQty = card.baseBatchQty ?? 0;
      if (!override || baseQty <= 0 || override === baseQty) return card;
      const ratio = override / baseQty;
      return {
        ...card,
        netProfitIsk: card.netProfitIsk * ratio,
        requiredCapitalIsk: card.requiredCapitalIsk * ratio,
        totalVolumeM3: card.totalVolumeM3 * ratio,
        routeChains: card.routeChains.map((chain) => ({
          ...chain,
          legs: chain.legs.map((leg) => ({
            ...leg,
            iskCost: typeof leg.iskCost === 'number' ? leg.iskCost * ratio : undefined,
            iskPayout: typeof leg.iskPayout === 'number' ? leg.iskPayout * ratio : undefined,
            netProfitIsk:
              typeof leg.netProfitIsk === 'number' ? leg.netProfitIsk * ratio : undefined,
            cargoDeltaM3: leg.cargoDeltaM3 * ratio,
            items: leg.items.map((it) => ({
              ...it,
              quantity: Math.max(1, Math.round(it.quantity * ratio)),
              iskAmount: it.iskAmount * ratio,
              volumeM3: it.volumeM3 * ratio,
            })),
          })),
        })),
      };
    },
    [qtyOverridesByCardId]
  );

  // Active queued cards derived strictly from queuedRouteIds + live engineBundle.cards + external pinned cards
  const queuedRouteCards = useMemo(() => {
    const byId = new Map<string, ActionCardData>();
    for (const c of engineBundle.cards) byId.set(c.id, c);
    for (const c of Object.values(externalPinnedCards)) {
      if (!byId.has(c.id)) byId.set(c.id, c);
    }
    const list: ActionCardData[] = [];
    for (const id of queuedRouteIds) {
      const found = byId.get(id);
      if (found) list.push(applyCommittedQtyToCard(found));
    }
    return list;
  }, [engineBundle.cards, externalPinnedCards, queuedRouteIds, applyCommittedQtyToCard]);
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

  const handleToggleCollapseAllCards = useCallback(() => {
    const nextCollapsed = !allCardsCollapsed;
    const keys = [
      'panel-command-summary',
      'panel-industry-facility',
      'panel-industry-jobs',
      'panel-watchlist',
      'panel-overview-profit-chart',
      'panel-5hub-chart',
      'panel-blueprint-library',
      ...visibleCardsList.map((c) => `card-${c.id}`),
    ];
    setManyCardsCollapsed(keys, nextCollapsed);
    setAllCardsCollapsed(nextCollapsed);
  }, [allCardsCollapsed, visibleCardsList]);

  const handleOpenOrderMonitor = useCallback(() => {
    setOrderMonitorOpen(true);
    if (profile.mode === 'eve_sso' && !orderMonitorData && !isRefreshingOrderMonitor) {
      void handleRefreshOrderMonitor();
    }
  }, [handleRefreshOrderMonitor, isRefreshingOrderMonitor, orderMonitorData, profile.mode]);

  return (
    <div className="min-h-screen lg:h-screen flex flex-col bg-[#0b0e14] text-slate-100 lg:overflow-hidden">
      {/* Strict 3-Zone Top Navigation Bar */}
      <div className="no-print shrink-0">
        <TopBar
          activeView={activeView}
          onSelectView={setActiveView}
          orderMonitorOpen={orderMonitorOpen}
          undercutCount={profile.mode === 'eve_sso' ? (orderMonitorData?.undercutCount ?? 0) : 2}
          onOpenOrderMonitor={handleOpenOrderMonitor}
          onSyncMarkets={handleRefreshMarketPrices}
          isSyncing={isSyncing || scanProgress.active}
          marketCooldownRemainingSec={marketCooldownRemainingSec}
          isRateLimitPaused={rateLimitPauseRemainingSec > 0}
          routePanelOpen={rightSidebarMode === 'route'}
          queuedRouteCount={queuedRouteCards.length}
          onToggleRoutePanel={() =>
            setRightSidebarMode((mode) => (mode === 'route' ? 'collapsed' : 'route'))
          }
          onOpenSettings={() => openSettingsTab('connections')}
          hasEveClientId={Boolean(effectiveEveClientId)}
          cacheTelemetry={cacheTelemetry}
        />
      </div>

      {/* Main Resizable Split Command Workspace (Center Workspace + Drag Divider + Right Docked Panel) */}
      <div ref={splitContainerRef} className="flex-1 flex flex-col lg:flex-row min-h-0">
        {/* Main Center Workspace */}
        <main className="no-print flex-1 min-w-0 lg:overflow-y-auto px-5 py-5 space-y-5">
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
                onClick={() => openSettingsTab('industry')}
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
                onClick={() => {
                  if (profile.mode === 'eve_sso') {
                    openSettingsTab('connections');
                  } else if (!effectiveEveClientId) {
                    openSettingsTab('connections');
                    setSsoStatusMsg(
                      'No EVE Client ID is configured yet. Copy the Callback URL into developers.eveonline.com, paste your Client ID below, and click Connect EVE SSO.'
                    );
                  } else {
                    void handleConnectEveSso();
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {profile.mode === 'eve_sso' ? 'EVE SSO Connected' : 'Connect EVE SSO'}
                </span>
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

          {undoToast && (
            <div className="px-4 py-2 rounded-md bg-cyan-500/10 border border-cyan-500/35 text-xs text-cyan-100 flex items-center justify-between gap-3">
              <span>{undoToast.message}</span>
              <div className="flex items-center gap-2 shrink-0">
                {undoToast.onUndo && (
                  <button
                    type="button"
                    onClick={() => {
                      undoToast.onUndo?.();
                      setUndoToast(null);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-cyan-400/50 bg-cyan-500/20 text-cyan-100 hover:bg-cyan-500/30 font-medium cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>Undo</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setUndoToast(null)}
                  className="text-slate-400 hover:text-slate-200 text-[11px] cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {snapshot.syncError && (
            <div className="px-4 py-2.5 rounded-md bg-rose-500/10 border border-rose-500/30 text-xs text-rose-200">
              Market sync warning: {snapshot.syncError} — using cached/baseline prices until retry.
            </div>
          )}

          {/* Mobile / Tablet Engine Switcher */}
          <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-1">
            {(
              [
                'overview',
                'indy_invention',
                'reprocessing',
                'corridor_trade',
                'station_trading',
                'contracts',
                'pi_factory',
                'gank',
              ] as WorkspaceView[]
            ).map((v) => (
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
                      : v === 'corridor_trade'
                        ? '5-Hub Trade'
                        : v === 'station_trading'
                          ? 'Station Trading'
                          : v === 'contracts'
                            ? 'Contracts'
                            : v === 'gank'
                              ? 'Gank'
                              : 'PI'}
              </button>
            ))}
          </div>

          {/* Collapsible Market Scope & Category Checkboxes Matrix */}
          <MarketScopeBar
            checkedCategories={checkedCategories}
            onToggleCategory={handleToggleCategory}
            onApplyPreset={handleApplyPreset}
            isExpanded={scopeExpanded}
            onToggleExpand={toggleScopeCollapsed}
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

          {/* Collapsible 5-Column Command Telemetry Strip */}
          <section
            aria-label="Command Summary Metrics"
            className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
          >
            <div className="px-4 py-2 border-b border-slate-800/80 bg-[#0e131b]/70 flex items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-display font-semibold text-slate-200">
                  Command Telemetry Summary
                </span>
                {summaryCollapsed && topActionCard && (
                  <span className="font-mono tabular-nums text-[11px] text-emerald-400">
                    Top +{formatIsk(topActionCard.netProfitIsk)} · Total +
                    {formatIsk(selectedTotals.totalProjectedProfitIsk)} ·{' '}
                    {engineBundle.cards.length} cards
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={toggleSummaryCollapsed}
                aria-expanded={!summaryCollapsed}
                aria-label={summaryCollapsed ? 'Expand Command Summary' : 'Collapse Command Summary'}
                className="p-1 rounded border border-slate-700/80 bg-[#0b0e14] text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
              >
                {summaryCollapsed ? (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
            </div>

            {!summaryCollapsed && (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 divide-y xl:divide-y-0 md:divide-x divide-slate-800/80">
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
              </div>
            )}
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
                {/* Global Skill- & Standing-Adjusted Tax/Broker Execution Mode Toggle ("Apply to All Cards") */}
                <div
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-slate-800 bg-[#0b0e14] text-[11px]"
                  title={`Accounting Lv.${profile.skills.accounting} (Sales Tax ${effectiveFees.salesTaxPct.toFixed(2)}%) · Broker Relations Lv.${profile.skills.brokerRelations} (Standing-Adjusted Broker ${effectiveFees.brokerFeePct.toFixed(2)}%)`}
                >
                  <span className="font-mono tabular-nums text-slate-400 hidden sm:inline">
                    Tax {effectiveFees.salesTaxPct.toFixed(2)}% · Broker{' '}
                    {effectiveFees.brokerFeePct.toFixed(2)}%
                  </span>
                  <div className="inline-flex rounded bg-[#131822] p-0.5 border border-slate-800">
                    <button
                      type="button"
                      onClick={() => handleApplyExecutionModeToAll('list_orders')}
                      title="Apply List Orders to all cards (clears per-card overrides)"
                      className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        effectiveFees.executionMode === 'list_orders'
                          ? 'bg-cyan-500/20 text-cyan-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All: Orders
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyExecutionModeToAll('instant_fill')}
                      title="Apply Instant Fill to all cards (clears per-card overrides)"
                      className={`px-2 py-0.5 text-[11px] font-medium rounded transition-colors cursor-pointer ${
                        effectiveFees.executionMode === 'instant_fill'
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All: Instant
                    </button>
                  </div>
                  {Object.keys(cardExecModeOverrides).length > 0 && (
                    <span className="text-[10px] font-mono text-amber-300">
                      ({Object.keys(cardExecModeOverrides).length} custom)
                    </span>
                  )}
                </div>

                {/* Quick Global Tooltips On/Off Toggle (Locked Info Tips always remain active) */}
                <button
                  type="button"
                  onClick={() =>
                    handleChangeAppSettings({
                      ...appSettings,
                      tooltipsEnabled: !appSettings.tooltipsEnabled,
                    })
                  }
                  title="Toggle general helper tooltips across the app (Locked setup/rule tips stay visible)"
                  className={`px-2 py-1.5 text-[11px] font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    appSettings.tooltipsEnabled
                      ? 'border-slate-700/90 bg-[#0e131b] text-slate-300 hover:text-slate-100'
                      : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  }`}
                >
                  Tooltips: {appSettings.tooltipsEnabled ? 'On' : 'Off'}
                </button>

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

                <button
                  type="button"
                  onClick={handleToggleCollapseAllCards}
                  title="Collapse or expand all dashboard panels and action cards (saved across refreshes)"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-700/90 bg-[#0e131b] text-slate-300 hover:border-slate-500 hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  {allCardsCollapsed ? (
                    <ChevronsUpDown className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                  ) : (
                    <ChevronsDownUp className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                  )}
                  <span>{allCardsCollapsed ? 'Expand All' : 'Collapse All'}</span>
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

          {/* Dedicated v2.2.0 Tabs: Contracts, Station Trading, and Gank Evaluator */}
          {activeView === 'contracts' ? (
            <div className="pb-8">
              <ContractsTab
                profile={profile}
                snapshot={snapshot}
                structureConfig={structureConfig}
                appSettings={appSettings}
                eveAccessToken={eveAccessToken}
                onPinToRoute={handlePinExternalCardToRoute}
                onOpenSettings={() => openSettingsTab('connections')}
              />
            </div>
          ) : activeView === 'gank' ? (
            <div className="pb-8">
              <GankTab profile={profile} snapshot={snapshot} appSettings={appSettings} />
            </div>
          ) : activeView === 'station_trading' ? (
            <div className="pb-8">
              <StationTradingTab
                profile={profile}
                snapshot={snapshot}
                checkedCategories={checkedCategories}
                appSettings={appSettings}
                eveAccessToken={eveAccessToken}
                onPinToRoute={handlePinExternalCardToRoute}
                onInspectCard={(c) => {
                  setShowShoppingListDrawer(false);
                  setInspectedCard(c);
                }}
                onOpenProjection={(typeId, itemName, regionId) =>
                  setPriceProjectionTarget({ typeId, itemName, regionId })
                }
                onOpenSettings={() => openSettingsTab('connections')}
              />
            </div>
          ) : checkedCategories.length === 0 ? (
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
              {(activeView === 'overview' || activeView === 'indy_invention') && (
                <IndustryFacilityBar
                  config={structureConfig}
                  industryCosts={industryCosts}
                  isRefreshingCosts={isRefreshingCosts}
                  onChangeConfig={handleChangeStructureConfig}
                  onRefreshCosts={() => void handleRefreshIndustryCosts()}
                />
              )}

              {(activeView === 'overview' || activeView === 'indy_invention') && (
                <IndustryJobsPanel
                  profile={profile}
                  indyCards={visibleCardsByEngine.indy_invention}
                  queuedRouteCardIds={queuedRouteIds}
                  isRefreshingJobs={isRefreshingJobs}
                  jobsError={jobsError}
                  onRefreshJobs={() => void handleRefreshIndustryJobs()}
                  onInspectCard={(c) => {
                    setShowShoppingListDrawer(false);
                    setInspectedCard(c);
                  }}
                  onAddToRoute={(cardId) => handleToggleQueueCard(cardId, true)}
                />
              )}

              {(activeView === 'overview' || activeView === 'indy_invention') && (
                <BuildQueueAndLedgerPanel
                  entries={buildQueue}
                  cardsById={cardsById}
                  profile={profile}
                  snapshot={snapshot}
                  structureConfig={structureConfig}
                  activeMfgJobCount={activeMfgJobCount}
                  selectedEntryId={selectedCardId}
                  onSelectEntry={setSelectedCardId}
                  onUpdateRuns={handleUpdateQueueRuns}
                  onUpdateSlots={handleUpdateQueueSlots}
                  onMovePriority={handleMoveQueuePriority}
                  onRemoveEntry={handleRemoveQueueEntry}
                  onClearQueue={handleClearBuildQueue}
                  onOpenHaulerFlyout={setHaulerFlyoutContext}
                />
              )}

              {(activeView === 'overview' ||
                activeView === 'corridor_trade' ||
                activeView === 'regional_trade') && (
                <WatchlistPanel
                  watchlist={watchlist}
                  snapshot={snapshot}
                  profile={profile}
                  catalog={catalog}
                  sourceHub={sourceHub}
                  destHub={destHub}
                  onAddWatchlistItem={handleAddWatchlistItem}
                  onUpdateWatchlistItem={handleUpdateWatchlistItem}
                  onRemoveWatchlistItem={handleRemoveWatchlistItem}
                  onOpenHistory={handleOpenHistory}
                  onOpenPriceProjection={setPriceProjectionTarget}
                />
              )}

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
                  sourceHub={sourceHub}
                  destHub={destHub}
                  onChangeSourceHub={handleChangeSourceHub}
                  onChangeDestHub={handleChangeDestHub}
                  onSwapHubs={handleSwapHubs}
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
                            appSettings={appSettings}
                            isQueuedForRoute={queuedRouteIds.includes(card.id)}
                            isPinnedToWatchlist={
                              card.primaryTypeId
                                ? pinnedTypeIds.has(card.primaryTypeId)
                                : false
                            }
                            committedQty={qtyOverridesByCardId[card.id]}
                            onCommitQty={handleCommitCardQty}
                            cardExecutionModeOverride={cardExecModeOverrides[card.id]}
                            onChangeCardExecutionMode={handleChangeCardExecutionMode}
                            cardTransportCostIsk={cardTransportMap[card.id]?.transportIsk}
                            cardMinDesiredProfitIsk={
                              cardTransportMap[card.id]?.minDesiredProfitIsk
                            }
                            haulCostOverrideIsk={
                              haulOverrides[card.id] !== undefined ? haulOverrides[card.id] : null
                            }
                            onChangeCardTransport={handleChangeCardTransport}
                            isSelected={selectedCardId === card.id}
                            onSelectCard={setSelectedCardId}
                            snapshot={snapshot}
                            structureConfig={structureConfig}
                            activeMfgJobCount={activeMfgJobCount}
                            isInBuildQueue={buildQueue.some((e) => e.cardId === card.id)}
                            onAddToBuildQueue={handleAddToBuildQueue}
                            onOpenHaulerFlyout={setHaulerFlyoutContext}
                            onOpenPriceProjection={setPriceProjectionTarget}
                            onToggleQueueForRoute={handleToggleQueueCard}
                            onTogglePinWatchlist={handleTogglePinWatchlist}
                            onChangeExecutionMode={handleChangeExecutionMode}
                            onInspect={(c) => {
                              setShowShoppingListDrawer(false);
                              setInspectedCard(c);
                            }}
                            onAskAdvisor={handleAskAdvisorAboutCard}
                            onOpenHistory={handleOpenHistory}
                            onOpenSsoSettings={() => openSettingsTab('connections')}
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
                    pinnedTypeIds={pinnedTypeIds}
                    onTogglePinWatchlist={handleTogglePinWatchlist}
                    onToggleCorpBlueprints={handleToggleCorpBlueprints}
                    onRescanBlueprints={() => handleScanBlueprints(includeCorpBlueprints)}
                    onOpenHistory={handleOpenHistory}
                  />
                </section>
              )}
            </div>
          )}
        </main>

        {/* Click-and-Drag Resizable Vertical Split-Pane Divider (Desktop Only; double-click resets 50/50) */}
        {rightSidebarMode !== 'collapsed' && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workspace and right sidebar (double-click to reset 50/50)"
            title="Drag to resize · Double-click to reset 50/50"
            onMouseDown={(e) => {
              e.preventDefault();
              setIsDraggingSplit(true);
            }}
            onDoubleClick={() => setRightPanePct(50)}
            className={`no-print hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center border-l border-slate-800/90 transition-colors group ${
              isDraggingSplit
                ? 'bg-cyan-500/25 border-cyan-400/70'
                : 'bg-[#0b0e14] hover:bg-cyan-500/15 hover:border-cyan-400/50'
            }`}
          >
            <div
              className={`w-1 h-10 rounded-full transition-colors ${
                isDraggingSplit
                  ? 'bg-cyan-300'
                  : 'bg-slate-700 group-hover:bg-cyan-400'
              }`}
            />
          </div>
        )}

        {/* Collapsible Right Docked Panel: Fleet Logistics & Autopilot OR Gemini Strategic Advisor */}
        {rightSidebarMode === 'collapsed' ? (
          <div className="no-print">
            <AdvisorSidebar
              isCollapsed
              onToggleCollapse={() => setRightSidebarMode('advisor')}
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
          </div>
        ) : (
          <div
            className="w-full lg:h-full shrink-0 lg:min-w-[330px] lg:max-w-[66%] flex flex-col"
            style={{ flexBasis: `${rightPanePct}%` }}
          >
            {rightSidebarMode === 'route' ? (
              <RouteOptimizerSidebar
                queuedCards={queuedRouteCards}
                allCandidateCards={visibleCardsList}
                snapshot={snapshot}
                appSettings={appSettings}
                savedRoutes={savedRoutes}
                onSaveCommittedRoute={handleSaveCommittedRoute}
                onMarkRouteCompleted={handleMarkRouteCompleted}
                onDeleteSavedRoute={handleDeleteSavedRoute}
                onRestoreRoute={handleRestoreRoute}
                cardTransportMap={cardTransportMap}
                haulOverrides={haulOverrides}
                onSetHaulOverride={handleSetHaulOverride}
                onClearHaulOverride={handleClearHaulOverride}
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
                onOpenSsoSettings={() => openSettingsTab('connections')}
                onCollapse={() => setRightSidebarMode('collapsed')}
              />
            ) : (
              <AdvisorSidebar
                isCollapsed={false}
                onToggleCollapse={() => setRightSidebarMode('collapsed')}
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
        )}
      </div>

      {/* High-Density Inspection Drawer */}
      <InspectDrawer
        card={inspectedCard}
        profile={profile}
        eveAccessToken={eveAccessToken}
        appSettings={appSettings}
        snapshot={snapshot}
        shoppingListMode={showShoppingListDrawer}
        shoppingList={mergedShopping.lines}
        shoppingTotalIsk={mergedShopping.totalIsk}
        shoppingTotalM3={mergedShopping.totalM3}
        shoppingSavingsIsk={mergedShopping.savingsIsk}
        deductHangarStock={deductHangarStock}
        onToggleDeductHangarStock={handleToggleDeductHangarStock}
        customItemCount={customShoppingItems.length}
        onClearCustomShoppingItems={() => {
          setCustomShoppingItems([]);
          setAppliedActionIds([]);
        }}
        onOpenHistory={handleOpenHistory}
        onOpenSsoSettings={() => openSettingsTab('connections')}
        onClose={() => {
          setInspectedCard(null);
          setShowShoppingListDrawer(false);
        }}
      />

      {/* Slide-Over Undercut & Realized Fill Order Monitor Overlay */}
      <OrderMonitorOverlay
        isOpen={orderMonitorOpen}
        onClose={() => setOrderMonitorOpen(false)}
        profile={profile}
        eveAccessToken={eveAccessToken}
        data={orderMonitorData}
        isLoading={isRefreshingOrderMonitor}
        error={orderMonitorError}
        onRefresh={() => void handleRefreshOrderMonitor()}
        onOpenEveMarketWindow={handleOpenEveMarketWindow}
        onOpenSsoSetup={() => {
          setOrderMonitorOpen(false);
          openSettingsTab('connections');
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
        onOpenPriceProjection={setPriceProjectionTarget}
        onClose={() => setInspectedSkuCategory(null)}
      />

      {/* 30-Day Regional ESI Market History Modal */}
      <MarketHistoryModal
        target={historyTarget}
        onClose={() => setHistoryTarget(null)}
      />

      {/* Quantitative 7d/30d Price Projection & Optional BYOK AI Commentary Modal */}
      <PriceProjectionModal
        target={priceProjectionTarget}
        aiSettings={aiSettings}
        onOpenSettings={() => {
          setPriceProjectionTarget(null);
          openSettingsTab('connections');
        }}
        onClose={() => setPriceProjectionTarget(null)}
      />

      {/* Slide-Over Hauling Route Planner, Smart Hull Suggester & Multi-Buy Fit Flyout */}
      <HaulerFitFlyout
        context={haulerFlyoutContext}
        profile={profile}
        snapshot={snapshot}
        onClose={() => setHaulerFlyoutContext(null)}
      />

      {/* Subtle Bottom Footer Bar with Clickable About Info Popover */}
      <footer className="no-print px-5 py-1.5 bg-[#0d1118] border-t border-slate-800/80 flex items-center justify-between gap-4 text-[11px] text-slate-500 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">Foxy RedFox Indy Command</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => openSettingsTab('connections')}
            className="text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            Settings &amp; APIs
          </button>
        </div>
        <AboutInfoPopover
          position="top"
          compact
          onOpenSettings={() => openSettingsTab('connections')}
        />
      </footer>

      {/* Unified 5-Tab Settings Hub Modal */}
      <SettingsModal
        isOpen={settingsOpen}
        initialTab={settingsInitialTab}
        onClose={() => setSettingsOpen(false)}
        profile={profile}
        onUpdateProfile={setProfile}
        eveClientId={effectiveEveClientId}
        onChangeEveClientId={handleChangeClientId}
        callbackUrl={callbackUrl}
        onConnectEveSso={() => void handleConnectEveSso()}
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
        aiSettings={aiSettings}
        onChangeAiSettings={handleChangeAiSettings}
        appSettings={appSettings}
        onChangeAppSettings={handleChangeAppSettings}
      />
    </div>
  );
}
