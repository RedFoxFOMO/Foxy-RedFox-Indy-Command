import { useMemo, useState } from 'react';
import { Layers, LineChart, Search, X } from 'lucide-react';
import { formatIsk } from '../engines/decisionEngines.ts';
import type {
  CatalogSku,
  MarketCategoryDef,
  MarketSnapshot,
} from '../types/eve.ts';

interface CategorySkuModalProps {
  category: MarketCategoryDef | null;
  skus: CatalogSku[];
  catalogSource: 'esi_live' | 'baseline_fallback';
  catalogBuiltAt: string | null;
  snapshot: MarketSnapshot;
  minDailyVolume: number;
  onOpenHistory: (typeId: number, name: string) => void;
  onClose: () => void;
}

const INITIAL_LIMIT = 250;

export function CategorySkuModal({
  category,
  skus,
  catalogSource,
  catalogBuiltAt,
  snapshot,
  minDailyVolume,
  onOpenHistory,
  onClose,
}: CategorySkuModalProps) {
  const [query, setQuery] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const enriched = useMemo(() => {
    return skus.map((sku) => {
      const q = snapshot.quotes[sku.typeId];
      const hasLive = Boolean(q && q.source === 'live' && (q.jita.sellMin > 0 || q.dodixie.sellMin > 0));
      const estVol =
        q?.estDailyJitaVol ??
        sku.estDailyJitaVol ??
        (q ? Math.round((q.jita.sellVolume + q.jita.buyVolume) * 0.15) : 0);
      return {
        sku,
        quote: q,
        hasLive,
        estVol,
        meetsVolume: estVol >= minDailyVolume,
      };
    });
  }, [skus, snapshot.quotes, minDailyVolume]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((row) => {
      if (liveOnly && !row.hasLive) return false;
      if (!q) return true;
      return (
        row.sku.name.toLowerCase().includes(q) ||
        String(row.sku.typeId).includes(q) ||
        String(row.sku.marketGroupId).includes(q)
      );
    });
  }, [enriched, liveOnly, query]);

  if (!category) return null;

  const visibleRows = showAll ? filtered : filtered.slice(0, INITIAL_LIMIT);
  const remaining = Math.max(0, filtered.length - visibleRows.length);
  const liveCount = enriched.filter((r) => r.hasLive).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${category.label} SKU Catalog`}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden flex flex-col max-h-[88vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-start justify-between gap-4 bg-[#131822]/70">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-slate-100">
                {category.label} — ESI Item Catalog
              </h2>
              <span className="font-mono tabular-nums text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-0.5">
                {skus.length.toLocaleString()} SKUs
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {category.group} · Root ESI Market Group #{category.marketGroupId} ·{' '}
              <span className="font-mono text-slate-300">
                {catalogSource === 'esi_live' ? 'Live ESI Market Groups' : 'Baseline Fallback'}
              </span>
              {catalogBuiltAt && (
                <span className="text-slate-500 font-mono">
                  {' '}
                  (cached {new Date(catalogBuiltAt).toLocaleDateString()})
                </span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close SKU catalog modal"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search & Filter Bar */}
        <div className="px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0b0e14]/60">
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowAll(false);
              }}
              placeholder="Filter by EVE item name or type_id..."
              className="w-full bg-[#131822] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded-md pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setShowAll(false);
                }}
                aria-label="Clear filter"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 text-xs">
            <span className="font-mono tabular-nums text-slate-400">
              Showing {filtered.length.toLocaleString()} of {skus.length.toLocaleString()}
              {liveCount > 0 ? ` · ${liveCount.toLocaleString()} live priced` : ''}
            </span>
            <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={liveOnly}
                onChange={(e) => {
                  setLiveOnly(e.target.checked);
                  setShowAll(false);
                }}
                className="accent-cyan-400 rounded cursor-pointer"
              />
              <span>Live Quotes Only</span>
            </label>
          </div>
        </div>

        {/* SKU Table */}
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No items in {category.label} match your current filter.
            </div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#131822] border-b border-slate-800 text-slate-400 sticky top-0 z-10">
                  <th className="py-2 px-4 text-left font-medium">EVE Item Name</th>
                  <th className="py-2 px-3 text-right font-medium">type_id</th>
                  <th className="py-2 px-3 text-right font-medium">Group ID</th>
                  <th className="py-2 px-3 text-right font-medium">Jita Sell</th>
                  <th className="py-2 px-3 text-right font-medium">Dodixie Sell</th>
                  <th className="py-2 px-3 text-right font-medium">Est. Daily Vol</th>
                  <th className="py-2 px-3 text-center font-medium w-12">30d</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {visibleRows.map(({ sku, quote, hasLive, estVol, meetsVolume }) => (
                  <tr
                    key={sku.typeId}
                    className="hover:bg-slate-800/35 transition-colors"
                  >
                    <td className="py-2 px-4 text-slate-100 font-medium">
                      {sku.name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-cyan-300">
                      {sku.typeId}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">
                      {sku.marketGroupId}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                      {hasLive && quote && quote.jita.sellMin > 0
                        ? formatIsk(quote.jita.sellMin, false)
                        : '—'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                      {hasLive && quote && quote.dodixie.sellMin > 0
                        ? formatIsk(quote.dodixie.sellMin, false)
                        : '—'}
                    </td>
                    <td
                      className={`py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap ${
                        estVol > 0
                          ? meetsVolume
                            ? 'text-emerald-400'
                            : 'text-slate-500'
                          : 'text-slate-600'
                      }`}
                      title={
                        estVol > 0 && !meetsVolume
                          ? `Below Min Daily Volume filter (${minDailyVolume}/day)`
                          : undefined
                      }
                    >
                      {estVol > 0 ? estVol.toLocaleString() : '—'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      <button
                        type="button"
                        onClick={() => onOpenHistory(sku.typeId, sku.name)}
                        title={`View 30-day ESI market history for ${sku.name}`}
                        className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
                      >
                        <LineChart className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Progressive Footer */}
        {remaining > 0 && (
          <div className="px-5 py-2.5 border-t border-slate-800 bg-[#131822]/70 flex items-center justify-between gap-3 text-xs">
            <span className="font-mono tabular-nums text-slate-400">
              Rendered {visibleRows.length.toLocaleString()} of {filtered.length.toLocaleString()} items.
            </span>
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="px-3 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 font-medium cursor-pointer"
            >
              Show All {filtered.length.toLocaleString()} Items
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
