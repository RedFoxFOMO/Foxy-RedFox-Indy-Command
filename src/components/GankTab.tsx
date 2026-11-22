import { useMemo, useState } from 'react';
import {
  Crosshair,
  Flame,
  Radar,
  Search,
  ShieldAlert,
  ShieldCheck,
  Skull,
  Zap,
} from 'lucide-react';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import {
  GANK_HULL_CATALOG,
  evaluateGankEngagement,
  parseScannedCargoAndFitText,
} from '../utils/v22Engines.ts';
import type {
  AppSettingsV22,
  GankHullStats,
  GankPilotIntel,
  MarketSnapshot,
  PilotProfile,
} from '../types/eve.ts';
import { InfoTip } from './InfoTip.tsx';

interface GankTabProps {
  profile: PilotProfile;
  snapshot: MarketSnapshot;
  appSettings: AppSettingsV22;
}

export function GankTab({ profile, snapshot, appSettings }: GankTabProps) {
  const ownHullOptions = useMemo<GankHullStats[]>(() => {
    const synced: GankHullStats[] = (profile.hulls || []).map((h) => {
      const base =
        GANK_HULL_CATALOG.find((g) =>
          (h.shipTypeName || h.name).toLowerCase().includes(g.name.split(' ')[0].toLowerCase())
        ) ?? GANK_HULL_CATALOG[3];
      return {
        ...base,
        id: `synced:${h.id}`,
        name: `${h.name}${h.isActiveShip ? ' [Active Ship]' : ' [ESI Synced]'}`,
        cargoM3: h.capacityM3,
        ehp: h.isTanked ? Math.round(base.ehp * 1.15) : base.ehp,
      };
    });
    return [...synced, ...GANK_HULL_CATALOG];
  }, [profile.hulls]);

  const [ownHullId, setOwnHullId] = useState<string>(ownHullOptions[0]?.id ?? 'bustard_dst');
  const [targetHullId, setTargetHullId] = useState<string>('catalyst_gank');
  const [pilotQuery, setPilotQuery] = useState<string>('');
  const [pilotIntel, setPilotIntel] = useState<GankPilotIntel | null>(null);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [ownCargoIsk, setOwnCargoIsk] = useState<number>(250_000_000);
  const [targetCargoManualIsk, setTargetCargoManualIsk] = useState<number>(180_000_000);
  const [scanPasteText, setScanPasteText] = useState<string>('');

  const ownHull = useMemo(
    () => ownHullOptions.find((h) => h.id === ownHullId) ?? GANK_HULL_CATALOG[3],
    [ownHullOptions, ownHullId]
  );
  const targetHull = useMemo(
    () => GANK_HULL_CATALOG.find((h) => h.id === targetHullId) ?? GANK_HULL_CATALOG[0],
    [targetHullId]
  );

  const parsedScan = useMemo(
    () => parseScannedCargoAndFitText(scanPasteText, snapshot),
    [scanPasteText, snapshot]
  );

  const effectiveTargetCargoIsk =
    parsedScan.estimatedCargoIsk > 0 ? parsedScan.estimatedCargoIsk : targetCargoManualIsk;

  const evaluation = useMemo(
    () =>
      evaluateGankEngagement({
        ownHull,
        targetHull,
        targetPilot: pilotIntel,
        targetCargoIsk: effectiveTargetCargoIsk,
        ownCargoIsk,
      }),
    [ownHull, targetHull, pilotIntel, effectiveTargetCargoIsk, ownCargoIsk]
  );

  const handleLookupPilot = async () => {
    const clean = pilotQuery.trim();
    if (!clean) return;
    setIsLookingUp(true);
    setLookupError(null);
    try {
      const res = await fetch('/api/gank/pilot-intel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterName: clean }),
      });
      const json = (await res.json()) as GankPilotIntel & { error?: string };
      if (!res.ok) {
        setLookupError(json.error || `Pilot lookup returned HTTP ${res.status}`);
        return;
      }
      setPilotIntel(json);
    } catch {
      setLookupError('Unable to reach pilot intel lookup service.');
    } finally {
      setIsLookingUp(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Top Matchup Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Your Hull */}
        <div className="bg-[#10151f] border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>Your Hull (ESI Synced + Presets)</span>
            </h3>
            <span className="font-mono text-[11px] text-slate-400">{ownHull.hullClass}</span>
          </div>

          <select
            value={ownHullId}
            onChange={(e) => setOwnHullId(e.target.value)}
            className="w-full bg-[#0b0e14] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100"
          >
            {ownHullOptions.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.hullClass})
              </option>
            ))}
          </select>

          <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
            <div className="bg-[#0b0e14] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">EHP</div>
              <div className="text-slate-100 font-semibold">{ownHull.ehp.toLocaleString('en-US')}</div>
            </div>
            <div className="bg-[#0b0e14] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">DPS / Alpha</div>
              <div className="text-cyan-300 font-semibold">{ownHull.dps} / {ownHull.alphaDps}</div>
            </div>
            <div className="bg-[#0b0e14] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Speed / Align</div>
              <div className="text-slate-200">{ownHull.maxSpeedMs} m/s · {ownHull.alignSec}s</div>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 text-xs">
            <label htmlFor="own-cargo-isk" className="text-slate-400">
              Your Cargo Value at Risk (ISK):
            </label>
            <input
              id="own-cargo-isk"
              type="number"
              min={0}
              step={10_000_000}
              value={ownCargoIsk}
              onChange={(e) => setOwnCargoIsk(Math.max(0, Number(e.target.value) || 0))}
              className="w-36 bg-[#0b0e14] border border-slate-700 rounded px-2.5 py-1 font-mono text-right text-amber-300"
            />
          </div>
        </div>

        {/* Right: Target Pilot & Hull Lookup */}
        <div className="bg-[#10151f] border border-slate-800 rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <Crosshair className="w-4 h-4 text-rose-400" />
              <span>Target Pilot &amp; Hull Intel</span>
            </h3>
            <span className="font-mono text-[11px] text-slate-400">{targetHull.hullClass}</span>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={pilotQuery}
              onChange={(e) => setPilotQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleLookupPilot();
              }}
              placeholder="Lookup EVE Pilot Name (ESI + zKillboard posture)..."
              className="flex-1 bg-[#0b0e14] border border-slate-700 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 text-xs text-slate-100"
            />
            <button
              type="button"
              onClick={() => void handleLookupPilot()}
              disabled={isLookingUp || !pilotQuery.trim()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 text-xs font-medium hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <Search className="w-3.5 h-3.5" />
              <span>{isLookingUp ? 'Scanning...' : 'Lookup'}</span>
            </button>
          </div>

          {lookupError && (
            <div className="text-[11px] text-rose-300">{lookupError}</div>
          )}

          {pilotIntel && (
            <div className="p-2.5 rounded border border-slate-800 bg-[#0b0e14] text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-100">
                  {pilotIntel.characterName} ({pilotIntel.corporationName})
                </span>
                <span
                  className={`font-mono text-[11px] font-semibold ${
                    pilotIntel.posture === 'ganker_threat'
                      ? 'text-rose-400'
                      : pilotIntel.posture === 'victim_target'
                        ? 'text-emerald-400'
                        : 'text-amber-300'
                  }`}
                >
                  {pilotIntel.posture === 'ganker_threat'
                    ? 'Ganker / Threat'
                    : pilotIntel.posture === 'victim_target'
                      ? 'Victim / Target'
                      : 'Mixed / Unknown'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400">{pilotIntel.summary}</div>
            </div>
          )}

          <select
            value={targetHullId}
            onChange={(e) => setTargetHullId(e.target.value)}
            className="w-full bg-[#0b0e14] border border-slate-700 rounded-md px-3 py-2 text-xs text-slate-100"
          >
            {GANK_HULL_CATALOG.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name} ({h.hullClass})
              </option>
            ))}
          </select>

          <div className="grid grid-cols-3 gap-2 text-xs font-mono tabular-nums">
            <div className="bg-[#0b0e14] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">EHP / Sig</div>
              <div className="text-slate-100">{targetHull.ehp.toLocaleString('en-US')} · {targetHull.sigRadiusM}m</div>
            </div>
            <div className="bg-[#0b0e14] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">DPS / Alpha</div>
              <div className="text-rose-300 font-semibold">{targetHull.dps} / {targetHull.alphaDps}</div>
            </div>
            <div className="bg-[#0b0e14] border border-slate-800 rounded p-2">
              <div className="text-[10px] font-sans text-slate-400">Cargo Cap</div>
              <div className="text-slate-200">{formatM3(targetHull.cargoM3)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* Ship / Cargo Scanner Input */}
      <div className="bg-[#10151f] border border-slate-800 rounded-lg p-4 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
            <Radar className="w-4 h-4 text-amber-400" />
            <span>In-Game Ship / Cargo Scanner Paste (External Target)</span>
            <InfoTip
              locked
              tooltipsEnabled={appSettings.tooltipsEnabled}
              title="External Ship Fitting & Cargo Transparency"
              body="EVE ESI never exposes another player's live ship fitting or cargo hold. Your own synced ships load from ESI, while external target cargo/fits require pasting results from an in-game Ship Scanner or Cargo Scanner (or entering an estimate below)."
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-400">Est. Target Cargo ISK:</span>
            <input
              type="number"
              min={0}
              step={10_000_000}
              value={targetCargoManualIsk}
              onChange={(e) => setTargetCargoManualIsk(Math.max(0, Number(e.target.value) || 0))}
              className="w-36 bg-[#0b0e14] border border-slate-700 rounded px-2.5 py-1 font-mono text-right text-emerald-300"
            />
          </div>
        </div>
        <textarea
          rows={2}
          value={scanPasteText}
          onChange={(e) => setScanPasteText(e.target.value)}
          placeholder="Optional: Paste EVE Cargo Scanner or Ship Scanner lines (e.g., 'Tritanium	50000' or 'Multispectrum Shield Hardener II')..."
          className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md p-2.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
        />
        {parsedScan.parsedItemCount > 0 && (
          <div className="text-[11px] font-mono text-emerald-300">
            Parsed {parsedScan.parsedItemCount} scanned cargo item(s) → Live Jita Est:{' '}
            {formatIsk(parsedScan.estimatedCargoIsk)}
            {parsedScan.detectedModules.length > 0 && (
              <span className="text-amber-300 ml-2">
                · Modules detected: {parsedScan.detectedModules.slice(0, 4).join(', ')}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tactical Decision & Cost-Benefit Output */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recommendation & TTK */}
        <div className="lg:col-span-2 bg-[#0e131b] border border-slate-800 rounded-lg p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <span
                className={`px-3 py-1 rounded font-display text-sm font-bold tracking-wide ${
                  evaluation.recommendation === 'FIGHT'
                    ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/45'
                    : 'bg-rose-500/20 text-rose-200 border border-rose-500/45'
                }`}
              >
                {evaluation.recommendation}
              </span>
              <span className="text-xs text-slate-300 font-medium">
                {evaluation.confidenceLabel}
              </span>
            </div>

            <div className="flex items-center gap-1 text-[11px] text-amber-300 font-mono">
              <ShieldAlert className="w-3.5 h-3.5" />
              <span>CONCORD Excluded</span>
              <InfoTip
                locked
                tooltipsEnabled={appSettings.tooltipsEnabled}
                align="right"
                title="CONCORD Response Excluded from TTK"
                body="Time-to-Kill (TTK) and Time-to-Be-Killed strictly model pure ship-vs-ship EHP & DPS. High-sec CONCORD response windows (6s–24s depending on system security & pre-pulled spawns), gate guns, logistics alts, and live grid bumps are intentionally excluded."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
            <div className="bg-[#131822] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">Your TTK (Target)</div>
              <div className="text-sm font-bold text-emerald-300 mt-0.5">
                {Number.isFinite(evaluation.ttkTargetSec) ? `${evaluation.ttkTargetSec}s` : 'N/A (No DPS)'}
              </div>
            </div>
            <div className="bg-[#131822] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">Time-to-Be-Killed</div>
              <div className="text-sm font-bold text-rose-300 mt-0.5">
                {Number.isFinite(evaluation.timeToBeKilledSec) ? `${evaluation.timeToBeKilledSec}s` : 'Safe (0 DPS)'}
              </div>
            </div>
            <div className="bg-[#131822] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">Optimal Orbit / Speed</div>
              <div className="text-sm font-bold text-cyan-300 mt-0.5">
                {evaluation.optimalOrbitKm} km · {evaluation.optimalSpeedMs} m/s
              </div>
              <div className="text-[10px] text-slate-500">{evaluation.optimalAngularRadS} rad/s angular</div>
            </div>
            <div className="bg-[#131822] border border-slate-800 rounded p-2.5">
              <div className="text-[10px] font-sans text-slate-400">Best Damage Type</div>
              <div className="text-sm font-bold text-amber-300 mt-0.5 flex items-center gap-1">
                <Zap className="w-3.5 h-3.5" />
                {evaluation.recommendedDamageType}
              </div>
              <div className="text-[10px] text-slate-500">Target resist: {evaluation.weakestResistPct}%</div>
            </div>
          </div>

          {/* Modules to Overload & Tactical Notes */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center gap-1.5 text-amber-300 font-medium">
              <Flame className="w-3.5 h-3.5" />
              <span>Modules to Overload / Heat:</span>
              <span className="font-mono text-slate-200 font-normal">
                {evaluation.modulesToOverload.join(' · ')}
              </span>
            </div>
            <ul className="space-y-1 text-slate-300 list-disc pl-4">
              {evaluation.tacticalNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </div>

        {/* Engagement Cost-Benefit Summary */}
        <div className="bg-[#0e131b] border border-slate-800 rounded-lg p-4 space-y-3 flex flex-col justify-between">
          <div className="space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Skull className="w-3.5 h-3.5 text-amber-400" />
              <span>Engagement Cost-Benefit</span>
            </h4>
            <div className="space-y-2 text-xs font-mono tabular-nums">
              <div className="flex justify-between">
                <span className="font-sans text-slate-400">Expected Loot Drop (50%):</span>
                <span className="text-emerald-300 font-semibold">
                  {formatIsk(evaluation.expectedLootDropIsk)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-sans text-slate-400">Your Ship + Cargo Risk:</span>
                <span className="text-rose-300 font-semibold">
                  {formatIsk(evaluation.ownShipRiskIsk)}
                </span>
              </div>
              <div className="flex justify-between pt-2 border-t border-slate-800">
                <span className="font-sans text-slate-200 font-medium">Risk-Adjusted Net EV:</span>
                <span
                  className={`font-bold ${
                    evaluation.netExpectedValueIsk >= 0 ? 'text-emerald-300' : 'text-rose-400'
                  }`}
                >
                  {evaluation.netExpectedValueIsk >= 0 ? '+' : ''}
                  {formatIsk(evaluation.netExpectedValueIsk)}
                </span>
              </div>
            </div>
          </div>

          <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 font-mono">
            Target Resist Hole: EM {targetHull.resists.em}% · TH {targetHull.resists.thermal}% · KI {targetHull.resists.kinetic}% · EX {targetHull.resists.explosive}%
          </div>
        </div>
      </div>
    </div>
  );
}
