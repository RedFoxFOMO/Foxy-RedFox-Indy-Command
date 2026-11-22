import { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Layers,
  LineChart,
  MessageSquareText,
  Minus,
  Pin,
  Plus,
  RotateCcw,
  Sparkles,
  Table2,
  Truck,
} from 'lucide-react';
import { EMPIRE_HUB_MAP, EVE_ANCHORS, ITEM_BY_ID } from '../data/eveCatalog.ts';
import {
  formatIsk,
  formatM3,
  formatPct,
  getBrokerFeeRate,
  getHubQuote,
  getQuote,
  getSalesTaxRate,
} from '../engines/decisionEngines.ts';
import { getDotlanRouteUrl, getDotlanSystemUrl } from '../utils/dotlan.ts';
import {
  computeBlueprintBuildTime,
  formatDurationCompact,
  getMaxIndustrySlots,
  walkBuyOrderbookForSell,
  walkSellOrderbookForBuy,
} from '../utils/eveMarketMath.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  IndustryStructureConfig,
  MarketSnapshot,
  OrderExecutionMode,
  PilotProfile,
} from '../types/eve.ts';
import { useCollapsibleCard } from '../utils/collapseStore.ts';
import type { HaulerFlyoutContext } from './HaulerFitFlyout.tsx';
import { InfoTip } from './InfoTip.tsx';
import { LiveOrderBookPanel } from './LiveOrderBookPanel.tsx';
import { PriceTrendRibbon } from './PriceTrendRibbon.tsx';

interface ActionCardProps {
  card: ActionCardData;
  rank: number;
  profile: PilotProfile;
  eveAccessToken: string | null;
  appSettings?: AppSettingsV22;
  isQueuedForRoute: boolean;
  isPinnedToWatchlist?: boolean;
  committedQty?: number;
  onCommitQty?: (cardId: string, qty: number) => void;
  cardExecutionModeOverride?: OrderExecutionMode;
  onChangeCardExecutionMode?: (cardId: string, mode: OrderExecutionMode) => void;
  cardTransportCostIsk?: number;
  cardMinDesiredProfitIsk?: number;
  haulCostOverrideIsk?: number | null;
  onChangeCardTransport?: (cardId: string, transportIsk: number, minDesiredProfitIsk: number) => void;
  isSelected?: boolean;
  onSelectCard?: (cardId: string) => void;
  snapshot?: MarketSnapshot;
  structureConfig?: IndustryStructureConfig;
  activeMfgJobCount?: number;
  isInBuildQueue?: boolean;
  onAddToBuildQueue?: (card: ActionCardData, runs: number, slots: number) => void;
  onOpenHaulerFlyout?: (ctx: HaulerFlyoutContext) => void;
  onOpenPriceProjection?: (target: {
    typeId: number;
    itemName: string;
    regionId?: number;
    currentPrice?: number;
  }) => void;
  onToggleQueueForRoute: (cardId: string, nextChecked: boolean) => void;
  onTogglePinWatchlist?: (typeId: number, name: string, kind: 'sku' | 'blueprint') => void;
  onChangeExecutionMode: (mode: OrderExecutionMode) => void;
  onInspect: (card: ActionCardData) => void;
  onAskAdvisor: (card: ActionCardData) => void;
  onOpenHistory: (typeId: number, name: string) => void;
  onOpenSsoSettings: () => void;
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

export function ActionCard({
  card,
  rank,
  profile,
  eveAccessToken,
  appSettings,
  isQueuedForRoute,
  isPinnedToWatchlist = false,
  committedQty,
  onCommitQty,
  cardExecutionModeOverride,
  onChangeCardExecutionMode,
  cardTransportCostIsk = 0,
  cardMinDesiredProfitIsk = 0,
  haulCostOverrideIsk = null,
  onChangeCardTransport,
  isSelected = false,
  onSelectCard,
  snapshot,
  structureConfig = DEFAULT_STRUCTURE,
  activeMfgJobCount,
  isInBuildQueue = false,
  onAddToBuildQueue,
  onOpenHaulerFlyout,
  onOpenPriceProjection,
  onToggleQueueForRoute,
  onTogglePinWatchlist,
  onChangeExecutionMode,
  onInspect,
  onAskAdvisor,
  onOpenHistory,
  onOpenSsoSettings,
}: ActionCardProps) {
  const [cardCollapsed, toggleCardCollapsed] = useCollapsibleCard(`card-${card.id}`, false);
  const [orderBookExpanded, setOrderBookExpanded] = useState(false);
  const [allocatedSlots, setAllocatedSlots] = useState<number>(1);
  const [showTransportTools, setShowTransportTools] = useState(false);

  const effectiveExecMode: OrderExecutionMode = cardExecutionModeOverride ?? card.executionMode;
  const effectiveTransportCostIsk =
    typeof haulCostOverrideIsk === 'number' && haulCostOverrideIsk >= 0
      ? haulCostOverrideIsk
      : Math.max(0, cardTransportCostIsk);

  const baseQty = Math.max(1, Math.round(card.baseBatchQty ?? card.outputUnits ?? 1));
  const optimalQty = Math.max(1, Math.round(card.optimalProfitableQty ?? baseQty));
  const activeQty = Math.max(1, Math.round(committedQty ?? baseQty));
  const isIndyCard = card.engine === 'indy_invention';
  const showSlicer = true;

  const slotInfo = useMemo(() => {
    const info = getMaxIndustrySlots(profile);
    const active = typeof activeMfgJobCount === 'number' ? activeMfgJobCount : info.mfgActive;
    const avail = Math.max(1, info.mfgSlotsMax - active);
    return { ...info, mfgActive: active, mfgAvailable: avail };
  }, [profile, activeMfgJobCount]);

  // Live client-side recalculation (0 ESI re-fetches) for slicer Qty/Runs, card-specific execution mode & standing broker fees
  const liveMetrics = useMemo(() => {
    const ratio = baseQty > 0 ? activeQty / baseQty : 1;
    const salesTax = getSalesTaxRate(profile.skills.accounting);
    const brokerFee = getBrokerFeeRate(profile.skills.brokerRelations, effectiveExecMode, {
      hubId: card.destHubId ?? 'jita',
      standings: profile.npcStandings,
      appSettings,
    });
    const netSaleMult = Math.max(0.05, 1 - salesTax - brokerFee);

    // 1. Blueprint / Indy card recalculation (BOM orderbook depth-walk + Dual Profit + Concurrency time)
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
        const reqUnits = Math.max(1, Math.ceil(mat.qtyPerRun * activeQty));
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

      // Scale non-material job/invention fees linearly with runs
      const baseJobFeeEstimate = Math.max(
        0,
        card.requiredCapitalIsk -
          card.bomMaterials.reduce((s, m) => s + m.qtyPerRun * baseQty * m.unitPriceTopOfBook, 0)
      );
      const scaledJobFee = baseJobFeeEstimate * ratio;

      const outputPerRun = Math.max(1, card.outputPerRun ?? 1);
      const totalOutputUnits = activeQty * outputPerRun;
      const prodQuote = card.primaryTypeId ? getQuote(snapshot, card.primaryTypeId) : null;
      const sellHubId = card.destHubId ?? 'jita';
      const sellHub = prodQuote
        ? getHubQuote(prodQuote, sellHubId, card.primaryTypeId ? ITEM_BY_ID[card.primaryTypeId] : undefined)
        : null;

      let grossRevenueIsk = card.netProfitIsk * ratio + (buyAllMatCost + scaledJobFee);
      let sellSlippagePct = 0;
      let sellShortfallQty = 0;

      if (sellHub && (sellHub.sellMin > 0 || sellHub.buyMax > 0)) {
        if (effectiveExecMode === 'instant_fill') {
          const sellWalk = walkBuyOrderbookForSell(sellHub, totalOutputUnits);
          grossRevenueIsk =
            sellWalk.filledQty > 0
              ? sellWalk.totalIsk
              : totalOutputUnits * sellHub.buyMax;
          sellSlippagePct = sellWalk.slippagePct;
          sellShortfallQty = sellWalk.shortfallQty;
        } else {
          grossRevenueIsk = totalOutputUnits * (sellHub.sellMin > 0 ? sellHub.sellMin : sellHub.buyMax);
        }
      }

      const netRevenueIsk = grossRevenueIsk * netSaleMult;
      const buyAllCapitalIsk = buyAllMatCost + scaledJobFee;
      const buyMissingCapitalIsk = buyMissingMatCost + scaledJobFee;
      const buyAllProfitIsk = netRevenueIsk - buyAllCapitalIsk;
      const buyMissingProfitIsk = netRevenueIsk - buyMissingCapitalIsk;
      const hangarSavingsIsk = Math.max(0, buyAllMatCost - buyMissingMatCost);

      const netMarginPct = grossRevenueIsk > 0 ? (buyAllProfitIsk / grossRevenueIsk) * 100 : card.netMarginPct;
      const roiPct = buyAllCapitalIsk > 0 ? (buyAllProfitIsk / buyAllCapitalIsk) * 100 : card.roiPct;
      const perUnitNetProfitIsk = totalOutputUnits > 0 ? buyAllProfitIsk / totalOutputUnits : card.perUnitNetProfitIsk;

      const packagedOutputM3 =
        totalOutputUnits *
        (card.unitOutputM3 || (card.primaryTypeId ? ITEM_BY_ID[card.primaryTypeId]?.volume : 0) || 0.1);
      const totalVolumeM3 = Math.max(rawInputM3, packagedOutputM3);

      const buildTime = computeBlueprintBuildTime({
        baseRunDurationSec: card.baseRunDurationSec ?? 3600,
        runs: activeQty,
        bpTe: card.bpTe ?? 20,
        industryLvl: profile.skills.industry ?? 5,
        advIndustryLvl: profile.skills.advancedIndustry ?? 4,
        reactionsLvl: profile.skills.reactions ?? 4,
        isReaction: false,
        structureConfig,
        allocatedSlots,
        maxAvailableSlots: slotInfo.mfgSlotsMax,
      });

      const iskPerHour =
        buildTime.concurrentWallClockSec > 0
          ? buyAllProfitIsk / (buildTime.concurrentWallClockSec / 3600)
          : 0;

      return {
        netProfitIsk: buyAllProfitIsk,
        buyAllProfitIsk,
        buyMissingProfitIsk,
        buyMissingCapitalIsk,
        hangarSavingsIsk,
        requiredCapitalIsk: buyAllCapitalIsk,
        netMarginPct,
        roiPct,
        perUnitNetProfitIsk,
        totalVolumeM3,
        rawInputM3,
        packagedOutputM3,
        slippagePct: Math.max(maxInputSlippagePct, sellSlippagePct),
        shortfallQty: sellShortfallQty + inputShortfallCount,
        buildTime,
        iskPerHour,
        totalOutputUnits,
      };
    }

    // 2. Trade / Hauling card recalculation via live orderbook depth-walking
    if (card.primaryTypeId && snapshot && (card.sourceHubId || card.destHubId)) {
      const q = getQuote(snapshot, card.primaryTypeId);
      const itemMeta = ITEM_BY_ID[card.primaryTypeId];
      const buyHub = getHubQuote(q, card.sourceHubId ?? 'jita', itemMeta);
      const sellHub = getHubQuote(q, card.destHubId ?? 'dodixie', itemMeta);

      if (buyHub.sellMin > 0 && (sellHub.sellMin > 0 || sellHub.buyMax > 0)) {
        const buyWalk = walkSellOrderbookForBuy(buyHub, activeQty);
        const totalBuyIsk =
          buyWalk.filledQty > 0
            ? buyWalk.totalIsk + buyWalk.shortfallQty * buyWalk.weightedAvgPrice
            : activeQty * buyHub.sellMin;

        let grossRevIsk = 0;
        let sellSlippage = 0;
        let sellShortfall = 0;

        if (effectiveExecMode === 'instant_fill') {
          const sellWalk = walkBuyOrderbookForSell(sellHub, activeQty);
          grossRevIsk = sellWalk.filledQty > 0 ? sellWalk.totalIsk : activeQty * sellHub.buyMax;
          sellSlippage = sellWalk.slippagePct;
          sellShortfall = sellWalk.shortfallQty;
        } else {
          grossRevIsk = activeQty * (sellHub.sellMin > 0 ? sellHub.sellMin : sellHub.buyMax);
        }

        const netRevIsk = grossRevIsk * netSaleMult;
        const netProfitIsk = netRevIsk - totalBuyIsk;
        const netMarginPct = grossRevIsk > 0 ? (netProfitIsk / grossRevIsk) * 100 : 0;
        const roiPct = totalBuyIsk > 0 ? (netProfitIsk / totalBuyIsk) * 100 : 0;
        const perUnitNetProfitIsk = activeQty > 0 ? netProfitIsk / activeQty : 0;
        const unitVol = card.unitOutputM3 || itemMeta?.volume || (baseQty > 0 ? card.totalVolumeM3 / baseQty : 1);
        const totalVolumeM3 = activeQty * unitVol;

        return {
          netProfitIsk,
          buyAllProfitIsk: netProfitIsk,
          buyMissingProfitIsk: undefined,
          buyMissingCapitalIsk: undefined,
          hangarSavingsIsk: 0,
          requiredCapitalIsk: totalBuyIsk,
          netMarginPct,
          roiPct,
          perUnitNetProfitIsk,
          totalVolumeM3,
          rawInputM3: totalVolumeM3,
          packagedOutputM3: totalVolumeM3,
          slippagePct: Math.max(buyWalk.slippagePct, sellSlippage),
          shortfallQty: buyWalk.shortfallQty + sellShortfall,
          buildTime: null,
          iskPerHour: null,
          totalOutputUnits: activeQty,
        };
      }
    }

    // 3. Fallback linear scaling when orderbook/BOM not present
    return {
      netProfitIsk: card.netProfitIsk * ratio,
      buyAllProfitIsk: (card.buyAllProfitIsk ?? card.netProfitIsk) * ratio,
      buyMissingProfitIsk:
        typeof card.buyMissingProfitIsk === 'number' ? card.buyMissingProfitIsk * ratio : undefined,
      buyMissingCapitalIsk:
        typeof card.buyMissingCapitalIsk === 'number' ? card.buyMissingCapitalIsk * ratio : undefined,
      hangarSavingsIsk: card.hangarSavingsIsk ?? 0,
      requiredCapitalIsk: card.requiredCapitalIsk * ratio,
      netMarginPct: card.netMarginPct,
      roiPct: card.roiPct,
      perUnitNetProfitIsk: card.perUnitNetProfitIsk,
      totalVolumeM3: card.totalVolumeM3 * ratio,
      rawInputM3: card.totalVolumeM3 * ratio,
      packagedOutputM3: card.totalVolumeM3 * ratio,
      slippagePct: Math.max(
        card.depthWalkBuy?.slippagePct ?? 0,
        card.depthWalkSell?.slippagePct ?? 0
      ),
      shortfallQty:
        (card.depthWalkBuy?.shortfallQty ?? 0) + (card.depthWalkSell?.shortfallQty ?? 0),
      buildTime: null,
      iskPerHour: null,
      totalOutputUnits: activeQty,
    };
  }, [
    card,
    activeQty,
    baseQty,
    isIndyCard,
    snapshot,
    profile,
    appSettings,
    effectiveExecMode,
    structureConfig,
    allocatedSlots,
    slotInfo.mfgSlotsMax,
  ]);

  const netProfitAfterTransport = liveMetrics.netProfitIsk - effectiveTransportCostIsk;
  const maxAbsorbedTransportIsk = Math.max(0, liveMetrics.netProfitIsk - Math.max(0, cardMinDesiredProfitIsk));
  const isPositive = netProfitAfterTransport >= 0;

  const dotlanUrl = useMemo(() => {
    const srcName = card.sourceHubId ? EMPIRE_HUB_MAP[card.sourceHubId]?.systemName : card.routeChains?.[0]?.legs[0]?.systemName;
    const dstName = card.destHubId ? EMPIRE_HUB_MAP[card.destHubId]?.systemName : card.routeChains?.[0]?.legs[card.routeChains[0].legs.length - 1]?.systemName;
    if (srcName && dstName && srcName !== dstName) return getDotlanRouteUrl(srcName, dstName);
    return getDotlanSystemUrl(dstName || srcName || 'Jita');
  }, [card.sourceHubId, card.destHubId, card.routeChains]);

  const activeBrokerPct = Number(
    (
      getBrokerFeeRate(profile.skills.brokerRelations, effectiveExecMode, {
        hubId: card.destHubId ?? 'jita',
        standings: profile.npcStandings,
        appSettings,
      }) * 100
    ).toFixed(2)
  );
  const conflicts = card.activeOrderConflicts ?? [];
  const hasConflict = conflicts.length > 0;
  const conflictTooltip = hasConflict
    ? conflicts
        .map(
          (c) =>
            `${c.itemName}: ${c.volumeRemain.toLocaleString('en-US')} units listed @ ${formatIsk(c.price, false)}`
        )
        .join(' | ')
    : undefined;

  const commitNewQty = (next: number) => {
    const clamped = Math.max(1, Math.min(10000000, Math.round(next || 1)));
    onCommitQty?.(card.id, clamped);
  };

  const stepDelta = computeStepperDelta(activeQty, isIndyCard);

  const handleOpenHauler = () => {
    if (!onOpenHaulerFlyout) return;
    const allLegs = card.routeChains?.flatMap((ch) => ch.legs) ?? [];
    const firstStop = allLegs[0];
    const lastStop = allLegs[allLegs.length - 1];
    const originSystemId = firstStop?.systemId ?? EVE_ANCHORS.JITA_SYSTEM_ID;
    const destSystemId =
      lastStop?.systemId ??
      (isIndyCard ? structureConfig.systemId : EVE_ANCHORS.DODIXIE_SYSTEM_ID);
    const originName = firstStop?.systemName ?? 'Jita';
    const destName =
      lastStop?.systemName ?? (isIndyCard ? structureConfig.systemName : 'Dodixie');

    onOpenHaulerFlyout({
      title: `${card.title} (${activeQty.toLocaleString('en-US')} ${card.qtyUnitLabel ?? (isIndyCard ? 'runs' : 'units')})`,
      rawInputM3: liveMetrics.rawInputM3,
      packagedOutputM3: liveMetrics.packagedOutputM3,
      cargoValueIsk: liveMetrics.requiredCapitalIsk,
      originSystemId,
      destSystemId,
      originName,
      destName,
    });
  };

  return (
    <article
      onClick={() => onSelectCard?.(card.id)}
      className={`border rounded-lg transition-all ${
        isSelected
          ? 'bg-[#162133] border-cyan-400/70 border-l-2 border-l-cyan-400 shadow-[inset_0_1px_0_rgba(34,211,238,0.16),0_6px_20px_-6px_rgba(6,182,212,0.22)]'
          : isQueuedForRoute
            ? 'bg-[#151e2c] border-cyan-400/80 ring-1 ring-cyan-400/20'
            : 'bg-[#131822] border-slate-800/90 hover:border-slate-700/90'
      }`}
    >
      {/* Header Row */}
      <div
        className={`p-5 flex flex-col sm:flex-row sm:items-start justify-between gap-4 ${
          cardCollapsed ? 'pb-5' : 'pb-4'
        }`}
      >
        <div className="min-w-0">
          {/* Metadata kicker + Add to Route tick box + Market Depth & Active Order Open badges */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-slate-400 mb-1.5">
            <label
              onClick={(e) => e.stopPropagation()}
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-[11px] font-medium transition-colors cursor-pointer select-none ${
                isQueuedForRoute
                  ? 'bg-cyan-500/15 border-cyan-400/60 text-cyan-200 hover:bg-cyan-500/25'
                  : 'bg-[#0e131b] border-slate-700/90 text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200'
              }`}
            >
              <input
                type="checkbox"
                checked={isQueuedForRoute}
                aria-label={`${isQueuedForRoute ? 'Remove' : 'Add'} ${card.title} ${isQueuedForRoute ? 'from' : 'to'} route`}
                onChange={(e) => onToggleQueueForRoute(card.id, e.target.checked)}
                className="w-3.5 h-3.5 rounded border-slate-600 bg-[#0b0e14] text-cyan-400 accent-cyan-400 focus:ring-cyan-400 focus:ring-offset-0 cursor-pointer shrink-0"
              />
              <span>{isQueuedForRoute ? 'In Route' : 'Add to Route'}</span>
            </label>
            <span className="font-mono tabular-nums text-cyan-400">
              {String(rank).padStart(2, '0')}.
            </span>
            <span className="text-slate-300 font-medium">{card.engineLabel}</span>
            <span aria-hidden="true">·</span>
            <span>{card.stationAnchor}</span>

            {/* Market Depth Cap Badge */}
            <span
              title={card.marketDepthDetail}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-700/80 bg-[#0e131b] font-mono tabular-nums text-[10px] text-slate-200"
            >
              <Layers className="w-3 h-3 text-cyan-400" aria-hidden="true" />
              <span>Market Depth: {card.marketDepthUnits.toLocaleString('en-US')} units</span>
            </span>

            {/* Slippage / Thin Depth Warning */}
            {(liveMetrics.slippagePct >= 1.5 || liveMetrics.shortfallQty > 0) && (
              <span
                title={
                  liveMetrics.shortfallQty > 0
                    ? `Orderbook shortfall detected (${liveMetrics.shortfallQty.toLocaleString('en-US')} units exceed live depth) · Slippage ${liveMetrics.slippagePct.toFixed(2)}%`
                    : `Depth-walk slippage: +${liveMetrics.slippagePct.toFixed(2)}% vs top-of-book`
                }
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-mono tabular-nums text-[10px] font-medium ${
                  liveMetrics.shortfallQty > 0
                    ? 'border-rose-500/55 bg-rose-500/15 text-rose-200'
                    : 'border-amber-500/55 bg-amber-500/15 text-amber-200'
                }`}
              >
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                <span>
                  {liveMetrics.shortfallQty > 0
                    ? `Shortfall · Slip ${liveMetrics.slippagePct.toFixed(1)}%`
                    : `Slippage ${liveMetrics.slippagePct.toFixed(1)}%`}
                </span>
              </span>
            )}

            {/* Active Character Sell Order Conflict Guard Badge */}
            {hasConflict && (
              <span
                title={`Active Order Open in destination region — ${conflictTooltip}`}
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/55 bg-amber-500/15 font-mono text-[10px] font-semibold text-amber-200"
              >
                <AlertCircle className="w-3 h-3 text-amber-400" aria-hidden="true" />
                <span>
                  Active Order Open{conflicts.length > 1 ? ` (${conflicts.length})` : ''}
                </span>
              </span>
            )}
          </div>

          <h3 className="font-display text-lg font-semibold text-slate-100 leading-snug">
            {card.title}
          </h3>
          {!cardCollapsed && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs text-slate-400">{card.subtitle}</p>
              {card.multiPeriodTrend && (
                <PriceTrendRibbon
                  trend={card.multiPeriodTrend}
                  primaryPeriod={appSettings?.priceTrendPeriod ?? '7d'}
                  showSparkline={true}
                  tooltipsEnabled={appSettings?.tooltipsEnabled ?? true}
                />
              )}
              <a
                href={dotlanUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Open hub / route in DOTLAN EveMaps"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-800 bg-[#0b0e14] text-[10px] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
              >
                <Compass className="w-2.5 h-2.5 text-cyan-400" />
                <span>DOTLAN</span>
              </a>
            </div>
          )}
        </div>

        {/* Right Side: Profit Readout + Pin + Collapse Toggle */}
        <div className="flex items-start justify-between sm:justify-end gap-3 shrink-0">
          <div className="sm:text-right">
            <div className="text-[11px] text-slate-400">
              {effectiveTransportCostIsk > 0
                ? 'After-Tax & Transport Net'
                : isIndyCard
                  ? 'Buy All (Replacement Cost)'
                  : 'True After-Tax Net Profit'}
            </div>
            <div
              className={`font-mono tabular-nums text-xl font-semibold mt-0.5 ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? '+' : ''}
              {formatIsk(netProfitAfterTransport)}
            </div>
            <div
              className={`font-mono tabular-nums text-xs mt-0.5 ${
                isPositive ? 'text-emerald-300/90' : 'text-rose-300/90'
              }`}
            >
              Margin {formatPct(liveMetrics.netMarginPct)} · ROI {formatPct(liveMetrics.roiPct)}
              {liveMetrics.iskPerHour !== null && liveMetrics.iskPerHour !== 0 && (
                <span className="text-cyan-300 ml-1.5">
                  · {formatIsk(liveMetrics.iskPerHour)}/hr
                </span>
              )}
            </div>
            {!cardCollapsed && (
              <div className="font-mono tabular-nums text-[10px] text-slate-400 mt-0.5 inline-flex items-center gap-1 flex-wrap justify-end">
                <span>
                  Tax {card.salesTaxPct.toFixed(2)}%
                  {activeBrokerPct > 0
                    ? ` + Broker ${activeBrokerPct.toFixed(2)}%`
                    : ' · 0% Broker'}
                </span>
                {card.standingBrokerNote && (
                  <InfoTip
                    tooltipsEnabled={appSettings?.tooltipsEnabled ?? true}
                    title="Exact Broker Fee Breakdown"
                    content={card.standingBrokerNote}
                  />
                )}
                <span>·</span>
                <span className="text-amber-300/90">
                  {liveMetrics.perUnitNetProfitIsk >= 0 ? '+' : ''}
                  {Math.abs(liveMetrics.perUnitNetProfitIsk) < 100
                    ? `${liveMetrics.perUnitNetProfitIsk.toFixed(2)} ISK/u`
                    : `${formatIsk(liveMetrics.perUnitNetProfitIsk)}/u`}
                </span>
              </div>
            )}
          </div>

          <div
            className="flex items-center gap-1 shrink-0 pt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            {card.primaryTypeId && onTogglePinWatchlist && (
              <button
                type="button"
                onClick={() =>
                  onTogglePinWatchlist(
                    card.primaryTypeId!,
                    card.primaryItemName || card.title,
                    card.engine === 'indy_invention' ? 'blueprint' : 'sku'
                  )
                }
                title={
                  isPinnedToWatchlist
                    ? 'Remove from Pinned Watchlist'
                    : 'Pin to Watchlist with margin alerts'
                }
                aria-label={isPinnedToWatchlist ? 'Unpin from watchlist' : 'Pin to watchlist'}
                className={`p-1.5 rounded border transition-colors cursor-pointer ${
                  isPinnedToWatchlist
                    ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-200'
                    : 'border-slate-700/80 bg-[#0b0e14] text-slate-400 hover:text-cyan-200 hover:border-cyan-400/50'
                }`}
              >
                <Pin className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              onClick={toggleCardCollapsed}
              aria-expanded={!cardCollapsed}
              aria-label={cardCollapsed ? `Expand ${card.title}` : `Collapse ${card.title}`}
              title={cardCollapsed ? 'Expand card details' : 'Collapse card'}
              className="p-1.5 rounded border border-slate-700/80 bg-[#0b0e14] text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
            >
              {cardCollapsed ? (
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {!cardCollapsed && (
        <>
          {/* Interactive Quantity / Runs Slicer & Multi-Slot Concurrency Strip */}
          {showSlicer && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="px-5 py-2.5 border-t border-slate-800/80 bg-[#0c1119]/80 flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[11px] font-medium text-slate-400">
                  {isIndyCard ? 'Runs' : 'Qty'}:
                </span>
                <div className="inline-flex items-center rounded border border-slate-700/90 bg-[#0b0e14] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => commitNewQty(Math.max(1, activeQty - stepDelta))}
                    aria-label={`Decrease ${isIndyCard ? 'runs' : 'quantity'} by ${stepDelta}`}
                    className="px-2 py-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Minus className="w-3 h-3" />
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={10000000}
                    value={activeQty}
                    aria-label={`${isIndyCard ? 'Blueprint runs' : 'Trade quantity'} for ${card.title}`}
                    onChange={(e) => commitNewQty(Number(e.target.value))}
                    className="w-20 bg-transparent text-center font-mono tabular-nums text-xs text-cyan-200 font-semibold py-1 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => commitNewQty(activeQty + stepDelta)}
                    aria-label={`Increase ${isIndyCard ? 'runs' : 'quantity'} by ${stepDelta}`}
                    className="px-2 py-1 text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                </div>

                {activeQty !== optimalQty && (
                  <button
                    type="button"
                    onClick={() => commitNewQty(optimalQty)}
                    title={`Reset to optimal depth-walked profitable volume (${optimalQty.toLocaleString('en-US')})`}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/10 text-[11px] font-medium text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>Max Profitable ({optimalQty.toLocaleString('en-US')})</span>
                  </button>
                )}

                {isIndyCard && liveMetrics.buildTime && (
                  <div className="flex flex-wrap items-center gap-2 pl-2 border-l border-slate-800">
                    <span className="text-[11px] text-slate-400">Slots:</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, slotInfo.mfgSlotsMax)}
                      value={allocatedSlots}
                      aria-label={`Concurrent manufacturing slots for ${card.title}`}
                      onChange={(e) =>
                        setAllocatedSlots(
                          Math.max(1, Math.min(slotInfo.mfgSlotsMax, Number(e.target.value) || 1))
                        )
                      }
                      className="w-12 bg-[#0b0e14] border border-slate-700/90 rounded px-1.5 py-0.5 text-center font-mono tabular-nums text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                    />
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 flex items-center gap-1">
                      <Clock className="w-3 h-3 text-cyan-400" aria-hidden="true" />
                      <span>
                        1-Slot {formatDurationCompact(liveMetrics.buildTime.sequentialTotalSec)}
                      </span>
                      {liveMetrics.buildTime.allocatedSlotsClamped > 1 && (
                        <>
                          <span className="text-slate-600">→</span>
                          <span className="text-cyan-300 font-medium">
                            {liveMetrics.buildTime.allocatedSlotsClamped}×{' '}
                            {formatDurationCompact(liveMetrics.buildTime.timePerSlotSec)} (
                            {formatDurationCompact(liveMetrics.buildTime.concurrentWallClockSec)}{' '}
                            wall)
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>

              {/* Quick Build Queue & Hauler Flyout Triggers */}
              <div className="flex items-center gap-1.5">
                {isIndyCard && onAddToBuildQueue && (
                  <button
                    type="button"
                    onClick={() => onAddToBuildQueue(card, activeQty, allocatedSlots)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                      isInBuildQueue
                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                        : 'border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25'
                    }`}
                  >
                    {isInBuildQueue ? (
                      <>
                        <Check className="w-3 h-3" aria-hidden="true" />
                        <span>Update Queue</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3 h-3" aria-hidden="true" />
                        <span>Build Queue</span>
                      </>
                    )}
                  </button>
                )}
                {onChangeCardTransport && (
                  <button
                    type="button"
                    onClick={() => setShowTransportTools((v) => !v)}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                      typeof haulCostOverrideIsk === 'number'
                        ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                        : showTransportTools || effectiveTransportCostIsk > 0
                          ? 'border-cyan-400/50 bg-cyan-500/10 text-cyan-200'
                          : 'border-slate-700/90 bg-[#0b0e14] text-slate-300 hover:border-cyan-400/50'
                    }`}
                  >
                    <span>
                      {typeof haulCostOverrideIsk === 'number'
                        ? `Route Haul: ${formatIsk(haulCostOverrideIsk)}`
                        : effectiveTransportCostIsk > 0
                          ? `Transport: ${formatIsk(effectiveTransportCostIsk)}`
                          : 'Transport / Headroom'}
                    </span>
                  </button>
                )}
                {onOpenHaulerFlyout && (
                  <button
                    type="button"
                    onClick={handleOpenHauler}
                    title="Inspect hauling jumps, owned hull trips, and Jita fit Multi-Buy"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-700/90 bg-[#0b0e14] text-[11px] font-medium text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors cursor-pointer"
                  >
                    <Truck className="w-3 h-3 text-amber-400" aria-hidden="true" />
                    <span>Hauler &amp; Fit</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Per-Card Transport Cost + Min Desired Profit -> Max Absorbed Transport Headroom */}
          {showTransportTools && onChangeCardTransport && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="px-5 py-2.5 border-t border-slate-800/80 bg-[#0d1420] flex flex-wrap items-center justify-between gap-3 text-xs"
            >
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-slate-300">
                  <span className="text-[11px] text-slate-400">Transport Cost (M ISK):</span>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    disabled={typeof haulCostOverrideIsk === 'number'}
                    value={Number((effectiveTransportCostIsk / 1_000_000).toFixed(2))}
                    onChange={(e) =>
                      onChangeCardTransport(
                        card.id,
                        Math.max(0, Number(e.target.value) || 0) * 1_000_000,
                        cardMinDesiredProfitIsk
                      )
                    }
                    className="w-20 bg-[#0b0e14] border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-100 disabled:opacity-50"
                  />
                </label>
                <label className="inline-flex items-center gap-1.5 text-slate-300">
                  <span className="text-[11px] text-slate-400">Min Desired Profit (M ISK):</span>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={Number((cardMinDesiredProfitIsk / 1_000_000).toFixed(2))}
                    onChange={(e) =>
                      onChangeCardTransport(
                        card.id,
                        cardTransportCostIsk,
                        Math.max(0, Number(e.target.value) || 0) * 1_000_000
                      )
                    }
                    className="w-20 bg-[#0b0e14] border border-slate-700 rounded px-2 py-0.5 text-xs font-mono text-slate-100"
                  />
                </label>
              </div>
              <div className="flex items-center gap-2 font-mono text-[11px]">
                {typeof haulCostOverrideIsk === 'number' && (
                  <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-200">
                    Overridden in Route Planner
                  </span>
                )}
                <span className="text-slate-400">
                  Max Absorbed Transport Headroom:{' '}
                  <strong className="text-cyan-300">{formatIsk(maxAbsorbedTransportIsk)}</strong>
                </span>
              </div>
            </div>
          )}

          {/* Dual Profit Strip ("Buy All" vs "Buy Missing") for Blueprint / Indy Cards */}
          {isIndyCard && typeof liveMetrics.buyMissingProfitIsk === 'number' && (
            <div className="px-5 py-2 border-t border-slate-800/80 bg-[#0e1522]/70 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border border-slate-800 bg-[#0b0e14]/80">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Buy All (Replacement Cost)
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-slate-400">
                    Capital: {formatIsk(liveMetrics.requiredCapitalIsk)}
                  </div>
                </div>
                <div
                  className={`font-mono tabular-nums text-sm font-semibold ${
                    liveMetrics.buyAllProfitIsk >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {liveMetrics.buyAllProfitIsk >= 0 ? '+' : ''}
                  {formatIsk(liveMetrics.buyAllProfitIsk)}
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border border-cyan-500/30 bg-cyan-500/[0.06]">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-cyan-300">
                    Buy Missing (Cash Out-of-Pocket)
                  </div>
                  <div className="font-mono tabular-nums text-[11px] text-slate-400">
                    Cash: {formatIsk(liveMetrics.buyMissingCapitalIsk ?? 0)}
                    {liveMetrics.hangarSavingsIsk > 0 && (
                      <span className="text-emerald-400 ml-1.5">
                        (Hangar saves {formatIsk(liveMetrics.hangarSavingsIsk)})
                      </span>
                    )}
                  </div>
                </div>
                <div
                  className={`font-mono tabular-nums text-sm font-semibold ${
                    liveMetrics.buyMissingProfitIsk >= 0 ? 'text-emerald-300' : 'text-rose-400'
                  }`}
                >
                  {liveMetrics.buyMissingProfitIsk >= 0 ? '+' : ''}
                  {formatIsk(liveMetrics.buyMissingProfitIsk)}
                </div>
              </div>
            </div>
          )}

          {/* Single-elevation 4-column telemetry bar separated by hairlines */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-slate-800/80 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80 bg-[#0f141d]/60">
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-slate-400">Required Capital</div>
              <div className="font-mono tabular-nums text-sm font-medium text-amber-300 mt-0.5">
                {formatIsk(liveMetrics.requiredCapitalIsk)}
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-slate-400">Total Volume</div>
              <div className="font-mono tabular-nums text-sm font-medium text-slate-100 mt-0.5">
                {formatM3(liveMetrics.totalVolumeM3)}
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-slate-400">Recommended Hull</div>
              <div
                className="text-xs font-medium text-cyan-300 mt-1 truncate"
                title={card.recommendedHull}
              >
                {card.recommendedHull.split(' (')[0]}
              </div>
            </div>
            <div className="px-4 py-2.5" title={card.marketDepthDetail}>
              <div className="text-[11px] text-slate-400">Absorbable Depth Cap</div>
              <div className="font-mono tabular-nums text-xs font-medium text-slate-200 mt-1">
                {card.marketDepthUnits.toLocaleString('en-US')} units
              </div>
            </div>
          </div>

          {/* Actionable Execution Steps */}
          <div className="px-5 py-4">
            <ol className="space-y-2 text-sm text-slate-300 leading-relaxed">
              {card.steps.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="font-mono tabular-nums text-xs text-slate-500 mt-0.5 shrink-0">
                    {idx + 1}.
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Footer Controls + Inline Execution Mode Switcher */}
          <div
            onClick={(e) => e.stopPropagation()}
            className="px-5 py-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <div
                className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 text-[11px]"
                role="group"
                aria-label="Order Execution Mode"
              >
                <button
                  type="button"
                  onClick={() =>
                    onChangeCardExecutionMode
                      ? onChangeCardExecutionMode(card.id, 'list_orders')
                      : onChangeExecutionMode('list_orders')
                  }
                  title="Card-specific: Place Buy/Sell Orders (Sales Tax + Exact Standing/Upwell Broker Fee)"
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    effectiveExecMode === 'list_orders'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  List Orders
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChangeCardExecutionMode
                      ? onChangeCardExecutionMode(card.id, 'instant_fill')
                      : onChangeExecutionMode('instant_fill')
                  }
                  title="Card-specific: Instant Fill into existing orders (Sales Tax only, 0% Broker Fee)"
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    effectiveExecMode === 'instant_fill'
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Instant Fill
                </button>
              </div>
              {cardExecutionModeOverride && (
                <span className="text-[10px] font-mono text-cyan-300/90">Card Override</span>
              )}
              <span className="text-xs text-slate-500 truncate hidden md:inline">
                Hull: {card.recommendedHull}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setOrderBookExpanded((v) => !v)}
                aria-expanded={orderBookExpanded}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  orderBookExpanded
                    ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                    : 'border-slate-700/90 bg-[#0e131b] text-emerald-300 hover:border-emerald-400/60 hover:bg-emerald-500/10'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Order Book &amp; Range</span>
                {orderBookExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                )}
              </button>
              {card.primaryTypeId && (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenHistory(
                        card.primaryTypeId!,
                        card.primaryItemName || card.title
                      )
                    }
                    title={`View 30-day ESI market history for ${card.primaryItemName || card.title}`}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-slate-700/90 bg-[#0e131b] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <LineChart className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>30d History</span>
                  </button>
                  {onOpenPriceProjection && (
                    <button
                      type="button"
                      onClick={() =>
                        onOpenPriceProjection({
                          typeId: card.primaryTypeId!,
                          itemName: card.primaryItemName || card.title,
                          regionId: EVE_ANCHORS.THE_FORGE_REGION_ID,
                        })
                      }
                      title={`Quantitative 7d/30d price projection & optional AI commentary for ${card.primaryItemName || card.title}`}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400/70 hover:bg-indigo-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Projection</span>
                    </button>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => onInspect(card)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700/90 bg-[#0e131b] text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Inspect Data</span>
              </button>
              <button
                type="button"
                onClick={() => onAskAdvisor(card)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <MessageSquareText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Ask Advisor</span>
                <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Expandable Live ESI Regional Order Book & Skill-Based Remote Buy Range Panel */}
          {orderBookExpanded && (
            <div onClick={(e) => e.stopPropagation()}>
              <LiveOrderBookPanel
                card={card}
                profile={profile}
                eveAccessToken={eveAccessToken}
                appSettings={appSettings}
                onOpenSsoSettings={onOpenSsoSettings}
              />
            </div>
          )}
        </>
      )}
    </article>
  );
}
