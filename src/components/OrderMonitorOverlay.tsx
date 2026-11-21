import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCw,
  ShieldAlert,
  TrendingUp,
  X,
} from 'lucide-react';
import { formatIsk } from '../engines/decisionEngines.ts';
import type { OrderMonitorSnapshot, PilotProfile } from '../types/eve.ts';
import {
  computeEve4SigFigTick,
  computeRelistFeePreview,
} from '../utils/eveMarketMath.ts';
import { copyTextToClipboard } from '../utils/eveMultibuy.ts';

interface OrderMonitorOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  profile: PilotProfile;
  eveAccessToken: string | null;
  data: OrderMonitorSnapshot | null;
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onOpenEveMarketWindow: (typeId: number) => Promise<void>;
  onOpenSsoSetup: () => void;
}

type OrderFilter = 'all' | 'undercut' | 'sell' | 'buy';

function buildSimulationOrderMonitor(): OrderMonitorSnapshot {
  const now = Date.now();
  return {
    orders: [
      {
        orderId: 69000101,
        typeId: 24519,
        itemName: 'Scourge Fury Heavy Missile',
        regionId: 10000032,
        regionName: 'Sinq Laison (Dodixie)',
        locationId: 60011866,
        stationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
        isBuyOrder: false,
        myPrice: 126.5,
        marketBestPrice: 124.2,
        isUndercut: true,
        suggestedReclaimPrice: 124.1,
        deltaIsk: -2.4,
        competitorsAhead: 2,
        volumeRemain: 84_000,
        volumeTotal: 120_000,
        issued: new Date(now - 6 * 3600_000).toISOString(),
      },
      {
        orderId: 69000102,
        typeId: 2456,
        itemName: 'Hobgoblin II',
        regionId: 10000032,
        regionName: 'Sinq Laison (Dodixie)',
        locationId: 60011866,
        stationName: 'Dodixie IX - Moon 20 - Federation Navy Assembly Plant',
        isBuyOrder: false,
        myPrice: 1_195_000,
        marketBestPrice: 1_189_000,
        isUndercut: true,
        suggestedReclaimPrice: 1_188_000,
        deltaIsk: -7_000,
        competitorsAhead: 1,
        volumeRemain: 65,
        volumeTotal: 110,
        issued: new Date(now - 11 * 3600_000).toISOString(),
      },
      {
        orderId: 69000103,
        typeId: 4051,
        itemName: 'Nitrogen Fuel Block',
        regionId: 10000002,
        regionName: 'The Forge (Jita)',
        locationId: 60003760,
        stationName: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant',
        isBuyOrder: true,
        myPrice: 17_450,
        marketBestPrice: 17_450,
        isUndercut: false,
        suggestedReclaimPrice: 17_450,
        deltaIsk: 0,
        competitorsAhead: 0,
        volumeRemain: 4_500,
        volumeTotal: 8_000,
        issued: new Date(now - 4 * 3600_000).toISOString(),
      },
    ],
    undercutCount: 2,
    recentTransactions: [
      {
        transactionId: 910001,
        date: new Date(now - 2 * 3600_000).toISOString(),
        typeId: 24519,
        itemName: 'Scourge Fury Heavy Missile',
        quantity: 36_000,
        unitPrice: 126.5,
        totalIsk: 4_554_000,
        isBuy: false,
        locationId: 60011866,
      },
      {
        transactionId: 910002,
        date: new Date(now - 5 * 3600_000).toISOString(),
        typeId: 2456,
        itemName: 'Hobgoblin II',
        quantity: 45,
        unitPrice: 1_195_000,
        totalIsk: 53_775_000,
        isBuy: false,
        locationId: 60011866,
      },
      {
        transactionId: 910003,
        date: new Date(now - 9 * 3600_000).toISOString(),
        typeId: 4051,
        itemName: 'Nitrogen Fuel Block',
        quantity: 3_500,
        unitPrice: 17_450,
        totalIsk: 61_075_000,
        isBuy: true,
        locationId: 60003760,
      },
    ],
    realizedRevenue24hIsk: 58_329_000,
    realizedSpend24hIsk: 61_075_000,
    realizedProfit24hIsk: 11_420_000,
    realizedProfit7dIsk: 84_650_000,
    syncedAt: new Date(now).toISOString(),
  };
}

export function OrderMonitorOverlay({
  isOpen,
  onClose,
  profile,
  eveAccessToken,
  data,
  isLoading,
  error,
  onRefresh,
  onOpenEveMarketWindow,
  onOpenSsoSetup,
}: OrderMonitorOverlayProps) {
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [copiedOrderId, setCopiedOrderId] = useState<number | null>(null);
  const [openingTypeId, setOpeningTypeId] = useState<number | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    };
  }, []);

  const simSnapshot = useMemo(() => buildSimulationOrderMonitor(), []);
  const activeSnapshot = profile.mode === 'eve_sso' ? data : simSnapshot;

  const filteredOrders = useMemo(() => {
    const list = activeSnapshot?.orders ?? [];
    if (filter === 'undercut') return list.filter((o) => o.isUndercut);
    if (filter === 'sell') return list.filter((o) => !o.isBuyOrder);
    if (filter === 'buy') return list.filter((o) => o.isBuyOrder);
    return list;
  }, [activeSnapshot, filter]);

  if (!isOpen) return null;

  const handleCopyReclaimPrice = async (orderId: number, price: number) => {
    const ok = await copyTextToClipboard(String(price));
    if (!ok) return;
    setCopiedOrderId(orderId);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedOrderId(null), 1800);
  };

  const handleOpenInEve = async (typeId: number) => {
    if (!eveAccessToken) {
      onOpenSsoSetup();
      return;
    }
    setOpeningTypeId(typeId);
    try {
      await onOpenEveMarketWindow(typeId);
    } finally {
      setOpeningTypeId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-label="Order Monitor — Undercut and Realized Fill Tracker"
    >
      <div className="flex-1" onClick={onClose} aria-hidden="true" />
      <div className="w-full max-w-5xl bg-[#0d1118] border-l border-slate-800 h-full flex flex-col shadow-2xl">
        {/* Overlay Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 shrink-0 bg-[#0b0e14]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-cyan-400 font-medium">
              <Activity className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Order Monitor Overlay · Undercut &amp; Realized Fill Tracker</span>
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-100 mt-0.5">
              Active Market Orders &amp; Wallet Realized Profit
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {profile.mode === 'eve_sso' ? (
              <button
                type="button"
                onClick={onRefresh}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors cursor-pointer"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{isLoading ? 'Checking Books...' : 'Scan Live Undercuts'}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenSsoSetup}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25 transition-colors cursor-pointer"
              >
                <span>Connect EVE SSO for Live Orders</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Order Monitor overlay"
              className="p-2 rounded-md text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {profile.mode !== 'eve_sso' && (
            <div className="px-4 py-3 rounded-lg border border-amber-500/35 bg-amber-500/10 text-xs text-amber-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
                <span>
                  Previewing simulated order book telemetry. Connect EVE SSO (`esi-markets.read_character_orders.v1` + `esi-wallet.read_character_wallet.v1`) to track your live character orders and realized fills.
                </span>
              </div>
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200">
              {error}
            </div>
          )}

          {/* KPI Summary Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 border border-slate-800 rounded-lg divide-y md:divide-y-0 md:divide-x divide-slate-800 bg-[#131822]">
            <div className="p-4">
              <div className="text-[11px] text-slate-400">Active Orders</div>
              <div className="font-mono tabular-nums text-lg font-semibold text-slate-100 mt-1">
                {(activeSnapshot?.orders.length ?? 0).toLocaleString('en-US')}
              </div>
            </div>
            <div className="p-4">
              <div className="text-[11px] text-slate-400">Undercut Alerts</div>
              <div
                className={`font-mono tabular-nums text-lg font-semibold mt-1 ${
                  (activeSnapshot?.undercutCount ?? 0) > 0 ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {activeSnapshot?.undercutCount ?? 0} Undercut
              </div>
            </div>
            <div className="p-4">
              <div className="text-[11px] text-slate-400">24h Realized Profit (Est.)</div>
              <div
                className={`font-mono tabular-nums text-lg font-semibold mt-1 ${
                  (activeSnapshot?.realizedProfit24hIsk ?? 0) >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {(activeSnapshot?.realizedProfit24hIsk ?? 0) >= 0 ? '+' : ''}
                {formatIsk(activeSnapshot?.realizedProfit24hIsk ?? 0)}
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                24h Sales: {formatIsk(activeSnapshot?.realizedRevenue24hIsk ?? 0)}
              </div>
            </div>
            <div className="p-4">
              <div className="text-[11px] text-slate-400">7d Realized Profit (Est.)</div>
              <div
                className={`font-mono tabular-nums text-lg font-semibold mt-1 ${
                  (activeSnapshot?.realizedProfit7dIsk ?? 0) >= 0
                    ? 'text-emerald-400'
                    : 'text-rose-400'
                }`}
              >
                {(activeSnapshot?.realizedProfit7dIsk ?? 0) >= 0 ? '+' : ''}
                {formatIsk(activeSnapshot?.realizedProfit7dIsk ?? 0)}
              </div>
              <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                EVE 4-sig-fig tick advisor
              </div>
            </div>
          </div>

          {/* Active Orders Filter & Table */}
          <div className="bg-[#131822] border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#0e131b]">
              <h3 className="font-display text-sm font-semibold text-slate-100">
                Live Order Book Position &amp; Reclaim Price Calculator
              </h3>
              <div className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 text-xs">
                {(
                  [
                    { id: 'all', label: `All (${activeSnapshot?.orders.length ?? 0})` },
                    { id: 'undercut', label: `Undercut (${activeSnapshot?.undercutCount ?? 0})` },
                    { id: 'sell', label: 'Sell Orders' },
                    { id: 'buy', label: 'Buy Orders' },
                  ] as { id: OrderFilter; label: string }[]
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                      filter === tab.id
                        ? tab.id === 'undercut'
                          ? 'bg-rose-500/20 text-rose-200'
                          : 'bg-cyan-500/20 text-cyan-200'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {filteredOrders.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                {isLoading
                  ? 'Scanning live EVE ESI order books across your active orders...'
                  : 'No active orders match this filter.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#0e131b]/70 border-b border-slate-800 text-slate-400">
                      <th className="py-2.5 px-3 text-left font-medium">Item / Hub</th>
                      <th className="py-2.5 px-2.5 text-left font-medium">Side</th>
                      <th className="py-2.5 px-2.5 text-right font-medium">Remain</th>
                      <th className="py-2.5 px-3 text-right font-medium">My Price</th>
                      <th className="py-2.5 px-3 text-right font-medium">Top of Book</th>
                      <th className="py-2.5 px-3 text-right font-medium">Reclaim Price / Delta</th>
                      <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {filteredOrders.map((order) => {
                      const exactTick = order.isUndercut
                        ? computeEve4SigFigTick(
                            order.marketBestPrice,
                            order.isBuyOrder ? 'outbid_buy' : 'undercut_sell'
                          )
                        : order.myPrice;
                      const relistPreview = order.isUndercut
                        ? computeRelistFeePreview({
                            oldPrice: order.myPrice,
                            newPrice: exactTick,
                            volumeRemain: order.volumeRemain,
                            isBuyOrder: order.isBuyOrder,
                            brokerRelationsLvl: profile.skills.brokerRelations,
                            advBrokerRelationsLvl: profile.skills.advancedBrokerRelations ?? 0,
                            accountingLvl: profile.skills.accounting,
                          })
                        : null;
                      const isRowSelected = selectedOrderId === order.orderId;

                      return (
                      <tr
                        key={order.orderId}
                        onClick={() => setSelectedOrderId(order.orderId)}
                        className={`cursor-pointer transition-all ${
                          isRowSelected
                            ? 'bg-cyan-500/12 shadow-[inset_3px_0_0_#22d3ee,inset_0_1px_10px_rgba(34,211,238,0.12)]'
                            : order.isUndercut
                              ? 'bg-rose-500/5 hover:bg-rose-500/10'
                              : 'hover:bg-slate-800/30'
                        }`}
                      >
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-100">{order.itemName}</div>
                          <div
                            className="text-[10px] text-slate-400 truncate max-w-[260px]"
                            title={order.stationName}
                          >
                            {order.regionName} · {order.stationName}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          <span
                            className={`inline-block font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              order.isBuyOrder
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                                : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                            }`}
                          >
                            {order.isBuyOrder ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {order.volumeRemain.toLocaleString('en-US')}
                          <span className="text-slate-500">
                            /{order.volumeTotal.toLocaleString('en-US')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          {formatIsk(order.myPrice, false)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          <span className={order.isUndercut ? 'text-rose-300 font-semibold' : 'text-emerald-400'}>
                            {formatIsk(order.marketBestPrice, false)}
                          </span>
                          {order.competitorsAhead > 0 && (
                            <div className="text-[10px] text-rose-400">
                              {order.competitorsAhead} ahead
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                          {order.isUndercut && relistPreview ? (
                            <div>
                              <div className="inline-flex items-center gap-1 text-amber-300 font-semibold">
                                <AlertTriangle className="w-3 h-3 text-rose-400" aria-hidden="true" />
                                <span>{formatIsk(exactTick, false)}</span>
                              </div>
                              <div className="text-[10px] text-slate-400">
                                Relist Fee: <span className="text-amber-300">{formatIsk(relistPreview.modificationFeeIsk)}</span>
                                {relistPreview.estimatedNetMarginPct !== null && (
                                  <span
                                    className={`ml-1.5 ${
                                      relistPreview.unprofitableWarning ? 'text-rose-400 font-bold' : 'text-emerald-400'
                                    }`}
                                  >
                                    ({relistPreview.estimatedNetMarginPct.toFixed(1)}% net)
                                  </span>
                                )}
                              </div>
                              {relistPreview.unprofitableWarning && (
                                <div className="mt-0.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/50 text-[9px] font-bold text-rose-300 animate-pulse">
                                  UNPROFITABLE AFTER RELIST
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-emerald-400 font-medium">
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>Top of Book</span>
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="inline-flex items-center gap-1.5">
                            {order.isUndercut && (
                              <button
                                type="button"
                                onClick={() => handleCopyReclaimPrice(order.orderId, exactTick)}
                                title={`Copy exact 4-sig-fig tick (${exactTick}) · Relist fee ${
                                  relistPreview ? formatIsk(relistPreview.modificationFeeIsk) : '100 ISK'
                                } (${relistPreview?.relistDiscountPct.toFixed(0)}% Adv Broker disc)`}
                                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors cursor-pointer ${
                                  copiedOrderId === order.orderId
                                    ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                                    : relistPreview?.unprofitableWarning
                                      ? 'border-rose-500/60 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25'
                                      : 'border-amber-500/40 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20'
                                }`}
                              >
                                {copiedOrderId === order.orderId ? (
                                  <Check className="w-3 h-3" aria-hidden="true" />
                                ) : (
                                  <Copy className="w-3 h-3" aria-hidden="true" />
                                )}
                                <span>
                                  {copiedOrderId === order.orderId ? 'Copied Tick' : 'Copy Tick Price'}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleOpenInEve(order.typeId)}
                              disabled={openingTypeId === order.typeId}
                              title="Open item Market Details window inside EVE Online client"
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-700 bg-[#0b0e14] text-cyan-300 hover:border-cyan-400/60 text-[11px] font-medium transition-colors cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3" aria-hidden="true" />
                              <span>EVE</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Recent Wallet Fills / Transactions */}
          <div className="bg-[#131822] border border-slate-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 bg-[#0e131b]">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <h3 className="font-display text-sm font-semibold text-slate-100">
                  Recent Wallet Fills &amp; Transactions
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {(activeSnapshot?.recentTransactions.length ?? 0)} recent fills
              </span>
            </div>

            {(activeSnapshot?.recentTransactions.length ?? 0) === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">
                No recent wallet market transactions recorded.
              </div>
            ) : (
              <div className="overflow-x-auto max-h-[280px] overflow-y-auto">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#0e131b]/70 border-b border-slate-800 text-slate-400 sticky top-0">
                      <th className="py-2 px-3 text-left font-medium">Time (UTC)</th>
                      <th className="py-2 px-3 text-left font-medium">Type</th>
                      <th className="py-2 px-3 text-left font-medium">Item</th>
                      <th className="py-2 px-3 text-right font-medium">Qty</th>
                      <th className="py-2 px-3 text-right font-medium">Unit Price</th>
                      <th className="py-2 px-3 text-right font-medium">Total ISK</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {(activeSnapshot?.recentTransactions ?? []).map((tx) => (
                      <tr key={tx.transactionId} className="hover:bg-slate-800/30">
                        <td className="py-2 px-3 font-mono tabular-nums text-[11px] text-slate-400 whitespace-nowrap">
                          {new Date(tx.date).toISOString().replace('T', ' ').slice(5, 16)}
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap">
                          <span
                            className={`font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              tx.isBuy
                                ? 'bg-slate-800 text-slate-300'
                                : 'bg-emerald-500/15 text-emerald-300'
                            }`}
                          >
                            {tx.isBuy ? 'BOUGHT' : 'SOLD'}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-slate-100 font-medium">{tx.itemName}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-300">
                          {tx.quantity.toLocaleString('en-US')}
                        </td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-400">
                          {formatIsk(tx.unitPrice, false)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono tabular-nums font-medium ${
                            tx.isBuy ? 'text-amber-300' : 'text-emerald-400'
                          }`}
                        >
                          {tx.isBuy ? '-' : '+'}
                          {formatIsk(tx.totalIsk)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
