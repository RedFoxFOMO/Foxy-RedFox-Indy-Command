import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, KeyRound, Ship, Sliders, X } from 'lucide-react';
import { EVE_ANCHORS } from '../data/eveCatalog.ts';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import { EVE_SSO_SCOPES } from '../utils/evePkce.ts';
import type { ActionCardData, PilotProfile } from '../types/eve.ts';
import { BlueprintLibraryPanel } from './BlueprintLibraryPanel.tsx';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: 'sso' | 'profile' | 'assets';
  onClose: () => void;
  profile: PilotProfile;
  onUpdateProfile: (updater: (prev: PilotProfile) => PilotProfile) => void;
  eveClientId: string;
  onChangeEveClientId: (val: string) => void;
  callbackUrl: string;
  onConnectEveSso: () => void;
  onSwitchToSimulation: () => void;
  ssoStatusMsg: string | null;
  isSsoConnecting: boolean;
  indyCards: ActionCardData[];
  includeCorpBlueprints: boolean;
  isScanningBlueprints: boolean;
  blueprintScanError: string | null;
  onToggleCorpBlueprints: (next: boolean) => void;
  onRescanBlueprints: () => void;
  onOpenHistory: (typeId: number, name: string) => void;
}

const LOCATION_PRESETS = [
  {
    systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
    systemName: 'Ishisomo',
    stationName: EVE_ANCHORS.ISHISOMO_MFG_STATION_NAME,
  },
  {
    systemId: EVE_ANCHORS.ISHISOMO_SYSTEM_ID,
    systemName: 'Ishisomo',
    stationName: EVE_ANCHORS.ISHISOMO_RES_STATION_NAME,
  },
  {
    systemId: EVE_ANCHORS.JITA_SYSTEM_ID,
    systemName: 'Jita',
    stationName: EVE_ANCHORS.JITA_STATION_NAME,
  },
  {
    systemId: EVE_ANCHORS.DODIXIE_SYSTEM_ID,
    systemName: 'Dodixie',
    stationName: EVE_ANCHORS.DODIXIE_STATION_NAME,
  },
  {
    systemId: 30000144,
    systemName: 'Perimeter',
    stationName: 'Perimeter — En Route (1j Jita)',
  },
];

export function SettingsModal({
  isOpen,
  initialTab = 'sso',
  onClose,
  profile,
  onUpdateProfile,
  eveClientId,
  onChangeEveClientId,
  callbackUrl,
  onConnectEveSso,
  onSwitchToSimulation,
  ssoStatusMsg,
  isSsoConnecting,
  indyCards,
  includeCorpBlueprints,
  isScanningBlueprints,
  blueprintScanError,
  onToggleCorpBlueprints,
  onRescanBlueprints,
  onOpenHistory,
}: SettingsModalProps) {
  const [tab, setTab] = useState<'sso' | 'profile' | 'assets'>(initialTab);
  const [copiedUri, setCopiedUri] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
    }
  }, [isOpen, initialTab]);

  if (!isOpen) return null;

  const handleCopyCallback = async () => {
    try {
      await navigator.clipboard.writeText(callbackUrl);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 1800);
    } catch {
      // Clipboard fallback ignored
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Pilot Profile and EVE SSO Settings"
    >
      <div
        className={`w-full ${
          tab === 'assets' ? 'max-w-5xl' : 'max-w-2xl'
        } bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden flex flex-col max-h-[88vh] transition-[max-width] duration-150`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              EVE Online SSO &amp; Pilot Calibration
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect EVE ESI via OAuth2 PKCE for live fleet fittings, location, and Autopilot waypoints, or use simulation mode.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="p-2 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="px-6 border-b border-slate-800 flex items-center gap-6 bg-[#131822]/60">
          <button
            type="button"
            onClick={() => setTab('sso')}
            className={`py-3 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              tab === 'sso'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
            <span>EVE SSO (PKCE)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('profile')}
            className={`py-3 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              tab === 'profile'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Capital, Taxes &amp; Location</span>
          </button>
          <button
            type="button"
            onClick={() => setTab('assets')}
            className={`py-3 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
              tab === 'assets'
                ? 'border-cyan-400 text-cyan-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Ship className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Hulls &amp; Blueprints ({profile.blueprints.length})</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {tab === 'sso' && (
            <>
              <div className="bg-[#131822] border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">Active Authentication Mode</span>
                  <span className="font-mono text-cyan-300">
                    {profile.mode === 'eve_sso'
                      ? `Connected: ${profile.characterName}`
                      : 'Simulation / Offline Profile Mode'}
                  </span>
                </div>
                <p className="text-slate-400 leading-relaxed">
                  Register a public PKCE application at{' '}
                  <a
                    href="https://developers.eveonline.com/applications"
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                  >
                    developers.eveonline.com
                    <ExternalLink className="w-3 h-3" aria-hidden="true" />
                  </a>{' '}
                  using the exact callback URL below and paste your Client ID.
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="block text-slate-300 font-medium">
                  Required EVE Developer Callback URL
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={callbackUrl}
                    className="flex-1 bg-[#131822] border border-slate-800 rounded-md px-3 py-2 font-mono text-xs text-slate-200"
                  />
                  <button
                    type="button"
                    onClick={handleCopyCallback}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 bg-[#131822] text-slate-200 hover:border-cyan-400/50 cursor-pointer shrink-0"
                  >
                    {copiedUri ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUri ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="eve-client-id" className="block text-slate-300 font-medium">
                  EVE Developer Application CLIENT_ID
                </label>
                <input
                  id="eve-client-id"
                  type="text"
                  value={eveClientId}
                  onChange={(e) => onChangeEveClientId(e.target.value)}
                  placeholder="Enter your 32-character EVE SSO Client ID"
                  className="w-full bg-[#131822] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
                />
              </div>

              <div className="space-y-1.5">
                <div className="text-slate-300 font-medium">
                  EVE ESI Scopes Requested (Telemetry + In-Game Autopilot)
                </div>
                <div className="bg-[#131822] border border-slate-800 rounded-md p-3 font-mono text-[11px] text-slate-400 space-y-1">
                  {EVE_SSO_SCOPES.map((s) => (
                    <div key={s}>{s}</div>
                  ))}
                </div>
              </div>

              {ssoStatusMsg && (
                <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-200">
                  {ssoStatusMsg}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={onSwitchToSimulation}
                  className="px-3.5 py-2 rounded-md border border-slate-700 text-slate-300 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
                >
                  Use Simulation / Offline Profile
                </button>
                <button
                  type="button"
                  onClick={onConnectEveSso}
                  disabled={isSsoConnecting || !eveClientId.trim()}
                  className="px-4 py-2 rounded-md bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 font-medium hover:bg-cyan-500/30 disabled:opacity-50 transition-colors cursor-pointer"
                >
                  {isSsoConnecting ? 'Authenticating EVE SSO...' : 'Connect EVE SSO (PKCE)'}
                </button>
              </div>
            </>
          )}

          {tab === 'profile' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label htmlFor="capital-cap" className="block text-slate-300 font-medium">
                    Active Capital Cap (ISK)
                  </label>
                  <input
                    id="capital-cap"
                    type="number"
                    min={50000000}
                    step={50000000}
                    value={profile.activeCapitalCap}
                    onChange={(e) =>
                      onUpdateProfile((prev) => ({
                        ...prev,
                        activeCapitalCap: Math.max(10_000_000, Number(e.target.value) || 1_000_000_000),
                      }))
                    }
                    className="w-full bg-[#131822] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 font-mono tabular-nums text-slate-100"
                  />
                  <div className="text-[11px] text-slate-500 font-mono">
                    Current cap: {formatIsk(profile.activeCapitalCap)}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sim-location" className="block text-slate-300 font-medium">
                    Current Station / Location
                  </label>
                  <select
                    id="sim-location"
                    value={profile.currentStationName}
                    onChange={(e) => {
                      const found = LOCATION_PRESETS.find((l) => l.stationName === e.target.value);
                      if (found) {
                        onUpdateProfile((prev) => ({
                          ...prev,
                          currentSystemId: found.systemId,
                          currentSystemName: found.systemName,
                          currentStationName: found.stationName,
                        }));
                      }
                    }}
                    className="w-full bg-[#131822] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 text-slate-100"
                  >
                    {LOCATION_PRESETS.map((loc) => (
                      <option key={loc.stationName} value={loc.stationName}>
                        {loc.stationName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                <div className="space-y-1.5">
                  <label htmlFor="poco-import" className="block text-slate-300 font-medium">
                    NPC POCO Import Tax (%)
                  </label>
                  <input
                    id="poco-import"
                    type="number"
                    min={0}
                    max={25}
                    step={0.5}
                    value={profile.pocoImportTaxPct}
                    onChange={(e) =>
                      onUpdateProfile((prev) => ({
                        ...prev,
                        pocoImportTaxPct: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                      }))
                    }
                    className="w-full bg-[#131822] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 font-mono tabular-nums text-slate-100"
                  />
                  <div className="text-[11px] text-slate-500">
                    High-sec NPC default is 10% (applied at 50% CCP base value).
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="poco-export" className="block text-slate-300 font-medium">
                    NPC POCO Export Tax (%)
                  </label>
                  <input
                    id="poco-export"
                    type="number"
                    min={0}
                    max={25}
                    step={0.5}
                    value={profile.pocoExportTaxPct}
                    onChange={(e) =>
                      onUpdateProfile((prev) => ({
                        ...prev,
                        pocoExportTaxPct: Math.max(0, Math.min(30, Number(e.target.value) || 0)),
                      }))
                    }
                    className="w-full bg-[#131822] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 font-mono tabular-nums text-slate-100"
                  />
                  <div className="text-[11px] text-slate-500">
                    High-sec NPC default is 10% (player POCOs often 3%–5%).
                  </div>
                </div>
              </div>

              {/* Order Execution Mode & Skill-Adjusted Tax / Broker Fee Calibration */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-slate-200 font-medium">
                      Order Execution Mode &amp; Skill-Adjusted Fees
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Reads Accounting (ID 16622) &amp; Broker Relations (ID 3446) via ESI <span className="font-mono">esi-skills.read_skills.v1</span>.
                    </div>
                  </div>
                  <div className="inline-flex rounded-md border border-slate-800 bg-[#0b0e14] p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          orderExecutionMode: 'list_orders',
                        }))
                      }
                      className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        (profile.orderExecutionMode ?? 'list_orders') === 'list_orders'
                          ? 'bg-cyan-500/20 text-cyan-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      List Orders (Tax + Broker)
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          orderExecutionMode: 'instant_fill',
                        }))
                      }
                      className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer ${
                        profile.orderExecutionMode === 'instant_fill'
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Instant Fill (Tax Only)
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#131822] border border-slate-800 rounded-md p-3">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="skill-accounting" className="text-slate-300 font-medium">
                        Accounting (ID 16622)
                      </label>
                      <span className="font-mono tabular-nums text-emerald-400">
                        Sales Tax: {(7.5 * (1 - 0.11 * profile.skills.accounting)).toFixed(3)}%
                      </span>
                    </div>
                    <select
                      id="skill-accounting"
                      value={profile.skills.accounting}
                      onChange={(e) =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          skills: { ...prev.skills, accounting: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      {[0, 1, 2, 3, 4, 5].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Level {lvl} ({(7.5 * (1 - 0.11 * lvl)).toFixed(3)}% Sales Tax)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="skill-broker" className="text-slate-300 font-medium">
                        Broker Relations (ID 3446)
                      </label>
                      <span className="font-mono tabular-nums text-cyan-300">
                        Broker:{' '}
                        {profile.orderExecutionMode === 'instant_fill'
                          ? '0.00% (Instant)'
                          : `${(3.0 - 0.3 * profile.skills.brokerRelations).toFixed(2)}%`}
                      </span>
                    </div>
                    <select
                      id="skill-broker"
                      value={profile.skills.brokerRelations}
                      onChange={(e) =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          skills: { ...prev.skills, brokerRelations: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      {[0, 1, 2, 3, 4, 5].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Level {lvl} ({(3.0 - 0.3 * lvl).toFixed(2)}% NPC Broker Fee)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="skill-procurement" className="text-slate-300 font-medium">
                        Procurement (ID 16596)
                      </label>
                      <span className="font-mono tabular-nums text-emerald-300">
                        {(profile.skills.procurement ?? 0) === 0
                          ? 'Station Only'
                          : (profile.skills.procurement ?? 0) === 1
                            ? 'Same System'
                            : (profile.skills.procurement ?? 0) === 2
                              ? '5 Jumps'
                              : (profile.skills.procurement ?? 0) === 3
                                ? '10 Jumps'
                                : (profile.skills.procurement ?? 0) === 4
                                  ? '20 Jumps'
                                  : 'Entire Region'}
                      </span>
                    </div>
                    <select
                      id="skill-procurement"
                      value={profile.skills.procurement ?? 0}
                      onChange={(e) =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          skills: { ...prev.skills, procurement: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      <option value={0}>Level 0 (Station Only)</option>
                      <option value={1}>Level I (Same Solar System)</option>
                      <option value={2}>Level II (Up to 5 Jumps)</option>
                      <option value={3}>Level III (Up to 10 Jumps)</option>
                      <option value={4}>Level IV (Up to 20 Jumps)</option>
                      <option value={5}>Level V (Entire Region)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="skill-marketing" className="text-slate-300 font-medium">
                        Marketing (ID 16598)
                      </label>
                      <span className="font-mono tabular-nums text-amber-300">
                        {(profile.skills.marketing ?? 0) === 0
                          ? 'Station Only'
                          : (profile.skills.marketing ?? 0) === 1
                            ? 'Same System'
                            : (profile.skills.marketing ?? 0) === 2
                              ? '5 Jumps'
                              : (profile.skills.marketing ?? 0) === 3
                                ? '10 Jumps'
                                : (profile.skills.marketing ?? 0) === 4
                                  ? '20 Jumps'
                                  : 'Entire Region'}
                      </span>
                    </div>
                    <select
                      id="skill-marketing"
                      value={profile.skills.marketing ?? 0}
                      onChange={(e) =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          skills: { ...prev.skills, marketing: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      <option value={0}>Level 0 (Station Only)</option>
                      <option value={1}>Level I (Same Solar System)</option>
                      <option value={2}>Level II (Up to 5 Jumps)</option>
                      <option value={3}>Level III (Up to 10 Jumps)</option>
                      <option value={4}>Level IV (Up to 20 Jumps)</option>
                      <option value={5}>Level V (Entire Region)</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-800/80">
                <div className="text-slate-300 font-medium mb-2">
                  Character Telemetry &amp; Skills ({(profile.totalSp / 1e6).toFixed(1)}M SP)
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] font-mono text-slate-400 bg-[#131822] border border-slate-800 rounded-md p-3">
                  <div>Wallet: {formatIsk(profile.walletBalance)}</div>
                  <div>
                    Open Sell Orders:{' '}
                    {(profile.activeOrders ?? []).filter((o) => !o.isBuyOrder).length}
                  </div>
                  <div>Reprocessing: Lvl {profile.skills.reprocessing}</div>
                  <div>Reproc Eff: Lvl {profile.skills.reprocessingEfficiency}</div>
                  <div>Scrapmetal: Lvl {profile.skills.scrapmetalProcessing}</div>
                  <div>Indy / Sci: Lvl {profile.skills.industry} / {profile.skills.scienceEncryption}</div>
                </div>
              </div>
            </div>
          )}

          {tab === 'assets' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-slate-200 font-medium mb-2">
                  Scanned Hauling Fleet ({profile.hulls.length} Fitted Hulls)
                </h3>
                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#131822] border-b border-slate-800 text-slate-400">
                        <th className="py-2 px-3 text-left font-medium">Hull &amp; Fit</th>
                        <th className="py-2 px-3 text-right font-medium">Fitted Cap</th>
                        <th className="py-2 px-3 text-right font-medium">Safe ISK</th>
                        <th className="py-2 px-3 text-left font-medium">Location</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {profile.hulls.map((h) => (
                        <tr key={h.id}>
                          <td className="py-2 px-3">
                            <div className="text-slate-200 font-medium">
                              {h.name}
                              {h.isActiveShip ? (
                                <span className="ml-1.5 font-mono text-[10px] text-emerald-400">
                                  [Active]
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[10px] text-slate-500">{h.notes}</div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-cyan-300 whitespace-nowrap">
                            {formatM3(h.capacityM3)}
                          </td>
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-amber-300 whitespace-nowrap">
                            {formatIsk(h.safeIskThreshold ?? 750_000_000)}
                          </td>
                          <td className="py-2 px-3 text-slate-400">{h.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <BlueprintLibraryPanel
                blueprints={profile.blueprints}
                syncMeta={profile.blueprintSyncMeta}
                pilotMode={profile.mode}
                indyCards={indyCards}
                includeCorpBlueprints={includeCorpBlueprints}
                isScanning={isScanningBlueprints}
                scanError={blueprintScanError}
                onToggleCorpBlueprints={onToggleCorpBlueprints}
                onRescanBlueprints={onRescanBlueprints}
                onOpenHistory={onOpenHistory}
                compact
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
