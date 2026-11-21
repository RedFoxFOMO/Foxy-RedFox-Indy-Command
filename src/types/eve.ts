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
  minVolume?: number;
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
  sellLevels?: OrderBookLevel[]; // Ascending price buckets from live ESI order book
  avgDailyVol7d?: number; // 7-day average daily traded volume from ESI /markets/{region_id}/history/
  yesterdayAvgPrice?: number; // Yesterday's ESI daily average price for 24h trend delta
  prevSessionSellMin?: number; // Previous 5-min refresh sellMin for session tick delta
  prevSessionBuyMax?: number; // Previous 5-min refresh buyMax for session tick delta
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

export type TradeHubId = 'jita' | 'amarr' | 'dodixie' | 'rens' | 'hek';

export interface EmpireHubDef {
  id: TradeHubId;
  shortName: string;
  shortLabel: string;
  systemId: number;
  systemName: string;
  stationId: number;
  stationName: string;
  regionId: number;
  regionName: string;
  priceMultiplierFallback: number;
  volMultiplierFallback: number;
}

export interface MarketQuote {
  typeId: number;
  jita: HubQuote;
  dodixie: HubQuote;
  hubs?: Partial<Record<TradeHubId, HubQuote>>;
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
  cacheTelemetry?: MarketCacheTelemetry;
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

export type IndustryStructureType =
  | 'npc_station'
  | 'raitaru'
  | 'azbel'
  | 'sotiyo'
  | 'athanor'
  | 'tatara';
export type RigTier = 'none' | 't1' | 't2';

export interface IndustryStructureConfig {
  systemId: number;
  systemName: string;
  structureType: IndustryStructureType;
  meRig: RigTier;
  teRig: RigTier;
  costRig: RigTier;
  facilityTaxPct: number;
}

export interface SystemCostIndices {
  systemId: number;
  manufacturing: number;
  invention: number;
  copying: number;
  researching_material_efficiency: number;
  researching_time_efficiency: number;
  reaction: number;
}

export interface IndustryCostSnapshot {
  costIndicesBySystem: Record<number, SystemCostIndices>;
  adjustedPricesByType: Record<number, number>;
  fetchedAt: string | null;
  source: 'esi_live' | 'baseline';
}

export interface CharacterIndustryJob {
  jobId: number;
  activityId: number; // 1=Manufacturing, 3=TE, 4=ME, 5=Copying, 8=Invention, 9/11=Reaction
  activityLabel: string;
  blueprintId?: number;
  blueprintTypeId: number;
  blueprintName: string;
  productTypeId?: number;
  productName: string;
  runs: number;
  cost?: number;
  costIsk?: number;
  durationSeconds?: number;
  facilityId: number;
  facilityName: string;
  status: string;
  startDate: string;
  endDate: string;
}

export interface HangarStockEntry {
  typeId: number;
  jita: number;
  ishisomo: number;
  total: number;
}

export interface OrderMonitorEntry {
  orderId: number;
  typeId: number;
  itemName: string;
  regionId: number;
  regionName: string;
  locationId: number;
  stationName: string;
  isBuyOrder: boolean;
  myPrice: number;
  marketBestPrice: number;
  isUndercut: boolean;
  suggestedReclaimPrice: number;
  deltaIsk: number;
  competitorsAhead: number;
  volumeRemain: number;
  volumeTotal: number;
  issued: string;
}

export interface WalletTransactionEntry {
  transactionId: number;
  date: string;
  typeId: number;
  itemName: string;
  isBuy: boolean;
  quantity: number;
  unitPrice: number;
  totalIsk: number;
  locationId: number;
}

export interface OrderMonitorSnapshot {
  orders: OrderMonitorEntry[];
  undercutCount: number;
  recentTransactions: WalletTransactionEntry[];
  realizedRevenue24hIsk: number;
  realizedSpend24hIsk: number;
  realizedProfit24hIsk: number;
  realizedProfit7dIsk: number;
  syncedAt: string;
  cacheMeta?: MarketCacheTelemetry;
}

export interface WatchlistItem {
  id: string;
  typeId: number;
  name: string;
  kind: 'sku' | 'blueprint';
  minRoiPct: number;
  minIskPerM3: number;
  pinnedAt: string;
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
    advancedBrokerRelations?: number; // 3447: 50% + 6%/lvl relist modification fee discount (80% at V)
    procurement: number; // 16596: Remote Buy Order range (0=Station, 1=System, 2=5j, 3=10j, 4=20j, 5=Region)
    marketing: number; // 16598: Remote Sell Order range (0=Station, 1=System, 2=5j, 3=10j, 4=20j, 5=Region)
    reprocessing: number; // 5
    reprocessingEfficiency: number; // 5
    scrapmetalProcessing: number; // 5
    industry: number; // 3380: -4%/lvl build time
    advancedIndustry?: number; // 3388: -3%/lvl build & research time
    reactions?: number; // 45746: -4%/lvl reaction time & +1 reaction slot/lvl
    scienceEncryption: number; // 5
    massProduction?: number; // 3387: +1 mfg slot/lvl
    advancedMassProduction?: number; // 24625: +1 mfg slot/lvl
    laboratoryOperation?: number; // 3406: +1 science slot/lvl
    advancedLaboratoryOperation?: number; // 24624: +1 science slot/lvl
  };
  haulingSkills?: Record<number, number>; // Real EVE hauling skill levels keyed by skill type_id
  pocoImportTaxPct: number; // Default 10%
  pocoExportTaxPct: number; // Default 10%
  hulls: HangarHull[];
  blueprints: BlueprintEntry[];
  blueprintSyncMeta?: BlueprintSyncMeta;
  activeOrders?: ActiveMarketOrder[];
  activeOrdersSyncedAt?: string;
  industryJobs?: CharacterIndustryJob[];
  industryJobsSyncedAt?: string;
  hangarStock?: Record<number, HangarStockEntry>;
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

export interface DepthWalkResult {
  requestedQty: number;
  filledQty: number;
  shortfallQty: number;
  topOfBookPrice: number;
  weightedAvgPrice: number;
  totalIsk: number;
  slippagePct: number; // Positive = paying more (buy) or receiving less (sell) than top-of-book
  tiersUsed: number;
  isThinDepth: boolean; // True if slippage >= 2.5% or shortfall > 0
  sourceKind: 'live_book' | 'synthesized_curve';
}

export interface BomMaterialSpec {
  typeId: number;
  name: string;
  qtyPerRun: number;
  unitVolumeM3: number;
  unitPriceTopOfBook: number;
  depthWalk?: DepthWalkResult;
  sellLevels?: OrderBookLevel[];
  fallbackSellVolume?: number;
}

export interface BuildQueueEntry {
  cardId: string;
  title: string;
  productTypeId: number;
  productName: string;
  committedRuns: number;
  outputPerRun: number;
  allocatedSlots: number;
  priorityOrder: number;
  addedAt: string;
}

export interface VirtualHangarMaterialRow {
  typeId: number;
  name: string;
  requiredQty: number;
  availableBeforeSlot: number;
  reservedQty: number;
  missingQty: number;
  remainingAfterSlot: number;
  unitVolumeM3: number;
  buyAllCostIsk: number;
  buyMissingCostIsk: number;
  depthWalkMissing?: DepthWalkResult;
}

export interface VirtualHangarSlotAllocation {
  cardId: string;
  title: string;
  productName: string;
  priorityOrder: number;
  committedRuns: number;
  totalOutputUnits: number;
  allocatedSlots: number;
  sequentialDurationSec: number;
  concurrentDurationSec: number;
  materials: VirtualHangarMaterialRow[];
  buyAllCostIsk: number;
  buyMissingCostIsk: number;
  jobAndInventionFeeIsk: number;
  netRevenueIsk: number;
  buyAllProfitIsk: number;
  buyMissingProfitIsk: number;
  rawInputM3: number;
  packagedOutputM3: number;
}

export interface GlobalMultibuyMaterial {
  typeId: number;
  name: string;
  totalMissingQty: number;
  totalReservedQty: number;
  unitVolumeM3: number;
  totalVolumeM3: number;
  topOfBookPrice: number;
  weightedAvgPrice: number;
  totalCostIsk: number;
  slippagePct: number;
  shortfallQty: number;
  status: 'in_stock' | 'thin_depth' | 'shortfall';
}

export interface RelistFeePreview {
  oldPrice: number;
  newPrice: number;
  tickDelta: number;
  brokerFeePct: number;
  relistDiscountPct: number; // 50% + 6% * Advanced Broker Relations
  modificationFeeIsk: number; // Min 100 ISK
  newOrderValueIsk: number;
  estimatedNetMarginPct: number | null;
  unprofitableWarning: boolean;
  warningReason?: string;
}

export interface HaulerFitModule {
  slot: 'Hull' | 'High' | 'Mid' | 'Low' | 'Rig';
  typeId: number;
  name: string;
  qty: number;
  unitPriceIsk: number;
  totalPriceIsk: number;
}

export interface HaulerFitSuggestion {
  rawInputM3: number;
  packagedOutputM3: number;
  peakHaulM3: number;
  cargoIskValue: number;
  originSystemName: string;
  destSystemName: string;
  jumpCount: number;
  routeMinSec: number;
  routeSecurityLabel: string;
  ownedHullName: string | null;
  ownedHullCapM3: number;
  ownedHullTrips: number;
  recommendedClass: 't1_industrial' | 'blockade_runner' | 'dst' | 'freighter';
  recommendedClassLabel: string;
  recommendedHullTypeId: number;
  recommendedHullName: string;
  recommendedHullCapM3: number;
  recommendedTrips: number;
  indicativeHullCostIsk: number;
  totalFitCostIsk: number;
  gankRiskReason: string;
  fitModules: HaulerFitModule[];
  multibuyText: string;
}

export interface MarketCacheTelemetry {
  expiresAtMs: number | null;
  lastRefreshedAt?: string | null;
  ratelimitRemaining: number | null;
  retryAfterSec: number | null;
  from304Count: number;
  zeroTokenHits: number;
  mode?: 'active_sync' | 'background_watchdog';
  tabHidden?: boolean;
  watchdogActive?: boolean;
  watchdogTrackedOrders?: number;
  watchdogLastPollAt?: string | null;
}

export interface PriceProjectionAnalysis {
  typeId: number;
  itemName: string;
  regionId: number;
  regionName: string;
  currentAvgPrice: number;
  yesterdayAvgPrice: number;
  change24hPct: number;
  ma7d: number;
  ma30d: number;
  momentum7dPct: number;
  avgDailyVol7d: number;
  avgDailyVol30d: number;
  volumeSpikeRatio: number;
  volatilityPct: number;
  manipulationRisk: 'low' | 'moderate' | 'high';
  manipulationNotes: string[];
  signal: 'bullish' | 'neutral' | 'bearish' | 'caution_thin';
  signalSummary: string;
  projected7dLow: number;
  projected7dMid: number;
  projected7dHigh: number;
}

export interface AiCommentarySettings {
  enabled: boolean;
  provider: 'gemini' | 'openai';
  geminiKey: string;
  openaiKey: string;
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
  // v2.1.0 Depth-Walking, Slicer, Dual Profit & Build Time Metadata
  isEditableQty?: boolean;
  qtyUnitLabel?: 'runs' | 'units';
  baseBatchQty?: number; // Default runs (indy) or units (trade)
  optimalProfitableQty?: number; // Max profitable qty before depth thinning erodes margin
  outputPerRun?: number; // For indy build cards
  unitInputM3?: number; // Per-run input volume (indy) or per-unit volume (trade)
  unitOutputM3?: number; // Per-run output volume (indy) or per-unit volume (trade)
  baseRunDurationSec?: number; // Base blueprint run duration before skills/structure TE
  isReactionRecipe?: boolean;
  recipeTier?: 'T1' | 'T2';
  bpMe?: number;
  bpTe?: number;
  singleRunJobAndInventionFeeIsk?: number;
  bomMaterials?: BomMaterialSpec[];
  depthWalkBuy?: DepthWalkResult;
  depthWalkSell?: DepthWalkResult;
  buyAllProfitIsk?: number;
  buyMissingProfitIsk?: number;
  buyMissingCapitalIsk?: number;
  hangarSavingsIsk?: number;
  sourceHubId?: TradeHubId;
  destHubId?: TradeHubId;
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
  yesterdayAvgPrice?: number;
  prevSessionSellMin?: number;
  prevSessionBuyMax?: number;
  cacheExpiresAt?: string;
  ratelimitRemaining?: number | null;
  from304Cache?: boolean;
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
