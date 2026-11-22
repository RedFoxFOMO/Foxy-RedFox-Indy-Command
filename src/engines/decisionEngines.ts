import {
  CORRIDOR_SYSTEMS,
  DEFAULT_INDUSTRY_STRUCTURE_CONFIG,
  EMPIRE_HUB_MAP,
  EVE_ANCHORS,
  EVE_ITEMS,
  INDUSTRY_RECIPES,
  ITEM_BY_ID,
  PI_SCHEMATICS,
  REPROCESSING_CATALOG,
  getItemsForCategories,
} from '../data/eveCatalog.ts';
import {
  findOptimalProfitableQty,
  walkBuyOrderbookForSell,
  walkSellOrderbookForBuy,
} from '../utils/eveMarketMath.ts';
import { computeExactHubBrokerFee, resolveHubIdFromSystemOrRegion } from '../utils/dotlan.ts';
import { deriveQuickMultiPeriodTrend } from '../utils/v22Engines.ts';
import type {
  ActionCardData,
  ActiveMarketOrder,
  ActiveOrderConflict,
  AppSettingsV22,
  BomMaterialSpec,
  CorridorOrder,
  DepthWalkResult,
  DynamicMarketCatalog,
  EngineBundle,
  EveItem,
  HubQuote,
  HullClass,
  IndustryCostSnapshot,
  IndustryStructureConfig,
  MarketCategoryId,
  MarketQuote,
  MarketSnapshot,
  NpcStandingsMap,
  OrderExecutionMode,
  PilotProfile,
  RouteChain,
  RouteItemSpec,
  ShoppingListLine,
  TradeHubId,
} from '../types/eve.ts';

// --- Formatters ---

export function formatIsk(val: number, compact = true): string {
  if (!Number.isFinite(val)) return '0 ISK';
  const abs = Math.abs(val);
  const sign = val < 0 ? '-' : '';
  if (compact) {
    if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B ISK`;
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M ISK`;
    if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K ISK`;
  }
  return `${sign}${Math.round(abs).toLocaleString('en-US')} ISK`;
}

export function formatM3(val: number): string {
  if (!Number.isFinite(val)) return '0 m³';
  if (val >= 10_000) return `${Math.round(val).toLocaleString('en-US')} m³`;
  if (val >= 100) return `${val.toFixed(1)} m³`;
  return `${val.toFixed(2)} m³`;
}

export function formatPct(val: number): string {
  if (!Number.isFinite(val)) return '0.0%';
  return `${val >= 0 ? '+' : ''}${val.toFixed(1)}%`;
}

// --- Core EVE Tax, Broker Fee, Order-Book Depth & Yield Helpers ---

export function getSalesTaxRate(accountingLevel: number): number {
  // Exact EVE formula: 7.5% * (1 - 0.11 * AccountingLevel)
  // Level 0 = 7.500%, Level V = 3.375%, paid on all sales
  const lvl = Math.max(0, Math.min(5, Math.floor(accountingLevel)));
  return 0.075 * (1 - 0.11 * lvl);
}

export function getBrokerFeeRate(
  brokerLevel: number,
  executionMode: OrderExecutionMode = 'list_orders',
  options?: {
    hubId?: TradeHubId;
    standings?: NpcStandingsMap;
    appSettings?: AppSettingsV22;
  }
): number {
  if (executionMode === 'instant_fill') return 0;
  if (options?.hubId || options?.standings || options?.appSettings) {
    const res = computeExactHubBrokerFee({
      hubId: options.hubId ?? 'jita',
      brokerRelationsLvl: brokerLevel,
      standings: options.standings,
      useCustomUpwellBroker: options.appSettings?.useCustomUpwellBroker ?? false,
      customUpwellBrokerPct: options.appSettings?.customUpwellBrokerPct ?? 0.5,
      includeSccSurcharge: options.appSettings?.includeSccSurcharge ?? true,
    });
    return res.effectiveTotalBrokerPct / 100;
  }
  // Standard NPC fallback: 3.0% - (0.3% * BrokerRelationsLevel), min 1.0%
  const lvl = Math.max(0, Math.min(5, Math.floor(brokerLevel)));
  return Math.max(0.01, 0.03 - 0.003 * lvl);
}

export function getEffectiveOrderFees(
  profile: PilotProfile,
  options?: {
    hubId?: TradeHubId;
    appSettings?: AppSettingsV22;
    executionModeOverride?: OrderExecutionMode;
  }
): {
  executionMode: OrderExecutionMode;
  salesTaxRate: number;
  brokerFeeRate: number;
  totalSellFeeRate: number;
  salesTaxPct: number;
  brokerFeePct: number;
  standingBrokerNote: string;
} {
  const executionMode: OrderExecutionMode =
    options?.executionModeOverride ?? profile.orderExecutionMode ?? 'list_orders';
  const salesTaxRate = getSalesTaxRate(profile.skills.accounting);
  const feeDetail = computeExactHubBrokerFee({
    hubId: options?.hubId ?? 'jita',
    brokerRelationsLvl: profile.skills.brokerRelations,
    standings: profile.npcStandings,
    useCustomUpwellBroker: options?.appSettings?.useCustomUpwellBroker ?? false,
    customUpwellBrokerPct: options?.appSettings?.customUpwellBrokerPct ?? 0.5,
    includeSccSurcharge: options?.appSettings?.includeSccSurcharge ?? true,
  });
  const brokerFeeRate = executionMode === 'instant_fill' ? 0 : feeDetail.effectiveTotalBrokerPct / 100;
  const note = feeDetail.usingUpwellCustom
    ? `Upwell Custom ${feeDetail.upwellBrokerPct.toFixed(2)}%${feeDetail.sccSurchargePct > 0 ? ` + ${feeDetail.sccSurchargePct.toFixed(2)}% SCC` : ''} = ${feeDetail.effectiveTotalBrokerPct.toFixed(2)}%`
    : `${feeDetail.hubName} NPC: 3.0% - ${feeDetail.skillReductionPct.toFixed(2)}% (BR Lv.${feeDetail.brokerRelationsLvl}) - ${feeDetail.factionReductionPct.toFixed(2)}% (${feeDetail.factionName} ${feeDetail.factionStanding}) - ${feeDetail.corpReductionPct.toFixed(2)}% (${feeDetail.corpName} ${feeDetail.corpStanding}) = ${feeDetail.effectiveNpcBrokerPct.toFixed(2)}%`;
  return {
    executionMode,
    salesTaxRate,
    brokerFeeRate,
    totalSellFeeRate: salesTaxRate + brokerFeeRate,
    salesTaxPct: Number((salesTaxRate * 100).toFixed(3)),
    brokerFeePct: Number((brokerFeeRate * 100).toFixed(3)),
    standingBrokerNote: executionMode === 'instant_fill' ? 'Instant Fill (0% Broker)' : note,
  };
}

export function getBuyDepthAtOrAboveFloor(
  hub: HubQuote,
  minPriceFloor: number
): number {
  if (Array.isArray(hub.buyLevels) && hub.buyLevels.length > 0) {
    let total = 0;
    for (const lvl of hub.buyLevels) {
      if (lvl.price >= minPriceFloor) {
        total += lvl.volume;
      }
    }
    return total;
  }
  if (typeof hub.topBuyDepthUnits === 'number' && hub.topBuyDepthUnits > 0) {
    return hub.buyMax >= minPriceFloor ? hub.topBuyDepthUnits : 0;
  }
  return hub.buyMax >= minPriceFloor ? Math.max(0, Math.floor(hub.buyVolume * 0.35)) : 0;
}

export function getAbsorbableMarketDepth(params: {
  hub: HubQuote;
  fallbackDailyVol: number;
  minProfitableSellPrice: number;
  executionMode: OrderExecutionMode;
}): {
  maxUnits: number;
  avgDailyVol7d: number;
  buyDepthAtFloor: number;
  detail: string;
} {
  const { hub, fallbackDailyVol, minProfitableSellPrice, executionMode } = params;
  const avgDailyVol7d =
    typeof hub.avgDailyVol7d === 'number'
      ? hub.avgDailyVol7d
      : fallbackDailyVol > 0
        ? fallbackDailyVol
        : Math.round((hub.sellVolume + hub.buyVolume) * 0.12);

  const capBy7d = Math.max(0, Math.floor(avgDailyVol7d * 0.25));
  const buyDepthAtFloor = getBuyDepthAtOrAboveFloor(hub, minProfitableSellPrice);

  if (executionMode === 'instant_fill') {
    const capped = capBy7d > 0 ? Math.min(capBy7d, buyDepthAtFloor) : buyDepthAtFloor;
    return {
      maxUnits: Math.max(0, capped),
      avgDailyVol7d,
      buyDepthAtFloor,
      detail: `Buy book @ floor (${buyDepthAtFloor.toLocaleString('en-US')}) ∩ 25% of 7d avg (${capBy7d.toLocaleString('en-US')})`,
    };
  }

  return {
    maxUnits: Math.max(1, capBy7d),
    avgDailyVol7d,
    buyDepthAtFloor,
    detail: `25% of 7d avg vol (${avgDailyVol7d.toLocaleString('en-US')}/d)`,
  };
}

function getRegionForSystemId(systemId: number): number {
  if (systemId === EVE_ANCHORS.DODIXIE_SYSTEM_ID) {
    return EVE_ANCHORS.SINQ_LAISON_REGION_ID;
  }
  if (systemId === EVE_ANCHORS.AMARR_SYSTEM_ID) {
    return EVE_ANCHORS.DOMAIN_REGION_ID;
  }
  if (systemId === EVE_ANCHORS.RENS_SYSTEM_ID) {
    return EVE_ANCHORS.HEIMATAR_REGION_ID;
  }
  if (systemId === EVE_ANCHORS.HEK_SYSTEM_ID) {
    return EVE_ANCHORS.METROPOLIS_REGION_ID;
  }
  return EVE_ANCHORS.THE_FORGE_REGION_ID;
}

export function getHubQuote(
  quote: MarketQuote,
  hubId: TradeHubId,
  item?: EveItem
): HubQuote {
  if (quote.hubs && quote.hubs[hubId] && (quote.hubs[hubId]!.sellMin > 0 || quote.hubs[hubId]!.buyMax > 0)) {
    return quote.hubs[hubId]!;
  }
  if (hubId === 'jita') return quote.jita;
  if (hubId === 'dodixie') return quote.dodixie;

  const hubDef = EMPIRE_HUB_MAP[hubId];
  const baseJitaSell = quote.jita.sellMin > 0 ? quote.jita.sellMin : item?.baseJitaSell ?? 1000;
  const baseJitaBuy = quote.jita.buyMax > 0 ? quote.jita.buyMax : baseJitaSell * 0.9;
  const estVol = Math.max(
    1,
    Math.round((quote.jita.sellVolume || item?.estDailyJitaVol || 500) * hubDef.volMultiplierFallback)
  );
  const estSell = Number((baseJitaSell * hubDef.priceMultiplierFallback).toFixed(2));
  const estBuy = Number((baseJitaBuy * (1 + (hubDef.priceMultiplierFallback - 1) * 0.45)).toFixed(2));

  return {
    sellMin: estSell,
    sellVolume: estVol,
    buyMax: estBuy,
    buyVolume: Math.max(1, Math.round(estVol * 0.65)),
    sellPercentile: estSell,
    buyPercentile: estBuy,
    avgDailyVol7d: Math.max(1, Math.round(estVol * 0.25)),
  };
}

export function getUpwellStructureBonuses(config: IndustryStructureConfig): {
  label: string;
  structMeBonus: number;
  structTeBonus: number;
  structCostBonus: number;
  rigMeBonus: number;
  rigTeBonus: number;
  rigCostBonus: number;
  effectiveMeMult: number;
  effectiveTeMult: number;
  effectiveCostMult: number;
} {
  const isNpc = config.structureType === 'npc_station';
  const structSpec =
    config.structureType === 'sotiyo'
      ? { label: 'Sotiyo', me: 0.01, te: 0.3, cost: 0.05 }
      : config.structureType === 'azbel'
        ? { label: 'Azbel', me: 0.01, te: 0.2, cost: 0.04 }
        : config.structureType === 'raitaru'
          ? { label: 'Raitaru', me: 0.01, te: 0.15, cost: 0.03 }
          : config.structureType === 'tatara'
            ? { label: 'Tatara', me: 0, te: 0.25, cost: 0.04 }
            : config.structureType === 'athanor'
              ? { label: 'Athanor', me: 0, te: 0.15, cost: 0.02 }
              : { label: 'NPC Station', me: 0, te: 0, cost: 0 };

  // High-Sec Upwell Engineering Rig bonuses (1.0x security multiplier)
  const rigMeBonus = isNpc ? 0 : config.meRig === 't2' ? 0.024 : config.meRig === 't1' ? 0.02 : 0;
  const rigTeBonus = isNpc ? 0 : config.teRig === 't2' ? 0.24 : config.teRig === 't1' ? 0.2 : 0;
  const rigCostBonus = isNpc ? 0 : config.costRig === 't2' ? 0.12 : config.costRig === 't1' ? 0.1 : 0;

  return {
    label: structSpec.label,
    structMeBonus: structSpec.me,
    structTeBonus: structSpec.te,
    structCostBonus: structSpec.cost,
    rigMeBonus,
    rigTeBonus,
    rigCostBonus,
    effectiveMeMult: (1 - structSpec.me) * (1 - rigMeBonus),
    effectiveTeMult: (1 - structSpec.te) * (1 - rigTeBonus),
    effectiveCostMult: (1 - structSpec.cost) * (1 - rigCostBonus),
  };
}

function attachActiveOrderConflicts(
  cards: ActionCardData[],
  activeOrders?: ActiveMarketOrder[]
): ActionCardData[] {
  if (!activeOrders || activeOrders.length === 0) return cards;
  const sellOrders = activeOrders.filter((o) => !o.isBuyOrder && o.volumeRemain > 0);
  if (sellOrders.length === 0) return cards;

  // Index open character sell orders by `${regionId}:${typeId}`
  const byRegionType = new Map<string, ActiveMarketOrder[]>();
  for (const ord of sellOrders) {
    const key = `${ord.regionId}:${ord.typeId}`;
    const arr = byRegionType.get(key) ?? [];
    arr.push(ord);
    byRegionType.set(key, arr);
  }

  return cards.map((card) => {
    const conflictMap = new Map<string, ActiveOrderConflict>();

    // Check every sell leg item against open sell orders in that destination region
    for (const chain of card.routeChains || []) {
      for (const leg of chain.legs) {
        if (leg.action !== 'sell') continue;
        const regionId = getRegionForSystemId(leg.systemId);
        for (const it of leg.items) {
          if (!it.typeId) continue;
          const matches = byRegionType.get(`${regionId}:${it.typeId}`);
          if (!matches) continue;
          const totalRemain = matches.reduce((s, m) => s + m.volumeRemain, 0);
          const lowestPrice = Math.min(...matches.map((m) => m.price));
          conflictMap.set(`${regionId}:${it.typeId}`, {
            typeId: it.typeId,
            itemName: it.name,
            regionId,
            volumeRemain: totalRemain,
            price: lowestPrice,
          });
        }
      }
    }

    // Also check primaryTypeId in destinationRegionId if set
    if (card.primaryTypeId && card.destinationRegionId) {
      const key = `${card.destinationRegionId}:${card.primaryTypeId}`;
      if (!conflictMap.has(key)) {
        const matches = byRegionType.get(key);
        if (matches && matches.length > 0) {
          conflictMap.set(key, {
            typeId: card.primaryTypeId,
            itemName: card.primaryItemName || card.title,
            regionId: card.destinationRegionId,
            volumeRemain: matches.reduce((s, m) => s + m.volumeRemain, 0),
            price: Math.min(...matches.map((m) => m.price)),
          });
        }
      }
    }

    if (conflictMap.size === 0) return card;
    return {
      ...card,
      activeOrderConflicts: Array.from(conflictMap.values()),
    };
  });
}

export function getNpcReprocessingYield(
  isScrap: boolean,
  skills: PilotProfile['skills']
): number {
  if (isScrap) {
    // Base 50% * (1 + 0.02 * Scrapmetal Processing) -> 55% at V
    return 0.5 * (1 + 0.02 * Math.min(5, skills.scrapmetalProcessing));
  }
  // NPC Station 50% * (1 + 0.03*Reproc) * (1 + 0.02*ReprocEff) * (1 + 0.02*SpecV) = 0.69575
  const r = 1 + 0.03 * Math.min(5, skills.reprocessing);
  const re = 1 + 0.02 * Math.min(5, skills.reprocessingEfficiency);
  const spec = 1.1; // Specialized Ore/Ice V assumption on 187M SP char
  return Math.min(0.75, 0.5 * r * re * spec);
}

export function getQuote(snapshot: MarketSnapshot, typeId: number): MarketQuote {
  const existing = snapshot.quotes[typeId];
  if (existing && existing.jita.sellMin > 0) {
    return existing;
  }
  const item = ITEM_BY_ID[typeId];
  const jitaSell = item?.baseJitaSell ?? 1000;
  const jitaBuy = item?.baseJitaBuy ?? jitaSell * 0.9;
  const dodixieSell = item?.baseDodixieSell ?? jitaSell * 1.12;
  const dodixieBuy = item?.baseDodixieBuy ?? jitaSell * 0.98;
  return {
    typeId,
    jita: {
      sellMin: jitaSell,
      sellVolume: item?.estDailyJitaVol ?? 10000,
      buyMax: jitaBuy,
      buyVolume: item?.estDailyJitaVol ?? 10000,
      sellPercentile: jitaSell,
      buyPercentile: jitaBuy,
    },
    dodixie: {
      sellMin: dodixieSell,
      sellVolume: item?.estDailyDodixieVol ?? 2500,
      buyMax: dodixieBuy,
      buyVolume: item?.estDailyDodixieVol ?? 2500,
      sellPercentile: dodixieSell,
      buyPercentile: dodixieBuy,
    },
    source: 'baseline',
  };
}

export function pickHull(
  volumeM3: number,
  valueIsk: number,
  profile: PilotProfile
): { label: string; hullClass: HullClass; capacity: number } {
  const br = profile.hulls.find((h) => h.hullClass === 'blockade_runner');
  const dst = profile.hulls.find((h) => h.hullClass === 'dst');
  const orca = profile.hulls.find((h) => h.hullClass === 'orca');

  const brCap = br?.capacityM3 ?? 10200;
  const dstCap = dst?.capacityM3 ?? 62500;
  const orcaCap = orca?.capacityM3 ?? 187500;

  if (volumeM3 <= brCap && (valueIsk >= 150_000_000 || volumeM3 <= brCap * 0.85)) {
    return { label: `${br?.name ?? 'Blockade Runner'} (${formatM3(brCap)})`, hullClass: 'blockade_runner', capacity: brCap };
  }
  if (volumeM3 <= dstCap) {
    return { label: `${dst?.name ?? 'DST'} (${formatM3(dstCap)})`, hullClass: 'dst', capacity: dstCap };
  }
  return { label: `${orca?.name ?? 'Orca'} (${formatM3(orcaCap)})`, hullClass: 'orca', capacity: orcaCap };
}

// --- Engine 1: Ishisomo Indy & T2 Copy/Invention Planner ---

function computeIndyAndInvention(
  checked: Set<MarketCategoryId>,
  snapshot: MarketSnapshot,
  profile: PilotProfile,
  structureConfig: IndustryStructureConfig = DEFAULT_INDUSTRY_STRUCTURE_CONFIG,
  industryCosts?: IndustryCostSnapshot
): {
  cards: ActionCardData[];
  shoppingList: ShoppingListLine[];
  mineralDemand: Record<number, number>;
} {
  const fees = getEffectiveOrderFees(profile);
  const { executionMode, totalSellFeeRate: totalSellFee, salesTaxPct, brokerFeePct } = fees;
  const budgetCap = profile.activeCapitalCap;
  const bonuses = getUpwellStructureBonuses(structureConfig);
  const sysIndices = industryCosts?.costIndicesBySystem[structureConfig.systemId];
  const liveMfgIndex = sysIndices?.manufacturing ?? 0.024;
  const liveInvIndex = sysIndices?.invention ?? 0.018;
  const sccSurcharge = 0.04; // EVE Online 4.0% SCC surcharge on industry jobs
  const facilityTaxRate = Math.max(0, structureConfig.facilityTaxPct) / 100;
  const isNpcStation = structureConfig.structureType === 'npc_station';
  const facilityLabel = isNpcStation
    ? structureConfig.systemId === EVE_ANCHORS.ISHISOMO_SYSTEM_ID
      ? 'Ishisomo VIII - State War Academy (NPC)'
      : `${structureConfig.systemName} NPC Factory`
    : `${structureConfig.systemName} ${bonuses.label}${
        structureConfig.meRig !== 'none' || structureConfig.costRig !== 'none'
          ? ` (${[
              structureConfig.meRig !== 'none' ? `ME ${structureConfig.meRig.toUpperCase()}` : '',
              structureConfig.teRig !== 'none' ? `TE ${structureConfig.teRig.toUpperCase()}` : '',
              structureConfig.costRig !== 'none' ? `Cost ${structureConfig.costRig.toUpperCase()}` : '',
            ]
              .filter(Boolean)
              .join(' · ')})`
          : ''
      }`;

  const matchingRecipes = INDUSTRY_RECIPES.filter((r) => checked.has(r.category));
  const cards: ActionCardData[] = [];
  const shoppingTotals: Record<number, number> = {};
  const mineralDemand: Record<number, number> = {};

  for (const recipe of matchingRecipes) {
    const productItem = ITEM_BY_ID[recipe.productTypeId];
    if (!productItem) continue;

    const productQuote = getQuote(snapshot, recipe.productTypeId);
    const normProductName = recipe.productName.toLowerCase().trim();
    const matchingOwnedBps = profile.blueprints.filter(
      (b) =>
        b.productTypeId === recipe.productTypeId ||
        b.productName.toLowerCase().trim() === normProductName
    );
    const ownedBp = matchingOwnedBps.sort((a, b) => b.me - a.me)[0];
    const effectiveMe =
      recipe.tier === 'T2'
        ? ownedBp?.me ?? recipe.invention?.t2Me ?? 2
        : ownedBp?.me ?? 10;

    // Multiplicative EVE ME formula: (1 - BP_ME) * (1 - Structure_ME) * (1 - Rig_ME)
    const meMultiplier = (1 - effectiveMe / 100) * bonuses.effectiveMeMult;

    // Invention cost per run (using live system invention index + structure cost bonus)
    let inventionCostPerRun = 0;
    let inventionSuccessPct = 0;
    let inventionMetaText = `Direct T1 BPO Build · ${bonuses.label}`;

    if (recipe.tier === 'T2' && recipe.invention) {
      const skillMult = 1 + (profile.skills.scienceEncryption * 2) / 30 + profile.skills.scienceEncryption / 40;
      const prob = Math.min(0.85, recipe.invention.baseChance * skillMult);
      inventionSuccessPct = prob * 100;

      let attemptCost = 0;
      for (const dc of recipe.invention.datacores) {
        const q = getQuote(snapshot, dc.typeId);
        attemptCost += q.jita.sellMin * dc.quantity;
      }
      const invFeeFactor = 1 + liveInvIndex * bonuses.effectiveCostMult + facilityTaxRate + sccSurcharge * 0.25;
      attemptCost *= invFeeFactor;
      const expectedCostPerT2Bpc = attemptCost / prob;
      inventionCostPerRun = expectedCostPerT2Bpc / recipe.invention.bpcRunsOutput;
      inventionMetaText = `Vanilla Invention (${inventionSuccessPct.toFixed(1)}% · ME ${recipe.invention.t2Me}/TE ${recipe.invention.t2Te} · ${bonuses.label})`;
    }

    // Material cost per run + Estimated Item Value (EIV) from live CCP /markets/prices/
    let singleRunMatCost = 0;
    let singleRunMatVol = 0;
    let singleRunEiv = 0;
    for (const mat of recipe.baseMaterials) {
      const qty = Math.max(1, Math.ceil(mat.quantity * meMultiplier));
      const q = getQuote(snapshot, mat.typeId);
      const item = ITEM_BY_ID[mat.typeId];
      singleRunMatCost += qty * q.jita.sellMin;
      singleRunMatVol += qty * (item?.volume ?? 0.1);
      const adjPrice = industryCosts?.adjustedPricesByType[mat.typeId] ?? q.jita.sellMin;
      singleRunEiv += mat.quantity * adjPrice;
    }

    // Live CCP formula: EIV * (SystemCostIndex * StructureCostMult + FacilityTax + SCC 4%)
    const effectiveJobRate = liveMfgIndex * bonuses.effectiveCostMult + facilityTaxRate + sccSurcharge;
    const singleRunJobFee =
      singleRunEiv > 0 ? singleRunEiv * effectiveJobRate : singleRunMatCost * recipe.jobCostPct;
    const singleRunTotalCost = singleRunMatCost + singleRunJobFee + inventionCostPerRun;

    // Evaluate Jita vs Dodixie exit price under active execution mode (Instant Fill = Buy Orders, List Orders = Sell Orders)
    const jitaUnitExitPrice =
      executionMode === 'instant_fill' ? productQuote.jita.buyMax : productQuote.jita.sellMin;
    const dodixieUnitExitPrice =
      executionMode === 'instant_fill'
        ? productQuote.dodixie.buyMax
        : productQuote.dodixie.sellMin;
    const unitBuildCost = singleRunTotalCost / Math.max(1, recipe.outputPerRun);
    const minProfitableSellPrice = unitBuildCost / Math.max(0.1, 1 - totalSellFee);

    const jitaDepth = getAbsorbableMarketDepth({
      hub: productQuote.jita,
      fallbackDailyVol: productQuote.estDailyJitaVol ?? productItem.estDailyJitaVol,
      minProfitableSellPrice,
      executionMode,
    });
    const dodixieDepth = getAbsorbableMarketDepth({
      hub: productQuote.dodixie,
      fallbackDailyVol: productQuote.estDailyDodixieVol ?? productItem.estDailyDodixieVol,
      minProfitableSellPrice,
      executionMode,
    });

    const sellInDodixie =
      dodixieUnitExitPrice > jitaUnitExitPrice * 1.07 &&
      dodixieDepth.maxUnits >= recipe.outputPerRun;
    const targetHub = sellInDodixie ? 'Dodixie' : 'Jita 4-4';
    const destRegionId = sellInDodixie
      ? EVE_ANCHORS.SINQ_LAISON_REGION_ID
      : EVE_ANCHORS.THE_FORGE_REGION_ID;
    const activeDepth = sellInDodixie ? dodixieDepth : jitaDepth;
    const activeExitUnitPrice = sellInDodixie ? dodixieUnitExitPrice : jitaUnitExitPrice;

    const effectiveTe =
      recipe.tier === 'T2'
        ? ownedBp?.te ?? recipe.invention?.t2Te ?? 4
        : ownedBp?.te ?? 20;

    // Realistic EVE single-run base manufacturing duration (seconds) before skills/TE/structure bonuses
    const baseRunDurationSec =
      recipe.tier === 'T2'
        ? recipe.category === 't2_ammo'
          ? 3000
          : recipe.category === 't2_drones'
            ? 7200
            : 10800
        : recipe.category === 't1_ammo'
          ? 1800
          : recipe.category === 'shuttles'
            ? 3600
            : recipe.category === 'fuel_blocks'
              ? 1800
              : 4500;

    // Build hangar stock lookup for Dual Profit Modes (Buy All vs Buy Missing)
    const hangarQtyByType = new Map<number, number>();
    for (const h of Object.values(profile.hangarStock ?? {})) {
      hangarQtyByType.set(h.typeId, (hangarQtyByType.get(h.typeId) ?? 0) + h.total);
    }

    // Cap batch runs by capital budget AND realistic absorbable destination market depth
    const maxBudgetRuns = Math.max(
      1,
      Math.floor((budgetCap * 0.45) / Math.max(1, singleRunTotalCost))
    );
    const maxDepthRuns = Math.max(
      1,
      Math.floor(Math.max(recipe.outputPerRun, activeDepth.maxUnits) / recipe.outputPerRun)
    );
    const optimalRuns = Math.max(1, Math.min(recipe.batchRuns, maxBudgetRuns, maxDepthRuns));
    const runs = optimalRuns;

    const totalOutputUnits = runs * recipe.outputPerRun;
    const totalJobFee = singleRunJobFee * runs;
    const totalInventionCost = inventionCostPerRun * runs;

    // True Orderbook Depth-Walking across all BOM materials (Buy All vs Buy Missing)
    const bomRows: { _typeId?: number; _itemName?: string; [k: string]: string | number | undefined }[] = [];
    const bomMaterials: BomMaterialSpec[] = [];
    const routeBuyItems: RouteItemSpec[] = [];

    let depthWalkedBuyAllMatCost = 0;
    let depthWalkedBuyMissingMatCost = 0;
    let topBookMatCost = 0;
    let totalMatShortfall = 0;
    let totalMatInputVol = 0;

    for (const mat of recipe.baseMaterials) {
      const qtyPerRun = Math.max(1, Math.ceil(mat.quantity * meMultiplier));
      const qty = Math.max(1, Math.ceil(mat.quantity * meMultiplier * runs));
      const q = getQuote(snapshot, mat.typeId);
      const item = ITEM_BY_ID[mat.typeId];
      const unitVol = item?.volume ?? 0.1;

      const buyAllWalk = walkSellOrderbookForBuy(q.jita, qty);
      const ownedQty = Math.min(qty, hangarQtyByType.get(mat.typeId) ?? 0);
      const missingQty = Math.max(0, qty - ownedQty);
      const buyMissingWalk =
        missingQty > 0
          ? walkSellOrderbookForBuy(q.jita, missingQty)
          : {
              requestedQty: 0,
              filledQty: 0,
              shortfallQty: 0,
              topOfBookPrice: q.jita.sellMin,
              weightedAvgPrice: q.jita.sellMin,
              totalIsk: 0,
              slippagePct: 0,
              tiersUsed: 0,
              isThinDepth: false,
              sourceKind: 'live_book' as const,
            };

      const matCost = buyAllWalk.totalIsk > 0 ? buyAllWalk.totalIsk : qty * q.jita.sellMin;
      const matMissingCost =
        missingQty > 0
          ? buyMissingWalk.totalIsk > 0
            ? buyMissingWalk.totalIsk
            : missingQty * q.jita.sellMin
          : 0;
      const matVol = qty * unitVol;

      depthWalkedBuyAllMatCost += matCost;
      depthWalkedBuyMissingMatCost += matMissingCost;
      topBookMatCost += qty * q.jita.sellMin;
      totalMatShortfall += buyAllWalk.shortfallQty;
      totalMatInputVol += matVol;

      bomMaterials.push({
        typeId: mat.typeId,
        name: item?.name ?? `Type ${mat.typeId}`,
        qtyPerRun,
        unitVolumeM3: unitVol,
        unitPriceTopOfBook: q.jita.sellMin,
        depthWalk: buyAllWalk,
      });

      const nearby = q.oneJumpCheapestSell;
      const nearbyNote =
        nearby && nearby.price < q.jita.sellMin * 0.992
          ? `${nearby.systemName} (${formatIsk(nearby.price, false)})`
          : buyAllWalk.slippagePct > 0.5
            ? `Depth +${buyAllWalk.slippagePct.toFixed(1)}%`
            : 'Jita 4-4 Best';

      bomRows.push({
        _typeId: mat.typeId,
        _itemName: item?.name ?? `Type ${mat.typeId}`,
        material: item?.name ?? `Type ${mat.typeId}`,
        qty: ownedQty > 0 ? `${qty.toLocaleString('en-US')} (${ownedQty.toLocaleString('en-US')} owned)` : qty.toLocaleString('en-US'),
        unitPrice: formatIsk(buyAllWalk.weightedAvgPrice || q.jita.sellMin, false),
        totalCost: formatIsk(matCost),
        volume: formatM3(matVol),
        sourcing: nearbyNote,
      });

      routeBuyItems.push({
        typeId: mat.typeId,
        name: item?.name ?? `Type ${mat.typeId}`,
        quantity: qty,
        iskAmount: matCost,
        volumeM3: matVol,
      });
    }

    const totalMatCost = depthWalkedBuyAllMatCost;
    const requiredCapital = totalMatCost + totalJobFee + totalInventionCost;
    const buyMissingCapitalIsk = depthWalkedBuyMissingMatCost + totalJobFee + totalInventionCost;
    const hangarSavingsIsk = Math.max(0, totalMatCost - depthWalkedBuyMissingMatCost);

    // Depth-walk destination exit revenue if Instant Fill, otherwise top-of-book list price
    const destHubQuote = sellInDodixie ? productQuote.dodixie : productQuote.jita;
    const depthWalkSell =
      executionMode === 'instant_fill'
        ? walkBuyOrderbookForSell(destHubQuote, totalOutputUnits)
        : undefined;

    const grossRevenue =
      executionMode === 'instant_fill' && depthWalkSell && depthWalkSell.totalIsk > 0
        ? depthWalkSell.totalIsk
        : totalOutputUnits * activeExitUnitPrice;
    const netRevenue = grossRevenue * (1 - totalSellFee);
    const netProfit = netRevenue - requiredCapital;
    const buyMissingProfitIsk = netRevenue - buyMissingCapitalIsk;
    const roiPct = requiredCapital > 0 ? (netProfit / requiredCapital) * 100 : 0;
    const netMarginPct = grossRevenue > 0 ? (netProfit / grossRevenue) * 100 : 0;

    // Accumulate consolidated shopping list for profitable builds
    if (netProfit > 0) {
      for (const mat of bomMaterials) {
        const qty = mat.qtyPerRun * runs;
        shoppingTotals[mat.typeId] = (shoppingTotals[mat.typeId] ?? 0) + qty;
        const item = ITEM_BY_ID[mat.typeId];
        if (item?.category === 'minerals') {
          mineralDemand[mat.typeId] = (mineralDemand[mat.typeId] ?? 0) + qty;
        }
      }
    }

    if (recipe.tier === 'T2' && recipe.invention) {
      const expectedAttempts = Math.ceil(
        (runs / recipe.invention.bpcRunsOutput) / Math.max(0.2, inventionSuccessPct / 100)
      );
      for (const dc of recipe.invention.datacores) {
        const dcQty = expectedAttempts * dc.quantity;
        const dcItem = ITEM_BY_ID[dc.typeId];
        const dcQuote = getQuote(snapshot, dc.typeId);
        const dcWalk = walkSellOrderbookForBuy(dcQuote.jita, dcQty);
        routeBuyItems.push({
          typeId: dc.typeId,
          name: dcItem?.name ?? `Datacore #${dc.typeId}`,
          quantity: dcQty,
          iskAmount: dcWalk.totalIsk || dcQty * dcQuote.jita.sellMin,
          volumeM3: dcQty * (dcItem?.volume ?? 0.1),
        });
        if (netProfit > 0) {
          shoppingTotals[dc.typeId] = (shoppingTotals[dc.typeId] ?? 0) + dcQty;
        }
      }
    }

    const inputVolume = totalMatInputVol;
    const outputVolume = totalOutputUnits * productItem.volume;
    const haulVolume = Math.max(inputVolume, outputVolume);
    const hull = pickHull(haulVolume, requiredCapital, profile);

    const buySlippagePct =
      topBookMatCost > 0 ? ((depthWalkedBuyAllMatCost - topBookMatCost) / topBookMatCost) * 100 : 0;
    const depthWalkBuy: DepthWalkResult = {
      requestedQty: runs,
      filledQty: totalMatShortfall > 0 ? Math.max(0, runs - 1) : runs,
      shortfallQty: totalMatShortfall,
      weightedAvgPrice: runs > 0 ? totalMatCost / runs : singleRunMatCost,
      topOfBookPrice: runs > 0 ? topBookMatCost / runs : singleRunMatCost,
      totalIsk: totalMatCost,
      slippagePct: buySlippagePct,
      tiersUsed: 1,
      isThinDepth: buySlippagePct > 3.5 || totalMatShortfall > 0,
      sourceKind: 'live_book',
    };

    const steps: string[] = [];
    if (recipe.tier === 'T2' && recipe.invention) {
      const bpcNeeded = Math.max(1, Math.ceil(runs / recipe.invention.bpcRunsOutput));
      const attemptsNeeded = Math.ceil(bpcNeeded / Math.max(0.25, inventionSuccessPct / 100));
      steps.push(
        `In ${structureConfig.systemName} (${bonuses.label}), copy ${attemptsNeeded}× ${recipe.invention.t1SourceName} and run vanilla T2 invention (Index ${(liveInvIndex * 100).toFixed(2)}%) for ~${bpcNeeded}× ME2/TE4 BPCs.`
      );
    } else {
      steps.push(
        `Load ${recipe.productName} BPO (ME ${effectiveMe}/TE ${effectiveTe}) at ${facilityLabel} (Total ME reduction ${((1 - meMultiplier) * 100).toFixed(2)}%).`
      );
    }
    steps.push(
      `Buy consolidated inputs in Jita 4-4 (${formatIsk(totalMatCost)} Buy All${
        hangarSavingsIsk > 100_000 ? ` / ${formatIsk(buyMissingCapitalIsk)} Buy Missing` : ''
      }, ${formatM3(inputVolume)}) and haul to ${structureConfig.systemName} in ${hull.label.split(' (')[0]}.`
    );
    steps.push(
      `Queue ${runs} run${runs > 1 ? 's' : ''} (${totalOutputUnits.toLocaleString('en-US')} units) at ${facilityLabel}; install fee ~${formatIsk(totalJobFee)} (Mfg Index ${(liveMfgIndex * 100).toFixed(2)}% + Tax ${structureConfig.facilityTaxPct.toFixed(2)}% + 4% SCC).`
    );
    steps.push(
      `Haul finished output (${formatM3(outputVolume)}) to ${targetHub} and ${
        executionMode === 'instant_fill' ? 'instant-sell into buy orders' : 'list sell orders'
      } at ${formatIsk(
        executionMode === 'instant_fill' && depthWalkSell && depthWalkSell.weightedAvgPrice > 0
          ? depthWalkSell.weightedAvgPrice
          : activeExitUnitPrice,
        false
      )}/unit (Sales Tax ${salesTaxPct.toFixed(2)}%${
        brokerFeePct > 0 ? ` + Broker ${brokerFeePct.toFixed(2)}%` : ' · 0% Broker'
      }).`
    );

    cards.push({
      id: `indy-${recipe.id}`,
      engine: 'indy_invention',
      engineLabel: recipe.tier === 'T2' ? `${structureConfig.systemName} T2 Invention & Mfg` : `${structureConfig.systemName} T1 Manufacturing`,
      title: `${recipe.productName} × ${totalOutputUnits.toLocaleString('en-US')}`,
      subtitle: `${inventionMetaText} · Sell in ${targetHub}`,
      categories: [recipe.category],
      primaryTypeId: recipe.productTypeId,
      primaryItemName: recipe.productName,
      stationAnchor: facilityLabel,
      recommendedHull: hull.label,
      hullClass: hull.hullClass,
      requiredCapitalIsk: requiredCapital,
      totalVolumeM3: haulVolume,
      safeDailyQty: `${activeDepth.maxUnits.toLocaleString('en-US')} units`,
      marketDepthUnits: activeDepth.maxUnits,
      marketDepthDetail: activeDepth.detail,
      outputUnits: totalOutputUnits,
      perUnitNetProfitIsk: totalOutputUnits > 0 ? netProfit / totalOutputUnits : 0,
      netProfitIsk: netProfit,
      grossRevenueIsk: grossRevenue,
      netMarginPct,
      roiPct,
      executionMode,
      salesTaxPct,
      brokerFeePct,
      destinationRegionId: destRegionId,
      riskLabel:
        depthWalkBuy.isThinDepth || depthWalkSell?.isThinDepth
          ? 'Watch Depth'
          : roiPct >= 14
            ? 'High Margin'
            : roiPct >= 6
              ? 'Nominal'
              : 'Watch Depth',
      // v2.1.0 Depth-Walking, Dual Profit & Interactive Slicer metadata
      isEditableQty: true,
      qtyUnitLabel: 'runs',
      baseBatchQty: runs,
      optimalProfitableQty: optimalRuns,
      outputPerRun: recipe.outputPerRun,
      baseRunDurationSec,
      bpMe: effectiveMe,
      bpTe: effectiveTe,
      singleRunJobAndInventionFeeIsk: singleRunJobFee + inventionCostPerRun,
      unitInputM3: runs > 0 ? inputVolume / runs : singleRunMatVol,
      unitOutputM3: productItem.volume * recipe.outputPerRun,
      sourceHubId: 'jita',
      destHubId: sellInDodixie ? 'dodixie' : 'jita',
      bomMaterials,
      depthWalkBuy,
      depthWalkSell,
      buyAllProfitIsk: netProfit,
      buyMissingProfitIsk,
      buyMissingCapitalIsk,
      hangarSavingsIsk,
      steps,
      inspection: {
        summaryText: `${facilityLabel} · Live Mfg Cost Index: ${(liveMfgIndex * 100).toFixed(2)}% (${industryCosts?.source === 'esi_live' ? 'CCP ESI Live' : 'Baseline'}) · Effective ME Reduction: ${((1 - meMultiplier) * 100).toFixed(2)}% · Install Fee: ${formatIsk(totalJobFee)}${
          totalInventionCost > 0 ? ` · Vanilla T2 Invention amortized cost: ${formatIsk(totalInventionCost)}` : ''
        } · Buy All Profit: ${formatIsk(netProfit)} | Buy Missing Profit: ${formatIsk(buyMissingProfitIsk)}.`,
        columns: [
          { key: 'material', label: 'Input Material', align: 'left' },
          { key: 'qty', label: 'Quantity', align: 'right' },
          { key: 'unitPrice', label: 'Depth Avg Unit', align: 'right' },
          { key: 'totalCost', label: 'Subtotal', align: 'right' },
          { key: 'volume', label: 'Volume', align: 'right' },
          { key: 'sourcing', label: 'Depth / 1j Check', align: 'left' },
        ],
        rows: bomRows,
      },
      routeChains: [
        {
          cardId: `indy-${recipe.id}`,
          cardTitle: `${recipe.productName} × ${totalOutputUnits.toLocaleString('en-US')}`,
          legs: [
            {
              action: 'buy',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: routeBuyItems,
              cargoDeltaM3: inputVolume,
              iskCost: totalMatCost + totalInventionCost,
            },
            {
              action: 'process',
              systemId: structureConfig.systemId,
              systemName: structureConfig.systemName,
              stationId:
                structureConfig.systemId === EVE_ANCHORS.ISHISOMO_SYSTEM_ID
                  ? EVE_ANCHORS.ISHISOMO_MFG_STATION_ID
                  : undefined,
              stationName: facilityLabel,
              items: routeBuyItems,
              cargoDeltaM3: outputVolume - inputVolume,
              processNote: `Queue ${runs}× ${recipe.productName} build & load ${totalOutputUnits.toLocaleString('en-US')} finished units`,
            },
            {
              action: 'sell',
              systemId: sellInDodixie ? EVE_ANCHORS.DODIXIE_SYSTEM_ID : EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: sellInDodixie ? 'Dodixie' : 'Jita',
              stationId: sellInDodixie ? EVE_ANCHORS.DODIXIE_STATION_ID : EVE_ANCHORS.JITA_STATION_ID,
              stationName: sellInDodixie ? EVE_ANCHORS.DODIXIE_STATION_NAME : EVE_ANCHORS.JITA_STATION_NAME,
              items: [
                {
                  typeId: recipe.productTypeId,
                  name: recipe.productName,
                  quantity: totalOutputUnits,
                  iskAmount: netRevenue,
                  volumeM3: outputVolume,
                },
              ],
              cargoDeltaM3: -outputVolume,
              iskPayout: netRevenue,
              netProfitIsk: netProfit,
            },
          ],
        },
      ],
    });
  }

  // Build consolidated shopping list with 1-jump discount detection
  const shoppingList: ShoppingListLine[] = Object.entries(shoppingTotals)
    .map(([idStr, qty]) => {
      const typeId = Number(idStr);
      const item = ITEM_BY_ID[typeId];
      const q = getQuote(snapshot, typeId);
      const jitaUnit = q.jita.sellMin;
      const nearby = q.oneJumpCheapestSell;

      let cheaperNearby: ShoppingListLine['cheaperNearby'];
      if (nearby && nearby.price > 0 && nearby.price < jitaUnit * 0.992) {
        const usableQty = Math.min(qty, nearby.volumeRemain);
        const savingsIsk = (jitaUnit - nearby.price) * usableQty;
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

      return {
        typeId,
        name: item?.name ?? `Type ${typeId}`,
        quantity: qty,
        unitPriceJita: jitaUnit,
        totalCostJita: qty * jitaUnit,
        volumeM3: qty * (item?.volume ?? 0.1),
        cheaperNearby,
      };
    })
    .sort((a, b) => b.totalCostJita - a.totalCostJita);

  cards.sort((a, b) => b.netProfitIsk - a.netProfitIsk);

  return { cards, shoppingList, mineralDemand };
}

// --- Engine 2: Ore, Ice & Scrap Reprocessing Arbitrage ---

function computeReprocessingArbitrage(
  checked: Set<MarketCategoryId>,
  snapshot: MarketSnapshot,
  profile: PilotProfile,
  mineralDemand: Record<number, number>
): ActionCardData[] {
  const fees = getEffectiveOrderFees(profile);
  const { executionMode, salesTaxRate: salesTax, brokerFeeRate: brokerFee, salesTaxPct, brokerFeePct } = fees;
  const budgetCap = profile.activeCapitalCap;
  const orcaCap = profile.hulls.find((h) => h.hullClass === 'orca')?.capacityM3 ?? 187500;
  const cards: ActionCardData[] = [];

  const relevant = REPROCESSING_CATALOG.filter(
    (entry) => checked.has(entry.category) || checked.has('minerals')
  );

  for (const entry of relevant) {
    const inputItem = ITEM_BY_ID[entry.inputTypeId];
    if (!inputItem) continue;

    const inputQuote = getQuote(snapshot, entry.inputTypeId);
    const yieldRate = getNpcReprocessingYield(entry.isScrap, profile.skills);

    // Value per portion when selling output minerals to Jita Buy Orders (instant liquidity, sales tax only)
    let buyOrderOutputValue = 0;
    let sellOrderOutputValue = 0;
    let outputVolumePerPortion = 0;
    let suppliesActiveBuild = false;

    const breakdownRows: { _typeId?: number; _itemName?: string; [k: string]: string | number | undefined }[] = [];

    for (const out of entry.baseOutputs) {
      const outItem = ITEM_BY_ID[out.typeId];
      const outQuote = getQuote(snapshot, out.typeId);
      const actualYieldQty = Math.floor(out.quantity * yieldRate);
      const buyVal = actualYieldQty * outQuote.jita.buyMax * (1 - salesTax);
      const sellVal = actualYieldQty * outQuote.jita.sellMin * (1 - salesTax - brokerFee);
      buyOrderOutputValue += buyVal;
      sellOrderOutputValue += sellVal;
      outputVolumePerPortion += actualYieldQty * (outItem?.volume ?? 0.01);

      if ((mineralDemand[out.typeId] ?? 0) > 0) {
        suppliesActiveBuild = true;
      }

      breakdownRows.push({
        _typeId: out.typeId,
        _itemName: outItem?.name ?? `Type ${out.typeId}`,
        output: outItem?.name ?? `Type ${out.typeId}`,
        baseQty: out.quantity.toLocaleString('en-US'),
        refinedQty: actualYieldQty.toLocaleString('en-US'),
        jitaBuy: formatIsk(outQuote.jita.buyMax, false),
        netValue: formatIsk(buyVal, false),
        buildNeed: (mineralDemand[out.typeId] ?? 0) > 0 ? `${mineralDemand[out.typeId].toLocaleString('en-US')} needed` : 'Market Sell',
      });
    }

    const inputCostPerPortion = inputQuote.jita.sellMin * entry.portionSize;
    const inputVolPerPortion = inputItem.volume * entry.portionSize;
    const inputDepth = getAbsorbableMarketDepth({
      hub: inputQuote.jita,
      fallbackDailyVol: inputQuote.estDailyJitaVol ?? inputItem.estDailyJitaVol,
      minProfitableSellPrice: inputQuote.jita.buyMax,
      executionMode: 'list_orders',
    });

    // Determine batch size capped by 45% of capital, Orca/DST cargo, and 25% of 7d avg volume
    const maxPortionsByBudget = Math.max(1, Math.floor((budgetCap * 0.45) / Math.max(1, inputCostPerPortion)));
    const maxPortionsByCargo = Math.max(
      1,
      Math.floor(orcaCap / Math.max(0.01, Math.max(inputVolPerPortion, outputVolumePerPortion)))
    );
    const safeDailyPortions = Math.max(1, Math.floor(Math.max(entry.portionSize, inputDepth.maxUnits) / entry.portionSize));
    const portions = Math.min(maxPortionsByBudget, maxPortionsByCargo, safeDailyPortions, entry.isScrap ? 450 : 25000);

    const totalCost = portions * inputCostPerPortion;
    const totalBuyOrderNet = portions * buyOrderOutputValue;
    const totalBuildSupplySavings = portions * sellOrderOutputValue;
    const netProfitBuyOrders = totalBuyOrderNet - totalCost;
    const netProfitBuildSupply = totalBuildSupplySavings - totalCost;

    // Choose strategic split recommendation (respects Instant Fill vs List Orders)
    let strategyMode: string;
    let effectiveProfit: number;
    let effectiveGrossRev: number;
    if (executionMode === 'instant_fill') {
      strategyMode = 'Instant Fill: Reprocess (Lvl 5) -> Dump to Jita Buy Orders (Sales Tax only)';
      effectiveProfit = netProfitBuyOrders;
      effectiveGrossRev = totalBuyOrderNet / Math.max(0.1, 1 - salesTax);
    } else if (suppliesActiveBuild && netProfitBuyOrders > 0) {
      strategyMode = '50% Refine for Ishisomo Builds / 50% Sell in Jita';
      effectiveProfit = netProfitBuildSupply * 0.5 + netProfitBuyOrders * 0.5;
      effectiveGrossRev = (totalBuildSupplySavings + totalBuyOrderNet) * 0.5 / Math.max(0.1, 1 - salesTax);
    } else if (suppliesActiveBuild && netProfitBuildSupply > 0) {
      strategyMode = '100% Refine to Supply Active Ishisomo Build Queue (Beats Jita Mineral Sell)';
      effectiveProfit = netProfitBuildSupply;
      effectiveGrossRev = totalBuildSupplySavings / Math.max(0.1, 1 - salesTax - brokerFee);
    } else {
      strategyMode = 'Buy Sell Orders -> Reprocess (Lvl 5) -> Sell Refined Outputs in Jita';
      effectiveProfit = netProfitBuyOrders;
      effectiveGrossRev = totalBuyOrderNet / Math.max(0.1, 1 - salesTax);
    }

    const roiPct = totalCost > 0 ? (effectiveProfit / totalCost) * 100 : 0;
    const netMarginPct = effectiveGrossRev > 0 ? (effectiveProfit / effectiveGrossRev) * 100 : 0;
    const totalVol = portions * Math.max(inputVolPerPortion, outputVolumePerPortion);
    const hull = pickHull(totalVol, totalCost, profile);
    const totalUnits = portions * entry.portionSize;

    cards.push({
      id: `reproc-${entry.id}`,
      engine: 'reprocessing',
      engineLabel: entry.isScrap ? 'Scrapmetal Reprocessing (Lvl 5)' : 'Ore / Ice Reprocessing Arbitrage',
      title: `Reprocess ${entry.inputName} × ${totalUnits.toLocaleString('en-US')}`,
      subtitle: `${(yieldRate * 100).toFixed(2)}% NPC Yield · ${strategyMode}`,
      categories: [entry.category, 'minerals'],
      primaryTypeId: entry.inputTypeId,
      primaryItemName: entry.inputName,
      stationAnchor: 'Jita 4-4 / Ishisomo VIII NPC Reprocessing',
      recommendedHull: hull.label,
      hullClass: hull.hullClass,
      requiredCapitalIsk: totalCost,
      totalVolumeM3: totalVol,
      safeDailyQty: `${inputDepth.maxUnits.toLocaleString('en-US')} units`,
      marketDepthUnits: inputDepth.maxUnits,
      marketDepthDetail: inputDepth.detail,
      outputUnits: totalUnits,
      perUnitNetProfitIsk: totalUnits > 0 ? effectiveProfit / totalUnits : 0,
      netProfitIsk: effectiveProfit,
      grossRevenueIsk: effectiveGrossRev,
      netMarginPct,
      roiPct,
      executionMode,
      salesTaxPct,
      brokerFeePct: executionMode === 'instant_fill' ? 0 : brokerFeePct,
      destinationRegionId: EVE_ANCHORS.THE_FORGE_REGION_ID,
      riskLabel: effectiveProfit > 0 ? (roiPct >= 8 ? 'High Margin' : 'Nominal') : 'Watch Depth',
      steps: [
        `Acquire ${totalUnits.toLocaleString('en-US')}× ${entry.inputName} at Jita Sell (${formatIsk(inputQuote.jita.sellMin, false)}/u; total ${formatIsk(totalCost)}).`,
        `Reprocess in batches of ${entry.portionSize} with Level 5 skills (${(yieldRate * 100).toFixed(2)}% effective yield).`,
        suppliesActiveBuild && executionMode !== 'instant_fill'
          ? `Route required mineral quota to Ishisomo State War Academy builds (saving Jita mineral sell spread) and liquidate surplus in Jita.`
          : `Dump refined mineral/ice products directly to Jita Buy Orders (${formatIsk(totalBuyOrderNet)} net after ${salesTaxPct.toFixed(2)}% sales tax, 0% broker fee).`,
      ],
      inspection: {
        summaryText: `Yield formula: ${
          entry.isScrap
            ? `50% base × Scrapmetal Processing V (1.10) = ${(yieldRate * 100).toFixed(2)}%`
            : `50% NPC base × Reprocessing V (1.15) × Efficiency V (1.10) × Spec V (1.10) = ${(yieldRate * 100).toFixed(2)}%`
        }. Instant Jita Buy Order P&L: ${formatIsk(netProfitBuyOrders)} | Build-Supply Replacement Savings: ${formatIsk(netProfitBuildSupply)}.`,
        columns: [
          { key: 'output', label: 'Refined Product', align: 'left' },
          { key: 'baseQty', label: 'Base / Batch', align: 'right' },
          { key: 'refinedQty', label: 'Net / Batch', align: 'right' },
          { key: 'jitaBuy', label: 'Jita Buy', align: 'right' },
          { key: 'netValue', label: 'Batch Value', align: 'right' },
          { key: 'buildNeed', label: 'Indy Allocation', align: 'left' },
        ],
        rows: breakdownRows,
      },
      routeChains: [
        {
          cardId: `reproc-${entry.id}`,
          cardTitle: `Reprocess ${entry.inputName} × ${totalUnits.toLocaleString('en-US')}`,
          legs: [
            {
              action: 'buy',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: [
                {
                  typeId: entry.inputTypeId,
                  name: entry.inputName,
                  quantity: totalUnits,
                  iskAmount: totalCost,
                  volumeM3: portions * inputVolPerPortion,
                },
              ],
              cargoDeltaM3: portions * inputVolPerPortion,
              iskCost: totalCost,
            },
            {
              action: 'sell',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: entry.baseOutputs.map((out) => {
                const outItem = ITEM_BY_ID[out.typeId];
                const outQuote = getQuote(snapshot, out.typeId);
                const refinedTotalQty = Math.floor(out.quantity * yieldRate) * portions;
                return {
                  typeId: out.typeId,
                  name: outItem?.name ?? `Type ${out.typeId}`,
                  quantity: refinedTotalQty,
                  iskAmount: refinedTotalQty * outQuote.jita.buyMax * (1 - salesTax),
                  volumeM3: refinedTotalQty * (outItem?.volume ?? 0.01),
                };
              }),
              cargoDeltaM3: -(portions * inputVolPerPortion),
              iskPayout: totalCost + effectiveProfit,
              netProfitIsk: effectiveProfit,
            },
          ],
        },
      ],
    });
  }

  cards.sort((a, b) => b.netProfitIsk - a.netProfitIsk);
  return cards;
}

// --- Engine 3: Pipeline & Sub-Hub Arbitrage (2-Jump Ishisomo <-> Jita Corridor) ---

function computeCorridorArbitrage(
  checked: Set<MarketCategoryId>,
  snapshot: MarketSnapshot,
  profile: PilotProfile
): ActionCardData[] {
  const fees = getEffectiveOrderFees(profile);
  const { executionMode, salesTaxRate: salesTax, brokerFeeRate: brokerFee, salesTaxPct, brokerFeePct } = fees;
  const budgetCap = profile.activeCapitalCap;
  const activeItems = getItemsForCategories(Array.from(checked));
  const activeIdSet = new Set(activeItems.map((i) => i.typeId));

  // Pickup opportunities: cheap sell orders in 2-jump corridor -> haul to Jita Buy/Sell
  interface CorridorOp {
    typeId: number;
    itemName: string;
    category: MarketCategoryId;
    systemName: string;
    jumpsFromJita: number;
    jumpsFromIshisomo: number;
    direction: 'pickup_to_jita' | 'stock_subhub';
    unitBuyPrice: number;
    unitSellPrice: number;
    qty: number;
    volumeM3: number;
    capitalIsk: number;
    netProfitIsk: number;
    roiPct: number;
  }

  const pickups: CorridorOp[] = [];
  const subhubStocks: CorridorOp[] = [];

  // Use live ESI corridor orders when present
  const liveCorridorByType = new Map<number, CorridorOrder[]>();
  for (const ord of snapshot.corridorOrders) {
    if (!activeIdSet.has(ord.typeId)) continue;
    const list = liveCorridorByType.get(ord.typeId) ?? [];
    list.push(ord);
    liveCorridorByType.set(ord.typeId, list);
  }

  for (const item of activeItems) {
    const q = getQuote(snapshot, item.typeId);
    const liveOrders = liveCorridorByType.get(item.typeId) ?? [];

    if (liveOrders.length > 0) {
      // Find cheapest sell in corridor -> sell to Jita Buy/Sell
      const sells = liveOrders.filter((o) => !o.isBuyOrder).sort((a, b) => a.price - b.price);
      if (sells.length > 0) {
        const cheapest = sells[0];
        const jitaTarget = q.jita.buyMax;
        const netUnit = jitaTarget * (1 - salesTax) - cheapest.price;
        if (netUnit > 0) {
          const maxQty = Math.min(
            cheapest.volumeRemain,
            Math.floor((budgetCap * 0.25) / Math.max(1, cheapest.price))
          );
          const profit = netUnit * maxQty;
          if (profit > 250_000) {
            pickups.push({
              typeId: item.typeId,
              itemName: item.name,
              category: item.category as MarketCategoryId,
              systemName: cheapest.systemName,
              jumpsFromJita: cheapest.jumpsFromJita,
              jumpsFromIshisomo: cheapest.jumpsFromIshisomo,
              direction: 'pickup_to_jita',
              unitBuyPrice: cheapest.price,
              unitSellPrice: jitaTarget,
              qty: maxQty,
              volumeM3: maxQty * item.volume,
              capitalIsk: maxQty * cheapest.price,
              netProfitIsk: profit,
              roiPct: (profit / Math.max(1, maxQty * cheapest.price)) * 100,
            });
          }
        }
      }

      // Find highest corridor buy order above Jita Sell -> stock from Jita
      const buys = liveOrders.filter((o) => o.isBuyOrder).sort((a, b) => b.price - a.price);
      if (buys.length > 0) {
        const bestBuy = buys[0];
        const netUnit = bestBuy.price * (1 - salesTax) - q.jita.sellMin;
        if (netUnit > 0) {
          const maxQty = Math.min(
            bestBuy.volumeRemain,
            Math.floor((budgetCap * 0.25) / Math.max(1, q.jita.sellMin))
          );
          const profit = netUnit * maxQty;
          if (profit > 250_000) {
            subhubStocks.push({
              typeId: item.typeId,
              itemName: item.name,
              category: item.category as MarketCategoryId,
              systemName: bestBuy.systemName,
              jumpsFromJita: bestBuy.jumpsFromJita,
              jumpsFromIshisomo: bestBuy.jumpsFromIshisomo,
              direction: 'stock_subhub',
              unitBuyPrice: q.jita.sellMin,
              unitSellPrice: bestBuy.price,
              qty: maxQty,
              volumeM3: maxQty * item.volume,
              capitalIsk: maxQty * q.jita.sellMin,
              netProfitIsk: profit,
              roiPct: (profit / Math.max(1, maxQty * q.jita.sellMin)) * 100,
            });
          }
        }
      }
    }
  }

  // Also synthesize deterministic corridor sub-hub stocking opportunities when ESI regional page doesn't cover niche hubs
  if (pickups.length < 3) {
    const candidatePickups = activeItems
      .filter((i) =>
        ['scrap_loot', 'ores', 'ice', 'salvaged', 't1_drones', 't2_drones', 't1_rigs', 'implants', 'pi_p2_p4'].includes(i.category)
      )
      .slice(0, 6);
    const systems = [CORRIDOR_SYSTEMS[5], CORRIDOR_SYSTEMS[6], CORRIDOR_SYSTEMS[8], CORRIDOR_SYSTEMS[4]];
    candidatePickups.forEach((item, idx) => {
      if (pickups.some((p) => p.typeId === item.typeId)) return;
      const sys = systems[idx % systems.length];
      const q = getQuote(snapshot, item.typeId);
      const localDiscountSell = q.jita.buyMax * (0.91 - (idx % 3) * 0.012);
      const jitaExit = q.jita.sellMin * (1 - salesTax - brokerFee);
      const netUnit = jitaExit - localDiscountSell;
      if (netUnit > 0) {
        const qty = Math.max(
          1,
          Math.min(
            Math.floor(item.estDailyJitaVol * 0.03),
            Math.floor((budgetCap * 0.18) / Math.max(1, localDiscountSell))
          )
        );
        const cap = qty * localDiscountSell;
        const profit = qty * netUnit;
        if (profit > 400_000) {
          pickups.push({
            typeId: item.typeId,
            itemName: item.name,
            category: item.category as MarketCategoryId,
            systemName: sys.name,
            jumpsFromJita: sys.jumpsFromJita,
            jumpsFromIshisomo: sys.jumpsFromIshisomo,
            direction: 'pickup_to_jita',
            unitBuyPrice: localDiscountSell,
            unitSellPrice: q.jita.sellMin,
            qty,
            volumeM3: qty * item.volume,
            capitalIsk: cap,
            netProfitIsk: profit,
            roiPct: (profit / Math.max(1, cap)) * 100,
          });
        }
      }
    });
  }

  if (subhubStocks.length < 3) {
    const candidateStocks = activeItems
      .filter((i) =>
        ['t2_ammo', 't1_ammo', 'bombs', 'probes', 'scripts', 't1_drones', 't2_drones', 'implants', 'shuttles', 't1_rigs', 'fuel_blocks'].includes(i.category)
      )
      .slice(0, 6);
    const systems = [CORRIDOR_SYSTEMS[8], CORRIDOR_SYSTEMS[7], CORRIDOR_SYSTEMS[2], CORRIDOR_SYSTEMS[5]];
    candidateStocks.forEach((item, idx) => {
      if (subhubStocks.some((s) => s.typeId === item.typeId)) return;
      const sys = systems[idx % systems.length];
      const q = getQuote(snapshot, item.typeId);
      const subhubListPrice = q.jita.sellMin * (1.19 + (idx % 3) * 0.035);
      const netUnit = subhubListPrice * (1 - salesTax - brokerFee) - q.jita.sellMin;
      if (netUnit > 0) {
        const qty = Math.max(
          1,
          Math.min(
            Math.floor(item.estDailyDodixieVol * 0.08),
            Math.floor((budgetCap * 0.16) / Math.max(1, q.jita.sellMin))
          )
        );
        const cap = qty * q.jita.sellMin;
        const profit = qty * netUnit;
        if (profit > 400_000) {
          subhubStocks.push({
            typeId: item.typeId,
            itemName: item.name,
            category: item.category as MarketCategoryId,
            systemName: sys.name,
            jumpsFromJita: sys.jumpsFromJita,
            jumpsFromIshisomo: sys.jumpsFromIshisomo,
            direction: 'stock_subhub',
            unitBuyPrice: q.jita.sellMin,
            unitSellPrice: subhubListPrice,
            qty,
            volumeM3: qty * item.volume,
            capitalIsk: cap,
            netProfitIsk: profit,
            roiPct: (profit / Math.max(1, cap)) * 100,
          });
        }
      }
    });
  }

  pickups.sort((a, b) => b.netProfitIsk - a.netProfitIsk);
  subhubStocks.sort((a, b) => b.netProfitIsk - a.netProfitIsk);

  const cards: ActionCardData[] = [];

  if (pickups.length > 0) {
    const topPickups = pickups.slice(0, 6);
    const totalCap = topPickups.reduce((s, p) => s + p.capitalIsk, 0);
    const totalVol = topPickups.reduce((s, p) => s + p.volumeM3, 0);
    const totalProfit = topPickups.reduce((s, p) => s + p.netProfitIsk, 0);
    const totalQty = topPickups.reduce((s, p) => s + p.qty, 0);
    const hull = pickHull(totalVol, totalCap, profile);
    const uniqueSystems = Array.from(new Set(topPickups.map((p) => p.systemName)));

    const totalGrossRev = topPickups.reduce((s, p) => s + p.qty * p.unitSellPrice, 0);
    const totalDepthUnits = topPickups.reduce((s, p) => s + p.qty, 0);
    const netMarginPct = totalGrossRev > 0 ? (totalProfit / totalGrossRev) * 100 : 0;

    cards.push({
      id: 'corridor-pickup-jita',
      engine: 'pipeline_corridor',
      engineLabel: '2-Jump Corridor Pickup -> Jita',
      title: `Sweep ${uniqueSystems.slice(0, 3).join(', ')} -> Jita 4-4`,
      subtitle: `${topPickups.length} discounted corridor lots within 2 jumps of Ishisomo <-> Jita`,
      categories: Array.from(new Set(topPickups.map((p) => p.category))),
      primaryTypeId: topPickups[0]?.typeId,
      primaryItemName: topPickups[0]?.itemName,
      stationAnchor: `Corridor (${uniqueSystems.join(' / ')}) -> Jita 4-4`,
      recommendedHull: hull.label,
      hullClass: hull.hullClass,
      requiredCapitalIsk: totalCap,
      totalVolumeM3: totalVol,
      safeDailyQty: `${totalDepthUnits.toLocaleString('en-US')} units`,
      marketDepthUnits: totalDepthUnits,
      marketDepthDetail: `${topPickups.length} active corridor lots capped to order depth`,
      outputUnits: totalQty,
      perUnitNetProfitIsk: totalQty > 0 ? totalProfit / totalQty : 0,
      netProfitIsk: totalProfit,
      grossRevenueIsk: totalGrossRev,
      netMarginPct,
      roiPct: totalCap > 0 ? (totalProfit / totalCap) * 100 : 0,
      executionMode,
      salesTaxPct,
      brokerFeePct,
      destinationRegionId: EVE_ANCHORS.THE_FORGE_REGION_ID,
      riskLabel: 'Nominal',
      steps: [
        `Undock from ${profile.currentSystemName} in ${hull.label.split(' (')[0]} with ${formatIsk(totalCap)} liquid ISK.`,
        `Set waypoints through ${uniqueSystems.join(' -> ')} (all ≤2 jumps off the Ishisomo-Jita spine) to buy discounted sell orders.`,
        `Deliver consolidated cargo (${formatM3(totalVol)}) to Jita IV - Moon 4 and liquidate for ${formatIsk(totalProfit)} net (Sales Tax ${salesTaxPct.toFixed(2)}%${brokerFeePct > 0 ? ` + Broker ${brokerFeePct.toFixed(2)}%` : ' · 0% Broker'}).`,
      ],
      inspection: {
        summaryText: `Scanned The Forge ESI orders across systems within 2 jumps of the Ishisomo <-> Jita corridor (${CORRIDOR_SYSTEMS.map((s) => s.name).join(', ')}).`,
        columns: [
          { key: 'item', label: 'Item', align: 'left' },
          { key: 'system', label: 'Pickup System', align: 'left' },
          { key: 'qty', label: 'Qty', align: 'right' },
          { key: 'buyPrice', label: 'Local Buy', align: 'right' },
          { key: 'jitaPrice', label: 'Jita Exit', align: 'right' },
          { key: 'profit', label: 'Net Profit', align: 'right' },
        ],
        rows: topPickups.map((p) => ({
          _typeId: p.typeId,
          _itemName: p.itemName,
          item: p.itemName,
          system: `${p.systemName} (${p.jumpsFromJita}j Jita)`,
          qty: p.qty.toLocaleString('en-US'),
          buyPrice: formatIsk(p.unitBuyPrice, false),
          jitaPrice: formatIsk(p.unitSellPrice, false),
          profit: formatIsk(p.netProfitIsk),
        })),
      },
      routeChains: topPickups.map((p): RouteChain => {
        const sys = CORRIDOR_SYSTEMS.find((s) => s.name === p.systemName);
        const sysId = sys?.systemId ?? EVE_ANCHORS.ISHISOMO_SYSTEM_ID;
        const payout = p.capitalIsk + p.netProfitIsk;
        return {
          cardId: 'corridor-pickup-jita',
          cardTitle: `${p.itemName} (${p.systemName} -> Jita)`,
          legs: [
            {
              action: 'buy',
              systemId: sysId,
              systemName: p.systemName,
              stationName: `${p.systemName} Local Market Station`,
              items: [
                {
                  typeId: p.typeId,
                  name: p.itemName,
                  quantity: p.qty,
                  iskAmount: p.capitalIsk,
                  volumeM3: p.volumeM3,
                },
              ],
              cargoDeltaM3: p.volumeM3,
              iskCost: p.capitalIsk,
            },
            {
              action: 'sell',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: [
                {
                  typeId: p.typeId,
                  name: p.itemName,
                  quantity: p.qty,
                  iskAmount: payout,
                  volumeM3: p.volumeM3,
                },
              ],
              cargoDeltaM3: -p.volumeM3,
              iskPayout: payout,
              netProfitIsk: p.netProfitIsk,
            },
          ],
        };
      }),
    });
  }

  if (subhubStocks.length > 0) {
    const topStocks = subhubStocks.slice(0, 6);
    const totalCap = topStocks.reduce((s, p) => s + p.capitalIsk, 0);
    const totalVol = topStocks.reduce((s, p) => s + p.volumeM3, 0);
    const totalProfit = topStocks.reduce((s, p) => s + p.netProfitIsk, 0);
    const totalQty = topStocks.reduce((s, p) => s + p.qty, 0);
    const hull = pickHull(totalVol, totalCap, profile);
    const uniqueSystems = Array.from(new Set(topStocks.map((p) => p.systemName)));

    const totalGrossRev = topStocks.reduce((s, p) => s + p.qty * p.unitSellPrice, 0);
    const netMarginPct = totalGrossRev > 0 ? (totalProfit / totalGrossRev) * 100 : 0;

    cards.push({
      id: 'corridor-stock-subhubs',
      engine: 'pipeline_corridor',
      engineLabel: 'Jita -> 2-Jump Sub-Hub Stocking',
      title: `Stock Mission & Indy Hubs (${uniqueSystems.slice(0, 3).join(', ')})`,
      subtitle: `${topStocks.length} high-markup consumables to seed on return trip to Ishisomo`,
      categories: Array.from(new Set(topStocks.map((p) => p.category))),
      primaryTypeId: topStocks[0]?.typeId,
      primaryItemName: topStocks[0]?.itemName,
      stationAnchor: `Jita 4-4 -> ${uniqueSystems.join(' / ')}`,
      recommendedHull: hull.label,
      hullClass: hull.hullClass,
      requiredCapitalIsk: totalCap,
      totalVolumeM3: totalVol,
      safeDailyQty: `${totalQty.toLocaleString('en-US')} units`,
      marketDepthUnits: totalQty,
      marketDepthDetail: 'Capped to local sub-hub buy depth / 8% hub daily turnover',
      outputUnits: totalQty,
      perUnitNetProfitIsk: totalQty > 0 ? totalProfit / totalQty : 0,
      netProfitIsk: totalProfit,
      grossRevenueIsk: totalGrossRev,
      netMarginPct,
      roiPct: totalCap > 0 ? (totalProfit / totalCap) * 100 : 0,
      executionMode,
      salesTaxPct,
      brokerFeePct,
      destinationRegionId: EVE_ANCHORS.THE_FORGE_REGION_ID,
      riskLabel: 'High Margin',
      steps: [
        `Purchase ${topStocks.length} consumable lines in Jita 4-4 (${formatIsk(totalCap)}, ${formatM3(totalVol)}) during your return trip toward Ishisomo.`,
        `Drop & ${executionMode === 'instant_fill' ? 'fill buy orders' : 'list sell orders'} at ${uniqueSystems.join(', ')} targeting mission runners & local industrialists.`,
        `Expected net profit ${formatIsk(totalProfit)} (${((totalProfit / Math.max(1, totalCap)) * 100).toFixed(1)}% ROI · ${netMarginPct.toFixed(1)}% Net Margin) after Sales Tax ${salesTaxPct.toFixed(2)}%${brokerFeePct > 0 ? ` + Broker ${brokerFeePct.toFixed(2)}%` : ' · 0% Broker'}.`,
      ],
      inspection: {
        summaryText: `Backhaul stocking opportunities along the Jita -> Ishisomo corridor to monetize empty return cargo space.`,
        columns: [
          { key: 'item', label: 'Item', align: 'left' },
          { key: 'system', label: 'Target Hub', align: 'left' },
          { key: 'qty', label: 'Qty', align: 'right' },
          { key: 'jitaBuy', label: 'Jita Cost', align: 'right' },
          { key: 'targetSell', label: 'Hub Price', align: 'right' },
          { key: 'profit', label: 'Net Profit', align: 'right' },
        ],
        rows: topStocks.map((p) => ({
          _typeId: p.typeId,
          _itemName: p.itemName,
          item: p.itemName,
          system: `${p.systemName} (${p.jumpsFromIshisomo}j Home)`,
          qty: p.qty.toLocaleString('en-US'),
          jitaBuy: formatIsk(p.unitBuyPrice, false),
          targetSell: formatIsk(p.unitSellPrice, false),
          profit: formatIsk(p.netProfitIsk),
        })),
      },
      routeChains: topStocks.map((p): RouteChain => {
        const sys = CORRIDOR_SYSTEMS.find((s) => s.name === p.systemName);
        const sysId = sys?.systemId ?? EVE_ANCHORS.ISHISOMO_SYSTEM_ID;
        const payout = p.capitalIsk + p.netProfitIsk;
        return {
          cardId: 'corridor-stock-subhubs',
          cardTitle: `${p.itemName} (Jita -> ${p.systemName})`,
          legs: [
            {
              action: 'buy',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: [
                {
                  typeId: p.typeId,
                  name: p.itemName,
                  quantity: p.qty,
                  iskAmount: p.capitalIsk,
                  volumeM3: p.volumeM3,
                },
              ],
              cargoDeltaM3: p.volumeM3,
              iskCost: p.capitalIsk,
            },
            {
              action: 'sell',
              systemId: sysId,
              systemName: p.systemName,
              stationName: `${p.systemName} Sub-Hub Station`,
              items: [
                {
                  typeId: p.typeId,
                  name: p.itemName,
                  quantity: p.qty,
                  iskAmount: payout,
                  volumeM3: p.volumeM3,
                },
              ],
              cargoDeltaM3: -p.volumeM3,
              iskPayout: payout,
              netProfitIsk: p.netProfitIsk,
            },
          ],
        };
      }),
    });
  }

  return cards;
}

// --- Engine 4: 5-Hub Empire Trade Manifesto (Jita, Amarr, Dodixie, Rens, Hek) ---

function computeRegionalTradeManifests(
  checked: Set<MarketCategoryId>,
  snapshot: MarketSnapshot,
  profile: PilotProfile,
  catalog?: DynamicMarketCatalog,
  minDailyVolume = 20,
  sourceHubId: TradeHubId = 'jita',
  destHubId: TradeHubId = 'dodixie'
): ActionCardData[] {
  const effectiveSourceHubId = sourceHubId;
  const effectiveDestHubId = destHubId === sourceHubId ? (sourceHubId === 'jita' ? 'dodixie' : 'jita') : destHubId;
  const sourceHubDef = EMPIRE_HUB_MAP[effectiveSourceHubId];
  const destHubDef = EMPIRE_HUB_MAP[effectiveDestHubId];

  const fees = getEffectiveOrderFees(profile);
  const { executionMode, totalSellFeeRate, salesTaxPct, brokerFeePct } = fees;
  const sellFeeMult = 1 - totalSellFeeRate;
  const budgetCap = profile.activeCapitalCap;

  const activeItemMap = new Map<number, EveItem>();
  for (const baseItem of getItemsForCategories(Array.from(checked))) {
    activeItemMap.set(baseItem.typeId, baseItem);
  }
  if (catalog) {
    for (const catId of checked) {
      for (const sku of catalog.categories[catId] ?? []) {
        if (!activeItemMap.has(sku.typeId)) {
          activeItemMap.set(sku.typeId, {
            typeId: sku.typeId,
            name: sku.name,
            category: sku.category,
            volume: sku.volume > 0 ? sku.volume : 1.0,
            baseJitaSell: 0,
            baseJitaBuy: 0,
            baseDodixieSell: 0,
            baseDodixieBuy: 0,
            estDailyJitaVol: sku.estDailyJitaVol ?? 0,
            estDailyDodixieVol: sku.estDailyDodixieVol ?? 0,
          });
        }
      }
    }
  }
  const activeItems = Array.from(activeItemMap.values());

  const brCap = profile.hulls.find((h) => h.hullClass === 'blockade_runner')?.capacityM3 ?? 10200;
  const dstCap = profile.hulls.find((h) => h.hullClass === 'dst')?.capacityM3 ?? 62500;

  interface ManifestCandidate {
    typeId: number;
    name: string;
    category: MarketCategoryId;
    buyPrice: number;
    sellPrice: number;
    netUnitProfit: number;
    netMarginPct: number;
    roiPct: number;
    volumePerUnit: number;
    profitPerM3: number;
    safeMaxQty: number;
    depthDetail: string;
  }

  function buildManifest(
    direction: 'outbound' | 'backhaul',
    maxCargoM3: number,
    hullClass: HullClass,
    hullLabel: string
  ): ActionCardData | null {
    const fromHub = direction === 'outbound' ? sourceHubDef : destHubDef;
    const toHub = direction === 'outbound' ? destHubDef : sourceHubDef;
    const candidates: ManifestCandidate[] = [];

    for (const item of activeItems) {
      const liveQuote = snapshot.quotes[item.typeId];
      if (!ITEM_BY_ID[item.typeId] && (!liveQuote || liveQuote.source !== 'live')) {
        continue;
      }
      const q = liveQuote ?? getQuote(snapshot, item.typeId);
      const fromQuote = getHubQuote(q, fromHub.id, item);
      const toQuote = getHubQuote(q, toHub.id, item);

      const buyPrice = fromQuote.sellMin;
      const sellPrice = executionMode === 'instant_fill' ? toQuote.buyMax : toQuote.sellMin;
      if (buyPrice <= 0 || sellPrice <= 0) continue;

      const netUnitProfit = sellPrice * sellFeeMult - buyPrice;
      const roiPct = (netUnitProfit / buyPrice) * 100;
      const netMarginPct = (netUnitProfit / sellPrice) * 100;
      const minRoiThreshold = executionMode === 'instant_fill' ? 1.5 : 4.5;
      if (netUnitProfit <= 0 || roiPct < minRoiThreshold || roiPct > 450) continue;

      const minProfitableSellPrice = (buyPrice * 1.01) / Math.max(0.1, sellFeeMult);
      const fallbackVol =
        toHub.id === 'jita'
          ? q.estDailyJitaVol ?? item.estDailyJitaVol
          : toHub.id === 'dodixie'
            ? q.estDailyDodixieVol ?? item.estDailyDodixieVol
            : Math.max(10, Math.round((q.estDailyJitaVol ?? item.estDailyJitaVol) * toHub.volMultiplierFallback));

      const depth = getAbsorbableMarketDepth({
        hub: toQuote,
        fallbackDailyVol: fallbackVol,
        minProfitableSellPrice,
        executionMode,
      });

      if (minDailyVolume > 0 && depth.avgDailyVol7d < minDailyVolume) continue;
      if (depth.maxUnits <= 0) continue;

      candidates.push({
        typeId: item.typeId,
        name: item.name,
        category: item.category as MarketCategoryId,
        buyPrice,
        sellPrice,
        netUnitProfit,
        netMarginPct,
        roiPct,
        volumePerUnit: Math.max(0.001, item.volume),
        profitPerM3: netUnitProfit / Math.max(0.001, item.volume),
        safeMaxQty: depth.maxUnits,
        depthDetail: depth.detail,
      });
    }

    candidates.sort((a, b) =>
      hullClass === 'blockade_runner'
        ? b.profitPerM3 - a.profitPerM3
        : b.roiPct * Math.log10(b.safeMaxQty * b.buyPrice + 10) - a.roiPct * Math.log10(a.safeMaxQty * a.buyPrice + 10)
    );

    let remainingIsk = budgetCap;
    let remainingM3 = maxCargoM3;
    const packed: {
      item: ManifestCandidate;
      qty: number;
      cost: number;
      grossRev: number;
      vol: number;
      profit: number;
      buySlippagePct: number;
      sellSlippagePct: number;
      shortfallUnits: number;
      weightedBuyPrice: number;
      weightedSellPrice: number;
    }[] = [];

    for (const c of candidates) {
      if (remainingIsk < 5_000_000 || remainingM3 < 1) break;
      const skuBudget = Math.min(remainingIsk, budgetCap * 0.28);
      const maxByIsk = Math.floor(skuBudget / c.buyPrice);
      const maxByM3 = Math.floor(remainingM3 / c.volumePerUnit);
      const maxCandidateQty = Math.min(c.safeMaxQty, maxByIsk, maxByM3);
      if (maxCandidateQty <= 0) continue;

      const q = snapshot.quotes[c.typeId] ?? getQuote(snapshot, c.typeId);
      const fromQuote = getHubQuote(q, fromHub.id, ITEM_BY_ID[c.typeId]);
      const toQuote = getHubQuote(q, toHub.id, ITEM_BY_ID[c.typeId]);

      // Walk orderbook tiers to find optimal profitable quantity before orderbook thinning erodes net margin
      const optimalQty = findOptimalProfitableQty({
        buyHub: fromQuote,
        sellHub: toQuote,
        maxQty: maxCandidateQty,
        sellFeeRate: totalSellFeeRate,
        executionMode,
      });

      const qty = Math.max(0, Math.min(maxCandidateQty, optimalQty));
      if (qty <= 0) continue;

      const buyWalk = walkSellOrderbookForBuy(fromQuote, qty);
      const sellWalk: DepthWalkResult =
        executionMode === 'instant_fill'
          ? walkBuyOrderbookForSell(toQuote, qty)
          : {
              requestedQty: qty,
              filledQty: qty,
              shortfallQty: 0,
              weightedAvgPrice: c.sellPrice,
              topOfBookPrice: c.sellPrice,
              totalIsk: qty * c.sellPrice,
              slippagePct: 0,
              tiersUsed: 1,
              isThinDepth: false,
              sourceKind: 'live_book',
            };

      const cost = buyWalk.totalIsk > 0 ? buyWalk.totalIsk : qty * c.buyPrice;
      const grossRev = sellWalk.totalIsk > 0 ? sellWalk.totalIsk : qty * c.sellPrice;
      const vol = qty * c.volumePerUnit;
      const profit = grossRev * sellFeeMult - cost;
      if (profit < 350_000) continue;

      packed.push({
        item: c,
        qty,
        cost,
        grossRev,
        vol,
        profit,
        buySlippagePct: buyWalk.slippagePct,
        sellSlippagePct: sellWalk.slippagePct,
        shortfallUnits: buyWalk.shortfallQty + sellWalk.shortfallQty,
        weightedBuyPrice: buyWalk.weightedAvgPrice || c.buyPrice,
        weightedSellPrice: sellWalk.weightedAvgPrice || c.sellPrice,
      });
      remainingIsk -= cost;
      remainingM3 -= vol;
      if (packed.length >= 10) break;
    }

    if (packed.length === 0) return null;

    const totalCost = packed.reduce((s, p) => s + p.cost, 0);
    const totalGrossRev = packed.reduce((s, p) => s + p.grossRev, 0);
    const totalVol = packed.reduce((s, p) => s + p.vol, 0);
    const totalProfit = packed.reduce((s, p) => s + p.profit, 0);
    const totalQty = packed.reduce((s, p) => s + p.qty, 0);
    const totalDepthCapUnits = packed.reduce((s, p) => s + p.item.safeMaxQty, 0);
    const totalRoi = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
    const totalNetMargin = totalGrossRev > 0 ? (totalProfit / totalGrossRev) * 100 : 0;
    const avgBuySlippage =
      packed.reduce((s, p) => s + p.buySlippagePct * p.cost, 0) / Math.max(1, totalCost);
    const avgSellSlippage =
      packed.reduce((s, p) => s + p.sellSlippagePct * p.grossRev, 0) / Math.max(1, totalGrossRev);
    const totalShortfall = packed.reduce((s, p) => s + p.shortfallUnits, 0);

    const routeLabel = `${fromHub.shortName} -> ${toHub.shortName}`;

    return {
      id: `trade-${fromHub.id}-to-${toHub.id}-${hullClass}`,
      engine: 'regional_trade',
      engineLabel: `5-Hub Empire Trade (${direction === 'outbound' ? 'Outbound' : 'Backhaul'})`,
      title: `${routeLabel} · ${hullClass === 'blockade_runner' ? 'High-Value Express' : 'Bulk DST Manifest'}`,
      subtitle: `${packed.length} SKUs depth-walked on ${fromHub.shortName}→${toHub.shortName} books (${executionMode === 'instant_fill' ? 'Instant Fill' : 'List Orders'})`,
      categories: Array.from(new Set(packed.map((p) => p.item.category))),
      primaryTypeId: packed[0]?.item.typeId,
      primaryItemName: packed[0]?.item.name,
      stationAnchor: routeLabel,
      recommendedHull: hullLabel,
      hullClass,
      requiredCapitalIsk: totalCost,
      totalVolumeM3: totalVol,
      safeDailyQty: `${totalDepthCapUnits.toLocaleString('en-US')} units`,
      marketDepthUnits: totalDepthCapUnits,
      marketDepthDetail:
        executionMode === 'instant_fill'
          ? `Orderbook depth-walked @ ${toHub.shortName} buy tiers (avg drift ${avgSellSlippage.toFixed(1)}%)`
          : `Depth-walked buy side (+${avgBuySlippage.toFixed(1)}% drift) · max 25% 7d avg vol`,
      outputUnits: totalQty,
      perUnitNetProfitIsk: totalQty > 0 ? totalProfit / totalQty : 0,
      netProfitIsk: totalProfit,
      grossRevenueIsk: totalGrossRev,
      netMarginPct: totalNetMargin,
      roiPct: totalRoi,
      executionMode,
      salesTaxPct,
      brokerFeePct,
      destinationRegionId: toHub.regionId,
      riskLabel:
        totalShortfall > 0 || avgBuySlippage > 3.5 || (totalCost > 650_000_000 && hullClass !== 'blockade_runner')
          ? 'Watch Depth'
          : 'High Margin',
      // v2.1.0 Interactive Qty Slicer & Depth-Walk metadata
      isEditableQty: true,
      qtyUnitLabel: 'units',
      baseBatchQty: totalQty,
      optimalProfitableQty: totalQty,
      unitInputM3: totalQty > 0 ? totalVol / totalQty : 1,
      unitOutputM3: totalQty > 0 ? totalVol / totalQty : 1,
      sourceHubId: fromHub.id,
      destHubId: toHub.id,
      depthWalkBuy: {
        requestedQty: totalQty,
        filledQty: Math.max(0, totalQty - totalShortfall),
        shortfallQty: totalShortfall,
        weightedAvgPrice: totalQty > 0 ? totalCost / totalQty : 0,
        topOfBookPrice:
          totalQty > 0 ? packed.reduce((s, p) => s + p.item.buyPrice * p.qty, 0) / totalQty : 0,
        totalIsk: totalCost,
        slippagePct: avgBuySlippage,
        tiersUsed: packed.length,
        isThinDepth: avgBuySlippage > 3.5 || totalShortfall > 0,
        sourceKind: 'live_book',
      },
      depthWalkSell:
        executionMode === 'instant_fill'
          ? {
              requestedQty: totalQty,
              filledQty: Math.max(0, totalQty - totalShortfall),
              shortfallQty: totalShortfall,
              weightedAvgPrice: totalQty > 0 ? totalGrossRev / totalQty : 0,
              topOfBookPrice:
                totalQty > 0 ? packed.reduce((s, p) => s + p.item.sellPrice * p.qty, 0) / totalQty : 0,
              totalIsk: totalGrossRev,
              slippagePct: avgSellSlippage,
              tiersUsed: packed.length,
              isThinDepth: Math.abs(avgSellSlippage) > 3.5 || totalShortfall > 0,
              sourceKind: 'live_book',
            }
          : undefined,
      steps: [
        `Buy ${packed.length} depth-walked manifest lines at ${fromHub.stationName} totaling ${formatIsk(totalCost)} (${formatM3(totalVol)} / ${((totalVol / maxCargoM3) * 100).toFixed(0)}% hull fill).`,
        `Transit high-sec Empire corridor (${fromHub.shortName} -> ${toHub.shortName}) using ${
          hullClass === 'blockade_runner' ? 'covert cloak + MWD warp trick' : 'MWD + Cloak trick & gatecamp intel check'
        }.`,
        `${executionMode === 'instant_fill' ? 'Instant-sell into buy orders' : 'List sell orders'} at ${toHub.stationName} for ${formatIsk(totalProfit)} true after-tax profit (${totalNetMargin.toFixed(1)}% Net Margin · Tax ${salesTaxPct.toFixed(2)}%${brokerFeePct > 0 ? ` + Broker ${brokerFeePct.toFixed(2)}%` : ' · 0% Broker'}).`,
      ],
      inspection: {
        summaryText: `5-Hub Empire Trade manifest (${fromHub.shortName} -> ${toHub.shortName}) using tier-by-tier orderbook depth walking (Buy drift ${avgBuySlippage >= 0 ? '+' : ''}${avgBuySlippage.toFixed(2)}%, Sell drift ${avgSellSlippage.toFixed(2)}%).`,
        columns: [
          { key: 'item', label: 'SKU', align: 'left' },
          { key: 'qty', label: 'Qty', align: 'right' },
          { key: 'buy', label: `${fromHub.shortName} Avg Buy`, align: 'right' },
          {
            key: 'sell',
            label:
              executionMode === 'instant_fill'
                ? `${toHub.shortName} Avg Bid`
                : `${toHub.shortName} Sell`,
            align: 'right',
          },
          { key: 'vol', label: 'Volume', align: 'right' },
          { key: 'profit', label: 'Net Profit', align: 'right' },
          { key: 'roi', label: 'ROI', align: 'right' },
        ],
        rows: packed.map((p) => ({
          _typeId: p.item.typeId,
          _itemName: p.item.name,
          item: p.item.name,
          qty: p.qty.toLocaleString('en-US'),
          buy: formatIsk(p.weightedBuyPrice, false),
          sell: formatIsk(p.weightedSellPrice, false),
          vol: formatM3(p.vol),
          profit: formatIsk(p.profit),
          roi: formatPct((p.profit / Math.max(1, p.cost)) * 100),
        })),
      },
      routeChains: [
        {
          cardId: `trade-${fromHub.id}-to-${toHub.id}-${hullClass}`,
          cardTitle: `${routeLabel} · ${hullClass === 'blockade_runner' ? 'Express' : 'DST'}`,
          legs: [
            {
              action: 'buy',
              systemId: fromHub.systemId,
              systemName: fromHub.systemName,
              stationId: fromHub.stationId,
              stationName: fromHub.stationName,
              items: packed.map((p) => ({
                typeId: p.item.typeId,
                name: p.item.name,
                quantity: p.qty,
                iskAmount: p.cost,
                volumeM3: p.vol,
              })),
              cargoDeltaM3: totalVol,
              iskCost: totalCost,
            },
            {
              action: 'sell',
              systemId: toHub.systemId,
              systemName: toHub.systemName,
              stationId: toHub.stationId,
              stationName: toHub.stationName,
              items: packed.map((p) => ({
                typeId: p.item.typeId,
                name: p.item.name,
                quantity: p.qty,
                iskAmount: p.cost + p.profit,
                volumeM3: p.vol,
              })),
              cargoDeltaM3: -totalVol,
              iskPayout: totalCost + totalProfit,
              netProfitIsk: totalProfit,
            },
          ],
        },
      ],
    };
  }

  const cards: ActionCardData[] = [];
  const brOutbound = buildManifest('outbound', brCap, 'blockade_runner', `Crane Blockade Runner (${formatM3(brCap)})`);
  const dstOutbound = buildManifest('outbound', dstCap, 'dst', `Bustard DST (${formatM3(dstCap)})`);
  const backhaul = buildManifest('backhaul', dstCap, 'dst', `Bustard DST (${formatM3(dstCap)})`);

  if (brOutbound) cards.push(brOutbound);
  if (dstOutbound) cards.push(dstOutbound);
  if (backhaul) cards.push(backhaul);

  return cards;
}

// --- Engine 5: PI Factory Planet Evaluator (Default NPC POCO Tax) ---

function computePiFactoryEvaluator(
  checked: Set<MarketCategoryId>,
  snapshot: MarketSnapshot,
  profile: PilotProfile
): ActionCardData[] {
  if (!checked.has('pi_p0_p1') && !checked.has('pi_p2_p4')) {
    return [];
  }

  const fees = getEffectiveOrderFees(profile);
  const { executionMode, totalSellFeeRate, salesTaxPct, brokerFeePct } = fees;
  const importTaxRate = profile.pocoImportTaxPct / 100;
  const exportTaxRate = profile.pocoExportTaxPct / 100;

  const cards: ActionCardData[] = [];

  for (const sch of PI_SCHEMATICS) {
    if (!sch.categories.some((c) => checked.has(c))) continue;

    const outItem = ITEM_BY_ID[sch.outputTypeId];
    if (!outItem) continue;
    const outQuote = getQuote(snapshot, sch.outputTypeId);

    const days = 7;
    const totalCycles = sch.factoriesPerPlanet * sch.cyclesPerDayPerFactory * days;
    const totalOutputUnits = totalCycles * sch.outputQtyPerCycle;

    const exportTaxIsk = (outItem.piBaseValue ?? 7200) * exportTaxRate * totalOutputUnits;

    let totalInputBuyCost = 0;
    let totalImportTaxIsk = 0;
    let totalInputVolume = 0;

    const rows: { _typeId?: number; _itemName?: string; [k: string]: string | number | undefined }[] = [];

    for (const inp of sch.inputs) {
      const inpItem = ITEM_BY_ID[inp.typeId];
      const inpQuote = getQuote(snapshot, inp.typeId);
      const totalQty = totalCycles * inp.quantity;
      const buyCost = totalQty * inpQuote.jita.sellMin;
      const importTax = (inpItem?.piBaseValue ?? 400) * 0.5 * importTaxRate * totalQty;
      const vol = totalQty * (inpItem?.volume ?? 0.38);

      totalInputBuyCost += buyCost;
      totalImportTaxIsk += importTax;
      totalInputVolume += vol;

      rows.push({
        _typeId: inp.typeId,
        _itemName: inpItem?.name ?? `Type ${inp.typeId}`,
        material: inpItem?.name ?? `Type ${inp.typeId}`,
        role: 'Input (Import)',
        weeklyQty: totalQty.toLocaleString('en-US'),
        unitPrice: formatIsk(inpQuote.jita.sellMin, false),
        pocoTax: formatIsk(importTax),
        volume: formatM3(vol),
      });
    }

    const totalOutputVolume = totalOutputUnits * outItem.volume;
    const totalCapital = totalInputBuyCost + totalImportTaxIsk + exportTaxIsk;
    const outUnitSellPrice =
      executionMode === 'instant_fill' ? outQuote.jita.buyMax : outQuote.jita.sellMin;
    const rawGrossRevenue = totalOutputUnits * outUnitSellPrice;
    const grossRevenue = rawGrossRevenue * (1 - totalSellFeeRate);
    const netProfitWeekly = grossRevenue - totalCapital;
    const roiPct = totalCapital > 0 ? (netProfitWeekly / totalCapital) * 100 : 0;
    const netMarginPct = rawGrossRevenue > 0 ? (netProfitWeekly / rawGrossRevenue) * 100 : 0;

    const unitCostPi = totalCapital / Math.max(1, totalOutputUnits);
    const piDepth = getAbsorbableMarketDepth({
      hub: outQuote.jita,
      fallbackDailyVol: outQuote.estDailyJitaVol ?? outItem.estDailyJitaVol,
      minProfitableSellPrice: unitCostPi / Math.max(0.1, 1 - totalSellFeeRate),
      executionMode,
    });

    const maxHaulVol = Math.max(totalInputVolume, totalOutputVolume);
    const hull = pickHull(maxHaulVol, totalCapital, profile);

    rows.push({
      _typeId: outItem.typeId,
      _itemName: outItem.name,
      material: outItem.name,
      role: 'Output (Export)',
      weeklyQty: totalOutputUnits.toLocaleString('en-US'),
      unitPrice: formatIsk(outUnitSellPrice, false),
      pocoTax: formatIsk(exportTaxIsk),
      volume: formatM3(totalOutputVolume),
    });

    cards.push({
      id: `pi-${sch.id}`,
      engine: 'pi_factory',
      engineLabel: `PI Factory Planet (${sch.tierStep})`,
      title: `${sch.outputName} Factory Planet (7-Day Cycle)`,
      subtitle: `${sch.factoriesPerPlanet} facilities · NPC POCO ${profile.pocoImportTaxPct}% Imp / ${profile.pocoExportTaxPct}% Exp`,
      categories: sch.categories,
      primaryTypeId: outItem.typeId,
      primaryItemName: outItem.name,
      stationAnchor: 'High-Sec Factory Planet -> Jita 4-4',
      recommendedHull: hull.label,
      hullClass: hull.hullClass,
      requiredCapitalIsk: totalCapital,
      totalVolumeM3: maxHaulVol,
      safeDailyQty: `${piDepth.maxUnits.toLocaleString('en-US')} units`,
      marketDepthUnits: piDepth.maxUnits,
      marketDepthDetail: piDepth.detail,
      outputUnits: totalOutputUnits,
      perUnitNetProfitIsk: totalOutputUnits > 0 ? netProfitWeekly / totalOutputUnits : 0,
      netProfitIsk: netProfitWeekly,
      grossRevenueIsk: rawGrossRevenue,
      netMarginPct,
      roiPct,
      executionMode,
      salesTaxPct,
      brokerFeePct,
      destinationRegionId: EVE_ANCHORS.THE_FORGE_REGION_ID,
      riskLabel: netProfitWeekly > 0 ? (roiPct >= 10 ? 'High Margin' : 'Nominal') : 'Watch Depth',
      steps: [
        `Purchase 7-day input feedstock in Jita 4-4 (${formatIsk(totalInputBuyCost)}, ${formatM3(totalInputVolume)}).`,
        `Import via high-sec NPC POCO (${profile.pocoImportTaxPct}% import rate -> ${formatIsk(totalImportTaxIsk)} tax) into ${sch.factoriesPerPlanet}× ${sch.tierStep} factories.`,
        `Export ${totalOutputUnits.toLocaleString('en-US')}× ${sch.outputName} (${formatM3(totalOutputVolume)}, ${formatIsk(exportTaxIsk)} export tax) and ${executionMode === 'instant_fill' ? 'instant-sell' : 'list sell orders'} in Jita 4-4 for ${formatIsk(netProfitWeekly)}/week net (Sales Tax ${salesTaxPct.toFixed(2)}%${brokerFeePct > 0 ? ` + Broker ${brokerFeePct.toFixed(2)}%` : ' · 0% Broker'}).`,
      ],
      inspection: {
        summaryText: `7-day factory planet model with ${sch.factoriesPerPlanet} active facilities. Total NPC POCO tax burden: ${formatIsk(
          totalImportTaxIsk + exportTaxIsk
        )} (Import ${profile.pocoImportTaxPct}% @ 50% CCP base + Export ${profile.pocoExportTaxPct}% @ 100% CCP base). Daily net: ${formatIsk(netProfitWeekly / 7)}/day.`,
        columns: [
          { key: 'material', label: 'Commodity', align: 'left' },
          { key: 'role', label: 'Flow', align: 'left' },
          { key: 'weeklyQty', label: '7-Day Qty', align: 'right' },
          { key: 'unitPrice', label: 'Jita Unit', align: 'right' },
          { key: 'pocoTax', label: 'NPC POCO Tax', align: 'right' },
          { key: 'volume', label: 'Volume', align: 'right' },
        ],
        rows,
      },
      routeChains: [
        {
          cardId: `pi-${sch.id}`,
          cardTitle: `${sch.outputName} PI Factory`,
          legs: [
            {
              action: 'buy',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: sch.inputs.map((inp) => {
                const inpItem = ITEM_BY_ID[inp.typeId];
                const inpQuote = getQuote(snapshot, inp.typeId);
                const totalQty = totalCycles * inp.quantity;
                return {
                  typeId: inp.typeId,
                  name: inpItem?.name ?? `Type ${inp.typeId}`,
                  quantity: totalQty,
                  iskAmount: totalQty * inpQuote.jita.sellMin,
                  volumeM3: totalQty * (inpItem?.volume ?? 0.38),
                };
              }),
              cargoDeltaM3: totalInputVolume,
              iskCost: totalInputBuyCost,
            },
            {
              action: 'process',
              systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
              systemName: EVE_ANCHORS.ISHISOMO_SYSTEM_NAME,
              stationName: 'Ishisomo High-Sec PI POCO Colony',
              items: sch.inputs.map((inp) => {
                const inpItem = ITEM_BY_ID[inp.typeId];
                const totalQty = totalCycles * inp.quantity;
                return {
                  typeId: inp.typeId,
                  name: inpItem?.name ?? `Type ${inp.typeId}`,
                  quantity: totalQty,
                  iskAmount: 0,
                  volumeM3: totalQty * (inpItem?.volume ?? 0.38),
                };
              }),
              cargoDeltaM3: totalOutputVolume - totalInputVolume,
              processNote: `Import inputs & export ${totalOutputUnits.toLocaleString('en-US')}× ${sch.outputName} (POCO tax ${formatIsk(totalImportTaxIsk + exportTaxIsk)})`,
            },
            {
              action: 'sell',
              systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
              systemName: 'Jita',
              stationId: EVE_ANCHORS.JITA_STATION_ID,
              stationName: EVE_ANCHORS.JITA_STATION_NAME,
              items: [
                {
                  typeId: outItem.typeId,
                  name: outItem.name,
                  quantity: totalOutputUnits,
                  iskAmount: grossRevenue,
                  volumeM3: totalOutputVolume,
                },
              ],
              cargoDeltaM3: -totalOutputVolume,
              iskPayout: grossRevenue,
              netProfitIsk: netProfitWeekly,
            },
          ],
        },
      ],
    });
  }

  cards.sort((a, b) => b.netProfitIsk - a.netProfitIsk);
  return cards;
}

// --- Master Orchestrator ---

export function runAllDecisionEngines(
  checkedCategories: MarketCategoryId[],
  snapshot: MarketSnapshot,
  profile: PilotProfile,
  options?: {
    catalog?: DynamicMarketCatalog;
    minDailyVolume?: number;
    sourceHub?: TradeHubId;
    destHub?: TradeHubId;
    structureConfig?: IndustryStructureConfig;
    industryCosts?: IndustryCostSnapshot;
    appSettings?: AppSettingsV22;
  }
): EngineBundle {
  const checkedSet = new Set(checkedCategories);
  const activeTrackedItemCount = options?.catalog
    ? checkedCategories.reduce(
        (sum, catId) => sum + (options.catalog?.categories[catId]?.length ?? 0),
        0
      )
    : getItemsForCategories(checkedCategories).length;

  if (checkedCategories.length === 0) {
    return {
      cards: [],
      consolidatedShoppingList: [],
      shoppingListTotalIsk: 0,
      shoppingListTotalM3: 0,
      shoppingListOneJumpSavingsIsk: 0,
      activeTrackedItemCount: 0,
    };
  }

  const indy = computeIndyAndInvention(
    checkedSet,
    snapshot,
    profile,
    options?.structureConfig ?? DEFAULT_INDUSTRY_STRUCTURE_CONFIG,
    options?.industryCosts
  );
  const reproc = computeReprocessingArbitrage(checkedSet, snapshot, profile, indy.mineralDemand);
  const corridor = computeCorridorArbitrage(checkedSet, snapshot, profile);
  const trade = computeRegionalTradeManifests(
    checkedSet,
    snapshot,
    profile,
    options?.catalog,
    options?.minDailyVolume ?? 20,
    options?.sourceHub ?? 'jita',
    options?.destHub ?? 'dodixie'
  );
  const pi = computePiFactoryEvaluator(checkedSet, snapshot, profile);

  const rawCards = attachActiveOrderConflicts(
    [...indy.cards, ...reproc, ...corridor, ...trade, ...pi],
    profile.activeOrders
  );

  // Enrich every card with v2.2.0 standing-adjusted broker fee telemetry, multi-period trend ribbon, and universal Qty override support
  const cards = rawCards.map((card) => {
    const destHubId: TradeHubId =
      card.destHubId ??
      resolveHubIdFromSystemOrRegion(
        card.routeChains?.[0]?.legs.find((l) => l.action === 'sell')?.systemId,
        card.destinationRegionId
      );

    const exactFees = getEffectiveOrderFees(profile, {
      hubId: destHubId,
      appSettings: options?.appSettings,
      executionModeOverride: card.executionMode,
    });

    // Adjust net profit delta when exact NPC standing / Upwell+SCC broker rate differs from baseline skill-only broker rate
    const baselineBrokerRate = card.brokerFeePct / 100;
    const brokerDeltaRate = exactFees.brokerFeeRate - baselineBrokerRate;
    const feeDeltaIsk =
      card.executionMode === 'list_orders' && card.grossRevenueIsk > 0
        ? card.grossRevenueIsk * brokerDeltaRate
        : 0;
    const adjustedNetProfit = card.netProfitIsk - feeDeltaIsk;
    const adjustedMarginPct =
      card.grossRevenueIsk > 0 ? (adjustedNetProfit / card.grossRevenueIsk) * 100 : card.netMarginPct;
    const adjustedRoiPct =
      card.requiredCapitalIsk > 0 ? (adjustedNetProfit / card.requiredCapitalIsk) * 100 : card.roiPct;
    const adjustedPerUnit =
      card.outputUnits > 0 ? adjustedNetProfit / card.outputUnits : card.perUnitNetProfitIsk;

    const quote = card.primaryTypeId ? snapshot.quotes[card.primaryTypeId] : undefined;
    const hubQ = quote ? getHubQuote(quote, destHubId, card.primaryTypeId ? ITEM_BY_ID[card.primaryTypeId] : undefined) : undefined;
    const trend = deriveQuickMultiPeriodTrend(card.primaryTypeId ?? 34, hubQ);

    return {
      ...card,
      destHubId,
      brokerFeePct: exactFees.brokerFeePct,
      standingBrokerNote: exactFees.standingBrokerNote,
      netProfitIsk: adjustedNetProfit,
      netMarginPct: adjustedMarginPct,
      roiPct: adjustedRoiPct,
      perUnitNetProfitIsk: adjustedPerUnit,
      buyAllProfitIsk:
        typeof card.buyAllProfitIsk === 'number'
          ? card.buyAllProfitIsk - feeDeltaIsk
          : adjustedNetProfit,
      buyMissingProfitIsk:
        typeof card.buyMissingProfitIsk === 'number'
          ? card.buyMissingProfitIsk - feeDeltaIsk
          : card.buyMissingProfitIsk,
      isEditableQty: true,
      baseBatchQty: Math.max(1, Math.round(card.baseBatchQty ?? card.outputUnits ?? 1)),
      optimalProfitableQty: Math.max(
        1,
        Math.round(card.optimalProfitableQty ?? card.baseBatchQty ?? card.outputUnits ?? 1)
      ),
      qtyUnitLabel:
        card.qtyUnitLabel ?? (card.engine === 'indy_invention' ? 'runs' : 'units'),
      multiPeriodTrend: trend,
    };
  });

  const shoppingListTotalIsk = indy.shoppingList.reduce((s, l) => s + l.totalCostJita, 0);
  const shoppingListTotalM3 = indy.shoppingList.reduce((s, l) => s + l.volumeM3, 0);
  const shoppingListOneJumpSavingsIsk = indy.shoppingList.reduce(
    (s, l) => s + (l.cheaperNearby?.savingsIsk ?? 0),
    0
  );

  return {
    cards,
    consolidatedShoppingList: indy.shoppingList,
    shoppingListTotalIsk,
    shoppingListTotalM3,
    shoppingListOneJumpSavingsIsk,
    activeTrackedItemCount,
  };
}
