import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  ClipboardCopy,
  Clock,
  Layers,
  Package,
  ShoppingCart,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import {
  computeBlueprintBuildTime,
  computeVirtualHangarLedger,
  formatDurationCompact,
  getMaxIndustrySlots,
} from '../utils/eveMarketMath.ts';
import type {
  ActionCardData,
  BuildQueueEntry,
  GlobalMultibuyMaterial,
  IndustryStructureConfig,
  MarketSnapshot,
  PilotProfile,
} from '../types/eve.ts';

interface BuildQueueAndLedgerPanelProps {
  entries: BuildQueueEntry[];
  cardsById: Map<string, ActionCardData>;
  profile: PilotProfile;
  snapshot: MarketSnapshot;
  structureConfig: IndustryStructureConfig;
  activeMfgJobCount: number;
  selectedEntryId: string | null;
  onSelectEntry: (cardId: string) => void;
  onUpdateRuns: (cardId: string, runs: number) => void;
  onUpdateSlots: (cardId: string, slots: number) => void;
  onMovePriority: (cardId: string, direction: 'up' | 'down') => void;
  onRemoveEntry: (cardId: string) => void;
  onClearQueue: () => void;
  onOpenHaulerFlyout: (params: {
    title: string;
    rawInputM3: number;
    packagedOutputM3: number;
    cargoValueIsk: number;
    originSystemId: number;
    destSystemId: number;
    originName: string;
    destName: string;
  }) => void;
}

export const BuildQueueAndLedgerPanel: React.FC<BuildQueueAndLedgerPanelProps> = ({
  entries,
  cardsById,
  profile,
  snapshot,
  structureConfig,
  activeMfgJobCount,
  selectedEntryId,
  onSelectEntry,
  onUpdateRuns,
  onUpdateSlots,
  onMovePriority,
  onRemoveEntry,
  onClearQueue,
  onOpenHaulerFlyout,
}) => {
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [copiedMode, setCopiedMode] = useState<'safe' | 'thin' | 'all' | null>(null);

  const slotCaps = useMemo(() => getMaxIndustrySlots(profile), [profile]);
  const availableMfgSlots = Math.max(1, slotCaps.mfgSlotsMax - activeMfgJobCount);

  const ledger = useMemo(
    () =>
      computeVirtualHangarLedger({
        queue: entries,
        cardsById,
        hangarStock: profile.hangarStock,
        snapshot,
        profile,
        structureConfig,
      }),
    [entries, cardsById, profile, snapshot, structureConfig]
  );

  const totalAllocatedSlots = useMemo(
    () => entries.reduce((sum, e) => sum + Math.max(1, e.allocatedSlots), 0),
    [entries]
  );

  const queueTotals = useMemo(() => {
    let longestWallClockSec = 0;

    for (const slot of ledger.allocations) {
      if (slot.concurrentDurationSec > longestWallClockSec) {
        longestWallClockSec = slot.concurrentDurationSec;
      }
    }

    return {
      rawInputM3: ledger.totalRawInputM3,
      packagedOutputM3: ledger.totalPackagedOutputM3,
      buyAllCapital: ledger.totalBuyAllCostIsk,
      buyMissingCapital: ledger.totalBuyMissingCostIsk,
      buyAllProfit: ledger.totalBuyAllProfitIsk,
      buyMissingProfit: ledger.totalBuyMissingProfitIsk,
      hangarSavings: ledger.totalHangarReservedSavingsIsk,
      longestWallClockSec,
    };
  }, [ledger]);

  const safeMaterials = useMemo(
    () => ledger.globalMultibuy.filter((m) => m.status === 'in_stock'),
    [ledger.globalMultibuy]
  );
  const riskyMaterials = useMemo(
    () => ledger.globalMultibuy.filter((m) => m.status !== 'in_stock'),
    [ledger.globalMultibuy]
  );

  const getStatusLabel = (m: GlobalMultibuyMaterial): string => {
    if (m.status === 'shortfall') {
      return `Shortfall (-${m.shortfallQty.toLocaleString('en-US')})`;
    }
    if (m.status === 'thin_depth') {
      return `Thin Depth (+${m.slippagePct.toFixed(1)}%)`;
    }
    return 'In Stock (Safe)';
  };

  const handleCopyMultibuy = async (items: GlobalMultibuyMaterial[], mode: 'safe' | 'thin' | 'all') => {
    const text = items
      .filter((m) => m.totalMissingQty > 0)
      .map((m) => `${m.name}\t${Math.round(m.totalMissingQty)}`)
      .join('\n');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMode(mode);
      setTimeout(() => setCopiedMode(null), 2200);
    } catch {
      // Clipboard blocked in some sandbox frames
    }
  };

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-slate-800 bg-[#0d131d] p-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Multi-Slot Build Queue &amp; Virtual Hangar Ledger
            </h3>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            Mfg Slots: {activeMfgJobCount}/{slotCaps.mfgSlotsMax} used ({availableMfgSlots} open)
          </span>
        </div>
        <p className="text-[11px] text-slate-400 leading-relaxed">
          Click <span className="text-cyan-300 font-semibold">+ Build Queue</span> on any Blueprint / Manufacturing card to allocate concurrent slots, reserve owned hangar stock in priority order, and export an availability-checked global EVE Multi-Buy list.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-cyan-500/30 bg-[#0d131d] overflow-hidden shadow-lg shadow-black/30">
      {/* Header */}
      <div className="px-3.5 py-2.5 bg-slate-900/90 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-100">
              Multi-Slot Build Queue &amp; Virtual Hangar Stock Ledger
            </h3>
            <p className="text-[10px] text-slate-400">
              Priority order: Slot 1 reserves hangar materials first · Remaining stock cascades down · Depleted mats roll into Buy Missing
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
              totalAllocatedSlots > availableMfgSlots
                ? 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            }`}
          >
            Slots: {totalAllocatedSlots}/{availableMfgSlots} open ({slotCaps.mfgSlotsMax} max)
          </span>
          <button
            type="button"
            onClick={() =>
              onOpenHaulerFlyout({
                title: `Build Queue (${entries.length} Blueprint${entries.length > 1 ? 's' : ''})`,
                rawInputM3: queueTotals.rawInputM3,
                packagedOutputM3: queueTotals.packagedOutputM3,
                cargoValueIsk: Math.max(queueTotals.buyAllCapital, queueTotals.buyMissingCapital),
                originSystemId: 30000142,
                destSystemId: structureConfig.systemId,
                originName: 'Jita',
                destName: structureConfig.systemName,
              })
            }
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold bg-amber-500/15 border border-amber-500/40 text-amber-200 hover:bg-amber-500/25 transition-colors cursor-pointer"
          >
            <Truck className="w-3.5 h-3.5" />
            Hauler &amp; Fit
          </button>
          <button
            type="button"
            onClick={onClearQueue}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold bg-slate-800 border border-slate-700 text-slate-300 hover:text-rose-300 hover:border-rose-500/40 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Clear Queue
          </button>
        </div>
      </div>

      {/* Summary Dual-Profit KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-3.5 py-2.5 bg-[#0a0f17] border-b border-slate-800/80 text-xs">
        <div className="rounded border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Buy All (Replacement)</div>
          <div
            className={`font-mono font-bold text-sm ${
              queueTotals.buyAllProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
            }`}
          >
            {formatIsk(queueTotals.buyAllProfit)}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            Cap: {formatIsk(queueTotals.buyAllCapital)}
          </div>
        </div>
        <div className="rounded border border-cyan-500/30 bg-cyan-950/20 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-cyan-300">Buy Missing (Cash Out)</div>
          <div
            className={`font-mono font-bold text-sm ${
              queueTotals.buyMissingProfit >= 0 ? 'text-cyan-300' : 'text-rose-400'
            }`}
          >
            {formatIsk(queueTotals.buyMissingProfit)}
          </div>
          <div className="text-[10px] text-emerald-400/90 font-mono">
            Hangar Saved: {formatIsk(queueTotals.hangarSavings)}
          </div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Concurrent Wall-Clock</div>
          <div className="font-mono font-bold text-sm text-amber-300 flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            {formatDurationCompact(queueTotals.longestWallClockSec)}
          </div>
          <div className="text-[10px] text-slate-500 font-mono">
            {totalAllocatedSlots} slot{totalAllocatedSlots > 1 ? 's' : ''} @ {structureConfig.systemName}
          </div>
        </div>
        <div className="rounded border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Committed Haul Volume</div>
          <div className="font-mono font-bold text-sm text-slate-100">
            {formatM3(queueTotals.rawInputM3)} in
          </div>
          <div className="text-[10px] text-slate-400 font-mono">
            {formatM3(queueTotals.packagedOutputM3)} out
          </div>
        </div>
      </div>

      {/* Priority-Ordered Slot Rows */}
      <div className="divide-y divide-slate-800/80">
        {ledger.allocations.map((slot, idx) => {
          const entry = entries.find((e) => e.cardId === slot.cardId);
          const card = cardsById.get(slot.cardId);
          if (!entry || !card) return null;

          const isExpanded = expandedSlotId === slot.cardId;
          const isSelected = selectedEntryId === slot.cardId;
          const timeInfo = computeBlueprintBuildTime({
            baseRunDurationSec: card.baseRunDurationSec ?? 3600,
            runs: entry.committedRuns,
            bpTe: card.bpTe ?? 20,
            industryLvl: profile.skills.industry ?? 5,
            advIndustryLvl: profile.skills.advancedIndustry ?? 4,
            reactionsLvl: profile.skills.reactions ?? 0,
            isReaction: false,
            structureConfig,
            allocatedSlots: entry.allocatedSlots,
            maxAvailableSlots: availableMfgSlots,
          });
          const buyAllProfit = slot.buyAllProfitIsk;
          const buyMissingProfit = slot.buyMissingProfitIsk;

          return (
            <div
              key={slot.cardId}
              onClick={() => onSelectEntry(slot.cardId)}
              className={`px-3.5 py-2.5 transition-all cursor-pointer relative ${
                isSelected
                  ? 'bg-cyan-500/10 border-l-2 border-l-cyan-400 shadow-[inset_0_1px_8px_rgba(34,211,238,0.14)]'
                  : 'hover:bg-slate-900/60 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-slate-800 border border-slate-700 text-[11px] font-mono font-bold text-cyan-300 shrink-0">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-slate-100 truncate">
                      {entry.productName}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      1-Slot Seq: {formatDurationCompact(timeInfo.sequentialTotalSec)} ·{' '}
                      <span className="text-amber-300">
                        {timeInfo.allocatedSlotsClamped} Slot{timeInfo.allocatedSlotsClamped > 1 ? 's' : ''}: {formatDurationCompact(timeInfo.concurrentWallClockSec)}
                      </span>{' '}
                      ({formatDurationCompact(timeInfo.timePerSlotSec)}/slot)
                    </div>
                  </div>
                </div>

                {/* Inline Controls: Runs, Slots, Priority Up/Down, Expand, Remove */}
                <div
                  className="flex flex-wrap items-center gap-2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5">
                    <span className="text-[10px] text-slate-400">Runs</span>
                    <button
                      type="button"
                      onClick={() => onUpdateRuns(slot.cardId, Math.max(1, entry.committedRuns - 1))}
                      className="px-1 text-xs font-bold text-slate-300 hover:text-cyan-300 cursor-pointer"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={entry.committedRuns}
                      onChange={(e) =>
                        onUpdateRuns(slot.cardId, Math.max(1, Math.min(10000, Math.round(Number(e.target.value) || 1))))
                      }
                      className="w-12 bg-transparent text-center font-mono text-xs text-slate-100 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onUpdateRuns(slot.cardId, entry.committedRuns + 1)}
                      className="px-1 text-xs font-bold text-slate-300 hover:text-cyan-300 cursor-pointer"
                    >
                      +
                    </button>
                  </div>

                  <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-1.5 py-0.5">
                    <span className="text-[10px] text-slate-400">Slots</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, slotCaps.mfgSlotsMax)}
                      value={entry.allocatedSlots}
                      onChange={(e) =>
                        onUpdateSlots(
                          slot.cardId,
                          Math.max(1, Math.min(slotCaps.mfgSlotsMax, Math.round(Number(e.target.value) || 1)))
                        )
                      }
                      className="w-9 bg-transparent text-center font-mono text-xs text-amber-300 focus:outline-none"
                    />
                  </div>

                  <div className="text-right font-mono text-[10px] leading-tight">
                    <div className={buyAllProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                      All: {formatIsk(buyAllProfit)}
                    </div>
                    <div className={buyMissingProfit >= 0 ? 'text-cyan-300' : 'text-rose-400'}>
                      Miss: {formatIsk(buyMissingProfit)}
                    </div>
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMovePriority(slot.cardId, 'up')}
                      title="Move up priority (reserves hangar stock earlier)"
                      className="p-1 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === ledger.allocations.length - 1}
                      onClick={() => onMovePriority(slot.cardId, 'down')}
                      title="Move down priority"
                      className="p-1 rounded border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setExpandedSlotId(isExpanded ? null : slot.cardId)}
                      className="px-2 py-1 rounded border border-slate-700 bg-slate-900 text-[10px] font-semibold text-slate-300 hover:border-cyan-500/40 hover:text-cyan-200 cursor-pointer"
                    >
                      {isExpanded ? 'Hide Stock' : 'Ledger'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveEntry(slot.cardId)}
                      title="Remove from Build Queue"
                      className="p-1 rounded border border-slate-700 bg-slate-900 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Per-Material Virtual Hangar Reservation Breakdown */}
              {isExpanded && (
                <div
                  className="mt-2.5 rounded border border-slate-800 bg-[#080c13] overflow-x-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <table className="w-full text-[11px] font-mono">
                    <thead className="bg-slate-900/90 text-slate-400 text-[10px] uppercase">
                      <tr>
                        <th className="text-left px-2.5 py-1.5">Material</th>
                        <th className="text-right px-2 py-1.5">Required</th>
                        <th className="text-right px-2 py-1.5">Reserved / Avail</th>
                        <th className="text-right px-2 py-1.5">Buy Missing</th>
                        <th className="text-right px-2.5 py-1.5">Missing Cost (Depth)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {slot.materials.map((m) => (
                        <tr key={m.typeId} className="hover:bg-slate-900/40">
                          <td className="px-2.5 py-1 text-slate-200 font-sans">{m.name}</td>
                          <td className="px-2 py-1 text-right text-slate-300">
                            {m.requiredQty.toLocaleString('en-US')}
                          </td>
                          <td className="px-2 py-1 text-right">
                            <span className={m.reservedQty > 0 ? 'text-emerald-400' : 'text-slate-500'}>
                              {m.reservedQty.toLocaleString('en-US')}
                            </span>
                            <span className="text-slate-500"> / {m.availableBeforeSlot.toLocaleString('en-US')}</span>
                          </td>
                          <td className="px-2 py-1 text-right">
                            {m.missingQty > 0 ? (
                              <span className="text-amber-300 font-semibold">
                                {m.missingQty.toLocaleString('en-US')}
                              </span>
                            ) : (
                              <span className="text-emerald-400">0 (Covered)</span>
                            )}
                          </td>
                          <td className="px-2.5 py-1 text-right text-slate-200">
                            {m.missingQty > 0 ? formatIsk(m.buyMissingCostIsk) : '0 ISK'}
                            {(m.depthWalkMissing?.slippagePct ?? 0) > 1 && (
                              <span className="ml-1 text-[9px] text-amber-400">
                                (+{(m.depthWalkMissing?.slippagePct ?? 0).toFixed(1)}%)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Export Total Shopping List Bar */}
      <div className="px-3.5 py-2.5 bg-slate-900/80 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] text-slate-300 flex items-center gap-2">
          <Package className="w-3.5 h-3.5 text-cyan-400" />
          <span>
            <strong className="font-mono text-slate-100">{ledger.globalMultibuy.length}</strong> missing material SKU
            {ledger.globalMultibuy.length === 1 ? '' : 's'} across queue
          </span>
          {riskyMaterials.length > 0 && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[10px] font-semibold">
              <AlertTriangle className="w-3 h-3" />
              {riskyMaterials.length} thin/shortfall isolated
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setExportModalOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-bold bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/30 transition-colors cursor-pointer shadow-sm"
        >
          <ShoppingCart className="w-3.5 h-3.5" />
          Export Total Shopping List
        </button>
      </div>

      {/* Availability-Checked Global Multi-Buy Aggregator Modal */}
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-xl border border-slate-700 bg-[#0d121b] shadow-2xl overflow-hidden">
            <div className="px-4 py-3 bg-slate-900 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                  <ShoppingCart className="w-4 h-4 text-cyan-400" />
                  Availability-Checked Global Multi-Buy Aggregator (Jita 4-4)
                </h4>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Combines all Buy Missing materials across your {entries.length} queued build
                  {entries.length > 1 ? 's' : ''} after Virtual Hangar Ledger reservations, isolating thin orderbooks so EVE Multi-Buy won&apos;t overcharge you.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 overflow-y-auto space-y-4">
              {ledger.globalMultibuy.length === 0 ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                  <CheckCircle2 className="w-6 h-6 text-emerald-400 mx-auto mb-1" />
                  <p className="text-sm font-semibold text-emerald-200">
                    100% Covered by Your Hangar Stock!
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Zero missing materials need to be purchased for this build queue.
                  </p>
                </div>
              ) : (
                <>
                  {/* Safe Bulk In-Stock Section */}
                  <div className="rounded-lg border border-emerald-500/30 bg-[#091117] overflow-hidden">
                    <div className="px-3 py-2 bg-emerald-950/30 border-b border-emerald-500/20 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Safe Bulk Multi-Buy — In Stock ({safeMaterials.length} SKU
                        {safeMaterials.length === 1 ? '' : 's'})
                      </div>
                      <button
                        type="button"
                        disabled={safeMaterials.length === 0}
                        onClick={() => handleCopyMultibuy(safeMaterials, 'safe')}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-40 cursor-pointer"
                      >
                        {copiedMode === 'safe' ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            Copied {safeMaterials.length} Safe Items!
                          </>
                        ) : (
                          <>
                            <ClipboardCopy className="w-3.5 h-3.5" />
                            Copy Safe Bulk for EVE Multi-Buy
                          </>
                        )}
                      </button>
                    </div>
                    {safeMaterials.length > 0 ? (
                      <table className="w-full text-xs font-mono">
                        <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-400">
                          <tr>
                            <th className="text-left px-3 py-1.5">Material</th>
                            <th className="text-right px-2 py-1.5">Buy Qty</th>
                            <th className="text-right px-2 py-1.5">Depth Avg</th>
                            <th className="text-right px-2 py-1.5">Total ISK</th>
                            <th className="text-right px-3 py-1.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {safeMaterials.map((m) => (
                            <tr key={m.typeId}>
                              <td className="px-3 py-1.5 font-sans text-slate-200">{m.name}</td>
                              <td className="px-2 py-1.5 text-right text-slate-100">
                                {m.totalMissingQty.toLocaleString('en-US')}
                              </td>
                              <td className="px-2 py-1.5 text-right text-slate-300">
                                {formatIsk(m.weightedAvgPrice, false)}
                              </td>
                              <td className="px-2 py-1.5 text-right text-emerald-300">
                                {formatIsk(m.totalCostIsk)}
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">
                                  {getStatusLabel(m)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <div className="p-3 text-xs text-slate-400">
                        All missing items triggered a thin-depth or shortfall warning below.
                      </div>
                    )}
                  </div>

                  {/* Isolated Thin Depth / Shortfall Section */}
                  {riskyMaterials.length > 0 && (
                    <div className="rounded-lg border border-amber-500/40 bg-[#140f09] overflow-hidden">
                      <div className="px-3 py-2 bg-amber-950/35 border-b border-amber-500/25 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Isolated Thin Depth / Shortfall Items ({riskyMaterials.length} SKU
                          {riskyMaterials.length === 1 ? '' : 's'})
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyMultibuy(riskyMaterials, 'thin')}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30 cursor-pointer"
                        >
                          {copiedMode === 'thin' ? (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              Copied Thin Items!
                            </>
                          ) : (
                            <>
                              <ClipboardCopy className="w-3.5 h-3.5" />
                              Copy Isolated Items Separately
                            </>
                          )}
                        </button>
                      </div>
                      <p className="px-3 py-1.5 text-[11px] text-amber-200/80 bg-amber-950/15 border-b border-amber-500/15">
                        These SKUs either exceed live Jita hub depth or push more than +2.0% above top-of-book. Buy them via limit Buy Orders or split across hubs instead of blind Multi-Buy.
                      </p>
                      <table className="w-full text-xs font-mono">
                        <thead className="bg-slate-900/80 text-[10px] uppercase text-slate-400">
                          <tr>
                            <th className="text-left px-3 py-1.5">Material</th>
                            <th className="text-right px-2 py-1.5">Buy Qty</th>
                            <th className="text-right px-2 py-1.5">Depth Avg</th>
                            <th className="text-right px-2 py-1.5">Slippage</th>
                            <th className="text-right px-3 py-1.5">Availability Check</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/70">
                          {riskyMaterials.map((m) => (
                            <tr key={m.typeId}>
                              <td className="px-3 py-1.5 font-sans text-slate-100">{m.name}</td>
                              <td className="px-2 py-1.5 text-right text-amber-200">
                                {m.totalMissingQty.toLocaleString('en-US')}
                              </td>
                              <td className="px-2 py-1.5 text-right text-slate-300">
                                {formatIsk(m.weightedAvgPrice, false)}
                              </td>
                              <td className="px-2 py-1.5 text-right text-amber-300">
                                +{m.slippagePct.toFixed(1)}%
                              </td>
                              <td className="px-3 py-1.5 text-right">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                    m.status === 'shortfall'
                                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                  }`}
                                >
                                  {getStatusLabel(m)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between">
              <div className="text-[11px] font-mono text-slate-400">
                Total Buy Missing Cash Out:{' '}
                <span className="text-cyan-300 font-bold">
                  {formatIsk(
                    ledger.globalMultibuy.reduce((s, m) => s + m.totalCostIsk, 0)
                  )}
                </span>{' '}
                · Volume:{' '}
                <span className="text-slate-200">
                  {formatM3(ledger.globalMultibuy.reduce((s, m) => s + m.totalVolumeM3, 0))}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {ledger.globalMultibuy.length > 0 && (
                  <button
                    type="button"
                    onClick={() => handleCopyMultibuy(ledger.globalMultibuy, 'all')}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 border border-slate-700 text-slate-200 hover:border-cyan-500/40 cursor-pointer"
                  >
                    {copiedMode === 'all' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        Copied All ({ledger.globalMultibuy.length})
                      </>
                    ) : (
                      <>
                        <ClipboardCopy className="w-3.5 h-3.5" />
                        Copy All Combined
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setExportModalOpen(false)}
                  className="px-3 py-1.5 rounded text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
