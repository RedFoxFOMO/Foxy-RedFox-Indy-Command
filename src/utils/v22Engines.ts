// v2.2.0 Domain Calculators:
// - Multi-Period Price Trends (30d / 14d / 7d / 1d + 5-min Sparkline)
// - Depth-Aware Tier-Split Multi-Buy / Multi-Sell Formatter
// - Public Courier & Item/BPC Contract Valuation Engines (including Multi-BPC Proportional Allocation)
// - Station Trading Matrix (Std Margin / Insta Flip / Hybrid + Station Stock Value)
// - Gank Threat vs. Target / Victim Tactical Evaluator (CONCORD strictly excluded from TTK)

import {
  EMPIRE_HUB_MAP,
  EVE_ITEMS,
  INDUSTRY_RECIPES,
  ITEM_BY_ID,
  REPROCESSING_CATALOG,
} from '../data/eveCatalog.ts';
import { computeExactHubBrokerFee } from './dotlan.ts';
import { walkBuyOrderbookForSell, walkSellOrderbookForBuy } from './eveMarketMath.ts';
import type {
  AppSettingsV22,
  BpcAllocationRow,
  CollateralClassification,
  EvaluatedCourierContract,
  EvaluatedItemBpcContract,
  GankEvaluationResult,
  GankHullStats,
  GankPilotIntel,
  HubQuote,
  IndustryStructureConfig,
  MarketCategoryId,
  MarketHistoryDay,
  MarketSnapshot,
  MultiPeriodTrend,
  PilotProfile,
  RawPublicContract,
  StationTradeOpportunity,
  TradeHubId,
} from '../types/eve.ts';

// --- 1. Multi-Period Price Trend & 5-Min Live Sparkline ---

export function computeMultiPeriodTrendFromHistory(
  days: MarketHistoryDay[],
  currentPriceOverride?: number,
  sessionTicks?: number[]
): MultiPeriodTrend {
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1];
  const current = currentPriceOverride && currentPriceOverride > 0
    ? currentPriceOverride
    : last?.average ?? 0;

  const pctFromOffset = (daysBack: number): number => {
    if (sorted.length < 2 || current <= 0) return 0;
    const idx = Math.max(0, sorted.length - 1 - daysBack);
    const base = sorted[idx]?.average ?? 0;
    if (base <= 0) return 0;
    return Number((((current - base) / base) * 100).toFixed(2));
  };

  const change1dPct = pctFromOffset(1);
  const change7dPct = pctFromOffset(7);
  const change14dPct = pctFromOffset(14);
  const change30dPct = pctFromOffset(Math.min(30, Math.max(1, sorted.length - 1)));

  let sparkline5m: number[];
  if (sessionTicks && sessionTicks.length >= 3) {
    sparkline5m = sessionTicks.slice(-12);
  } else {
    const tail = sorted.slice(-8).map((d) => d.average).filter((v) => v > 0);
    if (tail.length >= 3) {
      sparkline5m = [...tail, current > 0 ? current : tail[tail.length - 1]];
    } else if (current > 0) {
      sparkline5m = [current * 0.996, current * 0.999, current * 0.998, current];
    } else {
      sparkline5m = [1, 1, 1, 1];
    }
  }

  return {
    change30dPct,
    change14dPct,
    change7dPct,
    change1dPct,
    sparkline5m,
    currentPrice: current,
  };
}

export function deriveQuickMultiPeriodTrend(
  typeId: number,
  hubQuote: HubQuote | undefined,
  prevPrice?: number
): MultiPeriodTrend {
  const current = hubQuote?.sellMin || hubQuote?.buyMax || ITEM_BY_ID[typeId]?.baseJitaSell || 1;
  const pctSpread =
    hubQuote && hubQuote.sellPercentile > 0 && hubQuote.sellMin > 0
      ? ((hubQuote.sellMin - hubQuote.sellPercentile) / hubQuote.sellPercentile) * 100
      : 0;
  const baseRef = ITEM_BY_ID[typeId]?.baseJitaSell || current;
  const change30dPct =
    baseRef > 0 ? Number((((current - baseRef) / baseRef) * 100).toFixed(2)) : 0;
  const change14dPct = Number((change30dPct * 0.62 + pctSpread * 0.25).toFixed(2));
  const change7dPct = Number((change30dPct * 0.38 + pctSpread * 0.45).toFixed(2));
  const change1dPct =
    prevPrice && prevPrice > 0
      ? Number((((current - prevPrice) / prevPrice) * 100).toFixed(2))
      : Number((pctSpread * 0.5).toFixed(2));

  const start = current / (1 + change1dPct / 100 || 1);
  const mid1 = start + (current - start) * 0.35;
  const mid2 = start + (current - start) * 0.62;
  const mid3 = start + (current - start) * 0.85;

  return {
    change30dPct,
    change14dPct,
    change7dPct,
    change1dPct,
    sparkline5m: [start, mid1, mid2, mid3, current],
    currentPrice: current,
  };
}

// --- 2. Depth-Aware Tier-Split Multi-Buy / Multi-Sell Formatter ---

export interface DepthSplitLine {
  typeId?: number;
  name: string;
  tierIndex: number;
  qty: number;
  unitPriceIsk: number;
  totalIsk: number;
  side: 'buy' | 'sell';
}

export function buildDepthAwareOrderLines(
  items: { typeId?: number; name: string; quantity: number; side: 'buy' | 'sell' }[],
  snapshot: MarketSnapshot,
  hubId: TradeHubId = 'jita'
): {
  lines: DepthSplitLine[];
  eveMultibuyText: string;
  annotatedText: string;
  csvText: string;
} {
  const lines: DepthSplitLine[] = [];

  for (const item of items) {
    const qty = Math.max(1, Math.round(item.quantity));
    const q = item.typeId ? snapshot.quotes[item.typeId] : undefined;
    const hubQuote = q?.hubs?.[hubId] ?? q?.jita;

    if (hubQuote) {
      const bookLevels = item.side === 'buy' ? hubQuote.sellLevels : hubQuote.buyLevels;
      if (Array.isArray(bookLevels) && bookLevels.length > 0) {
        const sorted = [...bookLevels].sort((a, b) =>
          item.side === 'buy' ? a.price - b.price : b.price - a.price
        );
        let remaining = qty;
        let tierIdx = 0;
        let lastPrice = sorted[0].price;
        for (const lvl of sorted) {
          if (remaining <= 0) break;
          if (lvl.volume <= 0 || lvl.price <= 0) continue;
          const take = Math.min(remaining, lvl.volume);
          tierIdx += 1;
          lastPrice = lvl.price;
          lines.push({
            typeId: item.typeId,
            name: item.name,
            tierIndex: tierIdx,
            qty: take,
            unitPriceIsk: lvl.price,
            totalIsk: take * lvl.price,
            side: item.side,
          });
          remaining -= take;
        }
        if (remaining > 0) {
          lines.push({
            typeId: item.typeId,
            name: item.name,
            tierIndex: tierIdx + 1,
            qty: remaining,
            unitPriceIsk: lastPrice,
            totalIsk: remaining * lastPrice,
            side: item.side,
          });
        }
        continue;
      }

      const walk =
        item.side === 'buy'
          ? walkSellOrderbookForBuy(hubQuote, qty)
          : walkBuyOrderbookForSell(hubQuote, qty);
      if (walk.filledQty > 0) {
        lines.push({
          typeId: item.typeId,
          name: item.name,
          tierIndex: 1,
          qty: walk.filledQty,
          unitPriceIsk: walk.weightedAvgPrice,
          totalIsk: walk.totalIsk,
          side: item.side,
        });
        if (walk.shortfallQty > 0) {
          lines.push({
            typeId: item.typeId,
            name: item.name,
            tierIndex: 2,
            qty: walk.shortfallQty,
            unitPriceIsk: walk.weightedAvgPrice || walk.topOfBookPrice,
            totalIsk: walk.shortfallQty * (walk.weightedAvgPrice || walk.topOfBookPrice),
            side: item.side,
          });
        }
        continue;
      }
    }

    const fallbackPrice =
      item.side === 'buy'
        ? hubQuote?.sellMin || ITEM_BY_ID[item.typeId ?? 0]?.baseJitaSell || 0
        : hubQuote?.buyMax || (ITEM_BY_ID[item.typeId ?? 0]?.baseJitaSell ?? 0) * 0.9;
    lines.push({
      typeId: item.typeId,
      name: item.name,
      tierIndex: 1,
      qty,
      unitPriceIsk: fallbackPrice,
      totalIsk: qty * fallbackPrice,
      side: item.side,
    });
  }

  // EVE Multi-Buy strict format (tier-split lines if multiple tiers exist)
  const eveMultibuyText = lines.map((l) => `${l.name}\t${Math.round(l.qty)}`).join('\n');
  const annotatedText = lines
    .map(
      (l) =>
        `${l.side.toUpperCase()} | ${l.name} x${Math.round(l.qty).toLocaleString('en-US')} @ ${l.unitPriceIsk.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })} ISK (Tier ${l.tierIndex} · Total ${Math.round(l.totalIsk).toLocaleString('en-US')} ISK)`
    )
    .join('\n');

  const csvHeader = 'Side,Item,Tier,Quantity,UnitPriceISK,TotalISK';
  const csvRows = lines.map(
    (l) =>
      `${l.side},"${l.name.replace(/"/g, '""')}",${l.tierIndex},${Math.round(l.qty)},${l.unitPriceIsk.toFixed(2)},${l.totalIsk.toFixed(2)}`
  );

  return {
    lines,
    eveMultibuyText,
    annotatedText,
    csvText: [csvHeader, ...csvRows].join('\n'),
  };
}

// --- 3. Courier Contract Evaluator (3-Leg Routing + Timing + Bait/Collateral Classification) ---

export interface HaulerTimingSpec {
  id: string;
  name: string;
  capacityM3: number;
  alignSec: number;
  warpAuPerSec: number;
}

export const COURIER_HULL_PRESETS: HaulerTimingSpec[] = [
  { id: 'blockade_runner', name: 'Crane / Blockade Runner (10.2k m³)', capacityM3: 10200, alignSec: 3.4, warpAuPerSec: 6.0 },
  { id: 't1_hauler', name: 'Badger / T1 Industrial (18.5k m³)', capacityM3: 18500, alignSec: 7.5, warpAuPerSec: 4.5 },
  { id: 'dst', name: 'Bustard / Deep Space Transport (62.5k m³)', capacityM3: 62500, alignSec: 9.8, warpAuPerSec: 3.8 },
  { id: 'freighter', name: 'Charon / Freighter (935k m³)', capacityM3: 935000, alignSec: 26.0, warpAuPerSec: 1.5 },
];

export function estimateJumpTravelSeconds(
  jumps: number,
  hull: HaulerTimingSpec,
  manualClickCadenceSec: number
): number {
  if (jumps <= 0) return 0;
  // Average 32 AU warp across empire systems + align + session gate load + manual click cadence
  const avgWarpSec = 32 / Math.max(0.8, hull.warpAuPerSec) + 9.0; // accel/decel overhead
  const perJumpSec = hull.alignSec + avgWarpSec + Math.max(3, manualClickCadenceSec);
  // Add dock/undock overhead (~35s) once per non-zero leg
  return Math.round(jumps * perJumpSec + 35);
}

export function evaluateCourierContracts(params: {
  rawContracts: RawPublicContract[];
  regionId: number;
  regionName: string;
  snapshot: MarketSnapshot;
  jumpMatrix: Record<string, number>;
  pilotSystemId: number;
  hull: HaulerTimingSpec;
  manualClickCadenceSec: number;
  roundTrip: boolean;
  qtyMultiplier?: number;
}): EvaluatedCourierContract[] {
  const {
    rawContracts,
    regionId,
    regionName,
    snapshot,
    jumpMatrix,
    pilotSystemId,
    hull,
    manualClickCadenceSec,
    roundTrip,
  } = params;

  return rawContracts
    .filter((c) => c.type === 'courier')
    .map((c) => {
      const startSysId = c.start_system_id ?? 30000142;
      const endSysId = c.end_system_id ?? 30002659;
      const startName = c.start_system_name || 'Origin System';
      const endName = c.end_system_name || 'Destination System';
      const rewardIsk = Math.max(0, Number(c.reward ?? 0));
      const collateralIsk = Math.max(0, Number(c.collateral ?? 0));
      const volumeM3 = Math.max(0.1, Number(c.volume ?? 1));

      // Value included items via live depth-walked Jita sell prices if available
      let trueContentValueIsk = 0;
      const items = c.items ?? [];
      for (const it of items) {
        if (!it.isIncluded) continue;
        const q = snapshot.quotes[it.typeId];
        if (q?.jita && q.jita.sellMin > 0) {
          const walk = walkSellOrderbookForBuy(q.jita, Math.max(1, it.quantity));
          trueContentValueIsk += walk.totalIsk > 0 ? walk.totalIsk : it.quantity * q.jita.sellMin;
        } else {
          const base = ITEM_BY_ID[it.typeId]?.baseJitaSell ?? 0;
          trueContentValueIsk += base * it.quantity;
        }
      }

      // Public courier items are often sealed by ESI (not exposed until accepted);
      // if ESI returns no item lines, fall back to collateral as baseline estimate when collateral > 0
      const hasKnownItemVal = trueContentValueIsk > 0;
      const effectiveContentVal = hasKnownItemVal ? trueContentValueIsk : collateralIsk;

      const collateralCoveragePct =
        effectiveContentVal > 0
          ? Number(((collateralIsk / effectiveContentVal) * 100).toFixed(1))
          : collateralIsk > 0
            ? 200
            : 100;
      const collateralDeltaIsk = collateralIsk - effectiveContentVal;

      let classification: CollateralClassification = 'fair';
      let classificationLabel = 'Fair Collateral';
      if (hasKnownItemVal && collateralCoveragePct > 150) {
        classification = 'bait_scam';
        classificationLabel = 'Bait / Scam Risk (>150%)';
      } else if (hasKnownItemVal && collateralCoveragePct > 115) {
        classification = 'over_valued';
        classificationLabel = 'Over-Collateralized (>115%)';
      } else if (hasKnownItemVal && collateralCoveragePct < 85) {
        classification = 'under_valued';
        classificationLabel = 'Under-Collateralized (<85%)';
      } else if (!hasKnownItemVal && collateralIsk >= 1_500_000_000 && rewardIsk < collateralIsk * 0.005) {
        classification = 'bait_scam';
        classificationLabel = 'High Collateral / Low Reward Bait';
      }

      const approachJumps =
        pilotSystemId === startSysId
          ? 0
          : jumpMatrix[`${pilotSystemId}:${startSysId}`] ?? 3;
      const jobJumps =
        startSysId === endSysId
          ? 0
          : jumpMatrix[`${startSysId}:${endSysId}`] ?? 8;
      const returnJumps = roundTrip
        ? endSysId === pilotSystemId
          ? 0
          : jumpMatrix[`${endSysId}:${pilotSystemId}`] ?? Math.max(1, jobJumps)
        : 0;

      const totalJumps = approachJumps + jobJumps + returnJumps;
      const approachTimeSec = estimateJumpTravelSeconds(approachJumps, hull, manualClickCadenceSec);
      const jobTimeSec = estimateJumpTravelSeconds(Math.max(1, jobJumps), hull, manualClickCadenceSec);
      const returnTimeSec = roundTrip
        ? estimateJumpTravelSeconds(returnJumps, hull, manualClickCadenceSec)
        : 0;
      const totalTimeSec = Math.max(60, approachTimeSec + jobTimeSec + returnTimeSec);

      const iskPerJump = totalJumps > 0 ? rewardIsk / totalJumps : rewardIsk;
      const incomePerJobHrIsk = (rewardIsk / Math.max(60, jobTimeSec)) * 3600;
      const incomePerTotalHrIsk = (rewardIsk / totalTimeSec) * 3600;

      // Net profit equals reward (zero market tax on couriers); profit % relative to collateral at risk
      const netProfitIsk = rewardIsk;
      const profitPct = collateralIsk > 0 ? (rewardIsk / collateralIsk) * 100 : 100;

      return {
        contractId: c.contract_id,
        title: c.title?.trim() || `${startName} → ${endName} Courier`,
        regionId,
        regionName,
        startSystemId: startSysId,
        startSystemName: startName,
        startStationName: c.start_station_name || `${startName} Station`,
        endSystemId: endSysId,
        endSystemName: endName,
        endStationName: c.end_station_name || `${endName} Station`,
        volumeM3,
        rewardIsk,
        collateralIsk,
        trueContentValueIsk: effectiveContentVal,
        collateralCoveragePct,
        collateralDeltaIsk,
        classification,
        classificationLabel,
        approachJumps,
        jobJumps,
        returnJumps,
        totalJumps,
        approachTimeSec,
        jobTimeSec,
        returnTimeSec,
        totalTimeSec,
        iskPerJump,
        incomePerJobHrIsk,
        incomePerTotalHrIsk,
        netProfitIsk,
        profitPct,
        items,
        dateExpired: c.date_expired,
      };
    });
}

// --- 4. Item & BPC Contract Valuation Engine (Instant, Sell Order, Reprocessing, Multi-BPC Allocation) ---

function computeReprocessYieldRate(
  profile: PilotProfile,
  structureConfig: IndustryStructureConfig
): number {
  const baseStation =
    structureConfig.structureType === 'npc_station'
      ? 0.5
      : structureConfig.structureType === 'tatara'
        ? 0.555
        : structureConfig.structureType === 'athanor'
          ? 0.54
          : 0.52;
  const rigBonus =
    structureConfig.structureType === 'npc_station'
      ? 0
      : structureConfig.meRig === 't2'
        ? 0.03
        : structureConfig.meRig === 't1'
          ? 0.015
          : 0;
  const skillFactor =
    (1 + 0.03 * profile.skills.reprocessing) *
    (1 + 0.02 * profile.skills.reprocessingEfficiency) *
    (1 + 0.02 * profile.skills.scrapmetalProcessing);
  return Math.min(0.895, (baseStation + rigBonus) * skillFactor);
}

export function evaluateItemAndBpcContracts(params: {
  rawContracts: RawPublicContract[];
  regionId: number;
  regionName: string;
  snapshot: MarketSnapshot;
  profile: PilotProfile;
  structureConfig: IndustryStructureConfig;
  appSettings: AppSettingsV22;
  reprocessOutputMode: 'instant' | 'sell_order';
}): EvaluatedItemBpcContract[] {
  const {
    rawContracts,
    regionId,
    regionName,
    snapshot,
    profile,
    structureConfig,
    appSettings,
    reprocessOutputMode,
  } = params;

  const salesTaxRate = 0.075 * (1 - 0.11 * Math.max(0, Math.min(5, profile.skills.accounting)));
  const jitaBroker = computeExactHubBrokerFee({
    hubId: 'jita',
    brokerRelationsLvl: profile.skills.brokerRelations,
    standings: profile.npcStandings,
    useCustomUpwellBroker: appSettings.useCustomUpwellBroker,
    customUpwellBrokerPct: appSettings.customUpwellBrokerPct,
    includeSccSurcharge: appSettings.includeSccSurcharge,
  }).effectiveTotalBrokerPct / 100;

  const reprocYield = computeReprocessYieldRate(profile, structureConfig);

  return rawContracts
    .filter((c) => c.type === 'item_exchange' || c.type === 'auction')
    .map((c) => {
      const contractPriceIsk = Math.max(0, Number(c.price ?? 0));
      const items = (c.items ?? []).filter((it) => it.isIncluded);

      let instantSaleGross = 0;
      let sellOrderGross = 0;
      let reprocessGross = 0;

      // BPC tracking
      const rawBpcs: {
        typeId: number;
        blueprintName: string;
        productTypeId: number;
        productName: string;
        runs: number;
        me: number;
        te: number;
        fullBuildCostIsk: number;
        outputInstantRevIsk: number;
        grossBuiltMarginIsk: number;
      }[] = [];

      for (const it of items) {
        const qty = Math.max(1, it.quantity);
        const isBpc = Boolean(it.isBlueprintCopy || it.name.toLowerCase().includes('blueprint'));

        if (isBpc) {
          const recipe =
            INDUSTRY_RECIPES.find(
              (r) =>
                r.productName.toLowerCase() === it.name.replace(/\s*blueprint.*$/i, '').trim().toLowerCase() ||
                r.productTypeId === it.typeId
            ) ?? null;

          const runs = Math.max(1, it.runs ?? (recipe?.batchRuns || 10));
          const me = Math.max(0, Math.min(10, it.materialEfficiency ?? (recipe?.tier === 'T2' ? 2 : 10)));
          const te = Math.max(0, Math.min(20, it.timeEfficiency ?? (recipe?.tier === 'T2' ? 4 : 20)));

          if (recipe) {
            const meMult = 1 - me / 100;
            let buildCost = 0;
            for (const mat of recipe.baseMaterials) {
              const matQty = Math.max(1, Math.ceil(mat.quantity * runs * meMult));
              const q = snapshot.quotes[mat.typeId];
              const price = q?.jita?.sellMin || ITEM_BY_ID[mat.typeId]?.baseJitaSell || 100;
              buildCost += matQty * price;
            }
            const outUnits = runs * recipe.outputPerRun;
            const outQuote = snapshot.quotes[recipe.productTypeId]?.jita;
            const outWalk = outQuote
              ? walkBuyOrderbookForSell(outQuote, outUnits)
              : null;
            const outRevGross =
              outWalk && outWalk.totalIsk > 0
                ? outWalk.totalIsk
                : outUnits * (outQuote?.buyMax || (ITEM_BY_ID[recipe.productTypeId]?.baseJitaSell ?? 1000) * 0.9);
            const outRevNet = outRevGross * (1 - salesTaxRate);
            const grossBuiltMarginIsk = outRevNet - buildCost;

            rawBpcs.push({
              typeId: it.typeId,
              blueprintName: it.name,
              productTypeId: recipe.productTypeId,
              productName: recipe.productName,
              runs,
              me,
              te,
              fullBuildCostIsk: buildCost,
              outputInstantRevIsk: outRevNet,
              grossBuiltMarginIsk,
            });
          } else {
            // Fallback BPC estimate when recipe isn't in static table
            const estOut = Math.max(contractPriceIsk * 0.4, 2_500_000) * qty;
            const estCost = estOut * 0.72;
            rawBpcs.push({
              typeId: it.typeId,
              blueprintName: it.name,
              productTypeId: it.typeId,
              productName: it.name.replace(/\s*Blueprint.*$/i, ''),
              runs,
              me,
              te,
              fullBuildCostIsk: estCost,
              outputInstantRevIsk: estOut,
              grossBuiltMarginIsk: estOut - estCost,
            });
          }
          continue;
        }

        const q = snapshot.quotes[it.typeId];
        const jita = q?.jita;
        const baseFallback = ITEM_BY_ID[it.typeId]?.baseJitaSell ?? 0;

        const walkInstant = jita ? walkBuyOrderbookForSell(jita, qty) : null;
        const instantVal =
          walkInstant && walkInstant.totalIsk > 0
            ? walkInstant.totalIsk
            : qty * (jita?.buyMax || baseFallback * 0.9);
        const sellVal = qty * (jita?.sellMin || baseFallback);

        instantSaleGross += instantVal;
        sellOrderGross += sellVal;

        // Reprocess / Refine value check
        const reprocSpec = REPROCESSING_CATALOG.find((r) => r.inputTypeId === it.typeId);
        if (reprocSpec) {
          const batches = qty / Math.max(1, reprocSpec.portionSize);
          for (const out of reprocSpec.baseOutputs) {
            const outQty = Math.floor(batches * out.quantity * reprocYield);
            const outQ = snapshot.quotes[out.typeId]?.jita;
            const outPrice =
              reprocessOutputMode === 'instant'
                ? outQ?.buyMax || (ITEM_BY_ID[out.typeId]?.baseJitaSell ?? 10) * 0.92
                : outQ?.sellMin || ITEM_BY_ID[out.typeId]?.baseJitaSell || 10;
            reprocessGross += outQty * outPrice;
          }
        } else {
          // Scrapmetal reprocessing baseline (approx 52% base mineral recovery for modules/hulls)
          reprocessGross += instantVal * Math.min(0.75, reprocYield * 0.95);
        }
      }

      const instantSaleValueIsk = instantSaleGross * (1 - salesTaxRate);
      const sellOrderValueIsk = sellOrderGross * (1 - salesTaxRate - jitaBroker);
      const reprocessTaxMult =
        reprocessOutputMode === 'instant'
          ? 1 - salesTaxRate
          : 1 - salesTaxRate - jitaBroker;
      const reprocessValueIsk = reprocessGross * reprocessTaxMult;

      // Multi-BPC Proportional Profit Allocation
      const totalPositiveMargin = rawBpcs.reduce(
        (sum, b) => sum + Math.max(1, b.grossBuiltMarginIsk),
        0
      );
      const bpcAllocations: BpcAllocationRow[] = rawBpcs.map((b) => {
        const shareWeight =
          rawBpcs.length === 1
            ? 1
            : Math.max(1, b.grossBuiltMarginIsk) / Math.max(1, totalPositiveMargin);
        const allocatedContractShareIsk = contractPriceIsk * shareWeight;
        const residualProfitIsk = b.grossBuiltMarginIsk - allocatedContractShareIsk;
        return {
          ...b,
          allocatedContractShareIsk,
          residualProfitIsk,
        };
      });

      const bpcBuiltValueIsk = bpcAllocations.reduce((s, b) => s + b.outputInstantRevIsk, 0);
      const bpcBuildCostIsk = bpcAllocations.reduce((s, b) => s + b.fullBuildCostIsk, 0);
      // Total built value = non-BPC instant liquidation + BPC built net margin
      const bpcTotalLiquidationValueIsk =
        instantSaleValueIsk + (bpcBuiltValueIsk - bpcBuildCostIsk);
      const bpcResidualProfitIsk = bpcTotalLiquidationValueIsk - contractPriceIsk;

      const candidates: {
        strategy: EvaluatedItemBpcContract['bestStrategy'];
        val: number;
      }[] = [
        { strategy: 'instant_sale', val: instantSaleValueIsk },
        { strategy: 'sell_order', val: sellOrderValueIsk },
        { strategy: 'reprocess', val: reprocessValueIsk },
      ];
      if (bpcAllocations.length > 0) {
        candidates.push({ strategy: 'build_bpc', val: bpcTotalLiquidationValueIsk });
      }
      candidates.sort((a, b) => b.val - a.val);

      const best = candidates[0];
      const netProfitIsk = best.val - contractPriceIsk;
      const profitPct =
        contractPriceIsk > 0 ? (netProfitIsk / contractPriceIsk) * 100 : 0;

      const valuationDeltaIsk = best.val - contractPriceIsk;
      const valuationDeltaPct =
        contractPriceIsk > 0 ? (valuationDeltaIsk / contractPriceIsk) * 100 : 0;

      const valuationBadge: EvaluatedItemBpcContract['valuationBadge'] =
        valuationDeltaPct >= 8
          ? 'under_valued'
          : valuationDeltaPct <= -8
            ? 'over_priced'
            : 'fair';

      return {
        contractId: c.contract_id,
        title:
          c.title?.trim() ||
          (bpcAllocations.length > 0
            ? `${bpcAllocations[0].blueprintName} (${bpcAllocations.length} BPC${bpcAllocations.length > 1 ? 's' : ''})`
            : items[0]?.name || `Contract #${c.contract_id}`),
        regionId,
        regionName,
        stationName: c.start_station_name || `${regionName} Station`,
        systemName: c.start_system_name || regionName,
        contractPriceIsk,
        volumeM3: Math.max(0.1, Number(c.volume ?? 1)),
        instantSaleValueIsk,
        sellOrderValueIsk,
        reprocessValueIsk,
        reprocessBestMode: reprocessOutputMode,
        bpcBuiltValueIsk,
        bpcBuildCostIsk,
        bpcResidualProfitIsk,
        bpcAllocations,
        bestStrategy: best.strategy,
        bestValueIsk: best.val,
        netProfitIsk,
        profitPct,
        valuationBadge,
        valuationDeltaIsk,
        valuationDeltaPct,
        items,
        hasBpc: bpcAllocations.length > 0,
        dateExpired: c.date_expired,
      };
    });
}

// --- 5. Station Trading Engine (Std Margin, Insta Flip, Hybrid, Liquidity & Station Stock) ---

export function buildStationTradingOpportunities(params: {
  snapshot: MarketSnapshot;
  profile: PilotProfile;
  appSettings: AppSettingsV22;
  hubId: TradeHubId;
  categories: MarketCategoryId[];
  rangeJumps: 0 | 1 | 2 | 3;
  qtyOverrides: Record<number, number>;
}): StationTradeOpportunity[] {
  const { snapshot, profile, appSettings, hubId, categories, rangeJumps, qtyOverrides } = params;
  const hubDef = EMPIRE_HUB_MAP[hubId] ?? EMPIRE_HUB_MAP.jita;
  const catSet = new Set(categories);

  const salesTax = 0.075 * (1 - 0.11 * Math.max(0, Math.min(5, profile.skills.accounting)));
  const brokerBreakdown = computeExactHubBrokerFee({
    hubId,
    brokerRelationsLvl: profile.skills.brokerRelations,
    standings: profile.npcStandings,
    useCustomUpwellBroker: appSettings.useCustomUpwellBroker,
    customUpwellBrokerPct: appSettings.customUpwellBrokerPct,
    includeSccSurcharge: appSettings.includeSccSurcharge,
  });
  const brokerFee = brokerBreakdown.effectiveTotalBrokerPct / 100;

  // Relist overhead allowance (~2 relists with Adv Broker Relations discount)
  const advLvl = Math.max(0, Math.min(5, profile.skills.advancedBrokerRelations ?? 0));
  const relistDiscount = 0.5 + 0.06 * advLvl;
  const relistOverheadRate = brokerFee * (1 - relistDiscount) * 2;

  // Range adjustment slightly widens effective buy-side spread for 1-3j regional buy orders
  const rangeDiscountFactor = 1 - rangeJumps * 0.004;

  const stationAssets =
    (profile.currentStationId && profile.stationAssetsByLocation?.[profile.currentStationId]) || {};

  const results: StationTradeOpportunity[] = [];

  for (const item of EVE_ITEMS) {
    const normalizedCat: MarketCategoryId =
      item.category === 'indy_support' ? 'minerals' : item.category;
    if (catSet.size > 0 && !catSet.has(normalizedCat)) continue;
    const q = snapshot.quotes[item.typeId];
    const hubQuote = q?.hubs?.[hubId] ?? (hubId === 'jita' ? q?.jita : undefined);
    const bestSell = hubQuote?.sellMin || item.baseJitaSell;
    const bestBuy = (hubQuote?.buyMax || item.baseJitaSell * 0.91) * rangeDiscountFactor;
    if (bestSell <= 0 || bestBuy <= 0) continue;

    const dailyVolume = Math.max(
      1,
      Math.round((hubQuote?.sellVolume || item.estDailyJitaVol || 50) * (hubId === 'jita' ? 0.18 : 0.08))
    );

    // Cap auto-qty to ~35% of daily volume and pilot's capital cap
    const maxAffordable = Math.max(1, Math.floor((profile.activeCapitalCap * 0.25) / Math.max(1, bestBuy)));
    const defaultQty = Math.max(1, Math.min(maxAffordable, Math.max(1, Math.round(dailyVolume * 0.35))));
    const qty = Math.max(1, qtyOverrides[item.typeId] ?? defaultQty);

    // 1. Std Margin: Buy via Buy Order -> Sell via Sell Order (pays Buy Broker + Sell Broker + Sales Tax + Relist buffer)
    const stdBuyCost = bestBuy * qty * (1 + brokerFee);
    const stdSellNet = bestSell * qty * (1 - salesTax - brokerFee - relistOverheadRate);
    const stdMarginProfitIsk = stdSellNet - stdBuyCost;
    const stdMarginRoiPct = stdBuyCost > 0 ? (stdMarginProfitIsk / stdBuyCost) * 100 : 0;
    const stdDaysToSell = Number(Math.max(0.1, qty / Math.max(1, dailyVolume * 0.25)).toFixed(1));

    // 2. Insta Flip: Buy via Sell Order (instant) -> Sell via Buy Order (instant) (Sales Tax only)
    const instaCost = bestSell * qty;
    const instaNet = bestBuy * qty * (1 - salesTax);
    const instaFlipProfitIsk = instaNet - instaCost;
    const instaFlipRoiPct = instaCost > 0 ? (instaFlipProfitIsk / instaCost) * 100 : 0;

    // 3. Hybrid: Best of (Instant Buy -> Sell Order) vs (Buy Order -> Instant Sell)
    const hybridAProfit = bestSell * qty * (1 - salesTax - brokerFee) - bestSell * qty;
    const hybridBProfit = bestBuy * qty * (1 - salesTax) - bestBuy * qty * (1 + brokerFee);
    // More realistically, Hybrid also captures slightly deeper spread (buy at top buy, sell at mid-spread or buy cheap sell order -> relist at sell percentile)
    const sellPctl = hubQuote?.sellPercentile && hubQuote.sellPercentile > bestSell ? hubQuote.sellPercentile : bestSell * 1.025;
    const hybridOrderRelist = sellPctl * qty * (1 - salesTax - brokerFee) - bestSell * qty;
    const hybridProfitIsk = Math.max(hybridAProfit, hybridBProfit, hybridOrderRelist);
    const hybridCap = bestSell * qty;
    const hybridRoiPct = hybridCap > 0 ? (hybridProfitIsk / hybridCap) * 100 : 0;

    const strategies: { key: StationTradeOpportunity['bestStrategy']; profit: number; roi: number }[] = [
      { key: 'std_margin', profit: stdMarginProfitIsk, roi: stdMarginRoiPct },
      { key: 'insta_flip', profit: instaFlipProfitIsk, roi: instaFlipRoiPct },
      { key: 'hybrid', profit: hybridProfitIsk, roi: hybridRoiPct },
    ];
    strategies.sort((a, b) => b.profit - a.profit);

    const hangarEntry = profile.hangarStock?.[item.typeId];
    const stationStockQty =
      stationAssets[item.typeId] ??
      (hubId === 'jita' ? hangarEntry?.jita ?? 0 : 0);
    const stationStockMarketValueIsk = stationStockQty * bestSell;

    results.push({
      typeId: item.typeId,
      name: item.name,
      category: normalizedCat,
      hubId,
      hubName: hubDef.shortLabel,
      systemName: hubDef.systemName,
      stationName: hubDef.stationName,
      bestBuyPrice: bestBuy,
      bestSellPrice: bestSell,
      unitVolumeM3: item.volume,
      dailyVolume,
      recommendedQty: qty,
      capitalRequiredIsk: stdBuyCost,
      stdMarginProfitIsk,
      stdMarginRoiPct,
      stdDaysToSell,
      instaFlipProfitIsk,
      instaFlipRoiPct,
      hybridProfitIsk,
      hybridRoiPct,
      bestStrategy: strategies[0].key,
      bestProfitIsk: strategies[0].profit,
      bestRoiPct: strategies[0].roi,
      stationStockQty,
      stationStockMarketValueIsk,
      rangeJumps,
      trend: deriveQuickMultiPeriodTrend(item.typeId, hubQuote),
    });
  }

  return results;
}

// --- 6. Gank Tab: Threat vs. Target / Victim Evaluator (CONCORD Strictly Excluded from TTK) ---

export const GANK_HULL_CATALOG: GankHullStats[] = [
  {
    id: 'catalyst_gank',
    name: 'Catalyst (T2 Polarized Blaster Ganker)',
    hullClass: 'Destroyer',
    ehp: 4_800,
    dps: 790,
    alphaDps: 1_550,
    maxSpeedMs: 390,
    alignSec: 3.1,
    sigRadiusM: 68,
    cargoM3: 320,
    hullAndFitIsk: 14_500_000,
    resists: { em: 32, thermal: 45, kinetic: 52, explosive: 20 },
    optimalRangeKm: 2.2,
    trackingRadS: 0.48,
    overloadModules: ['Light Neutron Blaster II (Rack)', 'Magnetic Field Stabilizer (N/A passive)'],
  },
  {
    id: 'tornado_alpha',
    name: 'Tornado (1400mm Artillery Alpha)',
    hullClass: 'Attack Battlecruiser',
    ehp: 16_500,
    dps: 540,
    alphaDps: 11_800,
    maxSpeedMs: 1_120,
    alignSec: 5.8,
    sigRadiusM: 255,
    cargoM3: 450,
    hullAndFitIsk: 115_000_000,
    resists: { em: 15, thermal: 35, kinetic: 50, explosive: 55 },
    optimalRangeKm: 24.0,
    trackingRadS: 0.025,
    overloadModules: ['1400mm Howitzer Artillery II (Rack)', '50MN Microwarpdrive'],
  },
  {
    id: 'thrasher_gank',
    name: 'Thrasher (Arty / Autocannon Ganker)',
    hullClass: 'Destroyer',
    ehp: 5_200,
    dps: 510,
    alphaDps: 2_600,
    maxSpeedMs: 460,
    alignSec: 2.8,
    sigRadiusM: 64,
    cargoM3: 380,
    hullAndFitIsk: 9_500_000,
    resists: { em: 18, thermal: 38, kinetic: 48, explosive: 52 },
    optimalRangeKm: 4.5,
    trackingRadS: 0.34,
    overloadModules: ['200mm AutoCannon II / 280mm Artillery (Rack)', '1MN Afterburner'],
  },
  {
    id: 'bustard_dst',
    name: 'Bustard (Tanked DST)',
    hullClass: 'Deep Space Transport',
    ehp: 195_000,
    dps: 35,
    alphaDps: 80,
    maxSpeedMs: 920,
    alignSec: 9.8,
    sigRadiusM: 290,
    cargoM3: 62_500,
    hullAndFitIsk: 340_000_000,
    resists: { em: 68, thermal: 78, kinetic: 82, explosive: 76 },
    optimalRangeKm: 5.0,
    trackingRadS: 0.15,
    overloadModules: ['Multispectrum Shield Hardener II', 'EM Shield Hardener II', '50MN MWD (Cloak Trick)'],
  },
  {
    id: 'crane_br',
    name: 'Crane (Covert Blockade Runner)',
    hullClass: 'Blockade Runner',
    ehp: 34_000,
    dps: 0,
    alphaDps: 0,
    maxSpeedMs: 1_450,
    alignSec: 3.4,
    sigRadiusM: 120,
    cargoM3: 10_200,
    hullAndFitIsk: 285_000_000,
    resists: { em: 45, thermal: 65, kinetic: 72, explosive: 68 },
    optimalRangeKm: 0,
    trackingRadS: 0,
    overloadModules: ['Multispectrum Shield Hardener II', '50MN MWD (Gate Burn)'],
  },
  {
    id: 'badger_t1',
    name: 'Badger (T1 Hauler)',
    hullClass: 'Hauler',
    ehp: 24_000,
    dps: 0,
    alphaDps: 0,
    maxSpeedMs: 780,
    alignSec: 7.4,
    sigRadiusM: 210,
    cargoM3: 18_500,
    hullAndFitIsk: 14_000_000,
    resists: { em: 30, thermal: 50, kinetic: 62, explosive: 55 },
    optimalRangeKm: 0,
    trackingRadS: 0,
    overloadModules: ['Multispectrum Shield Hardener II', '50MN MWD'],
  },
  {
    id: 'charon_freighter',
    name: 'Charon (Bulkhead Freighter)',
    hullClass: 'Freighter',
    ehp: 485_000,
    dps: 0,
    alphaDps: 0,
    maxSpeedMs: 65,
    alignSec: 26.0,
    sigRadiusM: 2_800,
    cargoM3: 935_000,
    hullAndFitIsk: 2_900_000_000,
    resists: { em: 33, thermal: 33, kinetic: 33, explosive: 33 },
    optimalRangeKm: 0,
    trackingRadS: 0,
    overloadModules: ['None (Freighter has no active modules — rely on web alt / scout)'],
  },
  {
    id: 'gila_pve',
    name: 'Gila (Shield Cruiser / Abyssal)',
    hullClass: 'Faction Cruiser',
    ehp: 68_000,
    dps: 680,
    alphaDps: 980,
    maxSpeedMs: 1_240,
    alignSec: 5.2,
    sigRadiusM: 145,
    cargoM3: 480,
    hullAndFitIsk: 420_000_000,
    resists: { em: 52, thermal: 70, kinetic: 74, explosive: 64 },
    optimalRangeKm: 32.0,
    trackingRadS: 0.22,
    overloadModules: ['Multispectrum Shield Hardener II', 'Rapid Light Missile Launcher II', '10MN Afterburner'],
  },
  {
    id: 'hecate_t3d',
    name: 'Hecate (T3 Tactical Destroyer)',
    hullClass: 'Tactical Destroyer',
    ehp: 22_000,
    dps: 690,
    alphaDps: 1_350,
    maxSpeedMs: 2_450,
    alignSec: 1.9,
    sigRadiusM: 58,
    cargoM3: 420,
    hullAndFitIsk: 95_000_000,
    resists: { em: 58, thermal: 64, kinetic: 66, explosive: 48 },
    optimalRangeKm: 3.2,
    trackingRadS: 0.55,
    overloadModules: ['Light Neutron Blaster II (Rack)', '5MN Microwarpdrive', 'Small Ancillary Armor Repairer'],
  },
];

export function parseScannedCargoAndFitText(
  rawText: string,
  snapshot: MarketSnapshot
): {
  parsedItemCount: number;
  estimatedCargoIsk: number;
  detectedModules: string[];
} {
  if (!rawText.trim()) {
    return { parsedItemCount: 0, estimatedCargoIsk: 0, detectedModules: [] };
  }
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let parsedItemCount = 0;
  let estimatedCargoIsk = 0;
  const detectedModules: string[] = [];

  for (const line of lines) {
    // Support "Item Name\tQty" or "Qty x Item Name" or "Item Name x Qty"
    const tabParts = line.split('\t');
    let name = line;
    let qty = 1;
    if (tabParts.length >= 2) {
      name = tabParts[0].trim();
      const num = Number(tabParts[1].replace(/[^\d.]/g, ''));
      if (Number.isFinite(num) && num > 0) qty = num;
    } else {
      const m = line.match(/^([\d,]+)\s*x?\s+(.+)$/i) || line.match(/^(.+?)\s+x?\s*([\d,]+)$/i);
      if (m) {
        if (/^\d/.test(m[1])) {
          qty = Number(m[1].replace(/,/g, '')) || 1;
          name = m[2].trim();
        } else {
          name = m[1].trim();
          qty = Number(m[2].replace(/,/g, '')) || 1;
        }
      }
    }

    const lower = name.toLowerCase();
    const matched = EVE_ITEMS.find((it) => it.name.toLowerCase() === lower) ??
      EVE_ITEMS.find((it) => lower.includes(it.name.toLowerCase()) && it.name.length > 4);

    if (matched) {
      const price = snapshot.quotes[matched.typeId]?.jita?.sellMin || matched.baseJitaSell || 0;
      estimatedCargoIsk += price * qty;
      parsedItemCount += 1;
    } else if (/hardener|extender|plate|repairer|booster|blaster|artillery|cloak|warp|stabilizer|bulkhead/i.test(name)) {
      detectedModules.push(name);
    }
  }

  return { parsedItemCount, estimatedCargoIsk, detectedModules };
}

export function evaluateGankEngagement(params: {
  ownHull: GankHullStats;
  targetHull: GankHullStats;
  targetPilot: GankPilotIntel | null;
  targetCargoIsk: number;
  ownCargoIsk: number;
}): GankEvaluationResult {
  const { ownHull, targetHull, targetPilot, targetCargoIsk, ownCargoIsk } = params;

  // Identify target's weakest resist profile
  const resistEntries: { label: GankEvaluationResult['recommendedDamageType']; val: number }[] = [
    { label: 'EM', val: targetHull.resists.em },
    { label: 'Thermal', val: targetHull.resists.thermal },
    { label: 'Kinetic', val: targetHull.resists.kinetic },
    { label: 'Explosive', val: targetHull.resists.explosive },
  ];
  resistEntries.sort((a, b) => a.val - b.val);
  const weakest = resistEntries[0];

  // Effective DPS applying against weakest resist (vs average resist baseline)
  const avgTargetRes =
    (targetHull.resists.em +
      targetHull.resists.thermal +
      targetHull.resists.kinetic +
      targetHull.resists.explosive) /
    4;
  const resistAdvantageMult = Math.max(
    0.85,
    (100 - weakest.val) / Math.max(10, 100 - avgTargetRes)
  );
  // Overheating weapons adds ~15% DPS
  const heatedOwnDps = ownHull.dps * 1.15 * resistAdvantageMult;
  const heatedTargetDps = targetHull.dps * 1.15;

  // Pure ship-vs-ship TTK (CONCORD strictly excluded)
  const ttkTargetSec =
    heatedOwnDps > 1 ? Math.round(targetHull.ehp / heatedOwnDps) : Infinity;
  const timeToBeKilledSec =
    heatedTargetDps > 1 ? Math.round(ownHull.ehp / heatedTargetDps) : Infinity;

  // Optimal tactical envelope
  const isEvading =
    ownHull.dps < 100 ||
    (Number.isFinite(timeToBeKilledSec) && timeToBeKilledSec <= ttkTargetSec * 0.9) ||
    (targetPilot?.posture === 'ganker_threat' && ownHull.cargoM3 >= 5000);

  const optimalOrbitKm = isEvading
    ? Math.max(25, Math.round(targetHull.optimalRangeKm * 2.2))
    : Math.max(1.5, Number((ownHull.optimalRangeKm * 0.82).toFixed(1)));
  const optimalSpeedMs = Math.round(ownHull.maxSpeedMs * (isEvading ? 1.0 : 0.78));
  const optimalAngularRadS = Number(
    (optimalSpeedMs / Math.max(500, optimalOrbitKm * 1000)).toFixed(3)
  );

  // EVE 50% loot fairy expectation on target cargo + fit
  const expectedLootDropIsk = (targetCargoIsk + targetHull.hullAndFitIsk * 0.45) * 0.5;
  const ownShipRiskIsk = ownHull.hullAndFitIsk + ownCargoIsk;
  const winProbability =
    !Number.isFinite(ttkTargetSec)
      ? 0.05
      : !Number.isFinite(timeToBeKilledSec)
        ? 0.92
        : Math.max(0.05, Math.min(0.95, timeToBeKilledSec / (ttkTargetSec + timeToBeKilledSec)));

  const netExpectedValueIsk =
    winProbability * expectedLootDropIsk - (1 - winProbability) * ownShipRiskIsk;

  const recommendation: 'FIGHT' | 'EVADE' =
    !isEvading && Number.isFinite(ttkTargetSec) && ttkTargetSec < timeToBeKilledSec && netExpectedValueIsk > 0
      ? 'FIGHT'
      : 'EVADE';

  const confidenceLabel =
    recommendation === 'FIGHT'
      ? winProbability >= 0.75
        ? 'High Tactical Advantage'
        : 'Marginal Advantage (Heat Required)'
      : ownHull.dps < 100
        ? 'Non-Combat Hull — Immediate Evasion'
        : 'Unfavorable TTK / Risk Ratio';

  const tacticalNotes: string[] = [];
  if (recommendation === 'FIGHT') {
    tacticalNotes.push(
      `Load ${weakest.label} ammo/drones to exploit ${targetHull.name}'s ${weakest.val}% ${weakest.label} resist hole.`
    );
    tacticalNotes.push(
      `Hold ~${optimalOrbitKm} km orbit at ${optimalSpeedMs} m/s (${optimalAngularRadS} rad/s) to stay inside weapon optimal while reducing incoming tracking.`
    );
  } else {
    tacticalNotes.push(
      `Avoid direct grid brawl: align out (${ownHull.alignSec.toFixed(1)}s) or burn to gate/station while pulsing overheated tank/prop.`
    );
    if (targetHull.alphaDps >= ownHull.ehp * 0.45) {
      tacticalNotes.push(
        `High Alpha Warning: ${targetHull.name} delivers ~${targetHull.alphaDps.toLocaleString('en-US')} volley — avoid autopilot and dock/cloak immediately.`
      );
    }
  }
  if (targetPilot?.posture === 'ganker_threat') {
    tacticalNotes.push(
      `Pilot intel flags ${targetPilot.characterName} as Ganker/Threat (${targetPilot.dangerRatio}% danger ratio) — expect wingmates/alting scouts.`
    );
  }

  return {
    recommendation,
    confidenceLabel,
    optimalSpeedMs,
    optimalAngularRadS,
    optimalOrbitKm,
    recommendedDamageType: weakest.label,
    weakestResistPct: weakest.val,
    modulesToOverload: ownHull.overloadModules,
    ttkTargetSec,
    timeToBeKilledSec,
    expectedLootDropIsk,
    ownShipRiskIsk,
    netExpectedValueIsk,
    tacticalNotes,
  };
}
