import { useEffect, useState } from 'react';
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
import { AlertCircle, LineChart as LineChartIcon, RefreshCw, X } from 'lucide-react';
import { formatIsk, formatPct } from '../engines/decisionEngines.ts';
import type { MarketHistoryDay, MarketHistoryResponse } from '../types/eve.ts';

const REGION_JITA = 10000002; // The Forge
const REGION_DODIXIE = 10000032; // Sinq Laison

// Client-side in-memory cache keyed by `${regionId}:${typeId}`
const clientHistoryCache = new Map<string, MarketHistoryResponse>();

interface MarketHistoryModalProps {
  target: { typeId: number; name: string } | null;
  onClose: () => void;
}

function compactAxisNum(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(abs / 1_000).toFixed(0)}K`;
  return `${Math.round(abs)}`;
}

function shortDate(iso: string): string {
  // iso format YYYY-MM-DD -> MM-DD
  if (iso.length >= 10) return iso.slice(5, 10);
  return iso;
}

interface HistoryTooltipProps {
  active?: boolean;
  payload?: { payload?: MarketHistoryDay }[];
}

function HistoryTooltip({ active, payload }: HistoryTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const d = payload[0]?.payload;
  if (!d) return null;

  return (
    <div className="bg-[#0d1118] border border-slate-700/90 rounded-md px-3.5 py-2.5 text-xs shadow-xl">
      <div className="font-mono text-slate-200 font-semibold mb-1.5">
        {d.date}
      </div>
      <div className="space-y-1 border-t border-slate-800 pt-1.5 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-5">
          <span className="text-cyan-300">Average Price</span>
          <span className="text-slate-100 font-semibold">
            {d.average < 100
              ? `${d.average.toFixed(2)} ISK`
              : formatIsk(d.average, false)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-emerald-400">Daily High</span>
          <span className="text-slate-200">
            {d.highest < 100
              ? `${d.highest.toFixed(2)} ISK`
              : formatIsk(d.highest, false)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-amber-300">Daily Low</span>
          <span className="text-slate-200">
            {d.lowest < 100
              ? `${d.lowest.toFixed(2)} ISK`
              : formatIsk(d.lowest, false)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-5 pt-1 border-t border-slate-800/80">
          <span className="text-slate-400">Trade Volume</span>
          <span className="text-slate-100">
            {Math.round(d.volume).toLocaleString('en-US')} u
          </span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Orders Filled</span>
          <span className="text-slate-300">
            {Math.round(d.order_count).toLocaleString('en-US')}
          </span>
        </div>
      </div>
    </div>
  );
}

export function MarketHistoryModal({
  target,
  onClose,
}: MarketHistoryModalProps) {
  const [regionId, setRegionId] = useState<number>(REGION_JITA);
  const [data, setData] = useState<MarketHistoryResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [cacheHit, setCacheHit] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Close on Escape
  useEffect(() => {
    if (!target) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [target, onClose]);

  useEffect(() => {
    if (!target) return;
    const cacheKey = `${regionId}:${target.typeId}`;
    const cached = clientHistoryCache.get(cacheKey);
    if (cached && retryNonce === 0) {
      setData(cached);
      setErrorMsg(null);
      setIsLoading(false);
      setCacheHit(true);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setErrorMsg(null);
    setCacheHit(false);

    fetch(
      `/api/market/history?regionId=${regionId}&typeId=${encodeURIComponent(
        String(target.typeId)
      )}`
    )
      .then(async (res) => {
        const json = (await res.json()) as MarketHistoryResponse & {
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || `ESI history returned HTTP ${res.status}`);
        }
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        clientHistoryCache.set(cacheKey, json);
        setData(json);
        setRetryNonce(0);
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(
          err instanceof Error
            ? err.message
            : 'Unable to fetch 30-day ESI market history.'
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target, regionId, retryNonce]);

  if (!target) return null;

  const regionLabel =
    regionId === REGION_JITA
      ? 'Jita · The Forge (10000002)'
      : 'Dodixie · Sinq Laison (10000032)';

  const days = data?.days ?? [];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`30-Day Market History for ${target.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium">
              <LineChartIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>30-Day Regional ESI Market History</span>
              <span className="text-slate-600">·</span>
              <span className="font-mono text-slate-400">type_id {target.typeId}</span>
              {cacheHit && (
                <>
                  <span className="text-slate-600">·</span>
                  <span className="text-slate-500 font-mono">cached</span>
                </>
              )}
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-100 mt-0.5 truncate">
              {target.name}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close 30-day market history modal"
            className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Region Toggle Bar */}
        <div className="px-5 py-3 border-b border-slate-800/80 bg-[#131822]/70 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="inline-flex rounded-md border border-slate-800 bg-[#0b0e14] p-0.5">
            <button
              type="button"
              onClick={() => setRegionId(REGION_JITA)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                regionId === REGION_JITA
                  ? 'bg-cyan-500/20 text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Jita / The Forge (10000002)
            </button>
            <button
              type="button"
              onClick={() => setRegionId(REGION_DODIXIE)}
              className={`px-3 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap cursor-pointer ${
                regionId === REGION_DODIXIE
                  ? 'bg-amber-500/20 text-amber-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Dodixie / Sinq Laison (10000032)
            </button>
          </div>

          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-0.5 bg-cyan-400 inline-block" aria-hidden="true" />
              <span>Daily Avg Price (ISK)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-slate-600/90 inline-block" aria-hidden="true" />
              <span>Daily Volume</span>
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* 4-Column Summary KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-[#131822]">
            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">30d Avg Daily Volume</div>
              <div className="font-mono tabular-nums text-base font-semibold text-cyan-300 mt-0.5">
                {data && days.length > 0
                  ? `${Math.round(data.avgDailyVolume30d).toLocaleString('en-US')} u/d`
                  : '—'}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">30d Avg Price</div>
              <div className="font-mono tabular-nums text-base font-semibold text-slate-100 mt-0.5">
                {data && days.length > 0
                  ? data.avgPrice30d < 100
                    ? `${data.avgPrice30d.toFixed(2)} ISK`
                    : formatIsk(data.avgPrice30d)
                  : '—'}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">30d High / Low</div>
              <div className="font-mono tabular-nums text-xs font-medium text-slate-200 mt-1">
                {data && days.length > 0 ? (
                  <>
                    <span className="text-emerald-400">
                      {data.high30d < 100 ? data.high30d.toFixed(1) : formatIsk(data.high30d)}
                    </span>
                    <span className="text-slate-600"> / </span>
                    <span className="text-amber-300">
                      {data.low30d < 100 ? data.low30d.toFixed(1) : formatIsk(data.low30d)}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
            <div className="p-3.5">
              <div className="text-[11px] text-slate-400">30d Price Trend</div>
              <div
                className={`font-mono tabular-nums text-base font-semibold mt-0.5 ${
                  !data || days.length === 0
                    ? 'text-slate-500'
                    : data.trendPct >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                }`}
              >
                {data && days.length > 0 ? formatPct(data.trendPct) : '—'}
              </div>
            </div>
          </div>

          {/* Chart / Loading / Empty / Error */}
          {isLoading ? (
            <div className="h-[300px] border border-slate-800 rounded-lg bg-[#131822]/60 flex flex-col items-center justify-center gap-2 text-xs text-slate-400">
              <RefreshCw className="w-5 h-5 text-cyan-400 animate-spin" aria-hidden="true" />
              <span>Querying EVE ESI regional market history for {regionLabel}...</span>
            </div>
          ) : errorMsg ? (
            <div className="h-[260px] border border-rose-500/30 rounded-lg bg-rose-500/5 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <AlertCircle className="w-5 h-5 text-rose-400" aria-hidden="true" />
              <div className="text-xs text-rose-200 max-w-md">{errorMsg}</div>
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="px-3 py-1.5 text-xs font-medium rounded border border-slate-700 bg-[#131822] text-slate-200 hover:border-cyan-400/50 cursor-pointer"
              >
                Retry ESI Query
              </button>
            </div>
          ) : days.length === 0 ? (
            <div className="h-[260px] border border-slate-800 rounded-lg bg-[#131822]/60 flex flex-col items-center justify-center gap-2.5 p-6 text-center">
              <AlertCircle className="w-5 h-5 text-amber-400" aria-hidden="true" />
              <div className="text-sm font-medium text-slate-200">
                No Recent 30-Day Market History
              </div>
              <p className="text-xs text-slate-400 max-w-md">
                {data?.emptyReason ||
                  `EVE ESI returned no recorded daily trades for ${target.name} in ${regionLabel} over the last 30 days.`}
              </p>
              <button
                type="button"
                onClick={() =>
                  setRegionId((prev) =>
                    prev === REGION_JITA ? REGION_DODIXIE : REGION_JITA
                  )
                }
                className="mt-1 px-3 py-1.5 text-xs font-medium rounded border border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 cursor-pointer"
              >
                Check {regionId === REGION_JITA ? 'Dodixie / Sinq Laison' : 'Jita / The Forge'} Instead
              </button>
            </div>
          ) : (
            <div className="border border-slate-800 rounded-lg bg-[#131822] p-4">
              <div className="w-full h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={days}
                    margin={{ top: 8, right: 12, left: 6, bottom: 8 }}
                  >
                    <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={shortDate}
                      minTickGap={22}
                      stroke="#64748b"
                      tick={{
                        fill: '#94a3b8',
                        fontSize: 11,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="price"
                      domain={['auto', 'auto']}
                      tickFormatter={compactAxisNum}
                      stroke="#22d3ee"
                      tick={{
                        fill: '#67e8f9',
                        fontSize: 11,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={{ stroke: '#334155' }}
                    />
                    <YAxis
                      yAxisId="volume"
                      orientation="right"
                      tickFormatter={compactAxisNum}
                      stroke="#64748b"
                      tick={{
                        fill: '#94a3b8',
                        fontSize: 11,
                        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                      }}
                      axisLine={{ stroke: '#334155' }}
                      tickLine={{ stroke: '#334155' }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      content={<HistoryTooltip />}
                    />
                    <Bar
                      yAxisId="volume"
                      dataKey="volume"
                      name="Daily Trade Volume"
                      fill="#334155"
                      radius={[2, 2, 0, 0]}
                      maxBarSize={18}
                    />
                    <Line
                      yAxisId="price"
                      type="monotone"
                      dataKey="average"
                      name="Average Price (ISK)"
                      stroke="#22d3ee"
                      strokeWidth={2}
                      dot={{ r: 2.5, fill: '#22d3ee', strokeWidth: 0 }}
                      activeDot={{ r: 5, fill: '#67e8f9', stroke: '#0b0e14', strokeWidth: 1.5 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-800/70 flex items-center justify-between text-[11px] text-slate-500 font-mono">
                <span>Source: EVE Online Public ESI · {regionLabel}</span>
                <span>{days.length} trading days plotted</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
