import { Fragment, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Eye,
  MapPin,
  Package,
  Route,
} from 'lucide-react';
import { EMPIRE_HUB_LIST, EMPIRE_HUB_MAP } from '../data/eveCatalog.ts';
import { formatIsk } from '../engines/decisionEngines.ts';
import {
  computeExactHubBrokerFee,
  getDotlanSystemUrl,
  resolveHubIdFromSystemOrRegion,
} from '../utils/dotlan.ts';
import { buildStationTradingOpportunities } from '../utils/v22Engines.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  MarketCategoryId,
  MarketSnapshot,
  PilotProfile,
  StationTradeOpportunity,
  TradeHubId,
} from '../types/eve.ts';
import { InfoTip } from './InfoTip.tsx';
import { LiveOrderBookPanel } from './LiveOrderBookPanel.tsx';
import { PriceTrendRibbon } from './PriceTrendRibbon.tsx';

interface StationTradingTabProps {
  profile: PilotProfile;
  snapshot: MarketSnapshot;
  checkedCategories: MarketCategoryId[];
  appSettings: AppSettingsV22;
  eveAccessToken: string | null;
  onPinToRoute: (card: ActionCardData) => void;
  onInspectCard: (card: ActionCardData) => void;
  onOpenProjection: (typeId: number, itemName: string, regionId: number, regionName: string) => void;
  onOpenSettings: () => void;
}

type StationSortKey =
  | 'bestProfitIsk'
  | 'bestRoiPct'
  | 'capitalRequiredIsk'
  | 'dailyVolume'
  | 'stdDaysToSell'
  | 'bestStrategy';

export function StationTradingTab({
  profile,
  snapshot,
  checkedCategories,
  appSettings,
  eveAccessToken,
  onPinToRoute,
  onInspectCard,
  onOpenProjection,
  onOpenSettings,
}: StationTradingTabProps) {
  const defaultHub = resolveHubIdFromSystemOrRegion(profile.currentSystemId);
  const [hubSelection, setHubSelection] = useState<'current' | TradeHubId>('current');
  const [minDailyVol, setMinDailyVol] = useState<number>(20);
  const [minRoiPct, setMinRoiPct] = useState<number>(1.0);
  const [rangeJumps, setRangeJumps] = useState<0 | 1 | 2 | 3>(0);
  const [onlyGreen, setOnlyGreen] = useState<boolean>(true);
  const [qtyOverrides, setQtyOverrides] = useState<Record<number, number>>({});
  const [sortKey, setSortKey] = useState<StationSortKey>('bestProfitIsk');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [expandedTypeId, setExpandedTypeId] = useState<number | null>(null);

  const activeHubId: TradeHubId = hubSelection === 'current' ? defaultHub : hubSelection;
  const activeHubDef = EMPIRE_HUB_MAP[activeHubId] ?? EMPIRE_HUB_MAP.jita;

  const brokerInfo = useMemo(
    () =>
      computeExactHubBrokerFee({
        hubId: activeHubId,
        brokerRelationsLvl: profile.skills.brokerRelations,
        standings: profile.npcStandings,
        useCustomUpwellBroker: appSettings.useCustomUpwellBroker,
        customUpwellBrokerPct: appSettings.customUpwellBrokerPct,
        includeSccSurcharge: appSettings.includeSccSurcharge,
      }),
    [activeHubId, profile.skills.brokerRelations, profile.npcStandings, appSettings]
  );

  const opportunities = useMemo(() => {
    const raw = buildStationTradingOpportunities({
      snapshot,
      profile,
      appSettings,
      hubId: activeHubId,
      categories: checkedCategories,
      rangeJumps,
      qtyOverrides,
    });

    const filtered = raw.filter((o) => {
      if (o.dailyVolume < minDailyVol) return false;
      if (onlyGreen && o.bestProfitIsk <= 0) return false;
      if (o.bestRoiPct < minRoiPct) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortKey) {
        case 'bestProfitIsk':
          return (a.bestProfitIsk - b.bestProfitIsk) * dir;
        case 'bestRoiPct':
          return (a.bestRoiPct - b.bestRoiPct) * dir;
        case 'capitalRequiredIsk':
          return (a.capitalRequiredIsk - b.capitalRequiredIsk) * dir;
        case 'dailyVolume':
          return (a.dailyVolume - b.dailyVolume) * dir;
        case 'stdDaysToSell':
          return (a.stdDaysToSell - b.stdDaysToSell) * dir;
        case 'bestStrategy':
          return a.bestStrategy.localeCompare(b.bestStrategy) * dir;
      }
    });
  }, [
    snapshot,
    profile,
    appSettings,
    activeHubId,
    checkedCategories,
    rangeJumps,
    qtyOverrides,
    minDailyVol,
    onlyGreen,
    minRoiPct,
    sortKey,
    sortDir,
  ]);

  const totalStationStockValueIsk = useMemo(
    () => opportunities.reduce((sum, o) => sum + o.stationStockMarketValueIsk, 0),
    [opportunities]
  );

  const toggleSort = (key: StationSortKey) => {
    if (sortKey === key) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const renderSortIcon = (key: StationSortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 inline ml-0.5 text-cyan-300" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-0.5 text-cyan-300" />
    );
  };

  const buildCardFromOpportunity = (o: StationTradeOpportunity): ActionCardData => {
    const strategyLabel =
      o.bestStrategy === 'std_margin'
        ? 'Std Margin (Buy Order → Sell Order)'
        : o.bestStrategy === 'insta_flip'
          ? 'Insta Flip (Sell → Buy Instant)'
          : 'Hybrid Execution';
    return {
      id: `station-trade-${o.hubId}-${o.typeId}`,
      engine: 'regional_trade',
      engineLabel: 'Station Trading',
      title: `${o.name} × ${o.recommendedQty.toLocaleString('en-US')} (${o.hubName})`,
      subtitle: `${strategyLabel} · Est. ${o.stdDaysToSell}d turnover`,
      categories: [o.category],
      primaryTypeId: o.typeId,
      primaryItemName: o.name,
      stationAnchor: o.stationName,
      recommendedHull: 'Docked (0 Jumps)',
      hullClass: 't1_industrial',
      requiredCapitalIsk: o.capitalRequiredIsk,
      totalVolumeM3: o.recommendedQty * o.unitVolumeM3,
      safeDailyQty: `${o.dailyVolume.toLocaleString('en-US')}/day`,
      marketDepthUnits: o.dailyVolume,
      marketDepthDetail: `Order range: ${o.rangeJumps === 0 ? 'Station' : `${o.rangeJumps}j`} · ${o.stdDaysToSell}d to sell`,
      outputUnits: o.recommendedQty,
      perUnitNetProfitIsk: o.bestProfitIsk / Math.max(1, o.recommendedQty),
      netProfitIsk: o.bestProfitIsk,
      grossRevenueIsk: o.bestSellPrice * o.recommendedQty,
      netMarginPct: o.bestRoiPct,
      roiPct: o.bestRoiPct,
      executionMode: o.bestStrategy === 'insta_flip' ? 'instant_fill' : 'list_orders',
      salesTaxPct: 7.5 * (1 - 0.11 * profile.skills.accounting),
      brokerFeePct: o.bestStrategy === 'insta_flip' ? 0 : brokerInfo.effectiveTotalBrokerPct,
      destinationRegionId: activeHubDef.regionId,
      riskLabel: o.stdDaysToSell > 4 ? 'Watch Depth' : 'High Margin',
      steps: [
        `Station Trade inside ${o.stationName} (0 hauling jumps).`,
        `Recommended Strategy: ${strategyLabel} for ${o.recommendedQty.toLocaleString('en-US')} units.`,
        `Buy target: ${formatIsk(o.bestBuyPrice, false)} · Sell target: ${formatIsk(o.bestSellPrice, false)} · Broker ${brokerInfo.effectiveTotalBrokerPct.toFixed(3)}%.`,
      ],
      inspection: {
        summaryText: `Station trading breakdown at ${o.stationName} with exact standing-adjusted broker fee (${brokerInfo.effectiveTotalBrokerPct.toFixed(3)}%).`,
        columns: [
          { key: 'strategy', label: 'Strategy Pairing', align: 'left' },
          { key: 'profit', label: 'Net Profit (ISK)', align: 'right' },
          { key: 'roi', label: 'ROI %', align: 'right' },
        ],
        rows: [
          { strategy: 'Std Margin (Buy Order → Sell Order)', profit: formatIsk(o.stdMarginProfitIsk), roi: `${o.stdMarginRoiPct.toFixed(2)}%` },
          { strategy: 'Insta Flip (Instant Buy → Instant Sell)', profit: formatIsk(o.instaFlipProfitIsk), roi: `${o.instaFlipRoiPct.toFixed(2)}%` },
          { strategy: 'Hybrid (Mixed Order + Instant)', profit: formatIsk(o.hybridProfitIsk), roi: `${o.hybridRoiPct.toFixed(2)}%` },
        ],
      },
      routeChains: [
        {
          cardId: `station-trade-${o.hubId}-${o.typeId}`,
          cardTitle: `${o.name} Station Trade (${o.hubName})`,
          legs: [
            {
              action: 'buy',
              systemId: activeHubDef.systemId,
              systemName: activeHubDef.systemName,
              stationId: activeHubDef.stationId,
              stationName: activeHubDef.stationName,
              cargoDeltaM3: o.recommendedQty * o.unitVolumeM3,
              iskCost: o.capitalRequiredIsk,
              items: [{ typeId: o.typeId, name: o.name, quantity: o.recommendedQty, iskAmount: o.capitalRequiredIsk, volumeM3: o.recommendedQty * o.unitVolumeM3 }],
            },
            {
              action: 'sell',
              systemId: activeHubDef.systemId,
              systemName: activeHubDef.systemName,
              stationId: activeHubDef.stationId,
              stationName: activeHubDef.stationName,
              cargoDeltaM3: -(o.recommendedQty * o.unitVolumeM3),
              iskPayout: o.bestSellPrice * o.recommendedQty,
              netProfitIsk: o.bestProfitIsk,
              items: [{ typeId: o.typeId, name: o.name, quantity: o.recommendedQty, iskAmount: o.bestSellPrice * o.recommendedQty, volumeM3: o.recommendedQty * o.unitVolumeM3 }],
            },
          ],
        },
      ],
      sourceHubId: activeHubId,
      destHubId: activeHubId,
      multiPeriodTrend: o.trend,
    };
  };

  return (
    <div className="space-y-4">
      {/* Toolbar & Station Stock Valuation Summary */}
      <div className="bg-[#10151f] border border-slate-800 rounded-lg p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={hubSelection}
              onChange={(e) => setHubSelection(e.target.value as 'current' | TradeHubId)}
              aria-label="Station Trading Hub"
              className="bg-[#0b0e14] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100"
            >
              <option value="current">
                Current Station ({profile.currentSystemName} → {EMPIRE_HUB_MAP[defaultHub].systemName})
              </option>
              {EMPIRE_HUB_LIST.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.shortLabel} ({h.stationName})
                </option>
              ))}
            </select>

            <a
              href={getDotlanSystemUrl(activeHubDef.systemName)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded border border-slate-800 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/50 text-[11px]"
            >
              <MapPin className="w-3 h-3" />
              <span>DOTLAN</span>
              <ExternalLink className="w-2.5 h-2.5" />
            </a>

            <div className="inline-flex items-center gap-1 bg-[#0b0e14] border border-slate-800 rounded px-2 py-1 text-[11px]">
              <span className="text-slate-400">Range:</span>
              {([0, 1, 2, 3] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRangeJumps(r)}
                  className={`px-1.5 py-0.5 rounded font-mono cursor-pointer ${
                    rangeJumps === r ? 'bg-cyan-500/20 text-cyan-200 font-semibold' : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {r === 0 ? 'Station' : `${r}j`}
                </button>
              ))}
            </div>
          </div>

          {/* Station Material Stock Current Market Value */}
          <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Package className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-sans text-slate-400">Station Stock (Current Market Val):</span>
              <span className="text-amber-300 font-semibold">{formatIsk(totalStationStockValueIsk)}</span>
              <InfoTip
                tooltipsEnabled={appSettings.tooltipsEnabled}
                title="Station Asset Market Valuation"
                body="Shows the live market valuation of tracked assets synced in your active station hangar. This reflects current market value only (not historical acquisition cost basis)."
              />
            </div>
            <span className="text-slate-600">|</span>
            <span className="text-cyan-300" title={`Faction ${brokerInfo.factionStanding} · Corp ${brokerInfo.corpStanding}`}>
              Broker: {brokerInfo.effectiveTotalBrokerPct.toFixed(3)}%
            </span>
          </div>
        </div>

        {/* Liquidity & ROI Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex items-center gap-1.5 text-slate-400">
              <span>Min Daily Vol:</span>
              <input
                type="number"
                min={0}
                value={minDailyVol}
                onChange={(e) => setMinDailyVol(Math.max(0, Number(e.target.value) || 0))}
                className="w-20 bg-[#0b0e14] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-slate-400">
              <span>Min ROI %:</span>
              <input
                type="number"
                step={0.5}
                value={minRoiPct}
                onChange={(e) => setMinRoiPct(Number(e.target.value) || 0)}
                className="w-16 bg-[#0b0e14] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={onlyGreen}
                onChange={(e) => setOnlyGreen(e.target.checked)}
                className="accent-emerald-400"
              />
              <span>Only Profitable (Green) Rows</span>
            </label>
          </div>
          <div className="font-mono text-[11px] text-slate-400">
            {opportunities.length} SKU{opportunities.length === 1 ? '' : 's'} matching · Click any green row to expand live Order Book &amp; 30d Chart
          </div>
        </div>
      </div>

      {/* Main Station Trading Table */}
      <div className="bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#131822] border-b border-slate-800 text-slate-400 text-[11px]">
                <th className="py-2.5 px-3 text-left font-medium">Item &amp; Trend</th>
                <th className="py-2.5 px-2 text-right font-medium">Qty Override</th>
                <th className="py-2.5 px-2 text-right font-medium">Std Margin</th>
                <th className="py-2.5 px-2 text-right font-medium">Insta Flip</th>
                <th className="py-2.5 px-2 text-right font-medium">Hybrid</th>
                <th className="py-2.5 px-2 text-right font-medium">
                  <button type="button" onClick={() => toggleSort('bestProfitIsk')} className="cursor-pointer hover:text-slate-100">
                    Net Profit {renderSortIcon('bestProfitIsk')}
                  </button>
                </th>
                <th className="py-2.5 px-2 text-right font-medium">
                  <button type="button" onClick={() => toggleSort('bestRoiPct')} className="cursor-pointer hover:text-slate-100">
                    Profit % {renderSortIcon('bestRoiPct')}
                  </button>
                </th>
                <th className="py-2.5 px-2 text-right font-medium">
                  <button type="button" onClick={() => toggleSort('capitalRequiredIsk')} className="cursor-pointer hover:text-slate-100">
                    Capital {renderSortIcon('capitalRequiredIsk')}
                  </button>
                </th>
                <th className="py-2.5 px-2 text-right font-medium">
                  <button type="button" onClick={() => toggleSort('dailyVolume')} className="cursor-pointer hover:text-slate-100">
                    Daily Vol {renderSortIcon('dailyVolume')}
                  </button>
                </th>
                <th className="py-2.5 px-2 text-right font-medium">
                  <button type="button" onClick={() => toggleSort('stdDaysToSell')} className="cursor-pointer hover:text-slate-100">
                    Turnover {renderSortIcon('stdDaysToSell')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right font-medium">
                  <button type="button" onClick={() => toggleSort('bestStrategy')} className="cursor-pointer hover:text-slate-100">
                    Strategy / Actions {renderSortIcon('bestStrategy')}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {opportunities.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-8 text-center text-slate-500">
                    No station trading rows matched your current filters. Lower Min ROI % or Min Daily Vol, or select more market categories.
                  </td>
                </tr>
              ) : (
                opportunities.slice(0, 60).map((o) => {
                  const hasGreen =
                    o.stdMarginProfitIsk > 0 || o.instaFlipProfitIsk > 0 || o.hybridProfitIsk > 0;
                  const isExpanded = expandedTypeId === o.typeId;
                  const card = isExpanded ? buildCardFromOpportunity(o) : null;
                  return (
                    <Fragment key={o.typeId}>
                      <tr
                        onClick={() => hasGreen && setExpandedTypeId(isExpanded ? null : o.typeId)}
                        className={`transition-colors ${
                          hasGreen ? 'cursor-pointer hover:bg-slate-900/60' : 'opacity-75'
                        } ${isExpanded ? 'bg-cyan-500/8' : ''}`}
                      >
                        <td className="py-2 px-3">
                          <div className="font-medium text-slate-100">{o.name}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            <PriceTrendRibbon
                              trend={o.trend}
                              primaryPeriod={appSettings.priceTrendPeriod}
                              compact
                            />
                            {o.stationStockQty > 0 && (
                              <span className="font-mono text-[10px] text-amber-300">
                                Stock: {o.stationStockQty.toLocaleString('en-US')} ({formatIsk(o.stationStockMarketValueIsk)})
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          className="py-2 px-2 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center border border-slate-700 rounded bg-[#0b0e14] px-1">
                            <button
                              type="button"
                              onClick={() =>
                                setQtyOverrides((p) => ({
                                  ...p,
                                  [o.typeId]: Math.max(1, (p[o.typeId] ?? o.recommendedQty) - Math.max(1, Math.round(o.recommendedQty * 0.1))),
                                }))
                              }
                              className="px-1 text-slate-300 hover:text-cyan-300 cursor-pointer"
                            >
                              −
                            </button>
                            <input
                              type="number"
                              min={1}
                              value={o.recommendedQty}
                              onChange={(e) =>
                                setQtyOverrides((p) => ({
                                  ...p,
                                  [o.typeId]: Math.max(1, Math.round(Number(e.target.value) || 1)),
                                }))
                              }
                              className="w-14 bg-transparent text-center font-mono text-[11px] text-slate-100 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setQtyOverrides((p) => ({
                                  ...p,
                                  [o.typeId]: (p[o.typeId] ?? o.recommendedQty) + Math.max(1, Math.round(o.recommendedQty * 0.1)),
                                }))
                              }
                              className="px-1 text-slate-300 hover:text-cyan-300 cursor-pointer"
                            >
                              +
                            </button>
                          </div>
                        </td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap ${o.stdMarginProfitIsk > 0 ? 'text-emerald-300' : 'text-rose-400/80'}`}>
                          <div>{formatIsk(o.stdMarginProfitIsk)}</div>
                          <div className="text-[10px] opacity-80">{o.stdMarginRoiPct.toFixed(1)}%</div>
                        </td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap ${o.instaFlipProfitIsk > 0 ? 'text-emerald-300' : 'text-rose-400/80'}`}>
                          <div>{formatIsk(o.instaFlipProfitIsk)}</div>
                          <div className="text-[10px] opacity-80">{o.instaFlipRoiPct.toFixed(1)}%</div>
                        </td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap ${o.hybridProfitIsk > 0 ? 'text-emerald-300' : 'text-rose-400/80'}`}>
                          <div>{formatIsk(o.hybridProfitIsk)}</div>
                          <div className="text-[10px] opacity-80">{o.hybridRoiPct.toFixed(1)}%</div>
                        </td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${o.bestProfitIsk > 0 ? 'text-emerald-300' : 'text-rose-400'}`}>
                          {formatIsk(o.bestProfitIsk)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-cyan-300 whitespace-nowrap">
                          {o.bestRoiPct.toFixed(1)}%
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {formatIsk(o.capitalRequiredIsk)}
                        </td>
                        <td className="py-2 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {o.dailyVolume.toLocaleString('en-US')}
                        </td>
                        <td className={`py-2 px-2 text-right font-mono tabular-nums whitespace-nowrap ${o.stdDaysToSell > 5 ? 'text-amber-300' : 'text-slate-300'}`}>
                          {o.stdDaysToSell}d
                        </td>
                        <td
                          className="py-2 px-3 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <span className="font-mono text-[10px] text-slate-400 mr-1">
                              {o.bestStrategy === 'std_margin'
                                ? 'Std'
                                : o.bestStrategy === 'insta_flip'
                                  ? 'Insta'
                                  : 'Hybrid'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                onOpenProjection(o.typeId, o.name, activeHubDef.regionId, activeHubDef.regionName)
                              }
                              title="Open 30d Chart & Price Projection"
                              className="p-1 rounded border border-slate-700 bg-[#131822] text-slate-300 hover:text-cyan-300 cursor-pointer"
                            >
                              <BarChart3 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onInspectCard(buildCardFromOpportunity(o))}
                              title="Open Inspection Plan"
                              className="p-1 rounded border border-slate-700 bg-[#131822] text-slate-300 hover:text-cyan-300 cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onPinToRoute(buildCardFromOpportunity(o))}
                              title="Pin to Unified Route Pool"
                              className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 text-[10px] cursor-pointer"
                            >
                              <Route className="w-3 h-3 inline mr-0.5" />
                              Pin
                            </button>
                            {hasGreen && (
                              <button
                                type="button"
                                onClick={() => setExpandedTypeId(isExpanded ? null : o.typeId)}
                                className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                              >
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {isExpanded && card && (
                        <tr>
                          <td colSpan={11} className="p-3 bg-[#0a0f18] border-t border-cyan-500/25">
                            <LiveOrderBookPanel
                              card={card}
                              profile={profile}
                              eveAccessToken={eveAccessToken}
                              onOpenSsoSettings={onOpenSettings}
                              appSettings={appSettings}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
