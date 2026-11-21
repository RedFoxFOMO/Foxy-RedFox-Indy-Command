import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeftRight, ChevronDown, ChevronUp, LineChart } from 'lucide-react';
import {
  EMPIRE_HUBS,
  EMPIRE_HUB_MAP,
  ITEM_BY_ID,
  MARKET_CATEGORIES,
  getItemsForCategories,
} from '../data/eveCatalog.ts';

const CATEGORY_LABEL_BY_ID: Record<string, string> = Object.fromEntries(
  MARKET_CATEGORIES.map((c) => [c.id, c.label])
);
import {
  formatIsk,
  formatM3,
  formatPct,
  getBrokerFeeRate,
  getHubQuote,
  getQuote,
  getSalesTaxRate,
} from '../engines/decisionEngines.ts';
import type {
  DynamicMarketCatalog,
  EveItem,
  MarketCategoryId,
  MarketSnapshot,
  PilotProfile,
  TradeHubId,
} from '../types/eve.ts';
import { useCollapsibleCard } from '../utils/collapseStore.ts';

interface JitaDodixieChartProps {
  checkedCategories: MarketCategoryId[];
  snapshot: MarketSnapshot;
  profile: PilotProfile;
  catalog: DynamicMarketCatalog;
  minDailyVolume: number;
  sourceHub: TradeHubId;
  destHub: TradeHubId;
  onChangeSourceHub: (hub: TradeHubId) => void;
  onChangeDestHub: (hub: TradeHubId) => void;
  onSwapHubs: () => void;
  onOpenHistory: (typeId: number, name: string) => void;
}

interface ItemTradeRow {
  typeId: number;
  name: string;
  categoryId: MarketCategoryId;
  categoryLabel: string;
  srcBuy: number;
  srcSell: number;
  dstSell: number;
  netMarginPct: number;
  roiPct: number;
  unitProfitIsk: number;
  unitVolumeM3: number;
  safeBatchUnits: number;
  batchVolumeM3: number;
  batchProfitIsk: number;
  source: 'live' | 'baseline';
}

interface CategoryChartDatum {
  key: string;
  label: string;
  fullName: string;
  skuCount: number;
  srcBuy: number;
  srcSell: number;
  dstSell: number;
  netMarginPct: number;
  roiPct: number;
  cargoVolumeM3: number;
  batchProfitIsk: number;
  typeId?: number;
}

function compactAxisIsk(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K`;
  return `${Math.round(abs)}`;
}

function shortAxisLabel(label: string, max = 14): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload?: CategoryChartDatum }[];
  mode: 'categories' | 'items';
  srcLabel: string;
  dstLabel: string;
}

function FiveHubTooltip({ active, payload, mode, srcLabel, dstLabel }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-[#0d1118] border border-slate-700/90 rounded-md px-3.5 py-2.5 text-xs shadow-xl max-w-xs">
      <div className="font-display font-semibold text-slate-100 leading-snug">
        {d.fullName}
      </div>
      <div className="text-[11px] text-slate-400 mt-0.5 mb-2">
        {mode === 'categories'
          ? `Category avg across ${d.skuCount} tracked SKU${d.skuCount > 1 ? 's' : ''}`
          : `${srcLabel} acquisition vs. ${dstLabel} sell`}
      </div>

      <div className="space-y-1 border-t border-slate-800 pt-2 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">{srcLabel} Buy</span>
          <span className="text-slate-200">{formatIsk(d.srcBuy, false)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-cyan-300">{srcLabel} Sell</span>
          <span className="text-slate-100 font-medium">{formatIsk(d.srcSell, false)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-amber-300">{dstLabel} Sell</span>
          <span className="text-slate-100 font-semibold">{formatIsk(d.dstSell, false)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-800/80">
          <span className="text-emerald-400">Net Margin %</span>
          <span
            className={
              d.netMarginPct >= 0
                ? 'text-emerald-400 font-semibold'
                : 'text-rose-400 font-semibold'
            }
          >
            {formatPct(d.netMarginPct)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Net ROI %</span>
          <span className={d.roiPct >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
            {formatPct(d.roiPct)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Safe Batch Cargo</span>
          <span className="text-slate-200">{formatM3(d.cargoVolumeM3)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Est. Batch Net</span>
          <span className={d.batchProfitIsk >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {d.batchProfitIsk >= 0 ? '+' : ''}
            {formatIsk(d.batchProfitIsk)}
          </span>
        </div>
      </div>
    </div>
  );
}

export function JitaDodixieChart({
  checkedCategories,
  snapshot,
  profile,
  catalog,
  minDailyVolume,
  sourceHub,
  destHub,
  onChangeSourceHub,
  onChangeDestHub,
  onSwapHubs,
  onOpenHistory,
}: JitaDodixieChartProps) {
  const [collapsed, toggleCollapsed] = useCollapsibleCard('panel-five-hub-chart', false);
  const [viewMode, setViewMode] = useState<'categories' | 'items'>('categories');
  const [showAllRows, setShowAllRows] = useState(false);

  const srcMeta = EMPIRE_HUB_MAP[sourceHub];
  const dstMeta = EMPIRE_HUB_MAP[destHub];

  const itemRows = useMemo<ItemTradeRow[]>(() => {
    const mergedMap = new Map<number, EveItem>();
    for (const baseItem of getItemsForCategories(checkedCategories)) {
      mergedMap.set(baseItem.typeId, baseItem);
    }
    for (const catId of checkedCategories) {
      for (const sku of catalog.categories[catId] ?? []) {
        if (!mergedMap.has(sku.typeId)) {
          mergedMap.set(sku.typeId, {
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
    const items = Array.from(mergedMap.values());
    const execMode = profile.orderExecutionMode ?? 'list_orders';
    const salesTax = getSalesTaxRate(profile.skills.accounting);
    const brokerFee = getBrokerFeeRate(profile.skills.brokerRelations, execMode);
    const netSellMultiplier = 1 - salesTax - brokerFee;

    const rows: ItemTradeRow[] = [];
    for (const item of items) {
      if (item.category === 'indy_support') continue;
      const liveQuote = snapshot.quotes[item.typeId];
      if (!ITEM_BY_ID[item.typeId] && (!liveQuote || liveQuote.source !== 'live')) {
        continue;
      }
      const q = liveQuote ?? getQuote(snapshot, item.typeId);
      const srcQ = getHubQuote(q, sourceHub, item);
      const dstQ = getHubQuote(q, destHub, item);

      const srcBuy = srcQ.buyMax;
      const srcSell = srcQ.sellMin;
      const dstSell = execMode === 'instant_fill' ? dstQ.buyMax : dstQ.sellMin;
      if (srcSell <= 0 || dstSell <= 0) continue;

      const estDestVol =
        dstQ.avgDailyVol7d ??
        (destHub === 'jita'
          ? item.estDailyJitaVol
          : item.estDailyDodixieVol ||
            Math.round((dstQ.sellVolume + dstQ.buyVolume) * 0.12));
      if (minDailyVolume > 0 && estDestVol < minDailyVolume) continue;

      const netRevenuePerUnit = dstSell * netSellMultiplier;
      const unitProfitIsk = netRevenuePerUnit - srcSell;
      const netMarginPct = dstSell > 0 ? (unitProfitIsk / dstSell) * 100 : 0;
      const roiPct = srcSell > 0 ? (unitProfitIsk / srcSell) * 100 : 0;
      const safeBatchUnits = Math.max(
        1,
        Math.min(
          Math.floor(Math.max(1, estDestVol) * 0.25),
          Math.floor((profile.activeCapitalCap * 0.15) / Math.max(1, srcSell))
        )
      );
      const batchVolumeM3 = safeBatchUnits * item.volume;
      const batchProfitIsk = safeBatchUnits * unitProfitIsk;
      const catId = item.category as MarketCategoryId;

      rows.push({
        typeId: item.typeId,
        name: item.name,
        categoryId: catId,
        categoryLabel: CATEGORY_LABEL_BY_ID[catId] ?? catId,
        srcBuy,
        srcSell,
        dstSell,
        netMarginPct,
        roiPct,
        unitProfitIsk,
        unitVolumeM3: item.volume,
        safeBatchUnits,
        batchVolumeM3,
        batchProfitIsk,
        source: q.source,
      });
    }

    return rows.sort((a, b) => b.netMarginPct - a.netMarginPct);
  }, [checkedCategories, snapshot, profile, catalog, minDailyVolume, sourceHub, destHub]);

  const chartData = useMemo<CategoryChartDatum[]>(() => {
    if (viewMode === 'items') {
      return itemRows.slice(0, 10).map((row) => ({
        key: String(row.typeId),
        label: shortAxisLabel(row.name, 16),
        fullName: row.name,
        skuCount: 1,
        srcBuy: Math.round(row.srcBuy),
        srcSell: Math.round(row.srcSell),
        dstSell: Math.round(row.dstSell),
        netMarginPct: Number(row.netMarginPct.toFixed(1)),
        roiPct: Number(row.roiPct.toFixed(1)),
        cargoVolumeM3: row.batchVolumeM3,
        batchProfitIsk: Math.round(row.batchProfitIsk),
        typeId: row.typeId,
      }));
    }

    const byCat = new Map<MarketCategoryId, ItemTradeRow[]>();
    for (const row of itemRows) {
      const list = byCat.get(row.categoryId) ?? [];
      list.push(row);
      byCat.set(row.categoryId, list);
    }

    const result: CategoryChartDatum[] = [];
    for (const catId of checkedCategories) {
      const rows = byCat.get(catId);
      if (!rows || rows.length === 0) continue;
      const count = rows.length;
      const avgSrcBuy = rows.reduce((s, r) => s + r.srcBuy, 0) / count;
      const avgSrcSell = rows.reduce((s, r) => s + r.srcSell, 0) / count;
      const avgDstSell = rows.reduce((s, r) => s + r.dstSell, 0) / count;
      const avgNetMargin = rows.reduce((s, r) => s + r.netMarginPct, 0) / count;
      const avgRoi = rows.reduce((s, r) => s + r.roiPct, 0) / count;
      const totalCargo = rows.reduce((s, r) => s + r.batchVolumeM3, 0);
      const totalBatchProfit = rows.reduce((s, r) => s + Math.max(0, r.batchProfitIsk), 0);
      const label = CATEGORY_LABEL_BY_ID[catId] ?? catId;

      result.push({
        key: catId,
        label: shortAxisLabel(label, 14),
        fullName: label,
        skuCount: count,
        srcBuy: Math.round(avgSrcBuy),
        srcSell: Math.round(avgSrcSell),
        dstSell: Math.round(avgDstSell),
        netMarginPct: Number(avgNetMargin.toFixed(1)),
        roiPct: Number(avgRoi.toFixed(1)),
        cargoVolumeM3: totalCargo,
        batchProfitIsk: Math.round(totalBatchProfit),
      });
    }
    return result;
  }, [checkedCategories, itemRows, viewMode]);

  if (checkedCategories.length === 0 || itemRows.length === 0) return null;

  const visibleTableRows = showAllRows ? itemRows : itemRows.slice(0, 12);

  return (
    <section
      aria-label="5-Hub Empire Trade Network Price and Margin Comparison"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Header + 5-Hub Selector + Segmented View Switcher + Collapse Toggle */}
      <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0e131b]/50">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            5-Hub Empire Trade Network — {srcMeta.shortLabel} vs. {dstMeta.shortLabel} Spread &amp; Net Margin %
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Compare live spreads across Jita, Amarr, Dodixie, Rens, and Hek across your {checkedCategories.length} checked categories.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {/* 5-Hub Source / Dest Pair Picker */}
          <div className="inline-flex items-center gap-1.5 bg-[#0b0e14] border border-slate-800 rounded-md px-2 py-1 text-xs">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Buy</span>
            <select
              value={sourceHub}
              aria-label="Source trade hub"
              onChange={(e) => onChangeSourceHub(e.target.value as TradeHubId)}
              className="bg-transparent text-cyan-300 font-medium focus:outline-none cursor-pointer"
            >
              {EMPIRE_HUBS.map((h) => (
                <option key={h.id} value={h.id} className="bg-[#0d1118] text-slate-100">
                  {h.shortLabel}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={onSwapHubs}
              title="Swap Buy and Sell trade hubs"
              aria-label="Swap source and destination hubs"
              className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Sell</span>
            <select
              value={destHub}
              aria-label="Destination trade hub"
              onChange={(e) => onChangeDestHub(e.target.value as TradeHubId)}
              className="bg-transparent text-amber-300 font-medium focus:outline-none cursor-pointer"
            >
              {EMPIRE_HUBS.map((h) => (
                <option key={h.id} value={h.id} className="bg-[#0d1118] text-slate-100">
                  {h.shortLabel}
                </option>
              ))}
            </select>
          </div>

          {/* Toggle */}
          {!collapsed && (
            <div className="inline-flex rounded-md border border-slate-800 bg-[#0b0e14] p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('categories')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  viewMode === 'categories'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                By Category
              </button>
              <button
                type="button"
                onClick={() => setViewMode('items')}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                  viewMode === 'items'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Top 10 SKUs
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand 5-Hub Trade Chart' : 'Collapse 5-Hub Trade Chart'}
            className="p-1.5 rounded border border-slate-700/80 bg-[#0b0e14] text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
          >
            {collapsed ? (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* Recharts Grouped Bar + Net Margin % Line Chart */}
          <div className="px-4 py-4">
            <div className="w-full h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={chartData}
                  margin={{ top: 10, right: 16, left: 6, bottom: 26 }}
                  barCategoryGap="24%"
                  barGap={2}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="label"
                    interval={0}
                    angle={-24}
                    textAnchor="end"
                    height={52}
                    stroke="#64748b"
                    tick={{ fill: '#cbd5e1', fontSize: 11 }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={false}
                  />
                  <YAxis
                    yAxisId="isk"
                    tickFormatter={compactAxisIsk}
                    stroke="#64748b"
                    tick={{
                      fill: '#94a3b8',
                      fontSize: 11,
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={{ stroke: '#334155' }}
                  />
                  <YAxis
                    yAxisId="margin"
                    orientation="right"
                    tickFormatter={(v: number) => `${v}%`}
                    stroke="#10b981"
                    tick={{
                      fill: '#34d399',
                      fontSize: 11,
                      fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    }}
                    axisLine={{ stroke: '#334155' }}
                    tickLine={{ stroke: '#334155' }}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                    content={
                      <FiveHubTooltip
                        mode={viewMode}
                        srcLabel={srcMeta.shortLabel}
                        dstLabel={dstMeta.shortLabel}
                      />
                    }
                  />
                  <Bar
                    yAxisId="isk"
                    dataKey="srcBuy"
                    name={`${srcMeta.shortLabel} Buy (ISK)`}
                    fill="#64748b"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={18}
                  />
                  <Bar
                    yAxisId="isk"
                    dataKey="srcSell"
                    name={`${srcMeta.shortLabel} Sell (ISK)`}
                    fill="#22d3ee"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={18}
                  />
                  <Bar
                    yAxisId="isk"
                    dataKey="dstSell"
                    name={`${dstMeta.shortLabel} Sell (ISK)`}
                    fill="#f59e0b"
                    radius={[2, 2, 0, 0]}
                    maxBarSize={18}
                  />
                  <Line
                    yAxisId="margin"
                    type="monotone"
                    dataKey="netMarginPct"
                    name="Net Margin %"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ r: 3.5, fill: '#10b981', stroke: '#0b0e14', strokeWidth: 1.5 }}
                    activeDot={{ r: 5, fill: '#34d399' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Checked Market Items Spread Table with 30d History Button on Every Row */}
          <div className="border-t border-slate-800/80">
            <div className="px-5 py-2.5 bg-[#0f141d]/70 flex items-center justify-between gap-2 text-xs">
              <span className="font-medium text-slate-300">
                Checked Market Items — {srcMeta.shortLabel} vs. {dstMeta.shortLabel} Quotes ({itemRows.length.toLocaleString()} liquid SKUs
                {minDailyVolume > 0 ? ` · ≥${minDailyVolume.toLocaleString()} u/day` : ''})
              </span>
              {itemRows.length > 12 && (
                <button
                  type="button"
                  onClick={() => setShowAllRows((v) => !v)}
                  className="text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer"
                >
                  {showAllRows ? 'Show Top 12' : `Show All ${itemRows.length} SKUs`}
                </button>
              )}
            </div>

            <div className="overflow-x-auto border-t border-slate-800/70">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0f141d] border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-4 text-left font-medium">Item</th>
                    <th className="py-2 px-3 text-left font-medium">Category</th>
                    <th className="py-2 px-3 text-right font-medium">{srcMeta.shortLabel} Buy</th>
                    <th className="py-2 px-3 text-right font-medium">{srcMeta.shortLabel} Sell</th>
                    <th className="py-2 px-3 text-right font-medium">{dstMeta.shortLabel} Sell</th>
                    <th className="py-2 px-3 text-right font-medium">Net Margin</th>
                    <th className="py-2 px-3 text-right font-medium">Batch m³</th>
                    <th className="py-2 px-4 text-right font-medium">30d History</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {visibleTableRows.map((row) => (
                    <tr key={row.typeId} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2 px-4 text-slate-100 font-medium whitespace-nowrap">
                        {row.name}
                      </td>
                      <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                        {row.categoryLabel}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {formatIsk(row.srcBuy, false)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-cyan-300 whitespace-nowrap">
                        {formatIsk(row.srcSell, false)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                        {formatIsk(row.dstSell, false)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono tabular-nums font-medium whitespace-nowrap ${
                          row.netMarginPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {formatPct(row.netMarginPct)}
                      </td>
                      <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                        {formatM3(row.batchVolumeM3)}
                      </td>
                      <td className="py-2 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => onOpenHistory(row.typeId, row.name)}
                          title={`View 30-day ESI market history for ${row.name}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#0e131b] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                        >
                          <LineChart className="w-3 h-3" aria-hidden="true" />
                          <span>30d History</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
