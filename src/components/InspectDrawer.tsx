import { useEffect, useRef, useState } from 'react';
import { Check, Copy, LineChart, X } from 'lucide-react';
import { formatIsk, formatM3, formatPct } from '../engines/decisionEngines.ts';
import type { ActionCardData, PilotProfile, ShoppingListLine } from '../types/eve.ts';
import { copyTextToClipboard, formatEveMultibuyText } from '../utils/eveMultibuy.ts';
import { LiveOrderBookPanel } from './LiveOrderBookPanel.tsx';

interface InspectDrawerProps {
  card: ActionCardData | null;
  profile: PilotProfile;
  eveAccessToken: string | null;
  shoppingListMode: boolean;
  shoppingList: ShoppingListLine[];
  shoppingTotalIsk: number;
  shoppingTotalM3: number;
  shoppingSavingsIsk: number;
  customItemCount: number;
  onClearCustomShoppingItems: () => void;
  onOpenHistory: (typeId: number, name: string) => void;
  onOpenSsoSettings: () => void;
  onClose: () => void;
}

export function InspectDrawer({
  card,
  profile,
  eveAccessToken,
  shoppingListMode,
  shoppingList,
  shoppingTotalIsk,
  shoppingTotalM3,
  shoppingSavingsIsk,
  customItemCount,
  onClearCustomShoppingItems,
  onOpenHistory,
  onOpenSsoSettings,
  onClose,
}: InspectDrawerProps) {
  const [copiedCount, setCopiedCount] = useState<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  if (!card && !shoppingListMode) return null;

  const handleCopyMultibuy = async () => {
    const { text, itemCount } = formatEveMultibuyText(shoppingList);
    if (itemCount === 0) return;
    const ok = await copyTextToClipboard(text);
    if (!ok) return;

    setCopiedCount(itemCount);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedCount(null);
    }, 2000);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65"
      role="dialog"
      aria-modal="true"
      aria-label={shoppingListMode ? 'Consolidated Jita Shopping List' : card?.title}
    >
      <div
        className="flex-1"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="w-full max-w-3xl bg-[#0e131b] border-l border-slate-800 h-full flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="text-xs text-cyan-400 font-medium">
              {shoppingListMode ? 'Consolidated Jita 4-4 Procurement' : card?.engineLabel}
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-100 mt-0.5 truncate">
              {shoppingListMode ? 'Consolidated Jita Shopping List (1-Jump Check)' : card?.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspection panel"
            className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {shoppingListMode ? (
            <>
              <div className="grid grid-cols-3 border border-slate-800 rounded-lg divide-x divide-slate-800 bg-[#131822]">
                <div className="p-4">
                  <div className="text-xs text-slate-400">Total Jita Cost</div>
                  <div className="font-mono tabular-nums text-base font-semibold text-amber-300 mt-1">
                    {formatIsk(shoppingTotalIsk)}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">Total Cargo Volume</div>
                  <div className="font-mono tabular-nums text-base font-semibold text-slate-100 mt-1">
                    {formatM3(shoppingTotalM3)}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">1-Jump Savings Found</div>
                  <div className="font-mono tabular-nums text-base font-semibold text-emerald-400 mt-1">
                    {formatIsk(shoppingSavingsIsk)}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400 flex-1 min-w-[240px]">
                  Aggregated inputs across all positive-margin active Ishisomo T1/T2 builds{customItemCount > 0 ? ` plus ${customItemCount} Advisor-added item line${customItemCount > 1 ? 's' : ''}` : ''}. Checked against 1-jump ESI orders.
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {customItemCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearCustomShoppingItems}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-[#131822] text-slate-300 hover:border-rose-400/50 hover:text-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear Advisor Additions ({customItemCount})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyMultibuy}
                    disabled={shoppingList.length === 0}
                    title="Copy all shopping list items as <Item Name><TAB><Quantity> for EVE Online Multibuy"
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${
                      copiedCount !== null
                        ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                        : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20'
                    }`}
                  >
                    {copiedCount !== null ? (
                      <Check className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {copiedCount !== null
                        ? `Copied ${copiedCount} ${copiedCount === 1 ? 'item' : 'items'} for EVE Multibuy`
                        : 'Copy for EVE Multibuy'}
                    </span>
                  </button>
                </div>
              </div>

              {shoppingList.length === 0 ? (
                <div className="p-8 text-center border border-slate-800 rounded-lg text-sm text-slate-400">
                  No profitable industry builds match your currently checked Market Scope categories.
                </div>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-x-auto">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#131822] border-b border-slate-800 text-slate-400">
                        <th className="py-2.5 px-3 text-left font-medium">Material</th>
                        <th className="py-2.5 px-3 text-right font-medium">Qty</th>
                        <th className="py-2.5 px-3 text-right font-medium">Jita Unit</th>
                        <th className="py-2.5 px-3 text-right font-medium">Subtotal</th>
                        <th className="py-2.5 px-3 text-right font-medium">Volume</th>
                        <th className="py-2.5 px-3 text-left font-medium">1-Jump Check</th>
                        <th className="py-2.5 px-3 text-right font-medium">30d History</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {shoppingList.map((line) => (
                        <tr key={line.typeId} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 text-slate-200 font-medium">
                            <span>{line.name}</span>
                            {line.addedByAdvisor && (
                              <span className="ml-2 text-[11px] font-normal text-cyan-400">
                                · Advisor Added
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200">
                            {line.quantity.toLocaleString('en-US')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                            {formatIsk(line.unitPriceJita, false)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-300">
                            {formatIsk(line.totalCostJita)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                            {formatM3(line.volumeM3)}
                          </td>
                          <td className="py-2.5 px-3 text-left">
                            {line.cheaperNearby ? (
                              <span className="text-emerald-400 font-mono tabular-nums">
                                {line.cheaperNearby.systemName} (-{formatIsk(line.cheaperNearby.savingsIsk)})
                              </span>
                            ) : (
                              <span className="text-slate-500">Jita 4-4 Best</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onOpenHistory(line.typeId, line.name)}
                              title={`View 30-day ESI market history for ${line.name}`}
                              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#131822] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
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
              )}
            </>
          ) : card ? (
            <>
              {/* Key Metrics Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-[#131822]">
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">Required Capital</div>
                  <div className="font-mono tabular-nums text-sm font-semibold text-amber-300 mt-1">
                    {formatIsk(card.requiredCapitalIsk)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">Total Volume</div>
                  <div className="font-mono tabular-nums text-sm font-semibold text-slate-100 mt-1">
                    {formatM3(card.totalVolumeM3)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">Net Profit</div>
                  <div
                    className={`font-mono tabular-nums text-sm font-semibold mt-1 ${
                      card.netProfitIsk >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {card.netProfitIsk >= 0 ? '+' : ''}
                    {formatIsk(card.netProfitIsk)}
                  </div>
                </div>
                <div className="p-3.5">
                  <div className="text-[11px] text-slate-400">ROI</div>
                  <div
                    className={`font-mono tabular-nums text-sm font-semibold mt-1 ${
                      card.roiPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatPct(card.roiPct)}
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">
                {card.inspection.summaryText}
              </p>

              {/* High-Density Inspection Data Table */}
              <div className="border border-slate-800 rounded-lg overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#131822] border-b border-slate-800 text-slate-400">
                      {card.inspection.columns.map((col) => (
                        <th
                          key={col.key}
                          className={`py-2.5 px-3 font-medium whitespace-nowrap ${
                            col.align === 'right' ? 'text-right' : 'text-left'
                          }`}
                        >
                          {col.label}
                        </th>
                      ))}
                      <th className="py-2.5 px-3 text-right font-medium whitespace-nowrap">
                        30d History
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {card.inspection.rows.map((row, rIdx) => {
                      const rowTypeId =
                        typeof row._typeId === 'number' && row._typeId > 0
                          ? row._typeId
                          : undefined;
                      const rowItemName =
                        typeof row._itemName === 'string' && row._itemName
                          ? row._itemName
                          : String(row[card.inspection.columns[0]?.key] ?? card.title);
                      return (
                        <tr key={rIdx} className="hover:bg-slate-800/30">
                          {card.inspection.columns.map((col) => (
                            <td
                              key={col.key}
                              className={`py-2.5 px-3 ${
                                col.align === 'right'
                                  ? 'text-right font-mono tabular-nums text-slate-200'
                                  : 'text-left text-slate-300'
                              }`}
                            >
                              {row[col.key]}
                            </td>
                          ))}
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            {rowTypeId ? (
                              <button
                                type="button"
                                onClick={() => onOpenHistory(rowTypeId, rowItemName)}
                                title={`View 30-day ESI market history for ${rowItemName}`}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#131822] text-cyan-300 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-colors cursor-pointer"
                              >
                                <LineChart className="w-3 h-3" aria-hidden="true" />
                                <span>30d History</span>
                              </button>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Live Regional Order Book & Remote Buy Range inside Inspection Drawer */}
              <div className="border border-slate-800 rounded-lg overflow-hidden">
                <LiveOrderBookPanel
                  card={card}
                  profile={profile}
                  eveAccessToken={eveAccessToken}
                  onOpenSsoSettings={onOpenSsoSettings}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
