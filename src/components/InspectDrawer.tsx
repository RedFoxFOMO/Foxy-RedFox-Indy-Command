import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Check,
  Clock,
  Compass,
  Copy,
  LineChart,
  Lock,
  Minus,
  PackageCheck,
  Plus,
  RotateCcw,
  Table2,
  Truck,
  X,
} from 'lucide-react';
import { EMPIRE_HUB_LIST, EMPIRE_HUB_MAP, EVE_ANCHORS, ITEM_BY_ID } from '../data/eveCatalog.ts';
import {
  formatIsk,
  formatM3,
  formatPct,
  getBrokerFeeRate,
  getHubQuote,
  getQuote,
  getSalesTaxRate,
} from '../engines/decisionEngines.ts';
import { getDotlanRouteUrl } from '../utils/dotlan.ts';
import {
  computeBlueprintBuildTime,
  formatDurationCompact,
  getMaxIndustrySlots,
  walkBuyOrderbookForSell,
  walkSellOrderbookForBuy,
} from '../utils/eveMarketMath.ts';
import { copyTextToClipboard, formatEveMultibuyText } from '../utils/eveMultibuy.ts';
import { buildDepthAwareOrderLines } from '../utils/v22Engines.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  IndustryStructureConfig,
  MarketSnapshot,
  OrderExecutionMode,
  PerOutputDestinationOption,
  PilotProfile,
  ShoppingListLine,
  TradeHubId,
} from '../types/eve.ts';
import type { HaulerFlyoutContext } from './HaulerFitFlyout.tsx';
import { LiveOrderBookPanel } from './LiveOrderBookPanel.tsx';

interface InspectDrawerProps {
  card: ActionCardData | null;
  profile: PilotProfile;
  eveAccessToken: string | null;
  appSettings?: AppSettingsV22;
  snapshot?: MarketSnapshot;
  committedQty?: number;
  onCommitQty?: (cardId: string, qty: number) => void;
  onResetQty?: (cardId: string) => void;
  cardExecutionModeOverride?: OrderExecutionMode;
  cardTransportCostIsk?: number;
  haulCostOverrideIsk?: number | null;
  structureConfig?: IndustryStructureConfig;
  activeMfgJobCount?: number;
  onOpenHaulerFlyout?: (ctx: HaulerFlyoutContext) => void;
  shoppingListMode: boolean;
  shoppingList: ShoppingListLine[];
  shoppingTotalIsk: number;
  shoppingTotalM3: number;
  shoppingSavingsIsk: number;
  deductHangarStock: boolean;
  onToggleDeductHangarStock: (next: boolean) => void;
  customItemCount: number;
  onClearCustomShoppingItems: () => void;
  onOpenHistory: (typeId: number, name: string) => void;
  onOpenSsoSettings: () => void;
  onClose: () => void;
}

const DEFAULT_STRUCTURE: IndustryStructureConfig = {
  structureType: 'raitaru',
  meRig: 't1',
  teRig: 't1',
  costRig: 'none',
  facilityTaxPct: 1.0,
  systemName: 'Ishisomo',
  systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
};

function computeStepperDelta(currentQty: number, isIndy: boolean): number {
  if (isIndy) {
    if (currentQty >= 500) return 50;
    if (currentQty >= 100) return 10;
    if (currentQty >= 20) return 5;
    return 1;
  }
  if (currentQty >= 10000) return 1000;
  if (currentQty >= 1000) return 100;
  if (currentQty >= 100) return 25;
  if (currentQty >= 20) return 5;
  return 1;
}

function parseFormattedIskOrNumber(raw: string | number | undefined): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  const s = String(raw).trim().replace(/,/g, '');
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*([BMK])?/i);
  if (!m) return 0;
  const val = Number(m[1]);
  if (!Number.isFinite(val)) return 0;
  const suffix = (m[2] || '').toUpperCase();
  if (suffix === 'B') return val * 1_000_000_000;
  if (suffix === 'M') return val * 1_000_000;
  if (suffix === 'K') return val * 1_000;
  return val;
}

export function InspectDrawer({
  card,
  profile,
  eveAccessToken,
  appSettings,
  snapshot,
  committedQty,
  onCommitQty,
  onResetQty,
  cardExecutionModeOverride,
  cardTransportCostIsk = 0,
  haulCostOverrideIsk = null,
  structureConfig = DEFAULT_STRUCTURE,
  activeMfgJobCount,
  onOpenHaulerFlyout,
  shoppingListMode,
  shoppingList,
  shoppingTotalIsk,
  shoppingTotalM3,
  shoppingSavingsIsk,
  deductHangarStock,
  onToggleDeductHangarStock,
  customItemCount,
  onClearCustomShoppingItems,
  onOpenHistory,
  onOpenSsoSettings,
  onClose,
}: InspectDrawerProps) {
  const [copiedCount, setCopiedCount] = useState<number | null>(null);
  const [copiedSplitKind, setCopiedSplitKind] = useState<'buy' | 'sell' | null>(null);
  const [drawerView, setDrawerView] = useState<'inspection' | 'orderbook'>('inspection');
  const [extraEffortTargetIsk, setExtraEffortTargetIsk] = useState<number>(2_000_000);
  const [lockedOutputIds, setLockedOutputIds] = useState<Record<number, boolean>>({});
  const copyTimerRef = useRef<number | null>(null);
  const splitCopyTimerRef = useRef<number | null>(null);

  const isIndyCard = card?.engine === 'indy_invention';
  const effectiveExecMode: OrderExecutionMode =
    cardExecutionModeOverride ?? card?.executionMode ?? 'list_orders';
  const effectiveTransportCostIsk =
    typeof haulCostOverrideIsk === 'number' && haulCostOverrideIsk >= 0
      ? haulCostOverrideIsk
      : Math.max(0, cardTransportCostIsk);

  const advisedQty = card
    ? Math.max(1, Math.round(card.baseBatchQty ?? card.outputUnits ?? 1))
    : 1;
  const optimalQty = card
    ? Math.max(1, Math.round(card.optimalProfitableQty ?? advisedQty))
    : 1;
  const effectiveQty = card
    ? Math.max(1, Math.round(committedQty ?? advisedQty))
    : 1;
  const isQtyOverridden = Boolean(card && effectiveQty !== advisedQty);
  const scaleRatio = advisedQty > 0 ? effectiveQty / advisedQty : 1;
  const stepDelta = computeStepperDelta(effectiveQty, isIndyCard);

  const commitQty = (next: number) => {
    if (!card || !onCommitQty) return;
    const clamped = Math.max(1, Math.min(10_000_000, Math.round(next || 1)));
    onCommitQty(card.id, clamped);
  };

  const resetToAdvised = () => {
    if (!card) return;
    if (onResetQty) {
      onResetQty(card.id);
    } else if (onCommitQty) {
      onCommitQty(card.id, advisedQty);
    }
  };

  const slotInfo = useMemo(() => {
    const info = getMaxIndustrySlots(profile);
    const active = typeof activeMfgJobCount === 'number' ? activeMfgJobCount : info.mfgActive;
    return { ...info, mfgActive: active, mfgAvailable: Math.max(1, info.mfgSlotsMax - active) };
  }, [profile, activeMfgJobCount]);

  // Live depth-walked metrics derived directly from effectiveQty (identical math to ActionCard)
  const liveMetrics = useMemo(() => {
    if (!card) return null;

    const salesTax = getSalesTaxRate(profile.skills.accounting);
    const brokerFee = getBrokerFeeRate(profile.skills.brokerRelations, effectiveExecMode, {
      hubId: card.destHubId ?? 'jita',
      standings: profile.npcStandings,
      appSettings,
    });
    const netSaleMult = Math.max(0.05, 1 - salesTax - brokerFee);

    if (isIndyCard && card.bomMaterials && card.bomMaterials.length > 0 && snapshot) {
      const stockMap = new Map<number, number>();
      for (const s of Object.values(profile.hangarStock ?? {})) {
        stockMap.set(s.typeId, (stockMap.get(s.typeId) ?? 0) + s.total);
      }

      let buyAllMatCost = 0;
      let buyMissingMatCost = 0;
      let rawInputM3 = 0;
      let maxInputSlippagePct = 0;
      let inputShortfallCount = 0;

      for (const mat of card.bomMaterials) {
        const reqUnits = Math.max(1, Math.ceil(mat.qtyPerRun * effectiveQty));
        const q = getQuote(snapshot, mat.typeId);
        const hub = getHubQuote(q, 'jita', ITEM_BY_ID[mat.typeId]);
        const allWalk = walkSellOrderbookForBuy(hub, reqUnits);
        const unitCostFallback = hub.sellMin > 0 ? hub.sellMin : mat.unitPriceTopOfBook;
        const matAllIsk =
          allWalk.filledQty > 0
            ? allWalk.totalIsk + allWalk.shortfallQty * allWalk.weightedAvgPrice
            : reqUnits * unitCostFallback;
        buyAllMatCost += matAllIsk;

        const owned = stockMap.get(mat.typeId) ?? 0;
        const missing = Math.max(0, reqUnits - owned);
        if (missing > 0) {
          const missWalk = walkSellOrderbookForBuy(hub, missing);
          const matMissIsk =
            missWalk.filledQty > 0
              ? missWalk.totalIsk + missWalk.shortfallQty * missWalk.weightedAvgPrice
              : missing * unitCostFallback;
          buyMissingMatCost += matMissIsk;
          maxInputSlippagePct = Math.max(maxInputSlippagePct, missWalk.slippagePct);
          if (missWalk.shortfallQty > 0) inputShortfallCount += 1;
        }
        rawInputM3 += reqUnits * (mat.unitVolumeM3 || ITEM_BY_ID[mat.typeId]?.volume || 0.01);
      }

      const baseJobFeeEstimate = Math.max(
        0,
        card.requiredCapitalIsk -
          card.bomMaterials.reduce((s, m) => s + m.qtyPerRun * advisedQty * m.unitPriceTopOfBook, 0)
      );
      const scaledJobFee = baseJobFeeEstimate * scaleRatio;

      const outputPerRun = Math.max(1, card.outputPerRun ?? 1);
      const totalOutputUnits = effectiveQty * outputPerRun;
      const prodQuote = card.primaryTypeId ? getQuote(snapshot, card.primaryTypeId) : null;
      const sellHubId = card.destHubId ?? 'jita';
      const sellHub = prodQuote
        ? getHubQuote(prodQuote, sellHubId, card.primaryTypeId ? ITEM_BY_ID[card.primaryTypeId] : undefined)
        : null;

      let grossRevenueIsk = card.netProfitIsk * scaleRatio + (buyAllMatCost + scaledJobFee);
      let sellSlippagePct = 0;
      let sellShortfallQty = 0;

      if (sellHub && (sellHub.sellMin > 0 || sellHub.buyMax > 0)) {
        if (effectiveExecMode === 'instant_fill') {
          const sellWalk = walkBuyOrderbookForSell(sellHub, totalOutputUnits);
          grossRevenueIsk =
            sellWalk.filledQty > 0 ? sellWalk.totalIsk : totalOutputUnits * sellHub.buyMax;
          sellSlippagePct = sellWalk.slippagePct;
          sellShortfallQty = sellWalk.shortfallQty;
        } else {
          grossRevenueIsk = totalOutputUnits * (sellHub.sellMin > 0 ? sellHub.sellMin : sellHub.buyMax);
        }
      }

      const netRevenueIsk = grossRevenueIsk * netSaleMult;
      const buyAllCapitalIsk = buyAllMatCost + scaledJobFee;
      const buyMissingCapitalIsk = buyMissingMatCost + scaledJobFee;
      const buyAllProfitIsk = netRevenueIsk - buyAllCapitalIsk - effectiveTransportCostIsk;
      const buyMissingProfitIsk = netRevenueIsk - buyMissingCapitalIsk - effectiveTransportCostIsk;
      const netMarginPct = grossRevenueIsk > 0 ? (buyAllProfitIsk / grossRevenueIsk) * 100 : card.netMarginPct;
      const roiPct = buyAllCapitalIsk > 0 ? (buyAllProfitIsk / buyAllCapitalIsk) * 100 : card.roiPct;
      const packagedOutputM3 =
        totalOutputUnits *
        (card.unitOutputM3 || (card.primaryTypeId ? ITEM_BY_ID[card.primaryTypeId]?.volume : 0) || 0.1);
      const totalVolumeM3 = Math.max(rawInputM3, packagedOutputM3);

      const buildTime = computeBlueprintBuildTime({
        baseRunDurationSec: card.baseRunDurationSec ?? 3600,
        runs: effectiveQty,
        bpTe: card.bpTe ?? 20,
        industryLvl: profile.skills.industry ?? 5,
        advIndustryLvl: profile.skills.advancedIndustry ?? 4,
        reactionsLvl: profile.skills.reactions ?? 4,
        isReaction: false,
        structureConfig,
        allocatedSlots: 1,
        maxAvailableSlots: slotInfo.mfgSlotsMax,
      });

      const iskPerHour =
        buildTime.concurrentWallClockSec > 0
          ? buyAllProfitIsk / (buildTime.concurrentWallClockSec / 3600)
          : null;

      return {
        requiredCapitalIsk: buyAllCapitalIsk,
        buyMissingCapitalIsk,
        buyMissingProfitIsk,
        grossRevenueIsk,
        netProfitIsk: buyAllProfitIsk,
        netMarginPct,
        roiPct,
        totalVolumeM3,
        rawInputM3,
        packagedOutputM3,
        slippagePct: Math.max(maxInputSlippagePct, sellSlippagePct),
        shortfallQty: sellShortfallQty + inputShortfallCount,
        totalOutputUnits,
        buildTime,
        iskPerHour,
      };
    }

    if (card.primaryTypeId && snapshot && (card.sourceHubId || card.destHubId)) {
      const q = getQuote(snapshot, card.primaryTypeId);
      const itemMeta = ITEM_BY_ID[card.primaryTypeId];
      const buyHub = getHubQuote(q, card.sourceHubId ?? 'jita', itemMeta);
      const sellHub = getHubQuote(q, card.destHubId ?? 'dodixie', itemMeta);

      if (buyHub.sellMin > 0 && (sellHub.sellMin > 0 || sellHub.buyMax > 0)) {
        const buyWalk = walkSellOrderbookForBuy(buyHub, effectiveQty);
        const totalBuyIsk =
          buyWalk.filledQty > 0
            ? buyWalk.totalIsk + buyWalk.shortfallQty * buyWalk.weightedAvgPrice
            : effectiveQty * buyHub.sellMin;

        let grossRevenueIsk = 0;
        let sellSlippage = 0;
        let sellShortfall = 0;

        if (effectiveExecMode === 'instant_fill') {
          const sellWalk = walkBuyOrderbookForSell(sellHub, effectiveQty);
          grossRevenueIsk = sellWalk.filledQty > 0 ? sellWalk.totalIsk : effectiveQty * sellHub.buyMax;
          sellSlippage = sellWalk.slippagePct;
          sellShortfall = sellWalk.shortfallQty;
        } else {
          grossRevenueIsk = effectiveQty * (sellHub.sellMin > 0 ? sellHub.sellMin : sellHub.buyMax);
        }

        const netRevenueIsk = grossRevenueIsk * netSaleMult;
        const netProfitIsk = netRevenueIsk - totalBuyIsk - effectiveTransportCostIsk;
        const netMarginPct = grossRevenueIsk > 0 ? (netProfitIsk / grossRevenueIsk) * 100 : 0;
        const roiPct = totalBuyIsk > 0 ? (netProfitIsk / totalBuyIsk) * 100 : 0;
        const unitVol =
          card.unitOutputM3 || itemMeta?.volume || (advisedQty > 0 ? card.totalVolumeM3 / advisedQty : 1);
        const totalVolumeM3 = effectiveQty * unitVol;

        return {
          requiredCapitalIsk: totalBuyIsk,
          buyMissingCapitalIsk: undefined,
          buyMissingProfitIsk: undefined,
          grossRevenueIsk,
          netProfitIsk,
          netMarginPct,
          roiPct,
          totalVolumeM3,
          rawInputM3: totalVolumeM3,
          packagedOutputM3: totalVolumeM3,
          slippagePct: Math.max(buyWalk.slippagePct, sellSlippage),
          shortfallQty: buyWalk.shortfallQty + sellShortfall,
          totalOutputUnits: effectiveQty,
          buildTime: null,
          iskPerHour: null,
        };
      }
    }

    const scaledCap = card.requiredCapitalIsk * scaleRatio;
    const scaledProfit = card.netProfitIsk * scaleRatio - effectiveTransportCostIsk;
    const scaledVol = card.totalVolumeM3 * scaleRatio;
    const scaledRoi = scaledCap > 0 ? (scaledProfit / scaledCap) * 100 : card.roiPct;
    return {
      requiredCapitalIsk: scaledCap,
      buyMissingCapitalIsk:
        typeof card.buyMissingCapitalIsk === 'number'
          ? card.buyMissingCapitalIsk * scaleRatio
          : undefined,
      buyMissingProfitIsk:
        typeof card.buyMissingProfitIsk === 'number'
          ? card.buyMissingProfitIsk * scaleRatio - effectiveTransportCostIsk
          : undefined,
      grossRevenueIsk: scaledCap + scaledProfit,
      netProfitIsk: scaledProfit,
      netMarginPct: card.netMarginPct,
      roiPct: scaledRoi,
      totalVolumeM3: scaledVol,
      rawInputM3: scaledVol,
      packagedOutputM3: scaledVol,
      slippagePct: Math.max(
        card.depthWalkBuy?.slippagePct ?? 0,
        card.depthWalkSell?.slippagePct ?? 0
      ),
      shortfallQty:
        (card.depthWalkBuy?.shortfallQty ?? 0) + (card.depthWalkSell?.shortfallQty ?? 0),
      totalOutputUnits: Math.max(1, Math.round((card.outputUnits || advisedQty) * scaleRatio)),
      buildTime: null,
      iskPerHour: null,
    };
  }, [
    card,
    effectiveQty,
    advisedQty,
    scaleRatio,
    isIndyCard,
    snapshot,
    profile,
    appSettings,
    effectiveExecMode,
    effectiveTransportCostIsk,
    structureConfig,
    slotInfo.mfgSlotsMax,
  ]);

  // Hauler sizing & jump recommendation derived directly from effectiveQty volume
  const haulerSizing = useMemo(() => {
    if (!card || !liveMetrics) return null;
    const vol = Math.max(0, liveMetrics.totalVolumeM3);
    const fleet = [...(profile.hulls ?? [])]
      .filter((h) => h.capacityM3 > 0)
      .sort((a, b) => a.capacityM3 - b.capacityM3);

    const fitting = fleet.find((h) => h.capacityM3 >= vol);
    const largest = fleet[fleet.length - 1];
    const chosen = fitting ?? largest ?? null;
    const trips = chosen ? Math.max(1, Math.ceil(vol / Math.max(1, chosen.capacityM3))) : 1;

    const allLegs = card.routeChains?.flatMap((ch) => ch.legs) ?? [];
    const firstStop = allLegs[0];
    const lastStop = allLegs[allLegs.length - 1];
    const originSystemId = firstStop?.systemId ?? EVE_ANCHORS.JITA_SYSTEM_ID;
    const destSystemId =
      lastStop?.systemId ?? (isIndyCard ? structureConfig.systemId : EVE_ANCHORS.DODIXIE_SYSTEM_ID);
    const originName = firstStop?.systemName ?? (card.sourceHubId ? EMPIRE_HUB_MAP[card.sourceHubId]?.systemName : 'Jita');
    const destName =
      lastStop?.systemName ??
      (card.destHubId
        ? EMPIRE_HUB_MAP[card.destHubId]?.systemName
        : isIndyCard
          ? structureConfig.systemName
          : 'Dodixie');

    const hubJumpsFromJita: Record<TradeHubId, number> = {
      jita: 0,
      amarr: 10,
      dodixie: 12,
      hek: 19,
      rens: 24,
    };
    const totalJumpsEst =
      card.sourceHubId && card.destHubId && card.sourceHubId !== card.destHubId
        ? Math.max(
            1,
            Math.abs(
              (hubJumpsFromJita[card.destHubId] ?? 10) -
                (hubJumpsFromJita[card.sourceHubId] ?? 0)
            )
          )
        : originSystemId !== destSystemId
          ? 3
          : 0;

    return {
      chosenName: chosen ? chosen.name : vol > 60_000 ? 'Freighter' : vol > 12_000 ? 'DST / Bustard' : 'T1 Industrial',
      chosenCapacityM3: chosen?.capacityM3 ?? 0,
      trips,
      originSystemId,
      destSystemId,
      originName,
      destName,
      totalJumpsEst,
    };
  }, [card, liveMetrics, profile.hulls, isIndyCard, structureConfig.systemId, structureConfig.systemName]);

  // Live scaled inspection table rows (BOM depth-walk for Indy, per-row depth-walk for Empire Trade, clean ratio scaling for others)
  const scaledInspectionRows = useMemo(() => {
    if (!card) return [];

    // 1. Indy BOM: compute live depth-walked rows directly from card.bomMaterials & effectiveQty
    if (isIndyCard && card.bomMaterials && card.bomMaterials.length > 0 && snapshot) {
      const stockMap = new Map<number, number>();
      for (const s of Object.values(profile.hangarStock ?? {})) {
        stockMap.set(s.typeId, (stockMap.get(s.typeId) ?? 0) + s.total);
      }

      return card.bomMaterials.map((mat) => {
        const reqUnits = Math.max(1, Math.ceil(mat.qtyPerRun * effectiveQty));
        const q = getQuote(snapshot, mat.typeId);
        const hub = getHubQuote(q, 'jita', ITEM_BY_ID[mat.typeId]);
        const walk = walkSellOrderbookForBuy(hub, reqUnits);
        const unitFallback = hub.sellMin > 0 ? hub.sellMin : mat.unitPriceTopOfBook;
        const avgUnit = walk.filledQty > 0 ? walk.weightedAvgPrice : unitFallback;
        const subtotal =
          walk.filledQty > 0
            ? walk.totalIsk + walk.shortfallQty * walk.weightedAvgPrice
            : reqUnits * unitFallback;
        const volM3 = reqUnits * (mat.unitVolumeM3 || ITEM_BY_ID[mat.typeId]?.volume || 0.01);
        const owned = stockMap.get(mat.typeId) ?? 0;
        const netMissing = Math.max(0, reqUnits - owned);

        const sourcingParts: string[] = [];
        if (owned > 0) {
          sourcingParts.push(
            netMissing === 0
              ? `In Stock (${owned.toLocaleString('en-US')})`
              : `Stock ${owned.toLocaleString('en-US')} · Buy ${netMissing.toLocaleString('en-US')}`
          );
        } else {
          sourcingParts.push('Jita 4-4');
        }
        if (walk.shortfallQty > 0) {
          sourcingParts.push(`Shortfall -${walk.shortfallQty.toLocaleString('en-US')}`);
        } else if (walk.slippagePct >= 0.5) {
          sourcingParts.push(`Slip +${walk.slippagePct.toFixed(1)}%`);
        }

        return {
          _typeId: mat.typeId,
          _itemName: mat.name,
          material: mat.name,
          qty: reqUnits.toLocaleString('en-US'),
          unitPrice: formatIsk(avgUnit, false),
          totalCost: formatIsk(subtotal),
          volume: formatM3(volM3),
          sourcing: sourcingParts.join(' · '),
        } as Record<string, string | number>;
      });
    }

    if (!isQtyOverridden && !cardExecutionModeOverride) {
      return card.inspection.rows;
    }

    const salesTax = getSalesTaxRate(profile.skills.accounting);
    const brokerFee = getBrokerFeeRate(profile.skills.brokerRelations, effectiveExecMode, {
      hubId: card.destHubId ?? 'jita',
      standings: profile.npcStandings,
      appSettings,
    });
    const netSaleMult = Math.max(0.05, 1 - salesTax - brokerFee);

    return card.inspection.rows.map((row) => {
      const next: Record<string, string | number | undefined> = { ...row };
      const typeId = typeof row._typeId === 'number' ? row._typeId : 0;

      // 2. 5-Hub Regional Trade: live depth-walk each row at scaled qty
      if (card.engine === 'regional_trade' && typeId > 0 && snapshot) {
        const baseRowQty = Math.max(1, Math.round(parseFormattedIskOrNumber(row.qty)));
        const rowQty =
          card.inspection.rows.length === 1
            ? effectiveQty
            : Math.max(1, Math.round(baseRowQty * scaleRatio));
        const q = getQuote(snapshot, typeId);
        const itemMeta = ITEM_BY_ID[typeId];
        const buyHub = getHubQuote(q, card.sourceHubId ?? 'jita', itemMeta);
        const sellHub = getHubQuote(q, card.destHubId ?? 'dodixie', itemMeta);

        if (buyHub.sellMin > 0 && (sellHub.sellMin > 0 || sellHub.buyMax > 0)) {
          const buyWalk = walkSellOrderbookForBuy(buyHub, rowQty);
          const avgBuy = buyWalk.filledQty > 0 ? buyWalk.weightedAvgPrice : buyHub.sellMin;
          const totalBuy =
            buyWalk.filledQty > 0
              ? buyWalk.totalIsk + buyWalk.shortfallQty * buyWalk.weightedAvgPrice
              : rowQty * buyHub.sellMin;

          let avgSell = sellHub.sellMin > 0 ? sellHub.sellMin : sellHub.buyMax;
          let grossRev = rowQty * avgSell;
          if (effectiveExecMode === 'instant_fill') {
            const sellWalk = walkBuyOrderbookForSell(sellHub, rowQty);
            grossRev = sellWalk.filledQty > 0 ? sellWalk.totalIsk : rowQty * sellHub.buyMax;
            avgSell = sellWalk.filledQty > 0 ? sellWalk.weightedAvgPrice : sellHub.buyMax;
          }

          const rowProfit = grossRev * netSaleMult - totalBuy;
          const rowRoi = totalBuy > 0 ? (rowProfit / totalBuy) * 100 : 0;
          const rowVol = rowQty * (itemMeta?.volume ?? 1);

          next.qty = rowQty.toLocaleString('en-US');
          if ('buy' in next) next.buy = formatIsk(avgBuy, false);
          if ('sell' in next) next.sell = formatIsk(avgSell, false);
          if ('vol' in next) next.vol = formatM3(rowVol);
          if ('profit' in next) next.profit = `${rowProfit >= 0 ? '+' : ''}${formatIsk(rowProfit)}`;
          if ('roi' in next) next.roi = formatPct(rowRoi);
          return next;
        }
      }

      // 3. Generic clean scaling for qty/volume/total-value columns across Reprocessing, Corridor, PI, etc.
      const qtyKeys = new Set(['qty', 'baseQty', 'refinedQty', 'weeklyQty']);
      const iskTotalKeys = new Set(['totalCost', 'netValue', 'profit', 'pocoTax']);
      const volKeys = new Set(['vol', 'volume']);

      for (const col of card.inspection.columns) {
        const rawVal = row[col.key];
        if (rawVal === undefined) continue;
        if (qtyKeys.has(col.key)) {
          const parsed = parseFormattedIskOrNumber(rawVal);
          if (parsed > 0) {
            next[col.key] = Math.max(1, Math.round(parsed * scaleRatio)).toLocaleString('en-US');
          }
        } else if (iskTotalKeys.has(col.key)) {
          const parsed = parseFormattedIskOrNumber(rawVal);
          if (parsed !== 0) {
            const scaled = parsed * scaleRatio;
            next[col.key] = col.key === 'profit' && scaled >= 0 ? `+${formatIsk(scaled)}` : formatIsk(scaled);
          }
        } else if (volKeys.has(col.key)) {
          const parsed = parseFormattedIskOrNumber(rawVal);
          if (parsed > 0) {
            next[col.key] = formatM3(parsed * scaleRatio);
          }
        }
      }
      return next;
    });
  }, [
    card,
    isIndyCard,
    snapshot,
    profile,
    effectiveQty,
    isQtyOverridden,
    cardExecutionModeOverride,
    effectiveExecMode,
    appSettings,
    scaleRatio,
  ]);

  // Live Depth-Split Multi-Buy / Multi-Sell manifests derived directly from effectiveQty
  const depthSplitOrders = useMemo(() => {
    if (!card || !snapshot) return null;

    const buyItems: { typeId?: number; name: string; quantity: number; side: 'buy' }[] = [];
    const sellItems: { typeId?: number; name: string; quantity: number; side: 'sell' }[] = [];

    if (isIndyCard && card.bomMaterials && card.bomMaterials.length > 0) {
      for (const mat of card.bomMaterials) {
        buyItems.push({
          typeId: mat.typeId,
          name: mat.name,
          quantity: Math.max(1, Math.ceil(mat.qtyPerRun * effectiveQty)),
          side: 'buy',
        });
      }
      if (card.primaryTypeId) {
        sellItems.push({
          typeId: card.primaryTypeId,
          name: card.primaryItemName || card.title,
          quantity: Math.max(1, effectiveQty * Math.max(1, card.outputPerRun ?? 1)),
          side: 'sell',
        });
      }
    } else {
      for (const chain of card.routeChains ?? []) {
        for (const leg of chain.legs) {
          for (const it of leg.items) {
            if (!it.typeId && !it.name) continue;
            const scaledQty =
              it.typeId === card.primaryTypeId
                ? effectiveQty
                : Math.max(1, Math.round(it.quantity * scaleRatio));
            if (leg.action === 'buy') {
              buyItems.push({ typeId: it.typeId, name: it.name, quantity: scaledQty, side: 'buy' });
            } else if (leg.action === 'sell') {
              sellItems.push({ typeId: it.typeId, name: it.name, quantity: scaledQty, side: 'sell' });
            }
          }
        }
      }

      if (buyItems.length === 0 && card.primaryTypeId) {
        buyItems.push({
          typeId: card.primaryTypeId,
          name: card.primaryItemName || card.title,
          quantity: effectiveQty,
          side: 'buy',
        });
      }
      if (sellItems.length === 0 && card.primaryTypeId) {
        sellItems.push({
          typeId: card.primaryTypeId,
          name: card.primaryItemName || card.title,
          quantity: effectiveQty,
          side: 'sell',
        });
      }
    }

    const buyHubId: TradeHubId = card.sourceHubId ?? 'jita';
    const sellHubId: TradeHubId = card.destHubId ?? 'jita';

    return {
      buy: buyItems.length > 0 ? buildDepthAwareOrderLines(buyItems, snapshot, buyHubId) : null,
      sell: sellItems.length > 0 ? buildDepthAwareOrderLines(sellItems, snapshot, sellHubId) : null,
      buyHubLabel: EMPIRE_HUB_MAP[buyHubId]?.shortLabel ?? 'Jita',
      sellHubLabel: EMPIRE_HUB_MAP[sellHubId]?.shortLabel ?? 'Jita',
    };
  }, [card, snapshot, isIndyCard, effectiveQty, scaleRatio]);

  // Per-output alternative max-profit destinations for Reprocessing cards (scaled by effectiveQty)
  const altOutputOptions = useMemo<PerOutputDestinationOption[]>(() => {
    if (!card || card.engine !== 'reprocessing' || !snapshot) return [];
    const baseHub: TradeHubId = appSettings?.refiningHubId ?? 'jita';
    const baseHubName = EMPIRE_HUB_MAP[baseHub]?.shortLabel ?? 'Jita';
    const baseJumpsEst: Record<TradeHubId, number> = {
      jita: 0,
      dodixie: 12,
      amarr: 10,
      rens: 24,
      hek: 19,
    };

    const options: PerOutputDestinationOption[] = [];
    for (const row of card.inspection.rows) {
      const typeId = typeof row._typeId === 'number' ? row._typeId : 0;
      if (!typeId) continue;
      const itemName =
        typeof row._itemName === 'string'
          ? row._itemName
          : ITEM_BY_ID[typeId]?.name || `Type #${typeId}`;
      const qtyRaw = Number(String(row.refinedQty ?? '0').replace(/[^0-9.]/g, '')) || 100;
      const baseBatchMult = Math.max(1, Math.round((card.outputUnits || 100) / 100));
      const totalOutputQty = Math.max(1, Math.round(qtyRaw * baseBatchMult * scaleRatio));
      const q = getQuote(snapshot, typeId);
      const baseQ = getHubQuote(q, baseHub, ITEM_BY_ID[typeId]);
      const basePrice = effectiveExecMode === 'instant_fill' ? baseQ.buyMax : baseQ.sellMin;
      const baseRev = basePrice * totalOutputQty;

      let bestHub: TradeHubId = baseHub;
      let bestRev = baseRev;
      for (const h of EMPIRE_HUB_LIST) {
        const hq = getHubQuote(q, h.id, ITEM_BY_ID[typeId]);
        const price = effectiveExecMode === 'instant_fill' ? hq.buyMax : hq.sellMin;
        const rev = price * totalOutputQty;
        if (rev > bestRev) {
          bestRev = rev;
          bestHub = h.id;
        }
      }
      const extraGain = Math.max(0, bestRev - baseRev);
      const extraJumps =
        bestHub === baseHub
          ? 0
          : Math.abs((baseJumpsEst[bestHub] ?? 12) - (baseJumpsEst[baseHub] ?? 0));
      options.push({
        outputTypeId: typeId,
        outputName: itemName,
        qty: totalOutputQty,
        baseDestHubId: baseHub,
        baseDestName: baseHubName,
        baseNetIsk: baseRev,
        altDestHubId: bestHub,
        altDestName: EMPIRE_HUB_MAP[bestHub]?.shortLabel ?? baseHubName,
        altNetIsk: bestRev,
        extraGainIsk: extraGain,
        extraJumps,
        lockedDestHubId: lockedOutputIds[typeId] ? bestHub : baseHub,
      });
    }
    return options;
  }, [card, snapshot, appSettings?.refiningHubId, lockedOutputIds, scaleRatio, effectiveExecMode]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
      if (splitCopyTimerRef.current !== null) window.clearTimeout(splitCopyTimerRef.current);
    };
  }, []);

  const enrichedShopping = useMemo(() => {
    const stockMap = profile.hangarStock ?? {};
    let netTotalIsk = 0;
    let netTotalM3 = 0;
    let hangarSavedIsk = 0;

    const rows = shoppingList.map((line) => {
      const stock = stockMap[line.typeId];
      const onHandJita = stock?.jita ?? 0;
      const onHandIshisomo = stock?.ishisomo ?? 0;
      const onHandTotal = stock?.total ?? onHandJita + onHandIshisomo;
      const deductedQty = deductHangarStock ? Math.min(line.quantity, onHandTotal) : 0;
      const netQty = Math.max(0, line.quantity - deductedQty);
      const unitVol = line.quantity > 0 ? line.volumeM3 / line.quantity : 0;
      const effectiveCost = netQty * line.unitPriceJita;
      const effectiveVol = netQty * unitVol;

      netTotalIsk += effectiveCost;
      netTotalM3 += effectiveVol;
      hangarSavedIsk += deductedQty * line.unitPriceJita;

      return {
        ...line,
        onHandJita,
        onHandIshisomo,
        onHandTotal,
        deductedQty,
        netQty,
        effectiveCost,
        effectiveVol,
      };
    });

    return {
      rows,
      netTotalIsk,
      netTotalM3,
      hangarSavedIsk,
      coveredLineCount: rows.filter((r) => r.onHandTotal > 0).length,
    };
  }, [shoppingList, profile.hangarStock, deductHangarStock]);

  if (!card && !shoppingListMode) return null;

  const handleCopyMultibuy = async () => {
    const payloadLines = enrichedShopping.rows
      .map((row) => ({
        name: row.name,
        quantity: deductHangarStock ? row.netQty : row.quantity,
      }))
      .filter((r) => r.quantity > 0);

    const { text, itemCount } = formatEveMultibuyText(payloadLines);
    if (itemCount === 0) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;

    setCopiedCount(itemCount);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedCount(null), 2000);
  };

  const handleCopyDepthSplit = async (side: 'buy' | 'sell') => {
    const bundle = side === 'buy' ? depthSplitOrders?.buy : depthSplitOrders?.sell;
    if (!bundle || !bundle.eveMultibuyText) return;
    const ok = await copyTextToClipboard(bundle.eveMultibuyText);
    if (!ok) return;
    setCopiedSplitKind(side);
    if (splitCopyTimerRef.current !== null) window.clearTimeout(splitCopyTimerRef.current);
    splitCopyTimerRef.current = window.setTimeout(() => setCopiedSplitKind(null), 2000);
  };

  const handleOpenHaulerFromInspect = () => {
    if (!card || !liveMetrics || !haulerSizing || !onOpenHaulerFlyout) return;
    onOpenHaulerFlyout({
      title: `${card.title} (${effectiveQty.toLocaleString('en-US')} ${card.qtyUnitLabel ?? (isIndyCard ? 'runs' : 'units')})`,
      rawInputM3: liveMetrics.rawInputM3,
      packagedOutputM3: liveMetrics.packagedOutputM3,
      cargoValueIsk: liveMetrics.requiredCapitalIsk,
      originSystemId: haulerSizing.originSystemId,
      destSystemId: haulerSizing.destSystemId,
      originName: haulerSizing.originName,
      destName: haulerSizing.destName,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label={shoppingListMode ? 'Consolidated Jita Shopping List' : card?.title}
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <div className="w-full max-w-4xl bg-[#0e131b] border-l border-slate-800 h-full flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="text-xs text-cyan-400 font-medium">
              {shoppingListMode ? 'Consolidated Jita 4-4 Procurement' : card?.engineLabel}
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-100 mt-0.5 truncate">
              {shoppingListMode
                ? 'Consolidated Jita Shopping List (Hangar Stock & 1-Jump Check)'
                : card?.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspection panel"
            className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {shoppingListMode ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-[#131822]">
                <div className="p-4">
                  <div className="text-xs text-slate-400">
                    {deductHangarStock ? 'Net-to-Buy Cost' : 'Gross Jita Cost'}
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-amber-300 mt-1">
                    {formatIsk(deductHangarStock ? enrichedShopping.netTotalIsk : shoppingTotalIsk)}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">
                    {deductHangarStock ? 'Net Cargo Volume' : 'Gross Cargo Volume'}
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-slate-100 mt-1">
                    {formatM3(deductHangarStock ? enrichedShopping.netTotalM3 : shoppingTotalM3)}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">Hangar Stock Offset</div>
                  <div className="font-mono tabular-nums text-base font-semibold text-cyan-300 mt-1">
                    {deductHangarStock ? `-${formatIsk(enrichedShopping.hangarSavedIsk)}` : 'OFF (Gross)'}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">1-Jump Savings Found</div>
                  <div className="font-mono tabular-nums text-base font-semibold text-emerald-400 mt-1">
                    {formatIsk(shoppingSavingsIsk)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400 flex-1 min-w-[220px]">
                  Cross-checked against Jita &amp; Ishisomo hangar inventory (
                  {enrichedShopping.coveredLineCount} matched SKU
                  {enrichedShopping.coveredLineCount === 1 ? '' : 's'} on hand)
                  {customItemCount > 0
                    ? ` + ${customItemCount} Advisor item${customItemCount > 1 ? 's' : ''}`
                    : ''}
                  .
                </p>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {customItemCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearCustomShoppingItems}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-[#131822] text-slate-300 hover:border-rose-400/50 hover:text-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear Advisor ({customItemCount})
                    </button>
                  )}

                  <button
                    type="button"
                    role="switch"
                    aria-checked={deductHangarStock}
                    onClick={() => onToggleDeductHangarStock(!deductHangarStock)}
                    title="Subtract Jita and Ishisomo hangar stock before copying to EVE Multibuy"
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      deductHangarStock
                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                        : 'border-slate-700 bg-[#131822] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <PackageCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Deduct Hangar Stock</span>
                    <span
                      className={`inline-flex items-center w-7 h-4 rounded-full p-0.5 transition-colors ${
                        deductHangarStock ? 'bg-emerald-400 justify-end' : 'bg-slate-700 justify-start'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-[#0b0e14]" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyMultibuy}
                    disabled={shoppingList.length === 0}
                    title={
                      deductHangarStock
                        ? 'Copy NET-TO-BUY quantities (after deducting Jita/Ishisomo hangar stock) for EVE Online Multibuy'
                        : 'Copy GROSS requirements as <Item Name><TAB><Quantity> for EVE Online Multibuy'
                    }
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      copiedCount !== null
                        ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                        : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                    }`}
                  >
                    {copiedCount !== null ? (
                      <Check className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {copiedCount !== null
                        ? `Copied ${copiedCount} ${copiedCount === 1 ? 'item' : 'items'} (${deductHangarStock ? 'Net' : 'Gross'})`
                        : deductHangarStock
                          ? 'Copy Net for EVE Multibuy'
                          : 'Copy for EVE Multibuy'}
                    </span>
                  </button>
                </div>
              </div>

              {shoppingList.length === 0 ? (
                <div className="p-8 text-center border border-slate-800 rounded-lg text-sm text-slate-400">
                  No profitable industry builds match your currently checked Market Scope categories.
                </div>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#131822] border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 px-3 text-left font-medium">Material</th>
                        <th className="py-2.5 px-3 text-right font-medium">Gross Qty</th>
                        <th className="py-2.5 px-3 text-right font-medium">On-Hand (Jita/Ish)</th>
                        <th className="py-2.5 px-3 text-right font-medium">
                          {deductHangarStock ? 'Net-to-Buy' : 'Multibuy Qty'}
                        </th>
                        <th className="py-2.5 px-3 text-right font-medium">Subtotal</th>
                        <th className="py-2.5 px-3 text-left font-medium">1-Jump Check</th>
                        <th className="py-2.5 px-3 text-right font-medium">30d</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {enrichedShopping.rows.map((line) => {
                        const fullyCovered = deductHangarStock && line.netQty === 0;
                        return (
                          <tr
                            key={line.typeId}
                            className={
                              fullyCovered ? 'bg-emerald-500/5 text-slate-500' : 'hover:bg-slate-800/30'
                            }
                          >
                            <td className="py-2.5 px-3 text-slate-200 font-medium">
                              <span>{line.name}</span>
                              {line.addedByAdvisor && (
                                <span className="ml-2 text-[11px] font-normal text-cyan-400">
                                  · Advisor
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                              {line.quantity.toLocaleString('en-US')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {line.onHandTotal > 0 ? (
                                <span
                                  className="text-cyan-300"
                                  title={`Jita: ${line.onHandJita.toLocaleString()} · Ishisomo: ${line.onHandIshisomo.toLocaleString()}`}
                                >
                                  {line.onHandTotal.toLocaleString('en-US')}
                                </span>
                              ) : (
                                <span className="text-slate-600">0</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                              {fullyCovered ? (
                                <span className="text-emerald-400">0 (In Stock)</span>
                              ) : (
                                <span className="text-slate-100">
                                  {(deductHangarStock ? line.netQty : line.quantity).toLocaleString('en-US')}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-300">
                              {formatIsk(deductHangarStock ? line.effectiveCost : line.totalCostJita)}
                            </td>
                            <td className="py-2.5 px-3 text-left">
                              {line.cheaperNearby ? (
                                <span className="text-emerald-400 font-mono tabular-nums">
                                  {line.cheaperNearby.systemName} (-{formatIsk(line.cheaperNearby.savingsIsk)})
                                </span>
                              ) : (
                                <span className="text-slate-500">Jita 4-4 Best</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => onOpenHistory(line.typeId, line.name)}
                                title={`View 30-day ESI market history for ${line.name}`}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#131822] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                              >
                                <LineChart className="w-3 h-3" aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : card && liveMetrics ? (
            <>
              {/* Live Synchronized Quantity / Runs Strip (Bidirectional with Card & Route State) */}
              <div className="px-4 py-3 rounded-lg border border-slate-800 bg-[#131822] flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="text-xs font-medium text-slate-300">
                    {isIndyCard ? 'Build Runs' : 'Batch Qty'}:
                  </span>
                  <div className="inline-flex items-center rounded border border-slate-700/90 bg-[#0b0e14] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => commitQty(Math.max(1, effectiveQty - stepDelta))}
                      aria-label={`Decrease ${isIndyCard ? 'runs' : 'quantity'} by ${stepDelta}`}
                      className="px-2 py-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={10000000}
                      value={effectiveQty}
                      aria-label={`Inspection ${isIndyCard ? 'runs' : 'quantity'} for ${card.title}`}
                      onChange={(e) => commitQty(Number(e.target.value))}
                      className="w-24 bg-transparent text-center font-mono tabular-nums text-xs text-cyan-200 font-semibold py-1 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => commitQty(effectiveQty + stepDelta)}
                      aria-label={`Increase ${isIndyCard ? 'runs' : 'quantity'} by ${stepDelta}`}
                      className="px-2 py-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {isQtyOverridden ? (
                    <div className="inline-flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center px-2 py-0.5 rounded border border-amber-400/50 bg-amber-500/15 font-mono tabular-nums text-[11px] font-semibold text-amber-200">
                        Custom Qty: {effectiveQty.toLocaleString('en-US')} (Advised:{' '}
                        {advisedQty.toLocaleString('en-US')})
                      </span>
                      <button
                        type="button"
                        onClick={resetToAdvised}
                        title={`Reset quantity to advised baseline (${advisedQty.toLocaleString('en-US')})`}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/45 bg-cyan-500/10 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" aria-hidden="true" />
                        <span>Reset to Advised</span>
                      </button>
                    </div>
                  ) : (
                    <span className="font-mono tabular-nums text-[11px] text-slate-400">
                      Advised: {advisedQty.toLocaleString('en-US')}{' '}
                      {card.qtyUnitLabel ?? (isIndyCard ? 'runs' : 'units')}
                    </span>
                  )}

                  {optimalQty !== advisedQty && effectiveQty !== optimalQty && (
                    <button
                      type="button"
                      onClick={() => commitQty(optimalQty)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-[#0b0e14] text-[11px] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors cursor-pointer"
                    >
                      <span>Max Profitable ({optimalQty.toLocaleString('en-US')})</span>
                    </button>
                  )}
                </div>

                {/* Live Hauler Sizing & Jump Summary */}
                {haulerSizing && (
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-300">
                    <span className="px-2 py-0.5 rounded border border-slate-800 bg-[#0b0e14]">
                      {haulerSizing.chosenName} · {haulerSizing.trips} trip
                      {haulerSizing.trips === 1 ? '' : 's'}
                      {haulerSizing.totalJumpsEst > 0 ? ` · ~${haulerSizing.totalJumpsEst}j` : ''}
                    </span>
                    {onOpenHaulerFlyout && (
                      <button
                        type="button"
                        onClick={handleOpenHaulerFromInspect}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                      >
                        <Truck className="w-3 h-3" aria-hidden="true" />
                        <span>Hauler &amp; Fit</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Live Key Metrics Strip (Derived Directly from effectiveQty) */}
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-[#131822]">
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">Required Capital</div>
                  <div className="font-mono tabular-nums text-sm font-semibold text-amber-300 mt-1">
                    {formatIsk(liveMetrics.requiredCapitalIsk)}
                  </div>
                  {(liveMetrics.slippagePct >= 0.5 || liveMetrics.shortfallQty > 0) && (
                    <div className="text-[10px] font-mono text-amber-300/90 mt-0.5 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>
                        {liveMetrics.shortfallQty > 0
                          ? `Shortfall · Slip ${liveMetrics.slippagePct.toFixed(1)}%`
                          : `Depth Slip +${liveMetrics.slippagePct.toFixed(1)}%`}
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">Total Volume</div>
                  <div className="font-mono tabular-nums text-sm font-semibold text-slate-100 mt-1">
                    {formatM3(liveMetrics.totalVolumeM3)}
                  </div>
                  {isIndyCard && liveMetrics.buildTime && (
                    <div className="text-[10px] font-mono text-cyan-300/90 mt-0.5 flex items-center gap-1">
                      <Clock className="w-3 h-3 shrink-0" />
                      <span>
                        {formatDurationCompact(liveMetrics.buildTime.sequentialTotalSec)} ·{' '}
                        {liveMetrics.totalOutputUnits.toLocaleString('en-US')} out
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">
                    {effectiveTransportCostIsk > 0 ? 'Net Profit (After Haul)' : 'Net Profit'}
                  </div>
                  <div
                    className={`font-mono tabular-nums text-sm font-semibold mt-1 ${
                      liveMetrics.netProfitIsk >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {liveMetrics.netProfitIsk >= 0 ? '+' : ''}
                    {formatIsk(liveMetrics.netProfitIsk)}
                  </div>
                  {typeof liveMetrics.buyMissingProfitIsk === 'number' &&
                    liveMetrics.buyMissingProfitIsk > liveMetrics.netProfitIsk + 1 && (
                      <div className="text-[10px] font-mono text-cyan-300 mt-0.5">
                        Buy Missing: +{formatIsk(liveMetrics.buyMissingProfitIsk)}
                      </div>
                    )}
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">ROI · Margin</div>
                  <div
                    className={`font-mono tabular-nums text-sm font-semibold mt-1 ${
                      liveMetrics.roiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatPct(liveMetrics.roiPct)} · {formatPct(liveMetrics.netMarginPct)}
                  </div>
                  {liveMetrics.iskPerHour !== null && liveMetrics.iskPerHour !== 0 && (
                    <div className="text-[10px] font-mono text-cyan-300 mt-0.5">
                      {formatIsk(liveMetrics.iskPerHour)}/hr
                    </div>
                  )}
                </div>
              </div>

              {/* View Switcher: Inspection View vs Order Book View */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawerView('inspection')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium cursor-pointer ${
                      drawerView === 'inspection'
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    <span>Inspection View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerView('orderbook')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium cursor-pointer ${
                      drawerView === 'orderbook'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Order Book View</span>
                  </button>
                </div>

                {card.engine === 'reprocessing' && appSettings && (
                  <div className="text-[11px] font-mono text-slate-400">
                    3-Stage Refining: Refine{' '}
                    <strong className="text-cyan-300">
                      {appSettings.refiningLocationRule === 'same_station'
                        ? 'At Pickup Station'
                        : appSettings.refiningLocationRule === 'within_x_jumps'
                          ? `Within ${appSettings.refiningMaxJumps}j`
                          : EMPIRE_HUB_MAP[appSettings.refiningHubId]?.shortLabel}
                    </strong>{' '}
                    → Sell{' '}
                    <strong className="text-emerald-300">
                      {appSettings.refiningSellRule === 'same_as_refine'
                        ? 'At Refine Station'
                        : appSettings.refiningSellRule === 'back_at_buy'
                          ? 'Back at Buy Hub'
                          : `Within ${appSettings.refiningSellMaxJumps}j`}
                    </strong>
                  </div>
                )}
              </div>

              {drawerView === 'inspection' ? (
                <>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {card.inspection.summaryText}
                  </p>

                  {/* High-Density Live-Scaled Inspection Data Table */}
                  <div className="border border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#131822] border-b border-slate-800 text-slate-400">
                          {card.inspection.columns.map((col) => (
                            <th
                              key={col.key}
                              className={`py-2.5 px-3 font-medium whitespace-nowrap ${
                                col.align === 'right' ? 'text-right' : 'text-left'
                              }`}
                            >
                              {col.label}
                            </th>
                          ))}
                          <th className="py-2.5 px-3 text-right font-medium whitespace-nowrap">
                            30d History
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {scaledInspectionRows.map((row, rIdx) => {
                          const rowTypeId =
                            typeof row._typeId === 'number' && row._typeId > 0
                              ? row._typeId
                              : undefined;
                          const rowItemName =
                            typeof row._itemName === 'string' && row._itemName
                              ? row._itemName
                              : String(row[card.inspection.columns[0]?.key] ?? card.title);
                          return (
                            <tr key={rIdx} className="hover:bg-slate-800/30">
                              {card.inspection.columns.map((col) => (
                                <td
                                  key={col.key}
                                  className={`py-2.5 px-3 ${
                                    col.align === 'right'
                                      ? 'text-right font-mono tabular-nums text-slate-200'
                                      : 'text-left text-slate-300'
                                  }`}
                                >
                                  {row[col.key]}
                                </td>
                              ))}
                              <td className="py-2.5 px-3 text-right whitespace-nowrap">
                                {rowTypeId ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenHistory(rowTypeId, rowItemName)}
                                    title={`View 30-day ESI market history for ${rowItemName}`}
                                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#131822] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                                  >
                                    <LineChart className="w-3 h-3" aria-hidden="true" />
                                    <span>30d History</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-600">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Depth-Split Multi-Buy / Multi-Sell Order Manifest (Live from effectiveQty) */}
                  {depthSplitOrders &&
                    ((depthSplitOrders.buy && depthSplitOrders.buy.lines.length > 0) ||
                      (depthSplitOrders.sell && depthSplitOrders.sell.lines.length > 0)) && (
                      <div className="border border-slate-800 rounded-lg bg-[#111722] p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-xs font-semibold text-slate-100">
                              Depth-Split Multi-Buy &amp; Multi-Sell Lines (Live Qty:{' '}
                              {effectiveQty.toLocaleString('en-US')})
                            </div>
                            <div className="text-[11px] text-slate-400">
                              Tier-walked execution lines automatically synced with your active quantity override.
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {depthSplitOrders.buy && depthSplitOrders.buy.lines.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleCopyDepthSplit('buy')}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                                  copiedSplitKind === 'buy'
                                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                                    : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                                }`}
                              >
                                {copiedSplitKind === 'buy' ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>
                                  {copiedSplitKind === 'buy'
                                    ? 'Copied Buy Manifest'
                                    : `Copy Multi-Buy (${depthSplitOrders.buy.lines.length} tier${depthSplitOrders.buy.lines.length === 1 ? '' : 's'})`}
                                </span>
                              </button>
                            )}
                            {depthSplitOrders.sell && depthSplitOrders.sell.lines.length > 0 && (
                              <button
                                type="button"
                                onClick={() => handleCopyDepthSplit('sell')}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border transition-colors cursor-pointer ${
                                  copiedSplitKind === 'sell'
                                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                                    : 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                                }`}
                              >
                                {copiedSplitKind === 'sell' ? (
                                  <Check className="w-3 h-3" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                <span>
                                  {copiedSplitKind === 'sell'
                                    ? 'Copied Sell Manifest'
                                    : `Copy Multi-Sell (${depthSplitOrders.sell.lines.length} tier${depthSplitOrders.sell.lines.length === 1 ? '' : 's'})`}
                                </span>
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="max-h-48 overflow-y-auto border border-slate-800 rounded">
                          <table className="w-full text-[11px] border-collapse">
                            <thead className="sticky top-0 z-10 bg-[#0d121a]">
                              <tr className="border-b border-slate-800 text-slate-400">
                                <th className="py-1.5 px-2.5 text-left">Side</th>
                                <th className="py-1.5 px-2.5 text-left">Item</th>
                                <th className="py-1.5 px-2.5 text-right">Tier</th>
                                <th className="py-1.5 px-2.5 text-right">Qty</th>
                                <th className="py-1.5 px-2.5 text-right">Tier Price</th>
                                <th className="py-1.5 px-2.5 text-right">Subtotal</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/60">
                              {[
                                ...(depthSplitOrders.buy?.lines ?? []),
                                ...(depthSplitOrders.sell?.lines ?? []),
                              ].map((line, idx) => (
                                <tr key={`${line.side}-${line.name}-${line.tierIndex}-${idx}`}>
                                  <td className="py-1.5 px-2.5 font-mono uppercase">
                                    <span
                                      className={
                                        line.side === 'buy'
                                          ? 'text-emerald-300 font-semibold'
                                          : 'text-amber-300 font-semibold'
                                      }
                                    >
                                      {line.side}
                                    </span>
                                  </td>
                                  <td className="py-1.5 px-2.5 text-slate-200">{line.name}</td>
                                  <td className="py-1.5 px-2.5 text-right font-mono text-slate-400">
                                    T{line.tierIndex}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-slate-100">
                                    {Math.round(line.qty).toLocaleString('en-US')}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-slate-300">
                                    {formatIsk(line.unitPriceIsk, false)}
                                  </td>
                                  <td className="py-1.5 px-2.5 text-right font-mono tabular-nums text-amber-200">
                                    {formatIsk(line.totalIsk)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                  {/* Per-Output Alternative Max-Profit Destinations (Reprocessing Cards) */}
                  {card.engine === 'reprocessing' && altOutputOptions.length > 0 && (
                    <div className="border border-cyan-500/30 rounded-lg bg-[#111722] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-cyan-200">
                            Per-Output Alternative Max-Profit Destinations
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Compare base refining sell hub against highest-paying alternative Empire hub per mineral output.
                          </div>
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                          <span>Extra-Effort Profit Target (M ISK):</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={Number((extraEffortTargetIsk / 1_000_000).toFixed(2))}
                            onChange={(e) =>
                              setExtraEffortTargetIsk(
                                Math.max(0, Number(e.target.value) || 0) * 1_000_000
                              )
                            }
                            className="w-20 bg-[#0b0e14] border border-slate-700 rounded px-2 py-0.5 font-mono text-xs text-slate-100"
                          />
                        </label>
                      </div>

                      <div className="overflow-x-auto border border-slate-800 rounded">
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-[#0d121a] border-b border-slate-800 text-slate-400">
                              <th className="py-2 px-2.5 text-left">Refined Output</th>
                              <th className="py-2 px-2.5 text-left">Best Alt Hub</th>
                              <th className="py-2 px-2.5 text-right">Extra Gain</th>
                              <th className="py-2 px-2.5 text-right">Extra Jumps</th>
                              <th className="py-2 px-2.5 text-right">Transport Headroom</th>
                              <th className="py-2 px-2.5 text-right">Lock-In</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {altOutputOptions.map((opt) => {
                              const headroom = opt.extraGainIsk - extraEffortTargetIsk;
                              const isLocked = Boolean(lockedOutputIds[opt.outputTypeId]);
                              return (
                                <tr
                                  key={opt.outputTypeId}
                                  className={isLocked ? 'bg-cyan-500/10' : ''}
                                >
                                  <td className="py-2 px-2.5 text-slate-200 font-medium">
                                    {opt.outputName}
                                  </td>
                                  <td className="py-2 px-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-slate-200">{opt.altDestName}</span>
                                      {opt.altDestHubId !== opt.baseDestHubId && (
                                        <a
                                          href={getDotlanRouteUrl(
                                            EMPIRE_HUB_MAP[opt.baseDestHubId]?.systemName || 'Jita',
                                            EMPIRE_HUB_MAP[opt.altDestHubId]?.systemName || 'Amarr'
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-cyan-400 hover:text-cyan-300"
                                          title="Open route in DOTLAN"
                                        >
                                          <Compass className="w-3 h-3" />
                                        </a>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-2.5 text-right font-mono text-emerald-400">
                                    +{formatIsk(opt.extraGainIsk)}
                                  </td>
                                  <td className="py-2 px-2.5 text-right font-mono text-slate-300">
                                    {opt.extraJumps}j
                                  </td>
                                  <td
                                    className={`py-2 px-2.5 text-right font-mono ${
                                      headroom >= 0 ? 'text-cyan-300' : 'text-rose-400'
                                    }`}
                                  >
                                    {headroom >= 0 ? `+${formatIsk(headroom)}` : formatIsk(headroom)}
                                  </td>
                                  <td className="py-2 px-2.5 text-right">
                                    <button
                                      type="button"
                                      disabled={opt.altDestHubId === opt.baseDestHubId}
                                      onClick={() =>
                                        setLockedOutputIds((prev) => ({
                                          ...prev,
                                          [opt.outputTypeId]: !prev[opt.outputTypeId],
                                        }))
                                      }
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium cursor-pointer disabled:opacity-35 ${
                                        isLocked
                                          ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                                          : 'border-slate-700 bg-[#0b0e14] text-slate-300 hover:border-cyan-400/50'
                                      }`}
                                    >
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>{isLocked ? 'Locked' : 'Lock Alt'}</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <LiveOrderBookPanel
                    card={card}
                    profile={profile}
                    eveAccessToken={eveAccessToken}
                    appSettings={appSettings}
                    effectiveQty={effectiveQty}
                    advisedQty={advisedQty}
                    onOpenSsoSettings={onOpenSsoSettings}
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
