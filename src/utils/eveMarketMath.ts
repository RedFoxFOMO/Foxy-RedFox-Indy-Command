// Canonical v2.1.0 EVE Online Market Depth, 4-Sig-Fig Tick, Relist Fee,
// Blueprint Concurrency Time, Virtual Hangar Ledger, Hauler Fit & Quantitative Projection Engine.

import { ITEM_BY_ID } from '../data/eveCatalog.ts';
import type {
  ActionCardData,
  BuildQueueEntry,
  DepthWalkResult,
  GlobalMultibuyMaterial,
  HangarHull,
  HangarStockEntry,
  HaulerFitModule,
  HaulerFitSuggestion,
  HubQuote,
  IndustryStructureConfig,
  MarketHistoryDay,
  MarketSnapshot,
  OrderBookLevel,
  PilotProfile,
  PriceProjectionAnalysis,
  RelistFeePreview,
  VirtualHangarMaterialRow,
  VirtualHangarSlotAllocation,
} from '../types/eve.ts';

export const EVE_USER_AGENT =
  'Foxy-RedFox-Indy-Command/2.2.0 (+https://github.com/RedFoxFOMO/Foxy-RedFox-Indy-Command)';
export const ESI_COMPAT_DATE = '2026-08-18';

// --- 1. Exact EVE Online 4-Significant-Figure Tick Math ---

/**
 * Computes the exact next valid EVE Online 4-significant-figure price tick.
 * Handles power-of-10 boundaries cleanly:
 * - undercut_sell(1_000_000) -> 999_900 (NOT 999_000 and NOT 999_999.99)
 * - undercut_sell(99.99)     -> 99.98
 * - undercut_sell(100)       -> 99.99
 * - outbid_buy(999_900)      -> 1_000_000
 * - outbid_buy(1_000_000)    -> 1_001_000
 */
export function computeEve4SigFigTick(
  price: number,
  direction: 'undercut_sell' | 'outbid_buy'
): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  if (price <= 0.01 && direction === 'undercut_sell') return 0.01;

  // Normalize to 2 decimal places (EVE minimum ISK precision is 0.01)
  const p = Math.round(price * 100) / 100;
  const log10 = Math.log10(p);
  let magnitude = Math.floor(log10 + 1e-12);

  // Power-of-10 boundary check when stepping DOWN:
  // At 1,000,000 (10^6), stepping below crosses into the 999,xxx decade where tick size is 10^(6-4) = 100.
  const exactPowerOf10 = Math.pow(10, magnitude);
  if (
    direction === 'undercut_sell' &&
    Math.abs(p - exactPowerOf10) <= Math.max(0.005, exactPowerOf10 * 1e-9)
  ) {
    magnitude -= 1;
  }

  const step = Math.max(0.01, Math.pow(10, magnitude - 3));

  // Snap base to valid 4-sig-fig grid first, then step by 1 tick
  const snapped =
    direction === 'undercut_sell'
      ? Math.ceil(p / step - 1e-9) * step - step
      : Math.floor(p / step + 1e-9) * step + step;

  return Math.max(0.01, Number(snapped.toFixed(2)));
}

/**
 * Exact EVE Online order modification / relist fee preview:
 * - Broker Relations (3446): 3.0% - 0.3%/lvl (1.5% at V)
 * - Advanced Broker Relations (3447): 50% base discount + 6%/lvl (80% discount at V -> pay 20% of broker fee)
 * - Minimum modification fee is 100 ISK per EVE rules.
 */
export function computeRelistFeePreview(params: {
  oldPrice: number;
  newPrice: number;
  volumeRemain: number;
  isBuyOrder: boolean;
  brokerRelationsLvl: number;
  advBrokerRelationsLvl: number;
  accountingLvl: number;
  unitCostBasis?: number;
}): RelistFeePreview {
  const {
    oldPrice,
    newPrice,
    volumeRemain,
    isBuyOrder,
    brokerRelationsLvl,
    advBrokerRelationsLvl,
    accountingLvl,
    unitCostBasis,
  } = params;

  const brLvl = Math.max(0, Math.min(5, Math.floor(brokerRelationsLvl)));
  const abrLvl = Math.max(0, Math.min(5, Math.floor(advBrokerRelationsLvl)));
  const accLvl = Math.max(0, Math.min(5, Math.floor(accountingLvl)));

  const brokerRate = Math.max(0, 0.03 - 0.003 * brLvl);
  const relistDiscountRate = Math.min(0.8, 0.5 + 0.06 * abrLvl);
  const relistRate = brokerRate * (1 - relistDiscountRate);

  const oldOrderValue = Math.max(0, oldPrice * volumeRemain);
  const newOrderValue = Math.max(0, newPrice * volumeRemain);
  const upwardDeltaValue = Math.max(0, newOrderValue - oldOrderValue);

  // EVE formula: relist fee on full modified order + incremental broker fee on any upward value increase, min 100 ISK
  const rawFee = newOrderValue * relistRate + upwardDeltaValue * brokerRate;
  const modificationFeeIsk = Math.max(100, Number(rawFee.toFixed(2)));

  const salesTaxRate = 0.075 * (1 - 0.11 * accLvl);
  let estimatedNetMarginPct: number | null = null;
  let unprofitableWarning = false;
  let warningReason: string | undefined;

  if (typeof unitCostBasis === 'number' && unitCostBasis > 0 && newPrice > 0 && volumeRemain > 0) {
    const feePerUnit = modificationFeeIsk / volumeRemain;
    if (!isBuyOrder) {
      const netSalePerUnit = newPrice * (1 - salesTaxRate) - feePerUnit;
      const netProfitPerUnit = netSalePerUnit - unitCostBasis;
      estimatedNetMarginPct = Number(((netProfitPerUnit / newPrice) * 100).toFixed(2));
      if (netProfitPerUnit <= 0) {
        unprofitableWarning = true;
        warningReason = `Relisting at ${newPrice.toLocaleString('en-US')} ISK drops net margin to ${estimatedNetMarginPct}% (below cost basis + ${Math.round(modificationFeeIsk).toLocaleString('en-US')} ISK relist fee).`;
      }
    } else {
      // For a buy order, cost basis represents target resale price
      const netSpread = unitCostBasis * (1 - salesTaxRate - brokerRate) - (newPrice + feePerUnit);
      estimatedNetMarginPct = Number(((netSpread / Math.max(0.01, unitCostBasis)) * 100).toFixed(2));
      if (netSpread <= 0) {
        unprofitableWarning = true;
        warningReason = `Outbidding to ${newPrice.toLocaleString('en-US')} ISK + relist fee eliminates resale spread.`;
      }
    }
  } else if (newOrderValue > 0 && modificationFeeIsk / newOrderValue > 0.03) {
    unprofitableWarning = true;
    warningReason = `Relist fee (${Math.round(modificationFeeIsk).toLocaleString('en-US')} ISK) exceeds 3% of remaining order value.`;
  }

  return {
    oldPrice,
    newPrice,
    tickDelta: Number((newPrice - oldPrice).toFixed(2)),
    brokerFeePct: Number((brokerRate * 100).toFixed(2)),
    relistDiscountPct: Number((relistDiscountRate * 100).toFixed(0)),
    modificationFeeIsk,
    newOrderValueIsk: newOrderValue,
    estimatedNetMarginPct,
    unprofitableWarning,
    warningReason,
  };
}

// --- 2. Orderbook Depth-Walking Cost & Revenue Engine ---

function synthesizeSellLevels(hub: HubQuote): OrderBookLevel[] {
  const top = hub.sellMin > 0 ? hub.sellMin : hub.sellPercentile;
  if (top <= 0) return [];
  const pctl = hub.sellPercentile > top ? hub.sellPercentile : top * 1.018;
  const totalVol = Math.max(10, Math.round(hub.sellVolume || 250));
  return [
    { price: top, volume: Math.max(1, Math.round(totalVol * 0.14)) },
    { price: Number(((top + pctl) / 2).toFixed(2)), volume: Math.max(1, Math.round(totalVol * 0.24)) },
    { price: Number(pctl.toFixed(2)), volume: Math.max(1, Math.round(totalVol * 0.34)) },
    { price: Number((pctl * 1.045).toFixed(2)), volume: Math.max(1, Math.round(totalVol * 0.28)) },
  ];
}

function synthesizeBuyLevels(hub: HubQuote): OrderBookLevel[] {
  const top = hub.buyMax > 0 ? hub.buyMax : hub.buyPercentile;
  if (top <= 0) return [];
  const pctl = hub.buyPercentile > 0 && hub.buyPercentile < top ? hub.buyPercentile : top * 0.982;
  const totalVol = Math.max(10, Math.round(hub.topBuyDepthUnits || hub.buyVolume * 0.35 || 200));
  return [
    { price: top, volume: Math.max(1, Math.round(totalVol * 0.18)), minVolume: 1 },
    { price: Number(((top + pctl) / 2).toFixed(2)), volume: Math.max(1, Math.round(totalVol * 0.27)), minVolume: 1 },
    { price: Number(pctl.toFixed(2)), volume: Math.max(1, Math.round(totalVol * 0.32)), minVolume: 1 },
    { price: Number((pctl * 0.94).toFixed(2)), volume: Math.max(1, Math.round(totalVol * 0.23)), minVolume: 1 },
  ];
}

/**
 * Walks ascending hub sell orders tier-by-tier for `targetQty` units.
 */
export function walkSellOrderbookForBuy(
  hub: HubQuote,
  targetQty: number
): DepthWalkResult {
  const reqQty = Math.max(1, Math.ceil(targetQty));
  const hasLiveBook = Array.isArray(hub.sellLevels) && hub.sellLevels.length > 0;
  const levels = hasLiveBook
    ? [...hub.sellLevels!].filter((l) => l.price > 0 && l.volume > 0).sort((a, b) => a.price - b.price)
    : synthesizeSellLevels(hub);

  const topOfBookPrice = levels[0]?.price ?? Math.max(0, hub.sellMin);
  if (levels.length === 0 || topOfBookPrice <= 0) {
    return {
      requestedQty: reqQty,
      filledQty: 0,
      shortfallQty: reqQty,
      topOfBookPrice: 0,
      weightedAvgPrice: 0,
      totalIsk: 0,
      slippagePct: 0,
      tiersUsed: 0,
      isThinDepth: true,
      sourceKind: hasLiveBook ? 'live_book' : 'synthesized_curve',
    };
  }

  let remaining = reqQty;
  let filledQty = 0;
  let totalIsk = 0;
  let tiersUsed = 0;

  for (const lvl of levels) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, lvl.volume);
    if (take <= 0) continue;
    totalIsk += take * lvl.price;
    filledQty += take;
    remaining -= take;
    tiersUsed += 1;
  }

  const shortfallQty = Math.max(0, remaining);
  const weightedAvgPrice = filledQty > 0 ? totalIsk / filledQty : topOfBookPrice;
  const slippagePct =
    topOfBookPrice > 0 ? ((weightedAvgPrice - topOfBookPrice) / topOfBookPrice) * 100 : 0;

  return {
    requestedQty: reqQty,
    filledQty,
    shortfallQty,
    topOfBookPrice,
    weightedAvgPrice,
    totalIsk,
    slippagePct: Number(slippagePct.toFixed(2)),
    tiersUsed,
    isThinDepth: shortfallQty > 0 || slippagePct >= 2.5,
    sourceKind: hasLiveBook ? 'live_book' : 'synthesized_curve',
  };
}

/**
 * Walks descending hub buy orders tier-by-tier (respecting minVolume & volume_remain)
 * for instant-selling `targetQty` units.
 */
export function walkBuyOrderbookForSell(
  hub: HubQuote,
  targetQty: number
): DepthWalkResult {
  const reqQty = Math.max(1, Math.ceil(targetQty));
  const hasLiveBook = Array.isArray(hub.buyLevels) && hub.buyLevels.length > 0;
  const levels = hasLiveBook
    ? [...hub.buyLevels!].filter((l) => l.price > 0 && l.volume > 0).sort((a, b) => b.price - a.price)
    : synthesizeBuyLevels(hub);

  const topOfBookPrice = levels[0]?.price ?? Math.max(0, hub.buyMax);
  if (levels.length === 0 || topOfBookPrice <= 0) {
    return {
      requestedQty: reqQty,
      filledQty: 0,
      shortfallQty: reqQty,
      topOfBookPrice: 0,
      weightedAvgPrice: 0,
      totalIsk: 0,
      slippagePct: 0,
      tiersUsed: 0,
      isThinDepth: true,
      sourceKind: hasLiveBook ? 'live_book' : 'synthesized_curve',
    };
  }

  let remaining = reqQty;
  let filledQty = 0;
  let totalIsk = 0;
  let tiersUsed = 0;

  for (const lvl of levels) {
    if (remaining <= 0) break;
    const minVol = Math.max(1, lvl.minVolume ?? 1);
    if (remaining < minVol) continue;
    const take = Math.min(remaining, lvl.volume);
    if (take < minVol) continue;
    totalIsk += take * lvl.price;
    filledQty += take;
    remaining -= take;
    tiersUsed += 1;
  }

  const shortfallQty = Math.max(0, remaining);
  const weightedAvgPrice = filledQty > 0 ? totalIsk / filledQty : topOfBookPrice;
  const slippagePct =
    topOfBookPrice > 0 ? ((topOfBookPrice - weightedAvgPrice) / topOfBookPrice) * 100 : 0;

  return {
    requestedQty: reqQty,
    filledQty,
    shortfallQty,
    topOfBookPrice,
    weightedAvgPrice,
    totalIsk,
    slippagePct: Number(slippagePct.toFixed(2)),
    tiersUsed,
    isThinDepth: shortfallQty > 0 || slippagePct >= 2.5,
    sourceKind: hasLiveBook ? 'live_book' : 'synthesized_curve',
  };
}

/**
 * Finds the optimal profitable quantity before orderbook thinning erodes unit net margin below zero.
 */
export function findOptimalProfitableQty(params: {
  buyHub: HubQuote;
  sellHub: HubQuote;
  executionMode: 'list_orders' | 'instant_fill';
  sellFeeRate: number;
  maxQty: number;
}): number {
  const { buyHub, sellHub, executionMode, sellFeeRate, maxQty } = params;
  const cap = Math.max(1, Math.floor(maxQty));
  const netMult = Math.max(0.05, 1 - sellFeeRate);

  const sellSidePrice = executionMode === 'instant_fill' ? sellHub.buyMax : sellHub.sellMin;
  if (sellSidePrice <= 0 || buyHub.sellMin <= 0) return 1;

  // Test logarithmically + linearly spaced candidate quantities to find the exact marginal-profit peak
  const probes = new Set<number>([1, cap]);
  const steps = 16;
  for (let i = 1; i < steps; i++) {
    probes.add(Math.max(1, Math.round((cap * i) / steps)));
  }
  const sortedProbes = Array.from(probes).sort((a, b) => a - b);

  let bestQty = 1;
  let bestProfit = -Infinity;

  for (const qty of sortedProbes) {
    const buyWalk = walkSellOrderbookForBuy(buyHub, qty);
    if (buyWalk.filledQty === 0) continue;
    const effectiveQty = buyWalk.filledQty;

    let netRev = 0;
    if (executionMode === 'instant_fill') {
      const sellWalk = walkBuyOrderbookForSell(sellHub, effectiveQty);
      if (sellWalk.filledQty < effectiveQty * 0.95) continue;
      netRev = sellWalk.totalIsk * netMult;
    } else {
      netRev = effectiveQty * sellSidePrice * netMult;
    }

    const profit = netRev - buyWalk.totalIsk;
    if (profit > bestProfit) {
      bestProfit = profit;
      bestQty = effectiveQty;
    }
  }

  return Math.max(1, bestQty);
}

// --- 3. Skill- & Structure-Specific Blueprint Time & Multi-Slot Concurrency Planner ---

export function getMaxIndustrySlots(profile: PilotProfile): {
  mfgSlotsMax: number;
  sciSlotsMax: number;
  reactionSlotsMax: number;
  mfgActive: number;
  mfgAvailable: number;
} {
  const mfgSlotsMax =
    1 + (profile.skills.massProduction ?? 5) + (profile.skills.advancedMassProduction ?? 4);
  const sciSlotsMax =
    1 +
    (profile.skills.laboratoryOperation ?? 5) +
    (profile.skills.advancedLaboratoryOperation ?? 4);
  const reactionSlotsMax = 1 + (profile.skills.reactions ?? 4);
  const activeJobs = (profile.industryJobs ?? []).filter((j) => j.status === 'active');
  const mfgActive = activeJobs.filter((j) => j.activityId === 1).length;
  const mfgAvailable = Math.max(1, mfgSlotsMax - mfgActive);

  return { mfgSlotsMax, sciSlotsMax, reactionSlotsMax, mfgActive, mfgAvailable };
}

export function formatDurationCompact(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0m';
  const secs = Math.round(totalSeconds);
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

export function computeBlueprintBuildTime(params: {
  baseRunDurationSec: number;
  runs: number;
  bpTe: number;
  industryLvl: number;
  advIndustryLvl: number;
  reactionsLvl: number;
  isReaction: boolean;
  structureConfig: IndustryStructureConfig;
  allocatedSlots: number;
  maxAvailableSlots: number;
}): {
  perRunSec: number;
  sequentialTotalSec: number;
  allocatedSlotsClamped: number;
  runsPerSlotMax: number;
  timePerSlotSec: number;
  concurrentWallClockSec: number;
  effectiveTePct: number;
} {
  const {
    baseRunDurationSec,
    runs,
    bpTe,
    industryLvl,
    advIndustryLvl,
    reactionsLvl,
    isReaction,
    structureConfig,
    allocatedSlots,
    maxAvailableSlots,
  } = params;

  const cleanRuns = Math.max(1, Math.round(runs));
  const clampedSlots = Math.max(
    1,
    Math.min(Math.max(1, maxAvailableSlots), cleanRuns, Math.round(allocatedSlots || 1))
  );

  // Structure base TE bonus
  const structTeBonus =
    structureConfig.structureType === 'sotiyo'
      ? 0.3
      : structureConfig.structureType === 'azbel'
        ? 0.2
        : structureConfig.structureType === 'raitaru'
          ? 0.15
          : structureConfig.structureType === 'tatara' && isReaction
            ? 0.25
            : 0;
  const rigTeBonus =
    structureConfig.structureType === 'npc_station'
      ? 0
      : structureConfig.teRig === 't2'
        ? 0.24
        : structureConfig.teRig === 't1'
          ? 0.2
          : 0;

  const teFactor = isReaction
    ? (1 - 0.04 * Math.min(5, reactionsLvl)) * (1 - structTeBonus) * (1 - rigTeBonus)
    : (1 - Math.min(20, Math.max(0, bpTe)) / 100) *
      (1 - 0.04 * Math.min(5, industryLvl)) *
      (1 - 0.03 * Math.min(5, advIndustryLvl)) *
      (1 - structTeBonus) *
      (1 - rigTeBonus);

  const perRunSec = Math.max(60, Math.round(baseRunDurationSec * Math.max(0.15, teFactor)));
  const sequentialTotalSec = perRunSec * cleanRuns;
  const runsPerSlotMax = Math.ceil(cleanRuns / clampedSlots);
  const timePerSlotSec = perRunSec * runsPerSlotMax;
  const concurrentWallClockSec = timePerSlotSec;
  const effectiveTePct = Number(((1 - teFactor) * 100).toFixed(1));

  return {
    perRunSec,
    sequentialTotalSec,
    allocatedSlotsClamped: clampedSlots,
    runsPerSlotMax,
    timePerSlotSec,
    concurrentWallClockSec,
    effectiveTePct,
  };
}

// --- 4. Priority-Ordered Virtual Hangar Stock Ledger & Global Multi-Buy Aggregator ---

export function computeVirtualHangarLedger(params: {
  queue: BuildQueueEntry[];
  cardsById: Map<string, ActionCardData>;
  hangarStock: Record<number, HangarStockEntry> | undefined;
  snapshot: MarketSnapshot;
  profile: PilotProfile;
  structureConfig: IndustryStructureConfig;
}): {
  allocations: VirtualHangarSlotAllocation[];
  globalMultibuy: GlobalMultibuyMaterial[];
  totalBuyAllCostIsk: number;
  totalBuyMissingCostIsk: number;
  totalBuyAllProfitIsk: number;
  totalBuyMissingProfitIsk: number;
  totalHangarReservedSavingsIsk: number;
  totalRawInputM3: number;
  totalPackagedOutputM3: number;
} {
  const { queue, cardsById, hangarStock, snapshot, profile, structureConfig } = params;
  const remainingStock = new Map<number, number>();
  if (hangarStock) {
    for (const [idStr, entry] of Object.entries(hangarStock)) {
      remainingStock.set(Number(idStr), Math.max(0, Math.floor(entry.total || 0)));
    }
  }

  const slotInfo = getMaxIndustrySlots(profile);
  const sortedQueue = [...queue].sort((a, b) => a.priorityOrder - b.priorityOrder);

  const allocations: VirtualHangarSlotAllocation[] = [];
  const aggMissingByType = new Map<
    number,
    { name: string; missingQty: number; reservedQty: number; unitVolumeM3: number }
  >();

  let totalBuyAllCostIsk = 0;
  let totalBuyMissingCostIsk = 0;
  let totalBuyAllProfitIsk = 0;
  let totalBuyMissingProfitIsk = 0;
  let totalRawInputM3 = 0;
  let totalPackagedOutputM3 = 0;

  for (const entry of sortedQueue) {
    const card = cardsById.get(entry.cardId);
    if (!card) continue;

    const runs = Math.max(1, Math.round(entry.committedRuns));
    const outputPerRun = Math.max(1, card.outputPerRun ?? entry.outputPerRun ?? 1);
    const totalOutputUnits = runs * outputPerRun;
    const baseRuns = Math.max(1, card.baseBatchQty ?? 1);
    const scale = runs / baseRuns;

    const materials: VirtualHangarMaterialRow[] = [];
    let slotBuyAllMatCost = 0;
    let slotBuyMissingMatCost = 0;
    let slotRawInputM3 = 0;

    const bom = card.bomMaterials ?? [];
    for (const mat of bom) {
      const requiredQty = Math.max(1, Math.ceil(mat.qtyPerRun * runs));
      const availableBeforeSlot = remainingStock.get(mat.typeId) ?? 0;
      const reservedQty = Math.min(requiredQty, availableBeforeSlot);
      const missingQty = Math.max(0, requiredQty - reservedQty);
      const remainingAfterSlot = Math.max(0, availableBeforeSlot - reservedQty);
      remainingStock.set(mat.typeId, remainingAfterSlot);

      const q = snapshot.quotes[mat.typeId];
      const hubQuote: HubQuote = q?.jita ?? {
        sellMin: mat.unitPriceTopOfBook,
        sellVolume: mat.fallbackSellVolume ?? 50000,
        buyMax: mat.unitPriceTopOfBook * 0.9,
        buyVolume: 20000,
        sellPercentile: mat.unitPriceTopOfBook,
        buyPercentile: mat.unitPriceTopOfBook * 0.9,
        sellLevels: mat.sellLevels,
      };

      const walkAll = walkSellOrderbookForBuy(hubQuote, requiredQty);
      const walkMissing =
        missingQty > 0 ? walkSellOrderbookForBuy(hubQuote, missingQty) : undefined;

      const buyAllCostIsk =
        walkAll.filledQty >= requiredQty
          ? walkAll.totalIsk
          : requiredQty * (walkAll.weightedAvgPrice || mat.unitPriceTopOfBook);
      const buyMissingCostIsk =
        missingQty > 0
          ? walkMissing && walkMissing.filledQty >= missingQty
            ? walkMissing.totalIsk
            : missingQty * (walkMissing?.weightedAvgPrice || mat.unitPriceTopOfBook)
          : 0;

      slotBuyAllMatCost += buyAllCostIsk;
      slotBuyMissingMatCost += buyMissingCostIsk;
      slotRawInputM3 += requiredQty * mat.unitVolumeM3;

      materials.push({
        typeId: mat.typeId,
        name: mat.name,
        requiredQty,
        availableBeforeSlot,
        reservedQty,
        missingQty,
        remainingAfterSlot,
        unitVolumeM3: mat.unitVolumeM3,
        buyAllCostIsk,
        buyMissingCostIsk,
        depthWalkMissing: walkMissing,
      });

      const prevAgg = aggMissingByType.get(mat.typeId) ?? {
        name: mat.name,
        missingQty: 0,
        reservedQty: 0,
        unitVolumeM3: mat.unitVolumeM3,
      };
      prevAgg.missingQty += missingQty;
      prevAgg.reservedQty += reservedQty;
      aggMissingByType.set(mat.typeId, prevAgg);
    }

    const jobAndInventionFeeIsk =
      (card.singleRunJobAndInventionFeeIsk ?? 0) * runs;
    const netFeeMult = Math.max(0.1, 1 - (card.salesTaxPct + card.brokerFeePct) / 100);
    const grossRevScaled = card.grossRevenueIsk * scale;
    const netRevenueIsk = grossRevScaled * netFeeMult;

    const buyAllCostIsk = slotBuyAllMatCost + jobAndInventionFeeIsk;
    const buyMissingCostIsk = slotBuyMissingMatCost + jobAndInventionFeeIsk;
    const buyAllProfitIsk = netRevenueIsk - buyAllCostIsk;
    const buyMissingProfitIsk = netRevenueIsk - buyMissingCostIsk;

    const packagedOutputM3 =
      (card.unitOutputM3 ?? (card.totalVolumeM3 / Math.max(1, card.outputUnits))) *
      totalOutputUnits;

    const timeCalc = computeBlueprintBuildTime({
      baseRunDurationSec: card.baseRunDurationSec ?? 5400,
      runs,
      bpTe: card.bpTe ?? 20,
      industryLvl: profile.skills.industry ?? 5,
      advIndustryLvl: profile.skills.advancedIndustry ?? 5,
      reactionsLvl: profile.skills.reactions ?? 4,
      isReaction: Boolean(card.isReactionRecipe),
      structureConfig,
      allocatedSlots: entry.allocatedSlots,
      maxAvailableSlots: slotInfo.mfgAvailable,
    });

    allocations.push({
      cardId: card.id,
      title: `${card.primaryItemName || card.title} × ${totalOutputUnits.toLocaleString('en-US')}`,
      productName: card.primaryItemName || card.title,
      priorityOrder: entry.priorityOrder,
      committedRuns: runs,
      totalOutputUnits,
      allocatedSlots: timeCalc.allocatedSlotsClamped,
      sequentialDurationSec: timeCalc.sequentialTotalSec,
      concurrentDurationSec: timeCalc.concurrentWallClockSec,
      materials,
      buyAllCostIsk,
      buyMissingCostIsk,
      jobAndInventionFeeIsk,
      netRevenueIsk,
      buyAllProfitIsk,
      buyMissingProfitIsk,
      rawInputM3: slotRawInputM3,
      packagedOutputM3,
    });

    totalBuyAllCostIsk += buyAllCostIsk;
    totalBuyMissingCostIsk += buyMissingCostIsk;
    totalBuyAllProfitIsk += buyAllProfitIsk;
    totalBuyMissingProfitIsk += buyMissingProfitIsk;
    totalRawInputM3 += slotRawInputM3;
    totalPackagedOutputM3 += packagedOutputM3;
  }

  // Availability-Checked Global Multi-Buy Aggregator
  const globalMultibuy: GlobalMultibuyMaterial[] = [];
  for (const [typeId, agg] of aggMissingByType.entries()) {
    if (agg.missingQty <= 0) continue;
    const item = ITEM_BY_ID[typeId];
    const q = snapshot.quotes[typeId];
    const jitaHub: HubQuote = q?.jita ?? {
      sellMin: item?.baseJitaSell ?? 1000,
      sellVolume: item?.estDailyJitaVol ?? 50000,
      buyMax: (item?.baseJitaSell ?? 1000) * 0.9,
      buyVolume: 20000,
      sellPercentile: item?.baseJitaSell ?? 1000,
      buyPercentile: (item?.baseJitaSell ?? 1000) * 0.9,
    };

    const walk = walkSellOrderbookForBuy(jitaHub, agg.missingQty);
    const status: GlobalMultibuyMaterial['status'] =
      walk.shortfallQty > 0
        ? 'shortfall'
        : walk.slippagePct >= 2.0
          ? 'thin_depth'
          : 'in_stock';

    globalMultibuy.push({
      typeId,
      name: agg.name,
      totalMissingQty: agg.missingQty,
      totalReservedQty: agg.reservedQty,
      unitVolumeM3: agg.unitVolumeM3,
      totalVolumeM3: agg.missingQty * agg.unitVolumeM3,
      topOfBookPrice: walk.topOfBookPrice,
      weightedAvgPrice: walk.weightedAvgPrice,
      totalCostIsk:
        walk.shortfallQty > 0
          ? agg.missingQty * (walk.weightedAvgPrice || jitaHub.sellMin)
          : walk.totalIsk,
      slippagePct: walk.slippagePct,
      shortfallQty: walk.shortfallQty,
      status,
    });
  }

  globalMultibuy.sort((a, b) => b.totalCostIsk - a.totalCostIsk);

  return {
    allocations,
    globalMultibuy,
    totalBuyAllCostIsk,
    totalBuyMissingCostIsk,
    totalBuyAllProfitIsk,
    totalBuyMissingProfitIsk,
    totalHangarReservedSavingsIsk: Math.max(0, totalBuyAllCostIsk - totalBuyMissingCostIsk),
    totalRawInputM3,
    totalPackagedOutputM3,
  };
}

// --- 5. Hauling Route Planner, Smart Hull Suggester & Multi-Buy Fit Generator ---

interface HullFitBlueprint {
  hullClass: 't1_industrial' | 'blockade_runner' | 'dst' | 'freighter';
  classLabel: string;
  hullTypeId: number;
  hullName: string;
  capM3: number;
  fallbackHullIsk: number;
  modules: {
    slot: HaulerFitModule['slot'];
    typeId: number;
    name: string;
    qty: number;
    fallbackIsk: number;
  }[];
}

const STANDARD_HAULER_FITS: Record<HullFitBlueprint['hullClass'], HullFitBlueprint> = {
  t1_industrial: {
    hullClass: 't1_industrial',
    classLabel: 'T1 Industrial (Fast Budget Hauler)',
    hullTypeId: 648,
    hullName: 'Badger',
    capM3: 18_500,
    fallbackHullIsk: 1_850_000,
    modules: [
      { slot: 'High', typeId: 11578, name: 'Improved Cloaking Device II', qty: 1, fallbackIsk: 8_200_000 },
      { slot: 'Mid', typeId: 5975, name: '50MN Cold-Gas Enduring Microwarpdrive', qty: 1, fallbackIsk: 950_000 },
      { slot: 'Mid', typeId: 3841, name: 'Large Shield Extender II', qty: 2, fallbackIsk: 2_400_000 },
      { slot: 'Mid', typeId: 2281, name: 'Multispectrum Shield Hardener II', qty: 2, fallbackIsk: 1_900_000 },
      { slot: 'Low', typeId: 1319, name: 'Expanded Cargohold II', qty: 3, fallbackIsk: 850_000 },
      { slot: 'Low', typeId: 2048, name: 'Damage Control II', qty: 1, fallbackIsk: 1_350_000 },
      { slot: 'Rig', typeId: 31119, name: 'Medium Cargohold Optimization I', qty: 3, fallbackIsk: 900_000 },
    ],
  },
  blockade_runner: {
    hullClass: 'blockade_runner',
    classLabel: 'Blockade Runner (Covert Cloak · Anti-Gank)',
    hullTypeId: 12729,
    hullName: 'Crane',
    capM3: 10_200,
    fallbackHullIsk: 245_000_000,
    modules: [
      { slot: 'High', typeId: 11578, name: 'Covert Ops Cloaking Device II', qty: 1, fallbackIsk: 11_500_000 },
      { slot: 'Mid', typeId: 5975, name: '50MN Quad LiF Restrained Microwarpdrive', qty: 1, fallbackIsk: 1_150_000 },
      { slot: 'Mid', typeId: 3841, name: 'Large Shield Extender II', qty: 2, fallbackIsk: 2_400_000 },
      { slot: 'Mid', typeId: 2281, name: 'Multispectrum Shield Hardener II', qty: 1, fallbackIsk: 1_900_000 },
      { slot: 'Low', typeId: 1405, name: 'Inertial Stabilizers II', qty: 2, fallbackIsk: 1_100_000 },
      { slot: 'Rig', typeId: 31119, name: 'Medium Cargohold Optimization II', qty: 2, fallbackIsk: 12_500_000 },
    ],
  },
  dst: {
    hullClass: 'dst',
    classLabel: 'Deep Space Transport (62.5k m³ Fleet Hangar · High EHP)',
    hullTypeId: 12731,
    hullName: 'Bustard',
    capM3: 62_500,
    fallbackHullIsk: 275_000_000,
    modules: [
      { slot: 'High', typeId: 11578, name: 'Improved Cloaking Device II', qty: 1, fallbackIsk: 8_200_000 },
      { slot: 'Mid', typeId: 5975, name: '50MN Cold-Gas Enduring Microwarpdrive', qty: 1, fallbackIsk: 950_000 },
      { slot: 'Mid', typeId: 2281, name: 'Multispectrum Shield Hardener II', qty: 2, fallbackIsk: 1_900_000 },
      { slot: 'Mid', typeId: 3841, name: 'Large Shield Extender II', qty: 2, fallbackIsk: 2_400_000 },
      { slot: 'Mid', typeId: 35660, name: 'EM Shield Hardener II', qty: 1, fallbackIsk: 1_650_000 },
      { slot: 'Low', typeId: 2048, name: 'Damage Control II', qty: 1, fallbackIsk: 1_350_000 },
      { slot: 'Low', typeId: 10998, name: 'Warp Core Stabilizer II', qty: 1, fallbackIsk: 4_800_000 },
      { slot: 'Low', typeId: 1405, name: 'Inertial Stabilizers II', qty: 1, fallbackIsk: 1_100_000 },
      { slot: 'Rig', typeId: 31796, name: 'Medium Core Defense Field Extender II', qty: 2, fallbackIsk: 16_500_000 },
    ],
  },
  freighter: {
    hullClass: 'freighter',
    classLabel: 'Freighter (Bulk High-Sec Logistics)',
    hullTypeId: 20185,
    hullName: 'Charon',
    capM3: 935_000,
    fallbackHullIsk: 2_850_000_000,
    modules: [
      { slot: 'Low', typeId: 1317, name: 'Reinforced Bulkheads II', qty: 3, fallbackIsk: 2_100_000 },
    ],
  },
};

export function suggestOptimalHaulerAndFit(params: {
  rawInputM3: number;
  packagedOutputM3: number;
  cargoIskValue: number;
  originSystemName: string;
  destSystemName: string;
  jumpCount: number;
  routeMinSec: number;
  ownedHulls: HangarHull[];
  snapshot: MarketSnapshot;
}): HaulerFitSuggestion {
  const {
    rawInputM3,
    packagedOutputM3,
    cargoIskValue,
    originSystemName,
    destSystemName,
    jumpCount,
    routeMinSec,
    ownedHulls,
    snapshot,
  } = params;

  const peakHaulM3 = Math.max(1, rawInputM3, packagedOutputM3);
  const isLowOrNull = routeMinSec < 0.45;

  // Evaluate best owned hull from character assets
  const sortedOwned = [...ownedHulls].sort((a, b) => {
    if (a.isActiveShip && !b.isActiveShip) return -1;
    if (!a.isActiveShip && b.isActiveShip) return 1;
    return b.capacityM3 - a.capacityM3;
  });
  const ownedHull =
    sortedOwned.find((h) => h.capacityM3 >= peakHaulM3) ?? sortedOwned[0] ?? null;
  const ownedHullCapM3 = ownedHull?.capacityM3 ?? 0;
  const ownedHullTrips =
    ownedHullCapM3 > 0 ? Math.max(1, Math.ceil(peakHaulM3 / ownedHullCapM3)) : 0;

  // Smart hull class selection based on total m³, route security, and gank-risk ISK value
  let targetClass: HullFitBlueprint['hullClass'] = 't1_industrial';
  let gankRiskReason = '';

  if (isLowOrNull) {
    if (peakHaulM3 <= 10_200) {
      targetClass = 'blockade_runner';
      gankRiskReason = `Route crosses low-sec/null-sec (${routeMinSec.toFixed(1)} min sec) — Covert Ops Cloak Blockade Runner strongly recommended.`;
    } else {
      targetClass = 'dst';
      gankRiskReason = `Route crosses ${routeMinSec.toFixed(1)} sec with ${Math.round(peakHaulM3).toLocaleString('en-US')} m³ — MWD+Cloak DST with Warp Core Stabilizer recommended.`;
    }
  } else if (peakHaulM3 > 62_500) {
    if (cargoIskValue > 1_200_000_000) {
      targetClass = 'dst';
      gankRiskReason = `Cargo value (${(cargoIskValue / 1e9).toFixed(2)}B ISK) exceeds safe unescorted Freighter gank threshold (~1.2B ISK) — split into tanked DST runs.`;
    } else {
      targetClass = 'freighter';
      gankRiskReason = `Volume (${Math.round(peakHaulM3).toLocaleString('en-US')} m³) exceeds DST fleet hangar in high-sec with safe ISK/EHP ratio.`;
    }
  } else if (peakHaulM3 <= 10_200 && cargoIskValue >= 150_000_000) {
    targetClass = 'blockade_runner';
    gankRiskReason = `High-value compact cargo (${(cargoIskValue / 1e6).toFixed(0)}M ISK in ${Math.round(peakHaulM3).toLocaleString('en-US')} m³) — Covert Cloak Blockade Runner prevents cargo scans.`;
  } else if (peakHaulM3 > 18_500 || cargoIskValue >= 90_000_000) {
    targetClass = 'dst';
    gankRiskReason = `Volume/value exceeds safe T1 Industrial threshold (~90M ISK / 18.5k m³) — DST provides 62,500 m³ Fleet Hangar + MWD/Cloak tank.`;
  } else {
    targetClass = 't1_industrial';
    gankRiskReason = `Low gank exposure (<90M ISK, ${Math.round(peakHaulM3).toLocaleString('en-US')} m³ in high-sec) — tanked T1 Industrial is fast and cost-efficient.`;
  }

  const blueprint = STANDARD_HAULER_FITS[targetClass];
  const getLiveJitaPrice = (typeId: number, fallbackIsk: number): number => {
    const q = snapshot.quotes[typeId];
    if (q && q.jita.sellMin > 0) return q.jita.sellMin;
    return ITEM_BY_ID[typeId]?.baseJitaSell ?? fallbackIsk;
  };

  const hullPrice = getLiveJitaPrice(blueprint.hullTypeId, blueprint.fallbackHullIsk);
  const fitModules: HaulerFitModule[] = [
    {
      slot: 'Hull',
      typeId: blueprint.hullTypeId,
      name: blueprint.hullName,
      qty: 1,
      unitPriceIsk: hullPrice,
      totalPriceIsk: hullPrice,
    },
    ...blueprint.modules.map((m) => {
      const unit = getLiveJitaPrice(m.typeId, m.fallbackIsk);
      return {
        slot: m.slot,
        typeId: m.typeId,
        name: m.name,
        qty: m.qty,
        unitPriceIsk: unit,
        totalPriceIsk: unit * m.qty,
      };
    }),
  ];

  const totalFitCostIsk = fitModules.reduce((s, m) => s + m.totalPriceIsk, 0);
  const multibuyText = fitModules.map((m) => `${m.name}\t${m.qty}`).join('\n');

  const routeSecurityLabel =
    routeMinSec >= 0.5
      ? `High-Sec (${routeMinSec.toFixed(1)} min)`
      : routeMinSec > 0.0
        ? `Low-Sec Warning (${routeMinSec.toFixed(1)} min)`
        : `Null-Sec Warning (${routeMinSec.toFixed(1)} min)`;

  return {
    rawInputM3,
    packagedOutputM3,
    peakHaulM3,
    cargoIskValue,
    originSystemName,
    destSystemName,
    jumpCount,
    routeMinSec,
    routeSecurityLabel,
    ownedHullName: ownedHull?.name ?? null,
    ownedHullCapM3,
    ownedHullTrips,
    recommendedClass: blueprint.hullClass,
    recommendedClassLabel: blueprint.classLabel,
    recommendedHullTypeId: blueprint.hullTypeId,
    recommendedHullName: blueprint.hullName,
    recommendedHullCapM3: blueprint.capM3,
    recommendedTrips: Math.max(1, Math.ceil(peakHaulM3 / blueprint.capM3)),
    indicativeHullCostIsk: hullPrice,
    totalFitCostIsk,
    gankRiskReason,
    fitModules,
    multibuyText,
  };
}

// --- 6. Client-Side Quantitative Price Projection Engine (Zero API Key Required) ---

export function analyzePriceProjection(params: {
  typeId: number;
  itemName: string;
  regionId: number;
  regionName: string;
  days: MarketHistoryDay[];
}): PriceProjectionAnalysis {
  const { typeId, itemName, regionId, regionName, days } = params;
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last30 = sorted.slice(-30);
  const last7 = sorted.slice(-7);

  if (last30.length === 0) {
    return {
      typeId,
      itemName,
      regionId,
      regionName,
      currentAvgPrice: 0,
      yesterdayAvgPrice: 0,
      change24hPct: 0,
      ma7d: 0,
      ma30d: 0,
      momentum7dPct: 0,
      avgDailyVol7d: 0,
      avgDailyVol30d: 0,
      volumeSpikeRatio: 1,
      volatilityPct: 0,
      manipulationRisk: 'high',
      manipulationNotes: ['No recent regional trade history returned by EVE ESI.'],
      signal: 'caution_thin',
      signalSummary: 'Insufficient historical volume to project reliable pricing.',
      projected7dLow: 0,
      projected7dMid: 0,
      projected7dHigh: 0,
    };
  }

  const latest = last30[last30.length - 1];
  const prev = last30.length >= 2 ? last30[last30.length - 2] : latest;
  const currentAvgPrice = Number(latest.average || 0);
  const yesterdayAvgPrice = Number(prev.average || currentAvgPrice);
  const change24hPct =
    yesterdayAvgPrice > 0
      ? ((currentAvgPrice - yesterdayAvgPrice) / yesterdayAvgPrice) * 100
      : 0;

  const ma7d =
    last7.reduce((s, d) => s + Number(d.average || 0), 0) / Math.max(1, last7.length);
  const ma30d =
    last30.reduce((s, d) => s + Number(d.average || 0), 0) / Math.max(1, last30.length);

  const first7 = last7[0]?.average || currentAvgPrice;
  const momentum7dPct = first7 > 0 ? ((currentAvgPrice - first7) / first7) * 100 : 0;

  const avgDailyVol7d =
    last7.reduce((s, d) => s + Number(d.volume || 0), 0) / Math.max(1, last7.length);
  const avgDailyVol30d =
    last30.reduce((s, d) => s + Number(d.volume || 0), 0) / Math.max(1, last30.length);
  const volumeSpikeRatio =
    avgDailyVol30d > 0 ? Number((avgDailyVol7d / avgDailyVol30d).toFixed(2)) : 1;

  // Daily return standard deviation (volatility %)
  const returns: number[] = [];
  for (let i = 1; i < last30.length; i++) {
    const p0 = last30[i - 1].average;
    const p1 = last30[i].average;
    if (p0 > 0) returns.push((p1 - p0) / p0);
  }
  const meanRet = returns.reduce((s, r) => s + r, 0) / Math.max(1, returns.length);
  const variance =
    returns.reduce((s, r) => s + Math.pow(r - meanRet, 2), 0) / Math.max(1, returns.length);
  const dailyStdDev = Math.sqrt(variance);
  const volatilityPct = Number((dailyStdDev * 100).toFixed(2));

  // Thin-market & manipulation checks
  const avgOrders7d =
    last7.reduce((s, d) => s + Number(d.order_count || 0), 0) / Math.max(1, last7.length);
  const maxDailySpreadPct = Math.max(
    ...last7.map((d) => (d.average > 0 ? ((d.highest - d.lowest) / d.average) * 100 : 0))
  );

  const manipulationNotes: string[] = [];
  let riskScore = 0;

  if (avgOrders7d < 12) {
    riskScore += 2;
    manipulationNotes.push(
      `Thin order flow (${avgOrders7d.toFixed(1)} daily fills/7d) — susceptible to single-trader price spikes.`
    );
  }
  if (maxDailySpreadPct > 35) {
    riskScore += 2;
    manipulationNotes.push(
      `Wide intraday high/low wick (${maxDailySpreadPct.toFixed(0)}%) detected in the past 7 days.`
    );
  }
  if (volumeSpikeRatio >= 2.4 && Math.abs(momentum7dPct) >= 12) {
    riskScore += 1;
    manipulationNotes.push(
      `Abnormal ${volumeSpikeRatio.toFixed(1)}× volume surge paired with ${momentum7dPct >= 0 ? '+' : ''}${momentum7dPct.toFixed(1)}% 7d price move (possible hub buyout or patch speculation).`
    );
  }
  if (Math.abs(currentAvgPrice - ma30d) / Math.max(0.01, ma30d) > 0.25) {
    riskScore += 1;
    manipulationNotes.push(
      `Spot average sits ${(((currentAvgPrice - ma30d) / Math.max(0.01, ma30d)) * 100).toFixed(1)}% away from 30d mean — mean-reversion risk elevated.`
    );
  }
  if (manipulationNotes.length === 0) {
    manipulationNotes.push(
      `Healthy regional liquidity (${Math.round(avgOrders7d).toLocaleString('en-US')} daily fills/7d) with stable intraday spreads.`
    );
  }

  const manipulationRisk: PriceProjectionAnalysis['manipulationRisk'] =
    riskScore >= 3 ? 'high' : riskScore >= 1 ? 'moderate' : 'low';

  // Dampened 7-day statistical projection cone (linear drift capped + 1.5σ band)
  const clampedDrift = Math.max(-0.15, Math.min(0.15, (ma7d - ma30d) / Math.max(0.01, ma30d) * 0.5 + (momentum7dPct / 100) * 0.35));
  const projected7dMid = Number((currentAvgPrice * (1 + clampedDrift)).toFixed(2));
  const band7d = Math.min(0.28, Math.max(0.03, dailyStdDev * Math.sqrt(7) * 1.35));
  const projected7dLow = Math.max(0.01, Number((projected7dMid * (1 - band7d)).toFixed(2)));
  const projected7dHigh = Number((projected7dMid * (1 + band7d)).toFixed(2));

  let signal: PriceProjectionAnalysis['signal'] = 'neutral';
  let signalSummary = 'Range-bound near 30-day average; standard buy/sell spread execution advised.';

  if (manipulationRisk === 'high') {
    signal = 'caution_thin';
    signalSummary =
      'Thin-market / elevated volatility warning — verify live orderbook depth before committing bulk capital.';
  } else if (ma7d > ma30d * 1.03 && momentum7dPct > 2) {
    signal = 'bullish';
    signalSummary = `Upward momentum: 7d MA sits +${(((ma7d - ma30d) / Math.max(0.01, ma30d)) * 100).toFixed(1)}% above 30d MA (${volumeSpikeRatio.toFixed(1)}× vol ratio).`;
  } else if (ma7d < ma30d * 0.97 && momentum7dPct < -2) {
    signal = 'bearish';
    signalSummary = `Softening trend: 7d MA trails 30d MA by ${(((ma7d - ma30d) / Math.max(0.01, ma30d)) * 100).toFixed(1)}% — stagger sell orders or undercut conservatively.`;
  }

  return {
    typeId,
    itemName,
    regionId,
    regionName,
    currentAvgPrice,
    yesterdayAvgPrice,
    change24hPct: Number(change24hPct.toFixed(2)),
    ma7d: Number(ma7d.toFixed(2)),
    ma30d: Number(ma30d.toFixed(2)),
    momentum7dPct: Number(momentum7dPct.toFixed(2)),
    avgDailyVol7d: Math.round(avgDailyVol7d),
    avgDailyVol30d: Math.round(avgDailyVol30d),
    volumeSpikeRatio,
    volatilityPct,
    manipulationRisk,
    manipulationNotes,
    signal,
    signalSummary,
    projected7dLow,
    projected7dMid,
    projected7dHigh,
  };
}
