import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Check, Compass, Copy, LineChart, Lock, PackageCheck, Table2, X } from 'lucide-react';
import { EMPIRE_HUB_LIST, EMPIRE_HUB_MAP, ITEM_BY_ID } from '../data/eveCatalog.ts';
import { formatIsk, formatM3, formatPct, getHubQuote, getQuote } from '../engines/decisionEngines.ts';
import { getDotlanRouteUrl } from '../utils/dotlan.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  MarketSnapshot,
  PerOutputDestinationOption,
  PilotProfile,
  ShoppingListLine,
  TradeHubId,
} from '../types/eve.ts';
import { copyTextToClipboard, formatEveMultibuyText } from '../utils/eveMultibuy.ts';
import { LiveOrderBookPanel } from './LiveOrderBookPanel.tsx';

interface InspectDrawerProps {
  card: ActionCardData | null;
  profile: PilotProfile;
  eveAccessToken: string | null;
  appSettings?: AppSettingsV22;
  snapshot?: MarketSnapshot;
  shoppingListMode: boolean;
  shoppingList: ShoppingListLine[];
  shoppingTotalIsk: number;
  shoppingTotalM3: number;
  shoppingSavingsIsk: number;
  deductHangarStock: boolean;
  onToggleDeductHangarStock: (next: boolean) => void;
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
  appSettings,
  snapshot,
  shoppingListMode,
  shoppingList,
  shoppingTotalIsk,
  shoppingTotalM3,
  shoppingSavingsIsk,
  deductHangarStock,
  onToggleDeductHangarStock,
  customItemCount,
  onClearCustomShoppingItems,
  onOpenHistory,
  onOpenSsoSettings,
  onClose,
}: InspectDrawerProps) {
  const [copiedCount, setCopiedCount] = useState<number | null>(null);
  const [drawerView, setDrawerView] = useState<'inspection' | 'orderbook'>('inspection');
  const [extraEffortTargetIsk, setExtraEffortTargetIsk] = useState<number>(2_000_000);
  const [lockedOutputIds, setLockedOutputIds] = useState<Record<number, boolean>>({});
  const copyTimerRef = useRef<number | null>(null);

  // Per-output alternative max-profit destinations for Reprocessing cards
  const altOutputOptions = useMemo<PerOutputDestinationOption[]>(() => {
    if (!card || card.engine !== 'reprocessing' || !snapshot) return [];
    const baseHub: TradeHubId = appSettings?.refiningHubId ?? 'jita';
    const baseHubName = EMPIRE_HUB_MAP[baseHub]?.shortLabel ?? 'Jita';
    const baseJumpsEst: Record<TradeHubId, number> = {
      jita: 0,
      dodixie: 12,
      amarr: 10,
      rens: 24,
      hek: 19,
    };

    const options: PerOutputDestinationOption[] = [];
    for (const row of card.inspection.rows) {
      const typeId = typeof row._typeId === 'number' ? row._typeId : 0;
      if (!typeId) continue;
      const itemName = typeof row._itemName === 'string' ? row._itemName : ITEM_BY_ID[typeId]?.name || `Type #${typeId}`;
      const qtyRaw = Number(String(row.refinedQty ?? '0').replace(/[^0-9.]/g, '')) || 100;
      const totalOutputQty = qtyRaw * Math.max(1, Math.round((card.outputUnits || 100) / 100));
      const q = getQuote(snapshot, typeId);
      const baseQ = getHubQuote(q, baseHub, ITEM_BY_ID[typeId]);
      const basePrice = card.executionMode === 'instant_fill' ? baseQ.buyMax : baseQ.sellMin;
      const baseRev = basePrice * totalOutputQty;

      let bestHub: TradeHubId = baseHub;
      let bestRev = baseRev;
      for (const h of EMPIRE_HUB_LIST) {
        const hq = getHubQuote(q, h.id, ITEM_BY_ID[typeId]);
        const price = card.executionMode === 'instant_fill' ? hq.buyMax : hq.sellMin;
        const rev = price * totalOutputQty;
        if (rev > bestRev) {
          bestRev = rev;
          bestHub = h.id;
        }
      }
      const extraGain = Math.max(0, bestRev - baseRev);
      const extraJumps = bestHub === baseHub ? 0 : Math.abs((baseJumpsEst[bestHub] ?? 12) - (baseJumpsEst[baseHub] ?? 0));
      options.push({
        outputTypeId: typeId,
        outputName: itemName,
        qty: totalOutputQty,
        baseDestHubId: baseHub,
        baseDestName: baseHubName,
        baseNetIsk: baseRev,
        altDestHubId: bestHub,
        altDestName: EMPIRE_HUB_MAP[bestHub]?.shortLabel ?? baseHubName,
        altNetIsk: bestRev,
        extraGainIsk: extraGain,
        extraJumps,
        lockedDestHubId: lockedOutputIds[typeId] ? bestHub : baseHub,
      });
    }
    return options;
  }, [card, snapshot, appSettings?.refiningHubId, lockedOutputIds]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const enrichedShopping = useMemo(() => {
    const stockMap = profile.hangarStock ?? {};
    let netTotalIsk = 0;
    let netTotalM3 = 0;
    let hangarSavedIsk = 0;

    const rows = shoppingList.map((line) => {
      const stock = stockMap[line.typeId];
      const onHandJita = stock?.jita ?? 0;
      const onHandIshisomo = stock?.ishisomo ?? 0;
      const onHandTotal = stock?.total ?? onHandJita + onHandIshisomo;
      const deductedQty = deductHangarStock ? Math.min(line.quantity, onHandTotal) : 0;
      const netQty = Math.max(0, line.quantity - deductedQty);
      const unitVol = line.quantity > 0 ? line.volumeM3 / line.quantity : 0;
      const effectiveCost = netQty * line.unitPriceJita;
      const effectiveVol = netQty * unitVol;

      netTotalIsk += effectiveCost;
      netTotalM3 += effectiveVol;
      hangarSavedIsk += deductedQty * line.unitPriceJita;

      return {
        ...line,
        onHandJita,
        onHandIshisomo,
        onHandTotal,
        deductedQty,
        netQty,
        effectiveCost,
        effectiveVol,
      };
    });

    return {
      rows,
      netTotalIsk,
      netTotalM3,
      hangarSavedIsk,
      coveredLineCount: rows.filter((r) => r.onHandTotal > 0).length,
    };
  }, [shoppingList, profile.hangarStock, deductHangarStock]);

  if (!card && !shoppingListMode) return null;

  const handleCopyMultibuy = async () => {
    const payloadLines = enrichedShopping.rows
      .map((row) => ({
        name: row.name,
        quantity: deductHangarStock ? row.netQty : row.quantity,
      }))
      .filter((r) => r.quantity > 0);

    const { text, itemCount } = formatEveMultibuyText(payloadLines);
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
      <div className="w-full max-w-4xl bg-[#0e131b] border-l border-slate-800 h-full flex flex-col">
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-start justify-between gap-4 shrink-0">
          <div className="min-w-0">
            <div className="text-xs text-cyan-400 font-medium">
              {shoppingListMode ? 'Consolidated Jita 4-4 Procurement' : card?.engineLabel}
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-100 mt-0.5 truncate">
              {shoppingListMode ? 'Consolidated Jita Shopping List (Hangar Stock & 1-Jump Check)' : card?.title}
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
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-800 rounded-lg divide-y sm:divide-y-0 sm:divide-x divide-slate-800 bg-[#131822]">
                <div className="p-4">
                  <div className="text-xs text-slate-400">
                    {deductHangarStock ? 'Net-to-Buy Cost' : 'Gross Jita Cost'}
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-amber-300 mt-1">
                    {formatIsk(deductHangarStock ? enrichedShopping.netTotalIsk : shoppingTotalIsk)}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">
                    {deductHangarStock ? 'Net Cargo Volume' : 'Gross Cargo Volume'}
                  </div>
                  <div className="font-mono tabular-nums text-base font-semibold text-slate-100 mt-1">
                    {formatM3(deductHangarStock ? enrichedShopping.netTotalM3 : shoppingTotalM3)}
                  </div>
                </div>
                <div className="p-4">
                  <div className="text-xs text-slate-400">Hangar Stock Offset</div>
                  <div className="font-mono tabular-nums text-base font-semibold text-cyan-300 mt-1">
                    {deductHangarStock ? `-${formatIsk(enrichedShopping.hangarSavedIsk)}` : 'OFF (Gross)'}
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
                <p className="text-xs text-slate-400 flex-1 min-w-[220px]">
                  Cross-checked against Jita &amp; Ishisomo hangar inventory ({enrichedShopping.coveredLineCount} matched SKU{enrichedShopping.coveredLineCount === 1 ? '' : 's'} on hand){customItemCount > 0 ? ` + ${customItemCount} Advisor item${customItemCount > 1 ? 's' : ''}` : ''}.
                </p>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {customItemCount > 0 && (
                    <button
                      type="button"
                      onClick={onClearCustomShoppingItems}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-slate-700 bg-[#131822] text-slate-300 hover:border-rose-400/50 hover:text-rose-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Clear Advisor ({customItemCount})
                    </button>
                  )}

                  {/* On/Off Toggle Switch: Deduct Hangar Stock right next to Copy for EVE Multibuy */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={deductHangarStock}
                    onClick={() => onToggleDeductHangarStock(!deductHangarStock)}
                    title="Subtract Jita and Ishisomo hangar stock before copying to EVE Multibuy"
                    className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      deductHangarStock
                        ? 'border-emerald-400/60 bg-emerald-500/15 text-emerald-200'
                        : 'border-slate-700 bg-[#131822] text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <PackageCheck className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Deduct Hangar Stock</span>
                    <span
                      className={`inline-flex items-center w-7 h-4 rounded-full p-0.5 transition-colors ${
                        deductHangarStock ? 'bg-emerald-400 justify-end' : 'bg-slate-700 justify-start'
                      }`}
                    >
                      <span className="w-3 h-3 rounded-full bg-[#0b0e14]" />
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyMultibuy}
                    disabled={shoppingList.length === 0}
                    title={
                      deductHangarStock
                        ? 'Copy NET-TO-BUY quantities (after deducting Jita/Ishisomo hangar stock) for EVE Online Multibuy'
                        : 'Copy GROSS requirements as <Item Name><TAB><Quantity> for EVE Online Multibuy'
                    }
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
                        ? `Copied ${copiedCount} ${copiedCount === 1 ? 'item' : 'items'} (${deductHangarStock ? 'Net' : 'Gross'})`
                        : deductHangarStock
                          ? 'Copy Net for EVE Multibuy'
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
                        <th className="py-2.5 px-3 text-right font-medium">Gross Qty</th>
                        <th className="py-2.5 px-3 text-right font-medium">On-Hand (Jita/Ish)</th>
                        <th className="py-2.5 px-3 text-right font-medium">
                          {deductHangarStock ? 'Net-to-Buy' : 'Multibuy Qty'}
                        </th>
                        <th className="py-2.5 px-3 text-right font-medium">Subtotal</th>
                        <th className="py-2.5 px-3 text-left font-medium">1-Jump Check</th>
                        <th className="py-2.5 px-3 text-right font-medium">30d</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {enrichedShopping.rows.map((line) => {
                        const fullyCovered = deductHangarStock && line.netQty === 0;
                        return (
                          <tr
                            key={line.typeId}
                            className={
                              fullyCovered
                                ? 'bg-emerald-500/5 text-slate-500'
                                : 'hover:bg-slate-800/30'
                            }
                          >
                            <td className="py-2.5 px-3 text-slate-200 font-medium">
                              <span>{line.name}</span>
                              {line.addedByAdvisor && (
                                <span className="ml-2 text-[11px] font-normal text-cyan-400">
                                  · Advisor
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                              {line.quantity.toLocaleString('en-US')}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {line.onHandTotal > 0 ? (
                                <span
                                  className="text-cyan-300"
                                  title={`Jita: ${line.onHandJita.toLocaleString()} · Ishisomo: ${line.onHandIshisomo.toLocaleString()}`}
                                >
                                  {line.onHandTotal.toLocaleString('en-US')}
                                </span>
                              ) : (
                                <span className="text-slate-600">0</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                              {fullyCovered ? (
                                <span className="text-emerald-400">0 (In Stock)</span>
                              ) : (
                                <span className="text-slate-100">
                                  {(deductHangarStock ? line.netQty : line.quantity).toLocaleString('en-US')}
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-amber-300">
                              {formatIsk(deductHangarStock ? line.effectiveCost : line.totalCostJita)}
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
                              </button>
                            </td>
                          </tr>
                        );
                      })}
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

              {/* View Switcher: Inspection View vs Order Book View */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setDrawerView('inspection')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium cursor-pointer ${
                      drawerView === 'inspection'
                        ? 'bg-cyan-500/20 text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Table2 className="w-3.5 h-3.5" />
                    <span>Inspection View</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerView('orderbook')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded font-medium cursor-pointer ${
                      drawerView === 'orderbook'
                        ? 'bg-emerald-500/20 text-emerald-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span>Order Book View</span>
                  </button>
                </div>

                {card.engine === 'reprocessing' && appSettings && (
                  <div className="text-[11px] font-mono text-slate-400">
                    3-Stage Refining: Refine{' '}
                    <strong className="text-cyan-300">
                      {appSettings.refiningLocationRule === 'same_station'
                        ? 'At Pickup Station'
                        : appSettings.refiningLocationRule === 'within_x_jumps'
                          ? `Within ${appSettings.refiningMaxJumps}j`
                          : EMPIRE_HUB_MAP[appSettings.refiningHubId]?.shortLabel}
                    </strong>{' '}
                    → Sell{' '}
                    <strong className="text-emerald-300">
                      {appSettings.refiningSellRule === 'same_as_refine'
                        ? 'At Refine Station'
                        : appSettings.refiningSellRule === 'back_at_buy'
                          ? 'Back at Buy Hub'
                          : `Within ${appSettings.refiningSellMaxJumps}j`}
                    </strong>
                  </div>
                )}
              </div>

              {drawerView === 'inspection' ? (
                <>
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

                  {/* Per-Output Alternative Max-Profit Destinations (Reprocessing Cards) */}
                  {card.engine === 'reprocessing' && altOutputOptions.length > 0 && (
                    <div className="border border-cyan-500/30 rounded-lg bg-[#111722] p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-cyan-200">
                            Per-Output Alternative Max-Profit Destinations
                          </div>
                          <div className="text-[11px] text-slate-400">
                            Compare base refining sell hub against highest-paying alternative Empire hub per mineral output.
                          </div>
                        </div>
                        <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-300">
                          <span>Extra-Effort Profit Target (M ISK):</span>
                          <input
                            type="number"
                            min={0}
                            step={0.5}
                            value={Number((extraEffortTargetIsk / 1_000_000).toFixed(2))}
                            onChange={(e) =>
                              setExtraEffortTargetIsk(Math.max(0, Number(e.target.value) || 0) * 1_000_000)
                            }
                            className="w-20 bg-[#0b0e14] border border-slate-700 rounded px-2 py-0.5 font-mono text-xs text-slate-100"
                          />
                        </label>
                      </div>

                      <div className="overflow-x-auto border border-slate-800 rounded">
                        <table className="w-full text-[11px] border-collapse">
                          <thead>
                            <tr className="bg-[#0d121a] border-b border-slate-800 text-slate-400">
                              <th className="py-2 px-2.5 text-left">Refined Output</th>
                              <th className="py-2 px-2.5 text-left">Best Alt Hub</th>
                              <th className="py-2 px-2.5 text-right">Extra Gain</th>
                              <th className="py-2 px-2.5 text-right">Extra Jumps</th>
                              <th className="py-2 px-2.5 text-right">Transport Headroom</th>
                              <th className="py-2 px-2.5 text-right">Lock-In</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/70">
                            {altOutputOptions.map((opt) => {
                              const headroom = opt.extraGainIsk - extraEffortTargetIsk;
                              const isLocked = Boolean(lockedOutputIds[opt.outputTypeId]);
                              return (
                                <tr key={opt.outputTypeId} className={isLocked ? 'bg-cyan-500/10' : ''}>
                                  <td className="py-2 px-2.5 text-slate-200 font-medium">{opt.outputName}</td>
                                  <td className="py-2 px-2.5">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-slate-200">{opt.altDestName}</span>
                                      {opt.altDestHubId !== opt.baseDestHubId && (
                                        <a
                                          href={getDotlanRouteUrl(
                                            EMPIRE_HUB_MAP[opt.baseDestHubId]?.systemName || 'Jita',
                                            EMPIRE_HUB_MAP[opt.altDestHubId]?.systemName || 'Amarr'
                                          )}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-cyan-400 hover:text-cyan-300"
                                          title="Open route in DOTLAN"
                                        >
                                          <Compass className="w-3 h-3" />
                                        </a>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-2 px-2.5 text-right font-mono text-emerald-400">
                                    +{formatIsk(opt.extraGainIsk)}
                                  </td>
                                  <td className="py-2 px-2.5 text-right font-mono text-slate-300">
                                    {opt.extraJumps}j
                                  </td>
                                  <td
                                    className={`py-2 px-2.5 text-right font-mono ${
                                      headroom >= 0 ? 'text-cyan-300' : 'text-rose-400'
                                    }`}
                                  >
                                    {headroom >= 0 ? `+${formatIsk(headroom)}` : formatIsk(headroom)}
                                  </td>
                                  <td className="py-2 px-2.5 text-right">
                                    <button
                                      type="button"
                                      disabled={opt.altDestHubId === opt.baseDestHubId}
                                      onClick={() =>
                                        setLockedOutputIds((prev) => ({
                                          ...prev,
                                          [opt.outputTypeId]: !prev[opt.outputTypeId],
                                        }))
                                      }
                                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-medium cursor-pointer disabled:opacity-35 ${
                                        isLocked
                                          ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                                          : 'border-slate-700 bg-[#0b0e14] text-slate-300 hover:border-cyan-400/50'
                                      }`}
                                    >
                                      <Lock className="w-2.5 h-2.5" />
                                      <span>{isLocked ? 'Locked' : 'Lock Alt'}</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <LiveOrderBookPanel
                    card={card}
                    profile={profile}
                    eveAccessToken={eveAccessToken}
                    appSettings={appSettings}
                    onOpenSsoSettings={onOpenSsoSettings}
                  />
                </div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
