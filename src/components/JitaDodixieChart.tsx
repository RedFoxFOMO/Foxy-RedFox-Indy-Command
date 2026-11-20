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
import { LineChart } from 'lucide-react';
import {
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
  getQuote,
  getSalesTaxRate,
} from '../engines/decisionEngines.ts';
import type {
  DynamicMarketCatalog,
  EveItem,
  MarketCategoryId,
  MarketSnapshot,
  PilotProfile,
} from '../types/eve.ts';

interface JitaDodixieChartProps {
  checkedCategories: MarketCategoryId[];
  snapshot: MarketSnapshot;
  profile: PilotProfile;
  catalog: DynamicMarketCatalog;
  minDailyVolume: number;
  onOpenHistory: (typeId: number, name: string) => void;
}

interface ItemTradeRow {
  typeId: number;
  name: string;
  categoryId: MarketCategoryId;
  categoryLabel: string;
  jitaBuy: number;
  jitaSell: number;
  dodixieSell: number;
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
  jitaBuy: number;
  jitaSell: number;
  dodixieSell: number;
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
}

function JitaDodixieTooltip({ active, payload, mode }: CustomTooltipProps) {
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
          : 'Jita 4-4 acquisition vs. Dodixie 9-20 sell'}
      </div>

      <div className="space-y-1 border-t border-slate-800 pt-2 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Jita Buy</span>
          <span className="text-slate-200">{formatIsk(d.jitaBuy, false)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-cyan-300">Jita Sell</span>
          <span className="text-slate-100 font-medium">{formatIsk(d.jitaSell, false)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-amber-300">Dodixie Sell</span>
          <span className="text-slate-100 font-semibold">{formatIsk(d.dodixieSell, false)}</span>
        </div>
        <div className="flex items-center justify-between gap-4 pt-1 border-t border-slate-800/80">
          <span className="text-emerald-400">Net Margin %</span>
          <span className={d.netMarginPct >= 0 ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
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
  onOpenHistory,
}: JitaDodixieChartProps) {
  const [viewMode, setViewMode] = useState<'categories' | 'items'>('categories');
  const [showAllRows, setShowAllRows] = useState(false);

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
      const jitaBuy = q.jita.buyMax;
      const jitaSell = q.jita.sellMin;
      const dodixieSell = execMode === 'instant_fill' ? q.dodixie.buyMax : q.dodixie.sellMin;
      if (jitaSell <= 0 || dodixieSell <= 0) continue;

      const estDodixieVol =
        q.dodixie.avgDailyVol7d ??
        q.estDailyDodixieVol ??
        (item.estDailyDodixieVol ||
          Math.round((q.dodixie.sellVolume + q.dodixie.buyVolume) * 0.12));
      if (minDailyVolume > 0 && estDodixieVol < minDailyVolume) continue;

      const netRevenuePerUnit = dodixieSell * netSellMultiplier;
      const unitProfitIsk = netRevenuePerUnit - jitaSell;
      const netMarginPct = dodixieSell > 0 ? (unitProfitIsk / dodixieSell) * 100 : 0;
      const roiPct = jitaSell > 0 ? (unitProfitIsk / jitaSell) * 100 : 0;
      const safeBatchUnits = Math.max(
        1,
        Math.min(
          Math.floor(Math.max(1, estDodixieVol) * 0.25),
          Math.floor((profile.activeCapitalCap * 0.15) / Math.max(1, jitaSell))
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
        jitaBuy,
        jitaSell,
        dodixieSell,
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
  }, [checkedCategories, snapshot, profile, catalog, minDailyVolume]);

  const chartData = useMemo<CategoryChartDatum[]>(() => {
    if (viewMode === 'items') {
      return itemRows.slice(0, 10).map((row) => ({
        key: String(row.typeId),
        label: shortAxisLabel(row.name, 16),
        fullName: row.name,
        skuCount: 1,
        jitaBuy: Math.round(row.jitaBuy),
        jitaSell: Math.round(row.jitaSell),
        dodixieSell: Math.round(row.dodixieSell),
        netMarginPct: Number(row.netMarginPct.toFixed(1)),
        roiPct: Number(row.roiPct.toFixed(1)),
        cargoVolumeM3: row.batchVolumeM3,
        batchProfitIsk: Math.round(row.batchProfitIsk),
        typeId: row.typeId,
      }));
    }

    // Group by checked market category
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
      const avgJitaBuy = rows.reduce((s, r) => s + r.jitaBuy, 0) / count;
      const avgJitaSell = rows.reduce((s, r) => s + r.jitaSell, 0) / count;
      const avgDodixieSell = rows.reduce((s, r) => s + r.dodixieSell, 0) / count;
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
        jitaBuy: Math.round(avgJitaBuy),
        jitaSell: Math.round(avgJitaSell),
        dodixieSell: Math.round(avgDodixieSell),
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
      aria-label="Jita vs Dodixie Price and Margin Comparison"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Header + Segmented View Switcher */}
      <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Jita Buy / Sell vs. Dodixie Sell &amp; Net Margin %
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Live trade-hub comparison across your {checkedCategories.length} checked categories after Accounting V &amp; Broker Relations V fees.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Legend */}
          <div className="hidden sm:flex items-center gap-3 text-[11px] text-slate-300">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-500 inline-block" aria-hidden="true" />
              <span>Jita Buy</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-cyan-400 inline-block" aria-hidden="true" />
              <span>Jita Sell</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 inline-block" aria-hidden="true" />
              <span>Dodixie Sell</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" aria-hidden="true" />
              <span>Net Margin %</span>
            </span>
          </div>

          {/* Toggle */}
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
        </div>
      </div>

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
                content={<JitaDodixieTooltip mode={viewMode} />}
              />
              <Bar
                yAxisId="isk"
                dataKey="jitaBuy"
                name="Jita Buy (ISK)"
                fill="#64748b"
                radius={[2, 2, 0, 0]}
                maxBarSize={18}
              />
              <Bar
                yAxisId="isk"
                dataKey="jitaSell"
                name="Jita Sell (ISK)"
                fill="#22d3ee"
                radius={[2, 2, 0, 0]}
                maxBarSize={18}
              />
              <Bar
                yAxisId="isk"
                dataKey="dodixieSell"
                name="Dodixie Sell (ISK)"
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
            Checked Market Items — Jita vs. Dodixie Quotes ({itemRows.length.toLocaleString()} liquid SKUs
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
                <th className="py-2 px-3 text-right font-medium">Jita Buy</th>
                <th className="py-2 px-3 text-right font-medium">Jita Sell</th>
                <th className="py-2 px-3 text-right font-medium">Dodixie Sell</th>
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
                    {formatIsk(row.jitaBuy, false)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-cyan-300 whitespace-nowrap">
                    {formatIsk(row.jitaSell, false)}
                  </td>
                  <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                    {formatIsk(row.dodixieSell, false)}
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
    </section>
  );
}
