import { useMemo, useState } from 'react';
import {
  BellRing,
  ChevronDown,
  ChevronUp,
  LineChart,
  Pin,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { EMPIRE_HUB_MAP, EVE_ITEMS, ITEM_BY_ID } from '../data/eveCatalog.ts';
import {
  formatIsk,
  formatPct,
  getBrokerFeeRate,
  getHubQuote,
  getQuote,
  getSalesTaxRate,
} from '../engines/decisionEngines.ts';
import type {
  DynamicMarketCatalog,
  MarketSnapshot,
  PilotProfile,
  TradeHubId,
  WatchlistItem,
} from '../types/eve.ts';
import { useCollapsibleCard } from '../utils/collapseStore.ts';

interface WatchlistPanelProps {
  watchlist: WatchlistItem[];
  snapshot: MarketSnapshot;
  profile: PilotProfile;
  catalog: DynamicMarketCatalog;
  sourceHub: TradeHubId;
  destHub: TradeHubId;
  onAddWatchlistItem: (item: WatchlistItem) => void;
  onUpdateWatchlistItem: (typeId: number, patch: Partial<WatchlistItem>) => void;
  onRemoveWatchlistItem: (typeId: number) => void;
  onOpenHistory: (typeId: number, name: string) => void;
  onOpenPriceProjection?: (target: {
    typeId: number;
    itemName: string;
    regionId?: number;
    currentPrice?: number;
  }) => void;
}

export function WatchlistPanel({
  watchlist,
  snapshot,
  profile,
  catalog,
  sourceHub,
  destHub,
  onAddWatchlistItem,
  onUpdateWatchlistItem,
  onRemoveWatchlistItem,
  onOpenHistory,
  onOpenPriceProjection,
}: WatchlistPanelProps) {
  const [collapsed, toggleCollapsed] = useCollapsibleCard('panel-watchlist', false);
  const [pickerQuery, setPickerQuery] = useState('');
  const [selectedTypeId, setSelectedTypeId] = useState<number | null>(null);

  const srcMeta = EMPIRE_HUB_MAP[sourceHub];
  const dstMeta = EMPIRE_HUB_MAP[destHub];

  const searchableItems = useMemo(() => {
    const map = new Map<number, { typeId: number; name: string; volume: number }>();
    for (const item of EVE_ITEMS) {
      map.set(item.typeId, { typeId: item.typeId, name: item.name, volume: item.volume });
    }
    for (const skus of Object.values(catalog.categories)) {
      for (const s of skus ?? []) {
        if (!map.has(s.typeId)) {
          map.set(s.typeId, { typeId: s.typeId, name: s.name, volume: s.volume > 0 ? s.volume : 1 });
        }
      }
    }
    return Array.from(map.values());
  }, [catalog]);

  const pickerMatches = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return [];
    const pinnedSet = new Set(watchlist.map((w) => w.typeId));
    return searchableItems
      .filter((i) => !pinnedSet.has(i.typeId) && i.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [pickerQuery, searchableItems, watchlist]);

  const evaluatedRows = useMemo(() => {
    const execMode = profile.orderExecutionMode ?? 'list_orders';
    const salesTax = getSalesTaxRate(profile.skills.accounting);
    const brokerFee = getBrokerFeeRate(profile.skills.brokerRelations, execMode);
    const netMult = 1 - salesTax - brokerFee;

    return watchlist.map((w) => {
      const catalogItem = ITEM_BY_ID[w.typeId];
      const q = getQuote(snapshot, w.typeId);
      const srcQ = getHubQuote(q, sourceHub, catalogItem);
      const dstQ = getHubQuote(q, destHub, catalogItem);

      const buyCost = srcQ.sellMin;
      const sellPrice = execMode === 'instant_fill' ? dstQ.buyMax : dstQ.sellMin;
      const netUnitProfit = sellPrice * netMult - buyCost;
      const roiPct = buyCost > 0 ? (netUnitProfit / buyCost) * 100 : 0;
      const volume = catalogItem?.volume || 1;
      const iskPerM3 = volume > 0 ? netUnitProfit / volume : 0;

      const roiHit = roiPct >= w.minRoiPct;
      const m3Hit = iskPerM3 >= w.minIskPerM3;
      const triggered = netUnitProfit > 0 && roiHit && m3Hit;

      return {
        item: w,
        buyCost,
        sellPrice,
        netUnitProfit,
        roiPct,
        iskPerM3,
        roiHit,
        m3Hit,
        triggered,
      };
    });
  }, [watchlist, snapshot, profile, sourceHub, destHub]);

  const triggeredCount = evaluatedRows.filter((r) => r.triggered).length;

  return (
    <section
      aria-label="Pinned Watchlist and Margin Triggers"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0e131b]/70">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <Pin className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Pinned Watchlist &amp; Margin Triggers
          </h2>
          <span className="font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border border-slate-700 bg-[#0b0e14] text-slate-300">
            {watchlist.length} Pinned · {srcMeta.shortLabel} → {dstMeta.shortLabel}
          </span>
          {triggeredCount > 0 && (
            <span className="inline-flex items-center gap-1 font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border border-emerald-400/60 bg-emerald-500/15 text-emerald-200 font-semibold">
              <BellRing className="w-3 h-3 text-emerald-300" aria-hidden="true" />
              <span>
                {triggeredCount} Target{triggeredCount > 1 ? 's' : ''} Hit
              </span>
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand Pinned Watchlist' : 'Collapse Pinned Watchlist'}
          className="p-1.5 rounded border border-slate-700/80 bg-[#0b0e14] text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
        >
          {collapsed ? (
            <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
          )}
        </button>
      </div>

      {!collapsed && (
        <div>
          {/* Quick-Add Search Bar */}
          <div className="px-4 py-2.5 border-b border-slate-800/80 bg-[#0e131b]/40">
            <div className="relative max-w-md">
              <Search
                className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={pickerQuery}
                onChange={(e) => setPickerQuery(e.target.value)}
                placeholder="Pin an item or blueprint SKU to watchlist (e.g. Scourge Fury, PLEX, Hobgoblin II)..."
                className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded-md pl-8 pr-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
              />
            </div>

            {pickerMatches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {pickerMatches.map((m) => (
                  <button
                    key={m.typeId}
                    type="button"
                    onClick={() => {
                      onAddWatchlistItem({
                        id: `wl-${m.typeId}-${Date.now()}`,
                        typeId: m.typeId,
                        name: m.name,
                        kind: 'sku',
                        minRoiPct: 10,
                        minIskPerM3: 1000,
                        pinnedAt: new Date().toISOString(),
                      });
                      setPickerQuery('');
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" />
                    <span>{m.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {evaluatedRows.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-400">
              Pin any Opportunity Card, Blueprint row, or search above to monitor live ROI % and ISK/m³ trigger alerts.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0e131b]/80 border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-4 text-left font-medium">Pinned SKU / Blueprint</th>
                    <th className="py-2 px-3 text-right font-medium">{srcMeta.shortLabel} Buy</th>
                    <th className="py-2 px-3 text-right font-medium">{dstMeta.shortLabel} Sell</th>
                    <th className="py-2 px-3 text-right font-medium">Live ROI</th>
                    <th className="py-2 px-3 text-right font-medium">Live ISK/m³</th>
                    <th className="py-2 px-3 text-right font-medium">Min ROI %</th>
                    <th className="py-2 px-3 text-right font-medium">Min ISK/m³</th>
                    <th className="py-2 px-3 text-center font-medium">Trigger</th>
                    <th className="py-2 px-4 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {evaluatedRows.map((row) => {
                    const isSelected = selectedTypeId === row.item.typeId;
                    return (
                    <tr
                      key={row.item.typeId}
                      onClick={() => setSelectedTypeId(row.item.typeId)}
                      className={
                        isSelected
                          ? 'bg-cyan-500/[0.09] shadow-[inset_3px_0_0_#22d3ee,inset_0_1px_0_rgba(34,211,238,0.12)] transition-colors cursor-pointer'
                          : row.triggered
                            ? 'bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors cursor-pointer'
                            : 'hover:bg-slate-800/30 transition-colors cursor-pointer'
                      }
                    >
                      <td className="py-2 px-4 font-medium text-slate-100 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{row.item.name}</span>
                          {row.item.kind === 'blueprint' && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-indigo-400/40 bg-indigo-500/10 text-indigo-300">
                              BP
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-cyan-300 whitespace-nowrap">
                        {formatIsk(row.buyCost, false)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                        {formatIsk(row.sellPrice, false)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          row.roiHit ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {formatPct(row.roiPct)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                          row.m3Hit ? 'text-emerald-400' : 'text-slate-300'
                        }`}
                      >
                        {formatIsk(row.iskPerM3)}/m³
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <input
                          type="number"
                          step={1}
                          min={0}
                          max={500}
                          value={row.item.minRoiPct}
                          aria-label={`Minimum ROI % trigger for ${row.item.name}`}
                          onChange={(e) =>
                            onUpdateWatchlistItem(row.item.typeId, {
                              minRoiPct: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-16 bg-[#0b0e14] border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                        />
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap">
                        <input
                          type="number"
                          step={500}
                          min={0}
                          value={row.item.minIskPerM3}
                          aria-label={`Minimum ISK per m3 trigger for ${row.item.name}`}
                          onChange={(e) =>
                            onUpdateWatchlistItem(row.item.typeId, {
                              minIskPerM3: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                          className="w-24 bg-[#0b0e14] border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                        />
                      </td>
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        {row.triggered ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-emerald-400/60 bg-emerald-500/20 font-mono text-[10px] font-semibold text-emerald-200">
                            <BellRing className="w-3 h-3" aria-hidden="true" />
                            <span>TARGET HIT</span>
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-slate-500">Watching</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="inline-flex items-center gap-1.5">
                          {onOpenPriceProjection && (
                            <button
                              type="button"
                              onClick={() =>
                                onOpenPriceProjection({
                                  typeId: row.item.typeId,
                                  itemName: row.item.name,
                                  regionId: dstMeta.regionId,
                                  currentPrice: row.sellPrice,
                                })
                              }
                              title={`Price projection & momentum analysis for ${row.item.name}`}
                              className="p-1 rounded text-indigo-300 hover:text-indigo-200 hover:bg-indigo-500/20 transition-colors cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onOpenHistory(row.item.typeId, row.item.name)}
                            title={`30d history for ${row.item.name}`}
                            className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <LineChart className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onRemoveWatchlistItem(row.item.typeId)}
                            title={`Unpin ${row.item.name}`}
                            className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
