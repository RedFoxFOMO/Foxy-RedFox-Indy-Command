export type MarketCategoryId =
  | 't1_ammo'
  | 't2_ammo'
  | 'bombs'
  | 'probes'
  | 'scripts'
  | 'fuel_blocks'
  | 't1_rigs'
  | 't2_rigs'
  | 't1_drones'
  | 't2_drones'
  | 'shuttles'
  | 'implants'
  | 'scrap_loot'
  | 'ores'
  | 'ice'
  | 'minerals'
  | 'salvaged'
  | 'pi_p0_p1'
  | 'pi_p2_p4';

export type MarketCategoryGroup =
  | 'Charges & Fuel'
  | 'Rigs, Drones & Hulls'
  | 'Resources & PI';

export interface MarketCategoryDef {
  id: MarketCategoryId;
  label: string;
  group: MarketCategoryGroup;
  marketGroupId: number;
  description: string;
}

export interface EveItem {
  typeId: number;
  name: string;
  category: MarketCategoryId | 'indy_support';
  volume: number; // Packaged volume in m3
  baseJitaSell: number; // Fallback baseline if offline
  baseJitaBuy: number;
  baseDodixieSell: number;
  baseDodixieBuy: number;
  estDailyJitaVol: number;
  estDailyDodixieVol: number;
  piTier?: 0 | 1 | 2 | 3 | 4;
  piBaseValue?: number; // CCP base value used for NPC POCO tax math
}

export interface OrderBookLevel {
  price: number;
  volume: number;
}

export interface HubQuote {
  sellMin: number;
  sellVolume: number;
  buyMax: number;
  buyVolume: number;
  sellPercentile: number;
  buyPercentile: number;
  topBuyDepthUnits?: number; // Live buy-order volume within top price tiers
  buyLevels?: OrderBookLevel[]; // Descending price buckets from live ESI order book
  avgDailyVol7d?: number; // 7-day average daily traded volume from ESI /markets/{region_id}/history/
}

export interface CorridorOrder {
  orderId: number;
  typeId: number;
  systemId: number;
  systemName: string;
  jumpsFromJita: number;
  jumpsFromIshisomo: number;
  isBuyOrder: boolean;
  price: number;
  volumeRemain: number;
  locationId: number;
}

export interface MarketQuote {
  typeId: number;
  jita: HubQuote;
  dodixie: HubQuote;
  estDailyJitaVol?: number;
  estDailyDodixieVol?: number;
  oneJumpCheapestSell?: {
    systemId: number;
    systemName: string;
    price: number;
    volumeRemain: number;
    jumpsFromJita: number;
  };
  corridorBestBuy?: CorridorOrder;
  corridorBestSell?: CorridorOrder;
  source: 'live' | 'baseline';
}

export interface EsiRateLimitState {
  errorLimitRemain: number | null;
  errorLimitResetSec: number | null;
  ratelimitRemaining: number | null;
  retryAfterSec: number | null;
  paused: boolean;
  pauseReason?: string;
  pausedUntilMs?: number;
}

export interface CatalogSku {
  typeId: number;
  name: string;
  category: MarketCategoryId;
  marketGroupId: number;
  volume: number;
  estDailyJitaVol?: number;
  estDailyDodixieVol?: number;
  isBaseline?: boolean;
}

export interface DynamicMarketCatalog {
  version: number;
  builtAt: string;
  expiresAt: number;
  source: 'esi_live' | 'baseline_fallback';
  totalSkus: number;
  categories: Record<MarketCategoryId, CatalogSku[]>;
  esiRateLimit?: EsiRateLimitState;
}

export interface MarketScanProgress {
  active: boolean;
  completedItems: number;
  totalItems: number;
  completedBatches: number;
  totalBatches: number;
  liveFound: number;
}

export interface MarketSnapshot {
  quotes: Record<number, MarketQuote>;
  corridorOrders: CorridorOrder[];
  lastSyncedAt: string | null;
  liveItemCount: number;
  sourceMode: 'live' | 'partial' | 'baseline';
  syncError?: string | null;
  esiRateLimit?: EsiRateLimitState;
}

export interface BlueprintEntry {
  itemId: number;
  typeId: number; // Real EVE Blueprint Type ID
  blueprintName?: string; // Exact EVE name resolved from ESI /universe/names/ (e.g. "Scourge Heavy Missile Blueprint")
  productTypeId?: number; // Matched product Type ID if in tracked manufacturing catalog
  productName: string; // Clean product or blueprint name
  isBpo: boolean; // Canonical ESI rule: runs === -1 for BPO, runs > 0 for BPC
  me: number; // 0..10
  te: number; // 0..20
  runs: number; // -1 for BPO, > 0 for BPC
  quantity?: number; // -1 singleton BPO, -2 BPC, >0 unresearched BPO stack
  locationId?: number;
  locationFlag?: string;
  locationName: string;
  source?: 'personal' | 'corporation';
}

export interface BlueprintSyncMeta {
  personalCount: number;
  corpCount: number;
  pagesScanned: number;
  corpPagesScanned?: number;
  corpStatus?: 'loaded' | 'disabled' | 'no_access' | 'error';
  corpMessage?: string;
  syncedAt?: string;
}

export type HullClass =
  | 'blockade_runner'
  | 'dst'
  | 'orca'
  | 't1_industrial'
  | 'mineral_hauler'
  | 'ore_hauler'
  | 'pi_hauler'
  | 'ammo_hauler'
  | 'upwell_hauler'
  | 'bowhead'
  | 'freighter';

export type CargoBucket =
  | 'general'
  | 'minerals'
  | 'ice'
  | 'ores'
  | 'pi'
  | 'ammo'
  | 'infrastructure'
  | 'ships';

export interface SpecialBaySpec {
  name: string;
  capacityM3: number;
  acceptedBuckets: CargoBucket[];
}

export interface HangarHull {
  id: string;
  itemId?: number;
  typeId?: number;
  name: string; // Display name (custom ship name + hull type if ESI)
  shipTypeName?: string;
  customName?: string;
  hullClass: HullClass;
  capacityM3: number; // Effective primary usable capacity (general + fleet hangar or specialized bay)
  baseCargoM3?: number;
  fittedCargoM3?: number; // Exact general cargo after skills + low-slot expanders/bulkheads + rigs
  fleetHangarM3?: number; // General-purpose fleet hangar (DST / Orca / Torrent)
  specialBays?: SpecialBaySpec[]; // Kryos Mineral/Ice, Miasmos Ore, Epithal PI, Hoarder Ammo, Upwell Infra, Bowhead SMB
  location: string;
  stationId?: number;
  systemId?: number;
  systemName?: string;
  isActiveShip?: boolean;
  fittedModules?: string[];
  fittedRigs?: string[];
  isTanked?: boolean;
  isCloaky?: boolean;
  safeIskThreshold?: number;
  notes: string;
}

export type OrderExecutionMode = 'list_orders' | 'instant_fill';

export interface ActiveMarketOrder {
  orderId: number;
  typeId: number;
  regionId: number;
  locationId: number;
  isBuyOrder: boolean;
  price: number;
  volumeRemain: number;
  volumeTotal: number;
  issued: string;
}

export interface ActiveOrderConflict {
  typeId: number;
  itemName: string;
  regionId: number;
  volumeRemain: number;
  price: number;
}

export interface PilotProfile {
  mode: 'simulation' | 'eve_sso';
  characterId?: number;
  corporationId?: number;
  characterName: string;
  totalSp: number;
  walletBalance: number;
  activeCapitalCap: number;
  orderExecutionMode: OrderExecutionMode;
  currentSystemId: number;
  currentSystemName: string;
  currentStationId?: number;
  currentStationName: string;
  skills: {
    accounting: number; // 16622: 7.5% * (1 - 0.11 * lvl) -> 3.375% at V
    brokerRelations: number; // 3446: 3.0% - (0.3% * lvl) -> 1.5% at V
    procurement: number; // 16596: Remote Buy Order range (0=Station, 1=System, 2=5j, 3=10j, 4=20j, 5=Region)
    marketing: number; // 16598: Remote Sell Order range (0=Station, 1=System, 2=5j, 3=10j, 4=20j, 5=Region)
    reprocessing: number; // 5
    reprocessingEfficiency: number; // 5
    scrapmetalProcessing: number; // 5
    industry: number; // 5
    scienceEncryption: number; // 5
  };
  haulingSkills?: Record<number, number>; // Real EVE hauling skill levels keyed by skill type_id
  pocoImportTaxPct: number; // Default 10%
  pocoExportTaxPct: number; // Default 10%
  hulls: HangarHull[];
  blueprints: BlueprintEntry[];
  blueprintSyncMeta?: BlueprintSyncMeta;
  activeOrders?: ActiveMarketOrder[];
  activeOrdersSyncedAt?: string;
}

export type EngineId =
  | 'indy_invention'
  | 'reprocessing'
  | 'pipeline_corridor'
  | 'regional_trade'
  | 'pi_factory';

export interface InspectionColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

export interface InspectionRow {
  _typeId?: number;
  _itemName?: string;
  [key: string]: string | number | undefined;
}

export interface InspectionPayload {
  summaryText: string;
  columns: InspectionColumn[];
  rows: InspectionRow[];
  secondaryTitle?: string;
  secondaryColumns?: InspectionColumn[];
  secondaryRows?: InspectionRow[];
}

export type RoutingPreference = 'Safer' | 'Shorter';

export interface RouteItemSpec {
  typeId?: number;
  name: string;
  quantity: number;
  iskAmount: number; // Cost for buy, payout for sell
  volumeM3: number;
  cargoBucket?: CargoBucket;
}

export interface RouteLeg {
  action: 'buy' | 'process' | 'sell';
  systemId: number;
  systemName: string;
  stationId?: number;
  stationName: string;
  items: RouteItemSpec[];
  cargoDeltaM3: number; // Positive adds cargo, negative removes cargo
  iskCost?: number;
  iskPayout?: number;
  netProfitIsk?: number; // Realized upon completing this leg (typically on sell leg)
  processNote?: string;
}

export interface RouteChain {
  cardId: string;
  cardTitle: string;
  cardCategories?: MarketCategoryId[];
  legs: RouteLeg[];
}

export interface HotSystemIntel {
  systemId: number;
  systemName: string;
  shipKills: number;
  podKills: number;
  npcKills: number;
  severity: 'hot' | 'critical';
  zkillUrl: string;
}

export interface SolarSystemCoord {
  systemId: number;
  name: string;
  x: number;
  y: number;
  z: number;
  securityStatus: number;
}

export interface GankRiskAssessment {
  level: 'safe' | 'warning' | 'critical';
  cargoIskValue: number;
  thresholdIsk: number;
  hullLabel: string;
  headline: string;
  recommendation: string;
}

export interface HullFitEvaluation {
  fits: boolean;
  generalUsedM3: number;
  generalCapacityM3: number;
  specialUsedM3: number;
  specialCapacityM3: number;
  effectiveCapacityM3: number;
  matchedSpecialBays: string[];
  overflowM3: number;
}

export interface HullRecommendation {
  hull: HangarHull;
  reason: string;
  fit: HullFitEvaluation;
  gankRisk: GankRiskAssessment;
  requiresPickup: boolean;
  pickupJumps: number;
  pickupDestinationId: number;
  pickupStationName: string;
  pickupSystemName: string;
  alternativeHint?: string;
}

export interface OptimizedStop {
  stopNumber: number;
  systemId: number;
  systemName: string;
  stationId?: number;
  stationName: string;
  destinationId: number; // stationId if docked NPC station, otherwise systemId (for ESI autopilot)
  jumpsFromPrev: number;
  waypointsFromPrev: number[]; // Intermediate & endpoint solar system IDs along this leg
  hotSystems: HotSystemIntel[]; // Flagged live gatecamp/kill systems along this leg
  buys: RouteItemSpec[];
  totalBuyIsk: number;
  processes: { cardTitle: string; note: string; unloadM3: number; loadM3: number }[];
  sells: RouteItemSpec[];
  totalSellIsk: number;
  peakCargoM3: number;
  endingCargoM3: number;
  transitCargoIsk: number; // Peak ISK value carried on this leg/stop
  peakCargoByBucket: Record<CargoBucket, number>;
  isOverCapacity: boolean;
  gankRisk: GankRiskAssessment;
  stopNetProfitIsk: number;
  cumulativeNetProfitIsk: number;
}

export interface EndHubTarget {
  mode: 'any' | 'return_to_start' | 'custom';
  systemId?: number;
  systemName?: string;
  stationId?: number;
  stationName?: string;
}

export interface AutoFillLoopSummary {
  selectedCardIds: string[];
  evaluatedCardCount: number;
  totalNetProfitIsk: number;
  totalJumps: number;
  netIskPerJump: number;
  totalBuyIsk: number;
  peakCargoM3: number;
  peakCargoIsk: number;
  reason: string;
}

export interface OptimizedRouteResult {
  originSystemId: number;
  originSystemName: string;
  endHub?: EndHubTarget;
  returnLegJumps?: number;
  returnLegDestinationId?: number;
  returnLegStationName?: string;
  returnLegSystemName?: string;
  preference: RoutingPreference;
  avoidHotSystems: boolean;
  maxCargoM3: number;
  stops: OptimizedStop[];
  totalJumps: number;
  netIskPerJump: number;
  totalBuyIsk: number;
  totalSellIsk: number;
  totalNetProfitIsk: number;
  peakCargoM3: number;
  peakCargoIsk: number;
  peakCargoByBucket: Record<CargoBucket, number>;
  overCapacityStops: number;
  gankRiskStops: number;
  totalHotSystemsFlagged: number;
  hotSystemIdsOnRoute: number[];
}

export interface ActionCardData {
  id: string;
  engine: EngineId;
  engineLabel: string;
  title: string;
  subtitle: string;
  categories: MarketCategoryId[];
  primaryTypeId?: number;
  primaryItemName?: string;
  stationAnchor: string;
  recommendedHull: string;
  hullClass: HullClass;
  requiredCapitalIsk: number;
  totalVolumeM3: number;
  safeDailyQty: string;
  marketDepthUnits: number;
  marketDepthDetail: string;
  outputUnits: number;
  perUnitNetProfitIsk: number;
  netProfitIsk: number;
  grossRevenueIsk: number;
  netMarginPct: number;
  roiPct: number;
  executionMode: OrderExecutionMode;
  salesTaxPct: number;
  brokerFeePct: number;
  destinationRegionId?: number;
  activeOrderConflicts?: ActiveOrderConflict[];
  riskLabel: 'Nominal' | 'Watch Depth' | 'High Margin';
  steps: string[];
  inspection: InspectionPayload;
  routeChains: RouteChain[];
}

export interface MarketHistoryDay {
  date: string;
  average: number;
  highest: number;
  lowest: number;
  volume: number;
  order_count: number;
}

export interface MarketHistoryResponse {
  regionId: number;
  typeId: number;
  days: MarketHistoryDay[];
  avgDailyVolume30d: number;
  avgPrice30d: number;
  high30d: number;
  low30d: number;
  trendPct: number;
  emptyReason?: string;
}

export interface LiveOrderBookEntry {
  orderId: number;
  price: number;
  volumeRemain: number;
  volumeTotal: number;
  minVolume: number;
  locationId: number;
  stationName: string;
  systemId: number;
  isBuyOrder: boolean;
  range?: string;
}

export interface LiveOrderBookResponse {
  typeId: number;
  buyRegionId: number;
  buyRegionName: string;
  sellRegionId: number;
  sellRegionName: string;
  topSellOrdersAtBuyHub: LiveOrderBookEntry[];
  topBuyOrdersAtSellHub: LiveOrderBookEntry[];
  pilotSystemId?: number;
  pilotRegionId?: number;
  buySystemId?: number;
  buySystemRegionId?: number;
  jumpsToBuySystem?: number;
  sameRegion?: boolean;
  fetchedAt: string;
}

export interface ShoppingListLine {
  typeId: number;
  name: string;
  quantity: number;
  unitPriceJita: number;
  totalCostJita: number;
  volumeM3: number;
  addedByAdvisor?: boolean;
  cheaperNearby?: {
    systemName: string;
    jumpsFromJita: number;
    unitPrice: number;
    savingsIsk: number;
    availableQty: number;
  };
}

export interface CustomShoppingItem {
  typeId: number;
  name: string;
  quantity: number;
}

export type AdvisorTargetTab =
  | 'overview'
  | 'indy_invention'
  | 'reprocessing'
  | 'corridor_trade'
  | 'pi_factory';

export interface AdvisorShoppingAction {
  id: string;
  type: 'add_to_shopping_list';
  label: string;
  items: {
    typeId: number;
    name: string;
    quantity: number;
    estimatedCostIsk: number;
  }[];
}

export interface AdvisorSwitchTabAction {
  id: string;
  type: 'switch_tab';
  label: string;
  targetTab: AdvisorTargetTab;
}

export type AdvisorAction = AdvisorShoppingAction | AdvisorSwitchTabAction;

export interface AppStateSummary {
  activeTab: string;
  character: {
    name: string;
    mode: 'simulation' | 'eve_sso';
    totalSp: number;
    walletBalanceIsk: number;
    activeCapitalCapIsk: number;
    currentSystem: string;
    currentStation: string;
    pocoImportTaxPct: number;
    pocoExportTaxPct: number;
    skills: PilotProfile['skills'];
    hulls: { name: string; hullClass: HullClass; capacityM3: number }[];
    blueprints: {
      productName: string;
      isBpo: boolean;
      me: number;
      te: number;
      runs: number;
      locationName: string;
    }[];
  };
  marketScope: {
    checkedCategories: MarketCategoryId[];
    activeTrackedItemCount: number;
    sourceMode: MarketSnapshot['sourceMode'];
    lastSyncedAt: string | null;
  };
  selectedOpportunitiesSummary: {
    totalCardCount: number;
    profitableCardCount: number;
    totalProjectedProfitIsk: number;
    totalRequiredCapitalIsk: number;
    totalCargoVolumeM3: number;
    blendedRoiPct: number;
  };
  topRankedOpportunities: {
    id: string;
    engine: EngineId;
    engineLabel: string;
    title: string;
    stationAnchor: string;
    recommendedHull: string;
    requiredCapitalIsk: number;
    totalVolumeM3: number;
    netProfitIsk: number;
    roiPct: number;
  }[];
  consolidatedShoppingList: {
    totalIsk: number;
    totalM3: number;
    oneJumpSavingsIsk: number;
    itemCount: number;
    items: {
      typeId: number;
      name: string;
      quantity: number;
      unitPriceJita: number;
      totalCostJita: number;
      addedByAdvisor?: boolean;
      cheaperNearby?: string;
    }[];
  };
}

export interface EngineBundle {
  cards: ActionCardData[];
  consolidatedShoppingList: ShoppingListLine[];
  shoppingListTotalIsk: number;
  shoppingListTotalM3: number;
  shoppingListOneJumpSavingsIsk: number;
  activeTrackedItemCount: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  toolsUsed?: string[];
  actions?: AdvisorAction[];
  error?: boolean;
}
