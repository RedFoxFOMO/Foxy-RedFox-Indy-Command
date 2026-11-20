import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown, ChevronRight, LineChart } from 'lucide-react';
import { formatIsk, formatM3, formatPct } from '../engines/decisionEngines.ts';
import type { ActionCardData } from '../types/eve.ts';

interface OverviewProfitChartProps {
  cards: ActionCardData[];
  onOpenHistory: (typeId: number, name: string) => void;
  onInspectCard: (card: ActionCardData) => void;
}

interface ChartDatum {
  id: string;
  rank: number;
  shortLabel: string;
  fullTitle: string;
  engineLabel: string;
  batchProfitIsk: number;
  perUnitProfitIsk: number;
  roiPct: number;
  requiredCapitalIsk: number;
  totalVolumeM3: number;
  outputUnits: number;
  recommendedHull: string;
  primaryTypeId?: number;
  primaryItemName?: string;
  card: ActionCardData;
}

function compactAxisIsk(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(0)}K`;
  return `${sign}${Math.round(abs)}`;
}

function truncateLabel(text: string, max = 26): string {
  const cleaned = text
    .replace(/^(Build|Invent & Build|Reprocess|Haul|PI Factory:?)\s+/i, '')
    .replace(/\s+\([^)]*\)$/, '');
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max - 1)}…`;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload?: ChartDatum }[];
}

function OverviewTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-[#0d1118] border border-slate-700/90 rounded-md px-3.5 py-2.5 text-xs shadow-xl max-w-xs">
      <div className="font-display font-semibold text-slate-100 leading-snug">
        {String(d.rank).padStart(2, '0')}. {d.fullTitle}
      </div>
      <div className="text-[11px] text-slate-400 mt-0.5 mb-2">
        {d.engineLabel} · {d.recommendedHull.split(' (')[0]}
      </div>

      <div className="space-y-1 border-t border-slate-800 pt-2 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4">
          <span className="text-cyan-300">Full-Batch Profit</span>
          <span className="text-slate-100 font-semibold">
            {d.batchProfitIsk >= 0 ? '+' : ''}
            {formatIsk(d.batchProfitIsk, false)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-amber-300">Per-Unit Net Profit</span>
          <span className="text-slate-100 font-semibold">
            {d.perUnitProfitIsk >= 0 ? '+' : ''}
            {d.perUnitProfitIsk < 100 && d.perUnitProfitIsk > -100
              ? `${d.perUnitProfitIsk.toFixed(2)} ISK`
              : formatIsk(d.perUnitProfitIsk, false)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Batch ROI</span>
          <span className={d.roiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {formatPct(d.roiPct)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Cargo Volume</span>
          <span className="text-slate-200">{formatM3(d.totalVolumeM3)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Capital Required</span>
          <span className="text-slate-300">{formatIsk(d.requiredCapitalIsk)}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-slate-400">Batch Units</span>
          <span className="text-slate-300">{d.outputUnits.toLocaleString('en-US')} u</span>
        </div>
      </div>
    </div>
  );
}

export function OverviewProfitChart({
  cards,
  onOpenHistory,
  onInspectCard,
}: OverviewProfitChartProps) {
  const [tableOpen, setTableOpen] = useState(true);

  const topTen = useMemo<ChartDatum[]>(() => {
    return [...cards]
      .sort((a, b) => b.netProfitIsk - a.netProfitIsk)
      .slice(0, 10)
      .map((card, idx) => ({
        id: card.id,
        rank: idx + 1,
        shortLabel: `${String(idx + 1).padStart(2, '0')}. ${truncateLabel(card.title)}`,
        fullTitle: card.title,
        engineLabel: card.engineLabel,
        batchProfitIsk: Math.max(0, Math.round(card.netProfitIsk)),
        perUnitProfitIsk: Math.max(0, Number(card.perUnitNetProfitIsk.toFixed(2))),
        roiPct: card.roiPct,
        requiredCapitalIsk: card.requiredCapitalIsk,
        totalVolumeM3: card.totalVolumeM3,
        outputUnits: card.outputUnits,
        recommendedHull: card.recommendedHull,
        primaryTypeId: card.primaryTypeId,
        primaryItemName: card.primaryItemName,
        card,
      }));
  }, [cards]);

  if (topTen.length === 0) return null;

  const chartHeight = Math.max(290, topTen.length * 40 + 54);

  return (
    <section
      aria-label="Top 10 Ranked Opportunities Profit Chart"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Top {topTen.length} Ranked Opportunities — Batch vs. Per-Unit Net Profit
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Dual-scale horizontal comparison across checked Market Scope categories (bottom axis: Full-Batch ISK · top axis: Per-Unit ISK).
          </p>
        </div>

        {/* Inline Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-300 shrink-0">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-cyan-400 inline-block" aria-hidden="true" />
            <span>Full-Batch ISK</span>
          </span>
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-xs bg-amber-400 inline-block" aria-hidden="true" />
            <span>Per-Unit ISK</span>
          </span>
        </div>
      </div>

      {/* Recharts Dual-Axis Horizontal Bar Chart */}
      <div className="px-4 py-4">
        <div style={{ width: '100%', height: chartHeight }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={topTen}
              layout="vertical"
              margin={{ top: 8, right: 24, left: 10, bottom: 8 }}
              barCategoryGap="22%"
              barGap={3}
            >
              <CartesianGrid
                stroke="#1e293b"
                strokeDasharray="3 3"
                horizontal={false}
              />
              <XAxis
                xAxisId="batch"
                type="number"
                orientation="bottom"
                tickFormatter={compactAxisIsk}
                stroke="#64748b"
                tick={{ fill: '#94a3b8', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                axisLine={{ stroke: '#334155' }}
                tickLine={{ stroke: '#334155' }}
              />
              <XAxis
                xAxisId="unit"
                type="number"
                orientation="top"
                tickFormatter={compactAxisIsk}
                stroke="#d97706"
                tick={{ fill: '#fbbf24', fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, monospace' }}
                axisLine={{ stroke: '#334155' }}
                tickLine={{ stroke: '#334155' }}
              />
              <YAxis
                type="category"
                dataKey="shortLabel"
                width={195}
                stroke="#64748b"
                tick={{ fill: '#cbd5e1', fontSize: 11 }}
                axisLine={{ stroke: '#334155' }}
                tickLine={false}
              />
              <Tooltip
                cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                content={<OverviewTooltip />}
              />
              <Bar
                xAxisId="batch"
                dataKey="batchProfitIsk"
                name="Full-Batch Profit (ISK)"
                fill="#22d3ee"
                radius={[0, 3, 3, 0]}
                maxBarSize={14}
              />
              <Bar
                xAxisId="unit"
                dataKey="perUnitProfitIsk"
                name="Per-Unit Net Profit (ISK)"
                fill="#f59e0b"
                radius={[0, 3, 3, 0]}
                maxBarSize={14}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Compact Ranked Opportunities Table with 30d History Button on Every Row */}
      <div className="border-t border-slate-800/80">
        <button
          type="button"
          onClick={() => setTableOpen((v) => !v)}
          className="w-full px-5 py-2.5 flex items-center justify-between text-xs text-slate-300 hover:bg-slate-800/30 transition-colors cursor-pointer"
        >
          <span className="inline-flex items-center gap-1.5 font-medium">
            {tableOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
            )}
            <span>Top {topTen.length} Opportunities Ledger (with 30d ESI History)</span>
          </span>
          <span className="text-[11px] text-slate-500 font-mono">
            {tableOpen ? 'Hide ledger' : 'Show ledger'}
          </span>
        </button>

        {tableOpen && (
          <div className="overflow-x-auto border-t border-slate-800/70">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#0f141d] border-b border-slate-800 text-slate-400">
                  <th className="py-2 px-4 text-left font-medium">#</th>
                  <th className="py-2 px-3 text-left font-medium">Opportunity</th>
                  <th className="py-2 px-3 text-left font-medium">Engine</th>
                  <th className="py-2 px-3 text-right font-medium">Per-Unit Net</th>
                  <th className="py-2 px-3 text-right font-medium">Full-Batch Net</th>
                  <th className="py-2 px-3 text-right font-medium">ROI</th>
                  <th className="py-2 px-3 text-right font-medium">Volume</th>
                  <th className="py-2 px-4 text-right font-medium">30d History</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {topTen.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 px-4 font-mono tabular-nums text-cyan-400">
                      {String(row.rank).padStart(2, '0')}
                    </td>
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => onInspectCard(row.card)}
                        className="text-left text-slate-100 hover:text-cyan-300 font-medium transition-colors cursor-pointer"
                      >
                        {row.fullTitle}
                      </button>
                    </td>
                    <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                      {row.engineLabel}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                      {row.perUnitProfitIsk < 100
                        ? `${row.perUnitProfitIsk.toFixed(2)} ISK`
                        : formatIsk(row.perUnitProfitIsk)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-emerald-400 font-medium whitespace-nowrap">
                      +{formatIsk(row.batchProfitIsk)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      {formatPct(row.roiPct)}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                      {formatM3(row.totalVolumeM3)}
                    </td>
                    <td className="py-2 px-4 text-right whitespace-nowrap">
                      {row.primaryTypeId ? (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenHistory(
                              row.primaryTypeId!,
                              row.primaryItemName || row.fullTitle
                            )
                          }
                          title={`View 30-day ESI market history for ${row.primaryItemName || row.fullTitle}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#0e131b] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                        >
                          <LineChart className="w-3 h-3" aria-hidden="true" />
                          <span>30d History</span>
                        </button>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
