import { useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Database,
  Filter,
  Info,
  PauseCircle,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react';
import {
  MARKET_CATEGORIES,
  SCOPE_PRESETS,
} from '../data/eveCatalog.ts';
import type {
  DynamicMarketCatalog,
  EsiRateLimitState,
  MarketCategoryDef,
  MarketCategoryGroup,
  MarketCategoryId,
  MarketScanProgress,
} from '../types/eve.ts';
import { formatCooldownDuration } from '../utils/marketCatalogCache.ts';

interface MarketScopeBarProps {
  checkedCategories: MarketCategoryId[];
  onToggleCategory: (id: MarketCategoryId) => void;
  onApplyPreset: (ids: MarketCategoryId[]) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  activeTrackedItemCount: number;
  catalog: DynamicMarketCatalog;
  isCatalogLoading: boolean;
  onInspectCategorySkus: (cat: MarketCategoryDef) => void;
  // Protected Refresh Controls & Cooldowns
  marketCooldownRemainingSec: number;
  catalogCooldownRemainingSec: number;
  scanProgress: MarketScanProgress;
  onRefreshMarketPrices: () => void;
  onCancelMarketScan: () => void;
  onRebuildCatalog: () => void;
  // ESI Rate-Limit Safety & Liquidity Filter
  esiRateLimit: EsiRateLimitState | null;
  rateLimitPauseRemainingSec: number;
  minDailyVolume: number;
  onChangeMinDailyVolume: (val: number) => void;
}

const GROUPS: MarketCategoryGroup[] = [
  'Charges & Fuel',
  'Rigs, Drones & Hulls',
  'Resources & PI',
];

export function MarketScopeBar({
  checkedCategories,
  onToggleCategory,
  onApplyPreset,
  isExpanded,
  onToggleExpand,
  activeTrackedItemCount,
  catalog,
  isCatalogLoading,
  onInspectCategorySkus,
  marketCooldownRemainingSec,
  catalogCooldownRemainingSec,
  scanProgress,
  onRefreshMarketPrices,
  onCancelMarketScan,
  onRebuildCatalog,
  esiRateLimit,
  rateLimitPauseRemainingSec,
  minDailyVolume,
  onChangeMinDailyVolume,
}: MarketScopeBarProps) {
  const [confirmRebuildOpen, setConfirmRebuildOpen] = useState(false);

  const checkedSet = new Set(checkedCategories);

  const isPresetActive = (presetIds: MarketCategoryId[]) => {
    if (presetIds.length !== checkedCategories.length) return false;
    return presetIds.every((id) => checkedSet.has(id));
  };

  const isRateLimitPaused = Boolean(
    esiRateLimit?.paused && rateLimitPauseRemainingSec > 0
  );
  const marketRefreshDisabled =
    scanProgress.active ||
    marketCooldownRemainingSec > 0 ||
    isRateLimitPaused ||
    checkedCategories.length === 0;
  const catalogRebuildDisabled =
    isCatalogLoading ||
    catalogCooldownRemainingSec > 0 ||
    isRateLimitPaused;

  const progressPct =
    scanProgress.totalItems > 0
      ? Math.min(100, Math.round((scanProgress.completedItems / scanProgress.totalItems) * 100))
      : 0;

  return (
    <section
      aria-label="Market Scope and Category Checkboxes"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Top Row: Expand Title + Protected ESI Refresh Controls */}
      <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={isExpanded}
          className="inline-flex items-center gap-2.5 text-left group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
        >
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          ) : (
            <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-400 shrink-0" aria-hidden="true" />
          )}
          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <span className="font-display text-sm font-semibold text-slate-100 whitespace-nowrap">
            Market Scope &amp; Category Checkboxes
          </span>
          <span className="text-xs text-slate-400 font-mono tabular-nums whitespace-nowrap">
            {checkedCategories.length}/{MARKET_CATEGORIES.length} categories ·{' '}
            <span className="text-cyan-300">
              {activeTrackedItemCount.toLocaleString()}
            </span>{' '}
            active SKUs
          </span>
          {isCatalogLoading && (
            <span className="text-[11px] font-mono text-amber-300 animate-pulse whitespace-nowrap">
              Loading ESI Groups...
            </span>
          )}
        </button>

        {/* Protected ESI Refresh Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {scanProgress.active ? (
            <button
              type="button"
              onClick={onCancelMarketScan}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-amber-400/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PauseCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                Stop Scan ({scanProgress.completedItems}/{scanProgress.totalItems})
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onRefreshMarketPrices}
              disabled={marketRefreshDisabled}
              title={
                marketCooldownRemainingSec > 0
                  ? `CCP ESI caches market orders for 5 minutes. Wait ${formatCooldownDuration(marketCooldownRemainingSec)} before re-scanning.`
                  : 'Re-scan live Jita (10000002) and Dodixie (10000032) ESI market orders in throttled 18-item batches'
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                marketRefreshDisabled
                  ? 'border-slate-700/80 bg-[#0e131b] text-slate-400 cursor-not-allowed'
                  : 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 cursor-pointer'
              }`}
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {marketCooldownRemainingSec > 0
                  ? `ESI Cache Cooldown: ${formatCooldownDuration(marketCooldownRemainingSec)}`
                  : 'Refresh Market Prices'}
              </span>
            </button>
          )}

          {/* Secondary / Subtle Rebuild Item Catalog Button with Confirmation Warning */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (catalogRebuildDisabled) return;
                setConfirmRebuildOpen((v) => !v);
              }}
              disabled={catalogRebuildDisabled}
              title="Only needed after EVE game patches—rebuilds hundreds of static definitions from EVE ESI Market Groups (1-hour cooldown)"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                catalogRebuildDisabled
                  ? 'border-slate-800 bg-[#0b0e14] text-slate-500 cursor-not-allowed'
                  : 'border-slate-700/90 bg-[#0e131b] text-slate-300 hover:border-amber-400/50 hover:text-amber-200 cursor-pointer'
              }`}
            >
              <Database
                className={`w-3.5 h-3.5 ${isCatalogLoading ? 'animate-spin text-amber-400' : 'text-slate-400'}`}
                aria-hidden="true"
              />
              <span>
                {isCatalogLoading
                  ? 'Rebuilding Catalog...'
                  : catalogCooldownRemainingSec > 0
                    ? `Catalog Cooldown: ${formatCooldownDuration(catalogCooldownRemainingSec)}`
                    : 'Rebuild Item Catalog'}
              </span>
            </button>

            {confirmRebuildOpen && !catalogRebuildDisabled && (
              <div className="absolute right-0 mt-1.5 w-72 z-30 bg-[#0d1118] border border-amber-500/45 rounded-lg p-3 shadow-2xl space-y-2.5 text-xs">
                <div className="flex items-start gap-2 text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="leading-snug">
                    <div className="font-semibold">Rebuild ESI Market Group Tree?</div>
                    <p className="text-[11px] text-slate-300 mt-1">
                      Only needed after EVE game patches—rebuilds hundreds of static definitions and triggers a 1-hour cooldown.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirmRebuildOpen(false)}
                    className="px-2.5 py-1 rounded border border-slate-700 text-slate-300 hover:text-slate-100 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmRebuildOpen(false);
                      onRebuildCatalog();
                    }}
                    className="px-2.5 py-1 rounded border border-amber-400/60 bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 font-medium cursor-pointer"
                  >
                    Rebuild Now
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Compact ESI Fair-Use Safety Notice + Live Rate-Limit Telemetry */}
      <div className="px-4 py-1.5 border-t border-slate-800/70 bg-[#0e131b]/75 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
          <span>
            <strong className="text-slate-300 font-medium">ESI Fair-Use Protection:</strong>{' '}
            Market orders cache on CCP servers for 5 minutes. Cooldowns prevent triggering ESI 420/429 rate-limit blocks.
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums text-[10px] text-slate-400 shrink-0">
          <span>
            Catalog:{' '}
            <span className={catalog.source === 'esi_live' ? 'text-emerald-400' : 'text-amber-300'}>
              {catalog.totalSkus.toLocaleString()} SKUs ({catalog.source === 'esi_live' ? 'ESI 7d cache' : 'Baseline'})
            </span>
          </span>
          {esiRateLimit && esiRateLimit.errorLimitRemain !== null && (
            <span
              className={
                esiRateLimit.errorLimitRemain < 20
                  ? 'text-rose-400 font-semibold'
                  : esiRateLimit.errorLimitRemain < 50
                    ? 'text-amber-300'
                    : 'text-emerald-400'
              }
            >
              ESI Err-Remain: {esiRateLimit.errorLimitRemain}
            </span>
          )}
          {esiRateLimit && esiRateLimit.ratelimitRemaining !== null && (
            <span
              className={
                esiRateLimit.ratelimitRemaining < 20
                  ? 'text-rose-400 font-semibold'
                  : 'text-cyan-300'
              }
            >
              Token-Remain: {esiRateLimit.ratelimitRemaining}
            </span>
          )}
        </div>
      </div>

      {/* ESI Rate-Limit Auto-Pause Warning Banner */}
      {isRateLimitPaused && (
        <div
          role="alert"
          className="px-4 py-2.5 border-t border-rose-500/40 bg-rose-500/12 text-xs text-rose-200 flex flex-wrap items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" aria-hidden="true" />
            <span>
              <strong>ESI Scan Paused (Rate-Limit Guard):</strong>{' '}
              {esiRateLimit?.pauseReason || 'ESI error or rate-limit budget dropped below 20.'}
            </span>
          </div>
          <span className="font-mono tabular-nums font-semibold text-amber-300 whitespace-nowrap">
            Retry-After / Reset: {formatCooldownDuration(rateLimitPauseRemainingSec)}
          </span>
        </div>
      )}

      {/* Live Throttled Batch Scan Progress Bar */}
      {scanProgress.active && (
        <div className="px-4 py-2 border-t border-cyan-500/25 bg-cyan-500/8 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
            <span className="text-cyan-200 flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" aria-hidden="true" />
              <span>
                Scanning Live Jita (10000002) &amp; Dodixie (10000032) ESI Orders — Batch{' '}
                {scanProgress.completedBatches}/{scanProgress.totalBatches}
              </span>
            </span>
            <span className="text-slate-300">
              {scanProgress.completedItems.toLocaleString()}/{scanProgress.totalItems.toLocaleString()} SKUs ({progressPct}%) ·{' '}
              <span className="text-emerald-400">{scanProgress.liveFound.toLocaleString()} live</span>
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-cyan-400 transition-all duration-200"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Presets + Min Daily Volume Liquidity Filter Row */}
      <div className="px-4 py-2.5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0f141d]/50">
        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onApplyPreset(SCOPE_PRESETS.all)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isPresetActive(SCOPE_PRESETS.all)
                ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                : 'bg-[#0e131b] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
            }`}
          >
            Select All Tracked
          </button>
          <button
            type="button"
            onClick={() => onApplyPreset(SCOPE_PRESETS.blockade_runner)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isPresetActive(SCOPE_PRESETS.blockade_runner)
                ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                : 'bg-[#0e131b] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
            }`}
          >
            Blockade Runner / High-Value
          </button>
          <button
            type="button"
            onClick={() => onApplyPreset(SCOPE_PRESETS.refine_indy)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              isPresetActive(SCOPE_PRESETS.refine_indy)
                ? 'bg-amber-500/15 border-amber-400/50 text-amber-200'
                : 'bg-[#0e131b] border-slate-800 text-slate-300 hover:border-slate-700 hover:text-slate-100'
            }`}
          >
            Refine &amp; Indy Inputs
          </button>
          <button
            type="button"
            onClick={() => onApplyPreset(SCOPE_PRESETS.clear)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              checkedCategories.length === 0
                ? 'bg-rose-500/15 border-rose-400/40 text-rose-200'
                : 'bg-[#0e131b] border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            Clear
          </button>
        </div>

        {/* Min Daily Volume Liquidity Filter */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label
            htmlFor="min-daily-volume-input"
            className="inline-flex items-center gap-1.5 text-slate-300 font-medium whitespace-nowrap"
            title="Hide low-liquidity items trading fewer than this many units per day from manifests and hub comparison tables"
          >
            <Filter className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
            <span>Min Daily Volume:</span>
          </label>
          <input
            id="min-daily-volume-input"
            type="number"
            min={0}
            step={10}
            value={minDailyVolume}
            onChange={(e) =>
              onChangeMinDailyVolume(Math.max(0, Math.floor(Number(e.target.value) || 0)))
            }
            className="w-20 bg-[#0b0e14] border border-slate-700 focus:border-cyan-400/70 focus:outline-none rounded px-2 py-1 text-xs font-mono tabular-nums text-slate-100 text-right"
          />
          <span className="text-[11px] text-slate-500 font-mono">u/day</span>
          <div className="hidden sm:inline-flex items-center gap-1">
            {[0, 20, 100, 500].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => onChangeMinDailyVolume(preset)}
                className={`px-1.5 py-0.5 text-[10px] font-mono rounded border cursor-pointer ${
                  minDailyVolume === preset
                    ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-800 bg-[#0b0e14] text-slate-400 hover:text-slate-200'
                }`}
              >
                {preset === 0 ? 'All' : `${preset}+`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Collapsible 3-Column Checkbox Matrix with Clickable Live SKU Counters */}
      {isExpanded && (
        <div className="border-t border-slate-800/80 grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800/80">
          {GROUPS.map((group) => {
            const cats = MARKET_CATEGORIES.filter((c) => c.group === group);
            const activeInGroup = cats.filter((c) => checkedSet.has(c.id)).length;
            return (
              <div key={group} className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold text-slate-300 tracking-wide">
                    {group}
                  </h3>
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {activeInGroup}/{cats.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {cats.map((cat) => {
                    const isChecked = checkedSet.has(cat.id);
                    const skuCount = catalog.categories[cat.id]?.length ?? 0;
                    return (
                      <div
                        key={cat.id}
                        className="flex items-center justify-between gap-2 py-1 px-1.5 -mx-1.5 rounded hover:bg-slate-800/40 transition-colors"
                      >
                        <label className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => onToggleCategory(cat.id)}
                            className="w-4 h-4 rounded border-slate-700 bg-[#0b0e14] text-cyan-400 accent-cyan-400 focus:ring-cyan-400 focus:ring-offset-0 cursor-pointer shrink-0"
                          />
                          <span
                            className={`text-xs truncate ${
                              isChecked ? 'text-slate-100 font-medium' : 'text-slate-400'
                            }`}
                          >
                            {cat.label}
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => onInspectCategorySkus(cat)}
                          title={`Click to inspect all ${skuCount.toLocaleString()} ESI SKUs & type_ids in ${cat.label}`}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] font-mono tabular-nums text-slate-400 hover:text-cyan-300 hover:bg-cyan-500/10 border border-transparent hover:border-cyan-500/30 transition-colors shrink-0 cursor-pointer"
                        >
                          <span>{skuCount.toLocaleString()} SKUs</span>
                          <Info className="w-3 h-3 opacity-60" aria-hidden="true" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
