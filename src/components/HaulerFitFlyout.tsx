import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Navigation,
  ShieldAlert,
  ShieldCheck,
  Truck,
  X,
} from 'lucide-react';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import { suggestOptimalHaulerAndFit } from '../utils/eveMarketMath.ts';
import type { MarketSnapshot, PilotProfile } from '../types/eve.ts';

export interface HaulerFlyoutContext {
  title: string;
  rawInputM3: number;
  packagedOutputM3: number;
  cargoValueIsk: number;
  originSystemId: number;
  destSystemId: number;
  originName: string;
  destName: string;
}

interface HaulerFitFlyoutProps {
  context: HaulerFlyoutContext | null;
  profile: PilotProfile;
  snapshot: MarketSnapshot;
  onClose: () => void;
}

export const HaulerFitFlyout: React.FC<HaulerFitFlyoutProps> = ({
  context,
  profile,
  snapshot,
  onClose,
}) => {
  const [routeJumps, setRouteJumps] = useState<number | null>(null);
  const [minSecurity, setMinSecurity] = useState<number>(0.7);
  const [hotWarningCount, setHotWarningCount] = useState<number>(0);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!context) return;
    if (context.originSystemId === context.destSystemId) {
      setRouteJumps(0);
      setMinSecurity(0.9);
      setHotWarningCount(0);
      return;
    }

    let cancelled = false;
    setLoadingRoute(true);

    (async () => {
      try {
        const res = await fetch('/api/route/distances', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pairs: [{ origin: context.originSystemId, destination: context.destSystemId }],
            preference: 'Safer',
          }),
        });
        if (!res.ok) throw new Error('route fetch failed');
        const json = (await res.json()) as {
          distances?: Record<string, number>;
          waypointsByPair?: Record<string, number[]>;
          hotSystemsByPair?: Record<string, { systemId: number }[]>;
        };
        const pairKey = `${context.originSystemId}:${context.destSystemId}`;
        const jumps = json.distances?.[pairKey] ?? 4;
        const waypoints = json.waypointsByPair?.[pairKey] ?? [];
        const hotCount = json.hotSystemsByPair?.[pairKey]?.length ?? 0;

        let lowestSec = 0.7;
        if (waypoints.length > 0) {
          const coordRes = await fetch('/api/route/system-coords', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ systemIds: waypoints.slice(0, 60) }),
          });
          if (coordRes.ok) {
            const coordJson = (await coordRes.json()) as {
              systems?: Record<number, { securityStatus?: number }>;
            };
            const secs = Object.values(coordJson.systems ?? {})
              .map((s) => s.securityStatus)
              .filter((v): v is number => typeof v === 'number');
            if (secs.length > 0) {
              lowestSec = Math.min(...secs);
            }
          }
        }

        if (!cancelled) {
          setRouteJumps(jumps);
          setMinSecurity(Number(lowestSec.toFixed(2)));
          setHotWarningCount(hotCount);
        }
      } catch {
        if (!cancelled) {
          setRouteJumps(context.originSystemId === context.destSystemId ? 0 : 6);
          setMinSecurity(0.6);
          setHotWarningCount(0);
        }
      } finally {
        if (!cancelled) setLoadingRoute(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [context]);

  const suggestion = useMemo(() => {
    if (!context) return null;
    return suggestOptimalHaulerAndFit({
      rawInputM3: context.rawInputM3,
      packagedOutputM3: context.packagedOutputM3,
      cargoIskValue: context.cargoValueIsk,
      originSystemName: context.originName,
      destSystemName: context.destName,
      jumpCount: routeJumps ?? 4,
      routeMinSec: minSecurity,
      ownedHulls: profile.hulls ?? [],
      snapshot,
    });
  }, [context, routeJumps, minSecurity, profile.hulls, snapshot]);

  if (!context || !suggestion) return null;

  const gankRiskLevel: 'high' | 'moderate' | 'low' =
    minSecurity < 0.45 || context.cargoValueIsk >= 1_000_000_000
      ? 'high'
      : context.cargoValueIsk >= 150_000_000
        ? 'moderate'
        : 'low';

  const handleCopyFit = async () => {
    try {
      await navigator.clipboard.writeText(suggestion.multibuyText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard blocked
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-[2px]">
      <div className="w-full max-w-lg h-full bg-[#0c111a] border-l border-slate-700/80 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 bg-slate-900/95 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Truck className="w-4 h-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-100 truncate">
                Hauling Planner &amp; Smart Hull Fit
              </h3>
              <p className="text-[11px] text-slate-400 truncate">{context.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Volume & Route Telemetry */}
          <div className="grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Raw Inputs Volume</div>
              <div className="font-mono font-bold text-sm text-cyan-300 mt-0.5">
                {formatM3(context.rawInputM3)}
              </div>
              <div className="text-[10px] text-slate-500 mt-0.5">
                Packaged Output: <span className="font-mono text-slate-300">{formatM3(context.packagedOutputM3)}</span>
              </div>
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Cargo Value &amp; Risk</div>
              <div className="font-mono font-bold text-sm text-amber-300 mt-0.5">
                {formatIsk(context.cargoValueIsk)}
              </div>
              <div className="text-[10px] mt-0.5 flex items-center gap-1">
                {gankRiskLevel === 'high' ? (
                  <span className="text-rose-400 font-semibold flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3" /> High Gank Risk
                  </span>
                ) : gankRiskLevel === 'moderate' ? (
                  <span className="text-amber-300 font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Moderate Gank Risk
                  </span>
                ) : (
                  <span className="text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" /> Low Gank Risk
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* ESI Route Security Check */}
          <div className="rounded-lg border border-slate-800 bg-[#0a0f18] p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <Navigation className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-semibold text-slate-200">
                {context.originName} → {context.destName}
              </span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-200">
                {loadingRoute ? 'Routing…' : `${routeJumps ?? 0} jumps (Safer)`}
              </span>
              <span
                className={`px-2 py-0.5 rounded border ${
                  minSecurity < 0.5
                    ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}
              >
                Min Sec: {minSecurity.toFixed(2)}
              </span>
              {hotWarningCount > 0 && (
                <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300">
                  {hotWarningCount} Hot Sys
                </span>
              )}
            </div>
          </div>

          {/* Owned Hangar Hull Trip Check */}
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
              Your Hangar Hauler Check (ESI Assets)
            </div>
            {suggestion.ownedHullName ? (
              <div className="flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-semibold text-slate-100">{suggestion.ownedHullName}</div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    Capacity: {formatM3(suggestion.ownedHullCapM3)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-bold text-sm text-cyan-300">
                    {suggestion.ownedHullTrips} trip{suggestion.ownedHullTrips > 1 ? 's' : ''}
                  </div>
                  <div className="text-[10px] text-slate-400">required for load</div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                No haulers detected in your synced ESI assets yet. Connect EVE SSO or see the recommended hull below.
              </p>
            )}
          </div>

          {/* Smart Suggested Hull & Fit */}
          <div className="rounded-lg border border-amber-500/35 bg-amber-950/15 p-3 space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-amber-400 font-bold">
                  Recommended Optimal Hull Class · {suggestion.recommendedClassLabel}
                </div>
                <div className="text-sm font-bold text-slate-100 mt-0.5">
                  {suggestion.recommendedHullName}{' '}
                  <span className="text-xs font-mono font-normal text-slate-400">
                    ({formatM3(suggestion.recommendedHullCapM3)})
                  </span>
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-[10px] text-slate-400">Est. Jita Hull+Fit</div>
                <div className="text-sm font-bold text-amber-300">
                  {formatIsk(suggestion.totalFitCostIsk)}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">{suggestion.gankRiskReason}</p>
            <div className="text-[10px] font-mono text-slate-400">
              Recommended Hull Trips:{' '}
              <span className="text-emerald-300 font-bold">{suggestion.recommendedTrips}</span>
            </div>
          </div>

          {/* Standard Travel / Tank / Cargo Fit Modules Table */}
          <div className="rounded-lg border border-slate-800 bg-[#080d14] overflow-hidden">
            <div className="px-3 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
                Standard Travel / Tank / Cargo Fit (Live Jita Sell)
              </span>
              <span className="text-[10px] font-mono text-slate-400">
                Hull: {formatIsk(suggestion.indicativeHullCostIsk)}
              </span>
            </div>
            <table className="w-full text-xs font-mono">
              <thead className="bg-slate-900/60 text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="text-left px-3 py-1.5">Slot / Module</th>
                  <th className="text-right px-2 py-1.5">Qty</th>
                  <th className="text-right px-3 py-1.5">Jita Est.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {suggestion.fitModules.map((mod) => {
                  const isHull = mod.slot === 'Hull';
                  return (
                    <tr
                      key={`${mod.typeId}-${mod.slot}-${mod.name}`}
                      className={isHull ? 'bg-amber-500/5' : undefined}
                    >
                      <td className="px-3 py-1.5 font-sans">
                        <span
                          className={`text-[9px] uppercase px-1 py-0.5 rounded mr-1.5 ${
                            isHull
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {mod.slot}
                        </span>
                        <span className={isHull ? 'text-slate-100 font-semibold' : 'text-slate-200'}>
                          {mod.name}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right text-slate-300">{mod.qty}</td>
                      <td
                        className={`px-3 py-1.5 text-right ${
                          isHull ? 'text-amber-300' : 'text-slate-300'
                        }`}
                      >
                        {formatIsk(mod.totalPriceIsk)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer Action */}
        <div className="px-4 py-3 bg-slate-900/95 border-t border-slate-800 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleCopyFit}
            className="flex-1 inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold bg-amber-500/20 border border-amber-400/50 text-amber-200 hover:bg-amber-500/30 transition-colors cursor-pointer"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4 text-emerald-400" />
                Copied Hull + Fit for EVE Multi-Buy!
              </>
            ) : (
              <>
                <ClipboardCopy className="w-4 h-4" />
                Copy Hull + Fit for EVE Multi-Buy
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
