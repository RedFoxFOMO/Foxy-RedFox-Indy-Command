import { useState } from 'react';
import {
  AlertCircle,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Layers,
  LineChart,
  MessageSquareText,
  Pin,
  Table2,
} from 'lucide-react';
import { formatIsk, formatM3, formatPct } from '../engines/decisionEngines.ts';
import type { ActionCardData, OrderExecutionMode, PilotProfile } from '../types/eve.ts';
import { useCollapsibleCard } from '../utils/collapseStore.ts';
import { LiveOrderBookPanel } from './LiveOrderBookPanel.tsx';

interface ActionCardProps {
  card: ActionCardData;
  rank: number;
  profile: PilotProfile;
  eveAccessToken: string | null;
  isQueuedForRoute: boolean;
  isPinnedToWatchlist?: boolean;
  onToggleQueueForRoute: (cardId: string, nextChecked: boolean) => void;
  onTogglePinWatchlist?: (typeId: number, name: string, kind: 'sku' | 'blueprint') => void;
  onChangeExecutionMode: (mode: OrderExecutionMode) => void;
  onInspect: (card: ActionCardData) => void;
  onAskAdvisor: (card: ActionCardData) => void;
  onOpenHistory: (typeId: number, name: string) => void;
  onOpenSsoSettings: () => void;
}

export function ActionCard({
  card,
  rank,
  profile,
  eveAccessToken,
  isQueuedForRoute,
  isPinnedToWatchlist = false,
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
  const isPositive = card.netProfitIsk >= 0;
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

  return (
    <article
      className={`border rounded-lg transition-colors ${
        isQueuedForRoute
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
            <p className="text-xs text-slate-400 mt-1">{card.subtitle}</p>
          )}
        </div>

        {/* Right Side: Profit Readout + Pin + Collapse Toggle */}
        <div className="flex items-start justify-between sm:justify-end gap-3 shrink-0">
          <div className="sm:text-right">
            <div className="text-[11px] text-slate-400">True After-Tax Net Profit</div>
            <div
              className={`font-mono tabular-nums text-xl font-semibold mt-0.5 ${
                isPositive ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {isPositive ? '+' : ''}
              {formatIsk(card.netProfitIsk)}
            </div>
            <div
              className={`font-mono tabular-nums text-xs mt-0.5 ${
                isPositive ? 'text-emerald-300/90' : 'text-rose-300/90'
              }`}
            >
              Margin {formatPct(card.netMarginPct)} · ROI {formatPct(card.roiPct)}
            </div>
            {!cardCollapsed && (
              <div className="font-mono tabular-nums text-[10px] text-slate-400 mt-0.5">
                Tax {card.salesTaxPct.toFixed(2)}%
                {card.brokerFeePct > 0
                  ? ` + Broker ${card.brokerFeePct.toFixed(2)}%`
                  : ' · 0% Broker'}
                {' · '}
                <span className="text-amber-300/90">
                  {card.perUnitNetProfitIsk >= 0 ? '+' : ''}
                  {Math.abs(card.perUnitNetProfitIsk) < 100
                    ? `${card.perUnitNetProfitIsk.toFixed(2)} ISK/u`
                    : `${formatIsk(card.perUnitNetProfitIsk)}/u`}
                </span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 pt-0.5">
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
          {/* Single-elevation 4-column telemetry bar separated by hairlines */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border-y border-slate-800/80 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/80 bg-[#0f141d]/60">
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-slate-400">Required Capital</div>
              <div className="font-mono tabular-nums text-sm font-medium text-amber-300 mt-0.5">
                {formatIsk(card.requiredCapitalIsk)}
              </div>
            </div>
            <div className="px-4 py-2.5">
              <div className="text-[11px] text-slate-400">Total Volume</div>
              <div className="font-mono tabular-nums text-sm font-medium text-slate-100 mt-0.5">
                {formatM3(card.totalVolumeM3)}
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
          <div className="px-5 py-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 min-w-0">
              <div
                className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 text-[11px]"
                role="group"
                aria-label="Order Execution Mode"
              >
                <button
                  type="button"
                  onClick={() => onChangeExecutionMode('list_orders')}
                  title="Place Buy/Sell Orders: Sales Tax + NPC Broker Fees"
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    card.executionMode === 'list_orders'
                      ? 'bg-cyan-500/20 text-cyan-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  List Orders
                </button>
                <button
                  type="button"
                  onClick={() => onChangeExecutionMode('instant_fill')}
                  title="Take Existing Orders: Sales Tax only (0% Broker Fee)"
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    card.executionMode === 'instant_fill'
                      ? 'bg-emerald-500/20 text-emerald-200'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Instant Fill
                </button>
              </div>
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
            <LiveOrderBookPanel
              card={card}
              profile={profile}
              eveAccessToken={eveAccessToken}
              onOpenSsoSettings={onOpenSsoSettings}
            />
          )}
        </>
      )}
    </article>
  );
}
