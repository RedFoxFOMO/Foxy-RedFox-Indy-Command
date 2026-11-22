import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Loader2,
  Settings,
  Sparkles,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
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
import { EVE_ANCHORS } from '../data/eveCatalog.ts';
import { formatIsk } from '../engines/decisionEngines.ts';
import { analyzePriceProjection } from '../utils/eveMarketMath.ts';
import type {
  AiCommentarySettings,
  MarketHistoryDay,
  MarketHistoryResponse,
} from '../types/eve.ts';

interface PriceProjectionModalProps {
  target: {
    typeId: number;
    itemName: string;
    regionId?: number;
    regionName?: string;
    currentPrice?: number;
  } | null;
  aiSettings: AiCommentarySettings;
  onOpenSettings: () => void;
  onClose: () => void;
}

export const PriceProjectionModal: React.FC<PriceProjectionModalProps> = ({
  target,
  aiSettings,
  onOpenSettings,
  onClose,
}) => {
  const [regionId, setRegionId] = useState<number>(
    target?.regionId ?? EVE_ANCHORS.THE_FORGE_REGION_ID
  );
  const [days, setDays] = useState<MarketHistoryDay[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentary, setCommentary] = useState<string | null>(null);
  const [commentaryProvider, setCommentaryProvider] = useState<string | null>(null);
  const [commentaryLoading, setCommentaryLoading] = useState(false);
  const [commentaryError, setCommentaryError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setRegionId(target.regionId ?? EVE_ANCHORS.THE_FORGE_REGION_ID);
    setCommentary(null);
    setCommentaryError(null);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/market/history?typeId=${target.typeId}&regionId=${regionId}`
        );
        if (res.ok) {
          const json = (await res.json()) as MarketHistoryResponse;
          if (!cancelled) setDays(Array.isArray(json.days) ? json.days : []);
          return;
        }
        throw new Error('Backend history unavailable');
      } catch {
        try {
          const esiRes = await fetch(
            `https://esi.evetech.net/markets/${regionId}/history/?datasource=tranquility&type_id=${target.typeId}`,
            { headers: { Accept: 'application/json', 'X-Compatibility-Date': '2026-08-18' } }
          );
          if (!esiRes.ok) throw new Error(`ESI HTTP ${esiRes.status}`);
          const raw = (await esiRes.json()) as MarketHistoryDay[];
          const last30 = (Array.isArray(raw) ? raw : [])
            .sort((a, b) => a.date.localeCompare(b.date))
            .slice(-30);
          if (!cancelled) setDays(last30);
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : 'Unable to load ESI daily market history.');
            setDays([]);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target, regionId]);

  const regionName =
    regionId === EVE_ANCHORS.SINQ_LAISON_REGION_ID
      ? 'Sinq Laison (Dodixie)'
      : regionId === EVE_ANCHORS.DOMAIN_REGION_ID
        ? 'Domain (Amarr)'
        : regionId === EVE_ANCHORS.HEIMATAR_REGION_ID
          ? 'Heimatar (Rens)'
          : regionId === EVE_ANCHORS.METROPOLIS_REGION_ID
            ? 'Metropolis (Hek)'
            : 'The Forge (Jita)';

  const analysis = useMemo(() => {
    if (!target) return null;
    return analyzePriceProjection({
      typeId: target.typeId,
      itemName: target.itemName,
      regionId,
      regionName,
      days,
    });
  }, [target, regionId, regionName, days]);

  const chartData = useMemo(() => {
    return days.map((d, idx) => {
      const slice7 = days.slice(Math.max(0, idx - 6), idx + 1);
      const ma7 =
        slice7.reduce((s, r) => s + Number(r.average || 0), 0) / Math.max(1, slice7.length);
      return {
        date: d.date.slice(5),
        average: Number(d.average || 0),
        highest: Number(d.highest || 0),
        lowest: Number(d.lowest || 0),
        ma7: Number(ma7.toFixed(2)),
        volume: Number(d.volume || 0),
      };
    });
  }, [days]);

  const hasUserByokKey =
    aiSettings.enabled &&
    ((aiSettings.provider === 'gemini' && aiSettings.geminiKey.trim().length > 8) ||
      (aiSettings.provider === 'openai' && aiSettings.openaiKey.trim().length > 8));

  const handleGenerateByokCommentary = async () => {
    if (!analysis || !hasUserByokKey) return;
    setCommentaryLoading(true);
    setCommentaryError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (aiSettings.provider === 'gemini') {
        headers['X-Gemini-Api-Key'] = aiSettings.geminiKey.trim();
      } else {
        headers['X-OpenAI-Api-Key'] = aiSettings.openaiKey.trim();
      }

      const res = await fetch('/api/market/projection-commentary', {
        method: 'POST',
        headers,
        body: JSON.stringify({ analysis }),
      });
      const json = (await res.json()) as {
        commentary?: string;
        provider?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(json.error || `HTTP ${res.status}`);
      }
      setCommentary(json.commentary || 'No commentary returned.');
      setCommentaryProvider(json.provider || aiSettings.provider);
    } catch (err) {
      setCommentaryError(
        err instanceof Error ? err.message : 'Unable to generate BYOK commentary.'
      );
    } finally {
      setCommentaryLoading(false);
    }
  };

  if (!target || !analysis) return null;

  const signalStyle =
    analysis.signal === 'bullish'
      ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
      : analysis.signal === 'bearish'
        ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
        : analysis.signal === 'caution_thin'
          ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
          : 'bg-slate-800 border-slate-700 text-slate-300';

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-xl border border-slate-700 bg-[#0c111b] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <BarChart3 className="w-4 h-4 text-cyan-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100 truncate">
                Price Projection &amp; Quantitative Trend — {target.itemName}
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                Type #{target.typeId} · Client-side ESI History Quantitative Analyzer (0 API Keys Required)
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={regionId}
              onChange={(e) => setRegionId(Number(e.target.value))}
              className="bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
            >
              <option value={EVE_ANCHORS.THE_FORGE_REGION_ID}>The Forge (Jita)</option>
              <option value={EVE_ANCHORS.DOMAIN_REGION_ID}>Domain (Amarr)</option>
              <option value={EVE_ANCHORS.SINQ_LAISON_REGION_ID}>Sinq Laison (Dodixie)</option>
              <option value={EVE_ANCHORS.HEIMATAR_REGION_ID}>Heimatar (Rens)</option>
              <option value={EVE_ANCHORS.METROPOLIS_REGION_ID}>Metropolis (Hek)</option>
            </select>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loading ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-slate-400">
              <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
              Loading 30-day EVE ESI market history for {regionName}…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          ) : (
            <>
              {/* Quantitative KPI Grid */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 text-xs">
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-[10px] uppercase text-slate-400">Current vs 24h Avg</div>
                  <div className="font-mono font-bold text-sm text-slate-100 mt-0.5">
                    {formatIsk(analysis.currentAvgPrice, false)}
                  </div>
                  <div
                    className={`text-[11px] font-mono font-semibold flex items-center gap-1 mt-0.5 ${
                      analysis.change24hPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {analysis.change24hPct >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {analysis.change24hPct >= 0 ? '+' : ''}
                    {analysis.change24hPct.toFixed(2)}% vs yesterday
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-[10px] uppercase text-slate-400">7d / 30d Moving Avg</div>
                  <div className="font-mono font-bold text-sm text-cyan-300 mt-0.5">
                    {formatIsk(analysis.ma7d, false)}
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    30d: {formatIsk(analysis.ma30d, false)} ({analysis.momentum7dPct >= 0 ? '+' : ''}
                    {analysis.momentum7dPct.toFixed(1)}%)
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-[10px] uppercase text-slate-400">Volume Spike &amp; Volatility</div>
                  <div className="font-mono font-bold text-sm text-amber-300 mt-0.5">
                    {analysis.volumeSpikeRatio.toFixed(2)}× 7d/30d
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                    30d Vola: {analysis.volatilityPct.toFixed(1)}% · Risk:{' '}
                    <span
                      className={
                        analysis.manipulationRisk === 'high'
                          ? 'text-rose-400 font-semibold'
                          : analysis.manipulationRisk === 'moderate'
                            ? 'text-amber-300 font-semibold'
                            : 'text-emerald-400'
                      }
                    >
                      {analysis.manipulationRisk.toUpperCase()}
                    </span>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
                  <div className="text-[10px] uppercase text-slate-400">7-Day Statistical Band</div>
                  <div className="font-mono font-bold text-xs text-slate-100 mt-1">
                    {formatIsk(analysis.projected7dLow, false)} – {formatIsk(analysis.projected7dHigh, false)}
                  </div>
                  <div className="mt-1">
                    <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] font-bold uppercase ${signalStyle}`}>
                      {analysis.signal.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>

              {/* Recharts 30-Day Price & Volume Chart */}
              {chartData.length > 0 ? (
                <div className="rounded-lg border border-slate-800 bg-[#080c13] p-3">
                  <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-2 flex items-center justify-between">
                    <span>30-Day ESI Daily Average, 7d Moving Average &amp; Volume ({regionName})</span>
                    <span className="font-mono text-slate-500">{chartData.length} sessions</span>
                  </div>
                  <div className="h-56 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={chartData} margin={{ top: 6, right: 8, left: 4, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                        <YAxis
                          yAxisId="price"
                          tick={{ fill: '#94a3b8', fontSize: 10 }}
                          tickFormatter={(v) => formatIsk(Number(v), true).replace(' ISK', '')}
                          width={58}
                        />
                        <YAxis
                          yAxisId="vol"
                          orientation="right"
                          tick={{ fill: '#64748b', fontSize: 10 }}
                          width={46}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0f172a',
                            borderColor: '#334155',
                            fontSize: '11px',
                            borderRadius: '8px',
                          }}
                          formatter={(value: unknown, name: unknown) => {
                            const key = String(name ?? '');
                            return [
                              key === 'volume'
                                ? `${Number(value).toLocaleString('en-US')} u`
                                : formatIsk(Number(value), false),
                              key === 'average'
                                ? 'Daily Avg'
                                : key === 'ma7'
                                  ? '7d MA'
                                  : 'Volume',
                            ];
                          }}
                        />
                        <Bar yAxisId="vol" dataKey="volume" fill="#1e3a5f" opacity={0.55} />
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="average"
                          stroke="#38bdf8"
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          yAxisId="price"
                          type="monotone"
                          dataKey="ma7"
                          stroke="#f59e0b"
                          strokeWidth={1.75}
                          strokeDasharray="4 3"
                          dot={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4 text-xs text-slate-400 text-center">
                  No 30-day trade history recorded on ESI for this item in {regionName}.
                </div>
              )}

              {/* Quantitative Findings & Manipulation Checks */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                  Quantitative Trend Summary (Local Engine)
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{analysis.signalSummary}</p>
                {analysis.manipulationNotes.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {analysis.manipulationNotes.map((flag: string, idx: number) => (
                      <div
                        key={idx}
                        className="flex items-start gap-1.5 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/25 rounded px-2 py-1"
                      >
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{flag}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional BYOK Enhanced AI Commentary Section */}
              <div className="rounded-lg border border-indigo-500/30 bg-indigo-950/15 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-200">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    Optional Enhanced AI Commentary (Bring Your Own API Key)
                  </div>
                  {hasUserByokKey ? (
                    <button
                      type="button"
                      disabled={commentaryLoading}
                      onClick={handleGenerateByokCommentary}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-indigo-500/25 border border-indigo-400/50 text-indigo-100 hover:bg-indigo-500/35 disabled:opacity-50 cursor-pointer"
                    >
                      {commentaryLoading ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Analyzing via {aiSettings.provider.toUpperCase()}…
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Generate Commentary ({aiSettings.provider.toUpperCase()})
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onClose();
                        onOpenSettings();
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-slate-800 border border-slate-700 text-slate-300 hover:text-indigo-200 hover:border-indigo-500/40 cursor-pointer"
                    >
                      <Settings className="w-3 h-3" />
                      Enable BYOK in Settings
                    </button>
                  )}
                </div>

                {!hasUserByokKey && (
                  <p className="text-[11px] text-slate-400">
                    The quantitative trend analyzer above runs 100% locally with zero API keys. To add optional natural-language commentary using your own Gemini or OpenAI key (stored strictly in your browser&apos;s localStorage, never stored on the server), enable it in Settings.
                  </p>
                )}

                {commentaryError && (
                  <div className="text-xs text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded px-2.5 py-1.5">
                    {commentaryError}
                  </div>
                )}

                {commentary && (
                  <div className="rounded border border-indigo-500/25 bg-[#090d16] p-2.5 text-xs text-slate-200 whitespace-pre-line leading-relaxed">
                    <div className="text-[10px] font-mono uppercase text-indigo-400 mb-1">
                      Personal BYOK Commentary ({commentaryProvider?.toUpperCase()})
                    </div>
                    {commentary}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
