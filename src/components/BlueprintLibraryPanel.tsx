import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  LineChart,
  RefreshCw,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import { formatIsk, formatPct } from '../engines/decisionEngines.ts';
import type { ActionCardData, BlueprintEntry, BlueprintSyncMeta } from '../types/eve.ts';

type BlueprintFilterMode = 'all' | 'bpo' | 'bpc' | 'profitable';

interface BlueprintLibraryPanelProps {
  blueprints: BlueprintEntry[];
  syncMeta?: BlueprintSyncMeta;
  pilotMode: 'simulation' | 'eve_sso';
  indyCards: ActionCardData[];
  includeCorpBlueprints: boolean;
  isScanning: boolean;
  scanError: string | null;
  onToggleCorpBlueprints: (next: boolean) => void;
  onRescanBlueprints: () => void;
  onOpenHistory?: (typeId: number, name: string) => void;
  compact?: boolean;
}

function normalizeBlueprintKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+(blueprint|reaction formula|formula)$/i, '')
    .trim();
}

const INITIAL_RENDER_LIMIT = 400;

export function BlueprintLibraryPanel({
  blueprints,
  syncMeta,
  pilotMode,
  indyCards,
  includeCorpBlueprints,
  isScanning,
  scanError,
  onToggleCorpBlueprints,
  onRescanBlueprints,
  onOpenHistory,
  compact = false,
}: BlueprintLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<BlueprintFilterMode>('all');
  const [showAllRows, setShowAllRows] = useState(false);

  // Index live Indy & T2 Action Cards by productTypeId and normalized product name
  const profitabilityIndex = useMemo(() => {
    const byTypeId = new Map<number, ActionCardData>();
    const byName = new Map<string, ActionCardData>();

    for (const card of indyCards) {
      if (card.primaryTypeId) {
        const existing = byTypeId.get(card.primaryTypeId);
        if (!existing || card.netProfitIsk > existing.netProfitIsk) {
          byTypeId.set(card.primaryTypeId, card);
        }
      }
      if (card.primaryItemName) {
        const key = normalizeBlueprintKey(card.primaryItemName);
        const existing = byName.get(key);
        if (!existing || card.netProfitIsk > existing.netProfitIsk) {
          byName.set(key, card);
        }
      }
    }
    return { byTypeId, byName };
  }, [indyCards]);

  // Enrich every single blueprint without ever dropping unmapped/unknown items
  const enrichedBlueprints = useMemo(() => {
    return blueprints.map((bp) => {
      // Canonical ESI semantics: runs === -1 for BPO, runs > 0 for BPC
      const isBpo = bp.runs === -1 ? true : bp.runs > 0 ? false : bp.isBpo;
      const displayName = bp.blueprintName || bp.productName || `Blueprint Type #${bp.typeId}`;
      const productKey = normalizeBlueprintKey(bp.productName || displayName);

      const matchedCard =
        (bp.productTypeId ? profitabilityIndex.byTypeId.get(bp.productTypeId) : undefined) ??
        profitabilityIndex.byName.get(productKey);

      const isProfitable = Boolean(matchedCard && matchedCard.netProfitIsk > 0);
      const historyTypeId = bp.productTypeId ?? matchedCard?.primaryTypeId;
      const historyName = matchedCard?.primaryItemName ?? bp.productName;

      return {
        bp,
        isBpo,
        displayName,
        matchedCard,
        isProfitable,
        historyTypeId,
        historyName,
      };
    });
  }, [blueprints, profitabilityIndex]);

  const counts = useMemo(() => {
    let bpoCount = 0;
    let bpcCount = 0;
    let corpCount = 0;
    let profitableCount = 0;

    for (const row of enrichedBlueprints) {
      if (row.isBpo) bpoCount += 1;
      else bpcCount += 1;
      if (row.bp.source === 'corporation') corpCount += 1;
      if (row.isProfitable) profitableCount += 1;
    }

    return {
      total: enrichedBlueprints.length,
      bpoCount,
      bpcCount,
      corpCount,
      profitableCount,
    };
  }, [enrichedBlueprints]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return enrichedBlueprints.filter((row) => {
      if (filterMode === 'bpo' && !row.isBpo) return false;
      if (filterMode === 'bpc' && row.isBpo) return false;
      if (filterMode === 'profitable' && !row.isProfitable) return false;

      if (!q) return true;

      return (
        row.displayName.toLowerCase().includes(q) ||
        row.bp.productName.toLowerCase().includes(q) ||
        row.bp.locationName.toLowerCase().includes(q) ||
        String(row.bp.typeId).includes(q) ||
        (row.bp.source === 'corporation' && 'corp corporation'.includes(q)) ||
        `me${row.bp.me}`.includes(q) ||
        `me ${row.bp.me}`.includes(q)
      );
    });
  }, [enrichedBlueprints, filterMode, searchQuery]);

  const visibleRows = showAllRows
    ? filteredRows
    : filteredRows.slice(0, INITIAL_RENDER_LIMIT);
  const hiddenRowCount = Math.max(0, filteredRows.length - visibleRows.length);

  const pagesSummary = useMemo(() => {
    if (!syncMeta) return null;
    const totalPages = (syncMeta.pagesScanned || 0) + (syncMeta.corpPagesScanned || 0);
    if (totalPages <= 0) return null;
    return `${totalPages} ESI ${totalPages === 1 ? 'page' : 'pages'} scanned`;
  }, [syncMeta]);

  return (
    <div className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden">
      {/* Header & Count Bar */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0e131b]/70">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ScrollText className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
            <h3 className="font-display text-sm font-semibold text-slate-100">
              Tracked Blueprint Library
            </h3>
            <span className="font-mono tabular-nums text-xs text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 rounded px-2 py-0.5">
              Showing {filteredRows.length.toLocaleString()} of {counts.total.toLocaleString()} Total Blueprints
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] font-mono tabular-nums text-slate-400">
            <span>{counts.bpoCount.toLocaleString()} BPOs</span>
            <span aria-hidden="true">·</span>
            <span>{counts.bpcCount.toLocaleString()} BPCs</span>
            <span aria-hidden="true">·</span>
            <span className="text-emerald-400">
              {counts.profitableCount.toLocaleString()} Profitable in Scope
            </span>
            {counts.corpCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-amber-300">
                  {counts.corpCount.toLocaleString()} Corp Hangar
                </span>
              </>
            )}
            {pagesSummary && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-300">{pagesSummary}</span>
              </>
            )}
            {pilotMode === 'simulation' && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-slate-500">Simulation Baseline</span>
              </>
            )}
          </div>
        </div>

        {/* Corp Hangar Toggle & Full X-Pages Rescan Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <label
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs transition-colors select-none ${
              includeCorpBlueprints
                ? 'border-amber-400/50 bg-amber-500/10 text-amber-200'
                : 'border-slate-700/90 bg-[#0e131b] text-slate-300 hover:border-slate-600'
            } ${pilotMode !== 'eve_sso' ? 'opacity-70 cursor-pointer' : 'cursor-pointer'}`}
            title={
              pilotMode === 'eve_sso'
                ? 'Include Corporation Hangar blueprints via esi-corporations.read_blueprints.v1 (requires Director / Factory Manager role)'
                : 'Connect EVE SSO to fetch Corporation Hangar blueprints'
            }
          >
            <input
              type="checkbox"
              checked={includeCorpBlueprints}
              onChange={(e) => onToggleCorpBlueprints(e.target.checked)}
              disabled={isScanning}
              className="accent-amber-400 rounded cursor-pointer"
            />
            <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
            <span className="whitespace-nowrap">Include Corp Hangars</span>
          </label>

          <button
            type="button"
            onClick={onRescanBlueprints}
            disabled={isScanning || pilotMode !== 'eve_sso'}
            title={
              pilotMode === 'eve_sso'
                ? 'Fetch all pages (1..X-Pages) of character blueprints from EVE ESI and resolve all names'
                : 'Connect EVE SSO first to scan live ESI blueprints'
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-45 disabled:cursor-not-allowed text-xs font-medium transition-colors whitespace-nowrap cursor-pointer"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isScanning ? 'Scanning X-Pages...' : 'Rescan All (X-Pages)'}</span>
          </button>
        </div>
      </div>

      {/* Inline Warnings / Corp Status */}
      {(scanError ||
        (includeCorpBlueprints && pilotMode !== 'eve_sso') ||
        (syncMeta?.corpStatus === 'no_access' && syncMeta.corpMessage) ||
        (syncMeta?.corpStatus === 'error' && syncMeta.corpMessage)) && (
        <div className="px-4 py-2 border-b border-slate-800/80 bg-amber-500/10 text-amber-200 text-[11px] flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span>
            {scanError
              ? scanError
              : includeCorpBlueprints && pilotMode !== 'eve_sso'
                ? 'Corp hangar blueprints require an active EVE SSO connection with the esi-corporations.read_blueprints.v1 scope.'
                : syncMeta?.corpMessage}
          </span>
        </div>
      )}

      {/* Search Bar & Filter Toggle Row */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2.5 bg-[#0e131b]/40">
        <div className="relative flex-1 min-w-[220px]">
          <Search
            className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setShowAllRows(false);
            }}
            placeholder="Search by blueprint name, product, station/container, ME, or Type ID..."
            className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded-md pl-8 pr-8 py-1.5 text-xs text-slate-100 placeholder:text-slate-500"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setShowAllRows(false);
              }}
              aria-label="Clear blueprint search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Blueprint filters"
        >
          {(
            [
              { id: 'all', label: 'All Blueprints', count: counts.total },
              { id: 'bpo', label: 'BPOs Only', count: counts.bpoCount },
              { id: 'bpc', label: 'BPCs Only', count: counts.bpcCount },
              { id: 'profitable', label: 'Profitable Only', count: counts.profitableCount },
            ] as { id: BlueprintFilterMode; label: string; count: number }[]
          ).map((btn) => {
            const active = filterMode === btn.id;
            return (
              <button
                key={btn.id}
                type="button"
                onClick={() => {
                  setFilterMode(btn.id);
                  setShowAllRows(false);
                }}
                className={`px-2.5 py-1.5 rounded text-xs font-medium border transition-colors whitespace-nowrap cursor-pointer ${
                  active
                    ? btn.id === 'profitable'
                      ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                      : 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200'
                    : 'border-slate-800 bg-[#0b0e14] text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                {btn.label}{' '}
                <span className="font-mono tabular-nums opacity-80">({btn.count})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Scrollable Blueprint Table */}
      <div
        className={`overflow-x-auto overflow-y-auto ${
          compact ? 'max-h-[340px]' : 'max-h-[460px]'
        }`}
      >
        {filteredRows.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-slate-400">
            {counts.total === 0
              ? 'No blueprints found for this character.'
              : filterMode === 'profitable'
                ? 'No owned blueprints match a currently profitable manufacturing recipe in the checked Market Scope categories.'
                : 'No blueprints match your current search and filter criteria.'}
          </div>
        ) : (
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-[#0e131b] border-b border-slate-800 text-slate-400 sticky top-0 z-10">
                <th className="py-2 px-3 text-left font-medium">Blueprint Name</th>
                <th className="py-2 px-2.5 text-left font-medium">Type</th>
                <th className="py-2 px-2.5 text-right font-medium">ME</th>
                <th className="py-2 px-2.5 text-right font-medium">TE</th>
                <th className="py-2 px-2.5 text-right font-medium">Runs</th>
                <th className="py-2 px-3 text-left font-medium">Location / Hangar</th>
                <th className="py-2 px-3 text-right font-medium">Indy Est. Profit</th>
                {onOpenHistory && (
                  <th className="py-2 px-2 text-center font-medium w-9" aria-label="30d History">
                    30d
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {visibleRows.map((row) => {
                const { bp, isBpo, displayName, matchedCard, historyTypeId, historyName } = row;
                return (
                  <tr
                    key={`${bp.source ?? 'personal'}-${bp.itemId}`}
                    className="hover:bg-slate-800/35 transition-colors"
                  >
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="text-slate-100 font-medium truncate" title={displayName}>
                          {displayName}
                        </span>
                        {bp.source === 'corporation' && (
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded border border-amber-500/35 bg-amber-500/10 text-amber-300 shrink-0">
                            CORP
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-500">
                        Type #{bp.typeId}
                        {bp.quantity && bp.quantity > 1 ? ` · Stack ×${bp.quantity}` : ''}
                      </div>
                    </td>

                    <td className="py-2 px-2.5 whitespace-nowrap">
                      <span
                        className={`inline-block font-mono text-[11px] font-medium px-1.5 py-0.5 rounded border ${
                          isBpo
                            ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                            : 'border-indigo-400/40 bg-indigo-500/10 text-indigo-300'
                        }`}
                      >
                        {isBpo ? 'BPO' : 'BPC'}
                      </span>
                    </td>

                    <td className="py-2 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className={bp.me >= 10 ? 'text-emerald-400 font-medium' : 'text-slate-200'}>
                        {bp.me}%
                      </span>
                    </td>

                    <td className="py-2 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                      <span className={bp.te >= 20 ? 'text-emerald-400 font-medium' : 'text-slate-300'}>
                        {bp.te}%
                      </span>
                    </td>

                    <td className="py-2 px-2.5 text-right font-mono tabular-nums whitespace-nowrap text-slate-300">
                      {bp.runs === -1 ? '∞ (BPO)' : bp.runs.toLocaleString()}
                    </td>

                    <td className="py-2 px-3 text-slate-400 max-w-[240px] truncate" title={bp.locationName}>
                      {bp.locationName}
                    </td>

                    <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                      {matchedCard ? (
                        <div>
                          <span
                            className={
                              matchedCard.netProfitIsk > 0
                                ? 'text-emerald-400 font-medium'
                                : 'text-rose-400'
                            }
                          >
                            {matchedCard.netProfitIsk >= 0 ? '+' : ''}
                            {formatIsk(matchedCard.netProfitIsk)}
                          </span>
                          <div className="text-[10px] text-slate-500">
                            {formatPct(matchedCard.roiPct)} ROI
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>

                    {onOpenHistory && (
                      <td className="py-2 px-2 text-center">
                        {historyTypeId ? (
                          <button
                            type="button"
                            onClick={() => onOpenHistory(historyTypeId, historyName)}
                            title={`Open 30d market history for ${historyName}`}
                            className="p-1 rounded text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors cursor-pointer"
                          >
                            <LineChart className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <span className="text-slate-700">·</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Progressive Render Footer if > 400 rows match */}
      {hiddenRowCount > 0 && (
        <div className="px-4 py-2.5 border-t border-slate-800/80 bg-[#0e131b]/70 flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-400 font-mono tabular-nums">
            Rendered {visibleRows.length.toLocaleString()} of {filteredRows.length.toLocaleString()} matching blueprints ({hiddenRowCount.toLocaleString()} more ready).
          </span>
          <button
            type="button"
            onClick={() => setShowAllRows(true)}
            className="px-3 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 font-medium cursor-pointer"
          >
            Show All {filteredRows.length.toLocaleString()} Matching
          </button>
        </div>
      )}
    </div>
  );
}
