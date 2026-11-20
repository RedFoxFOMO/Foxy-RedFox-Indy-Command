import { RefreshCw, Route } from 'lucide-react';
import type { EngineId } from '../types/eve.ts';

import { formatCooldownDuration } from '../utils/marketCatalogCache.ts';

export type WorkspaceView = 'overview' | 'corridor_trade' | EngineId;

interface TopBarProps {
  activeView: WorkspaceView;
  onSelectView: (view: WorkspaceView) => void;
  onSyncMarkets: () => void;
  isSyncing: boolean;
  marketCooldownRemainingSec: number;
  isRateLimitPaused: boolean;
  routePanelOpen: boolean;
  queuedRouteCount: number;
  onToggleRoutePanel: () => void;
}

const NAV_ITEMS: { id: WorkspaceView; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'indy_invention', label: 'Indy & T2' },
  { id: 'reprocessing', label: 'Reprocessing' },
  { id: 'corridor_trade', label: 'Jita–Dodixie' },
  { id: 'pi_factory', label: 'PI Factories' },
];

export function TopBar({
  activeView,
  onSelectView,
  onSyncMarkets,
  isSyncing,
  marketCooldownRemainingSec,
  isRateLimitPaused,
  routePanelOpen,
  queuedRouteCount,
  onToggleRoutePanel,
}: TopBarProps) {
  const syncDisabled = isSyncing || marketCooldownRemainingSec > 0 || isRateLimitPaused;

  return (
    <header className="h-14 px-6 bg-[#0d1118] border-b border-slate-800/90 flex items-center justify-between gap-6 shrink-0">
      {/* Zone 1: Single-line Brand Wordmark */}
      <button
        type="button"
        onClick={() => onSelectView('overview')}
        className="font-display text-base font-semibold tracking-tight text-slate-100 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
      >
        Foxy RedFox Indy Command
      </button>

      {/* Zone 2: Clean Single-Line Navigation Links */}
      <nav
        aria-label="Decision Engines"
        className="hidden lg:flex items-center gap-6 h-full"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectView(item.id)}
              className={`h-full inline-flex items-center text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:text-cyan-300 ${
                isActive
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-slate-100'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Zone 3: Route Optimizer Toggle + Sync Live Markets */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleRoutePanel}
          aria-pressed={routePanelOpen}
          className={`inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
            routePanelOpen
              ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/60'
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
              : 'Refresh live Jita & Dodixie market orders from EVE ESI'
          }
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md bg-cyan-500/15 text-cyan-200 border border-cyan-400/40 hover:bg-cyan-500/25 disabled:opacity-55 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
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
