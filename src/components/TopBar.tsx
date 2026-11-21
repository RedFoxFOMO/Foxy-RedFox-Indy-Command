import { useEffect, useState } from 'react';
import { Activity, Clock, KeyRound, RefreshCw, Route, ShieldCheck } from 'lucide-react';
import type { EngineId, MarketCacheTelemetry } from '../types/eve.ts';

import { formatCooldownDuration } from '../utils/marketCatalogCache.ts';

export type WorkspaceView = 'overview' | 'corridor_trade' | EngineId;

interface TopBarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  orderMonitorOpen: boolean;
  undercutCount: number;
  onOpenOrderMonitor: () => void;
  onSyncMarkets: () => void;
  isSyncing: boolean;
  marketCooldownRemainingSec: number;
  isRateLimitPaused: boolean;
  cacheTelemetry?: MarketCacheTelemetry | null;
  routePanelOpen: boolean;
  queuedRouteCount: number;
  onToggleRoutePanel: () => void;
  onOpenApiSetup: () => void;
  hasEveClientId: boolean;
}

const NAV_ITEMS: { id: WorkspaceView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'indy_invention', label: 'Indy & T2' },
  { id: 'reprocessing', label: 'Reprocessing' },
  { id: 'corridor_trade', label: '5-Hub Trade' },
  { id: 'pi_factory', label: 'PI Factories' },
];

export function TopBar({
  activeView,
  onSelectView,
  orderMonitorOpen,
  undercutCount,
  onOpenOrderMonitor,
  onSyncMarkets,
  isSyncing,
  marketCooldownRemainingSec,
  isRateLimitPaused,
  cacheTelemetry,
  routePanelOpen,
  queuedRouteCount,
  onToggleRoutePanel,
  onOpenApiSetup,
  hasEveClientId,
}: TopBarProps) {
  const syncDisabled = isSyncing || marketCooldownRemainingSec > 0 || isRateLimitPaused;
  const [cacheRemainSec, setCacheRemainSec] = useState<number>(0);

  useEffect(() => {
    const updateCountdown = () => {
      if (!cacheTelemetry?.expiresAtMs) {
        setCacheRemainSec(0);
        return;
      }
      const diff = Math.max(0, Math.ceil((cacheTelemetry.expiresAtMs - Date.now()) / 1000));
      setCacheRemainSec(diff);
    };
    updateCountdown();
    const id = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(id);
  }, [cacheTelemetry?.expiresAtMs]);

  const cacheTooltip = cacheTelemetry
    ? [
        `ESI 5-Min Cache Shield (${cacheTelemetry.mode === 'background_watchdog' ? 'Low-Token Watchdog' : 'Active Sync'})`,
        cacheRemainSec > 0
          ? `Cache fresh for ${formatCooldownDuration(cacheRemainSec)} (0 ESI tokens)`
          : 'Cache window ready for ETag (304) revalidation',
        cacheTelemetry.ratelimitRemaining !== null
          ? `X-Ratelimit-Remaining: ${cacheTelemetry.ratelimitRemaining}`
          : null,
        `304 Not Modified saves: ${cacheTelemetry.from304Count} · 0-token hits: ${cacheTelemetry.zeroTokenHits}`,
      ]
        .filter(Boolean)
        .join(' | ')
    : 'ESI 5-Minute Cache & ETag (304) Shield Active';

  return (
    <header className="h-14 px-5 bg-[#0d1118] border-b border-slate-800/90 flex items-center justify-between gap-3 shrink-0">
      {/* Zone 1: Single-line Brand Wordmark */}
      <button
        type="button"
        onClick={() => onSelectView('overview')}
        className="font-display text-base font-semibold tracking-tight text-slate-100 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
      >
        Foxy RedFox Indy Command
      </button>

      {/* Zone 2: Navigation Tabs with Raised Active Shadow & Accent Indicator */}
      <nav
        aria-label="Decision Engines"
        className="hidden lg:flex items-center gap-1.5 h-full py-2"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id && !orderMonitorOpen;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`relative h-full px-3 rounded-md inline-flex items-center text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                isActive
                  ? 'bg-[#162030] text-cyan-200 border border-cyan-400/50 shadow-[0_4px_14px_rgba(34,211,238,0.20),inset_0_1px_0_rgba(165,243,252,0.18)] -translate-y-[1px]'
                  : 'border border-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
              }`}
            >
              <span>{item.label}</span>
              {isActive && (
                <span
                  aria-hidden="true"
                  className="absolute left-2 right-2 -bottom-[1px] h-[2px] rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]"
                />
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onOpenOrderMonitor}
          aria-pressed={orderMonitorOpen}
          title="Open Order Monitor overlay for live undercut detection and 24h/7d realized profit"
          className={`relative h-full px-3 rounded-md inline-flex items-center gap-1.5 text-sm font-medium transition-all whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
            orderMonitorOpen
              ? 'bg-[#221b12] text-amber-200 border border-amber-400/55 shadow-[0_4px_14px_rgba(251,191,36,0.22),inset_0_1px_0_rgba(253,230,138,0.2)] -translate-y-[1px]'
              : 'border border-transparent text-slate-400 hover:text-slate-100 hover:bg-slate-800/40'
          }`}
        >
          <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Order Monitor</span>
          {undercutCount > 0 && (
            <span className="font-mono tabular-nums text-[10px] font-semibold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/45">
              {undercutCount}
            </span>
          )}
          {orderMonitorOpen && (
            <span
              aria-hidden="true"
              className="absolute left-2 right-2 -bottom-[1px] h-[2px] rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"
            />
          )}
        </button>
      </nav>

      {/* Zone 3: Live Market Cache Shield Badge + API Setup + Route Optimizer Toggle + Refresh */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Live Market Cache Refresh Countdown Badge */}
        <div
          title={cacheTooltip}
          className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-800 bg-[#101622] text-[11px] font-mono tabular-nums text-slate-300"
        >
          {cacheTelemetry?.mode === 'background_watchdog' ? (
            <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          ) : (
            <Clock className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          )}
          <span className="text-slate-400">Cache</span>
          <span className={cacheRemainSec > 0 ? 'text-emerald-300 font-semibold' : 'text-cyan-300'}>
            {cacheRemainSec > 0 ? formatCooldownDuration(cacheRemainSec) : 'Ready'}
          </span>
          {cacheTelemetry?.ratelimitRemaining !== null &&
            cacheTelemetry?.ratelimitRemaining !== undefined && (
              <span className="text-slate-500 border-l border-slate-700 pl-1.5">
                RL:{cacheTelemetry.ratelimitRemaining}
              </span>
            )}
        </div>

        <button
          type="button"
          onClick={onOpenOrderMonitor}
          aria-label="Open Order Monitor"
          className="lg:hidden inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium rounded-md border border-slate-700/90 bg-[#131822] text-slate-200 hover:border-amber-400/50 hover:text-amber-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Activity className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Orders</span>
          {undercutCount > 0 && (
            <span className="font-mono text-[10px] text-rose-300 font-semibold">
              ({undercutCount})
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={onOpenApiSetup}
          title={
            hasEveClientId
              ? 'Manage EVE Client ID, Callback URL, and optional BYOK AI keys'
              : 'Configure your EVE Client ID and optional BYOK AI keys (no terminal needed)'
          }
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
            hasEveClientId
              ? 'bg-[#131822] text-slate-300 border-slate-700/90 hover:border-cyan-400/50 hover:text-cyan-200'
              : 'bg-amber-500/10 text-amber-200 border-amber-500/40 hover:bg-amber-500/20'
          }`}
        >
          <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
          <span>API Setup</span>
        </button>

        <button
          type="button"
          onClick={onToggleRoutePanel}
          aria-pressed={routePanelOpen}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
            routePanelOpen
              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60 shadow-[0_2px_10px_rgba(34,211,238,0.18)]'
              : queuedRouteCount > 0
                ? 'bg-[#131822] text-cyan-300 border-cyan-500/40 hover:bg-cyan-500/10'
                : 'bg-[#131822] text-slate-300 border-slate-700/90 hover:border-slate-600 hover:text-slate-100'
          }`}
        >
          <Route className="w-3.5 h-3.5" aria-hidden="true" />
          <span>
            Fleet &amp; Route{queuedRouteCount > 0 ? ` (${queuedRouteCount})` : ''}
          </span>
        </button>

        <button
          type="button"
          onClick={onSyncMarkets}
          disabled={syncDisabled}
          title={
            marketCooldownRemainingSec > 0
              ? `CCP ESI caches market orders for 5 minutes (${formatCooldownDuration(marketCooldownRemainingSec)} remaining)`
              : 'Refresh live 5-Hub Empire market orders from EVE ESI'
          }
          className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium rounded-md bg-cyan-500/15 text-cyan-200 border border-cyan-400/40 hover:bg-cyan-500/25 disabled:opacity-55 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>
            {isSyncing
              ? 'Scanning ESI...'
              : isRateLimitPaused
                ? 'ESI Paused'
                : marketCooldownRemainingSec > 0
                  ? `Cooldown ${formatCooldownDuration(marketCooldownRemainingSec)}`
                  : 'Refresh Markets'}
          </span>
        </button>
      </div>
    </header>
  );
}

