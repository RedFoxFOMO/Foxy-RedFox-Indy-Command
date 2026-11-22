import { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  Copy,
  ExternalLink,
  Factory,
  KeyRound,
  Link2,
  Send,
  Ship,
  Sliders,
  Sparkles,
  Truck,
  X,
} from 'lucide-react';
import { EMPIRE_HUB_LIST, EVE_ANCHORS } from '../data/eveCatalog.ts';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import {
  EMPIRE_HUB_NPC_OWNERS,
  computeExactHubBrokerFee,
} from '../utils/dotlan.ts';
import { EVE_SSO_SCOPES } from '../utils/evePkce.ts';
import type {
  ActionCardData,
  AiCommentarySettings,
  AppSettingsV22,
  PilotProfile,
  PriceTrendPeriod,
  RefiningLocationRule,
  RefiningSellRule,
  RoutingPreference,
  TradeHubId,
} from '../types/eve.ts';
import { BlueprintLibraryPanel } from './BlueprintLibraryPanel.tsx';
import { InfoTip } from './InfoTip.tsx';

export type SettingsTabId = 'connections' | 'trading' | 'industry' | 'hauling' | 'ui';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTabId;
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
  aiSettings: AiCommentarySettings;
  onChangeAiSettings: (next: AiCommentarySettings) => void;
  appSettings: AppSettingsV22;
  onChangeAppSettings: (next: AppSettingsV22) => void;
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
    systemId: 30002187,
    systemName: 'Amarr',
    stationName: 'Amarr VIII (Oris) - Emperor Family Academy',
  },
  {
    systemId: 30002510,
    systemName: 'Rens',
    stationName: 'Rens VI - Moon 8 - Brutor Tribe Treasury',
  },
  {
    systemId: 30002053,
    systemName: 'Hek',
    stationName: 'Hek VIII - Moon 12 - Boundless Creation Factory',
  },
];

export function SettingsModal({
  isOpen,
  initialTab = 'connections',
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
  aiSettings,
  onChangeAiSettings,
  appSettings,
  onChangeAppSettings,
}: SettingsModalProps) {
  const [tab, setTab] = useState<SettingsTabId>(initialTab);
  const [copiedUri, setCopiedUri] = useState(false);
  const [discordTestStatus, setDiscordTestStatus] = useState<{
    kind: 'idle' | 'sending' | 'ok' | 'error';
    msg?: string;
  }>({ kind: 'idle' });

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setDiscordTestStatus({ kind: 'idle' });
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

  const handleSendDiscordPing = async () => {
    const url = appSettings.discordWebhookUrl.trim();
    if (!url) {
      setDiscordTestStatus({ kind: 'error', msg: 'Enter a Discord webhook URL first.' });
      return;
    }
    setDiscordTestStatus({ kind: 'sending' });
    try {
      const res = await fetch('/api/integrations/discord-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhookUrl: url,
          content: `**Foxy RedFox Indy Command v2.2.0** — Test Ping confirmed for **${profile.characterName}** (${profile.currentSystemName}). Ready to receive committed routes & corp job exports!`,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setDiscordTestStatus({
          kind: 'error',
          msg: json.error || `Webhook returned HTTP ${res.status}`,
        });
        return;
      }
      setDiscordTestStatus({ kind: 'ok', msg: 'Test ping delivered to Discord channel!' });
    } catch {
      setDiscordTestStatus({ kind: 'error', msg: 'Network error contacting Discord proxy.' });
    }
  };

  const standingsMissingScope =
    profile.mode === 'eve_sso' && profile.npcStandings && !profile.npcStandings.hasScope;

  const tabs: { id: SettingsTabId; label: string; icon: typeof KeyRound }[] = [
    { id: 'connections', label: 'Connections & APIs', icon: KeyRound },
    { id: 'trading', label: 'Trading & Fees', icon: Sliders },
    { id: 'industry', label: 'Industry & Refining', icon: Factory },
    { id: 'hauling', label: 'Hauling & Fleet', icon: Truck },
    { id: 'ui', label: 'UI & Alerts', icon: Bell },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Unified Settings Hub"
    >
      <div
        className={`w-full ${
          tab === 'industry' || tab === 'hauling' ? 'max-w-5xl' : 'max-w-3xl'
        } bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden flex flex-col max-h-[90vh] transition-[max-width] duration-150`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-100">
              Unified Settings Hub — v2.2.0
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Centralized EVE Online SSO (PKCE), optional BYOK AI keys, Discord webhooks, standing-exact fee rules, refining rules, and UI preferences.
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

        {/* Section Tabs */}
        <div className="px-6 border-b border-slate-800 flex items-center gap-4 overflow-x-auto bg-[#131822]/60 shrink-0">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`py-3 text-xs font-medium border-b-2 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'border-cyan-400 text-cyan-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs">
          {/* TAB 1: CONNECTIONS & APIS */}
          {tab === 'connections' && (
            <div className="space-y-5">
              {/* 1A: EVE Online SSO (PKCE) */}
              <div className="bg-[#131822] border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                    <KeyRound className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                    <span>EVE Online SSO (OAuth2 PKCE)</span>
                    <InfoTip
                      locked
                      tooltipsEnabled={appSettings.tooltipsEnabled}
                      title="EVE Online SSO Setup (PKCE)"
                      body={`1. Go to developers.eveonline.com/applications and create a new application.\n2. Choose "Authentication & API Access".\n3. Paste the exact Callback URL shown below.\n4. Select all requested scopes (including esi-characters.read_standings.v1 for exact NPC broker fees).\n5. Copy your 32-character Client ID into this field — zero client secret needed!`}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-cyan-300">
                    {profile.mode === 'eve_sso'
                      ? `Connected: ${profile.characterName}`
                      : 'Simulation / Offline Mode'}
                  </span>
                </div>

                {standingsMissingScope && (
                  <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/35 text-amber-200 text-[11px]">
                    Your current EVE SSO token does not include{' '}
                    <span className="font-mono">esi-characters.read_standings.v1</span>. NPC standings default to{' '}
                    <span className="font-mono">0.0</span> until you click <strong>Re-sync / Connect EVE SSO</strong> below.
                  </div>
                )}

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-slate-300 font-medium">
                      Required Callback URL (EVE Developers Portal)
                    </label>
                    <a
                      href="https://developers.eveonline.com/applications"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:underline inline-flex items-center gap-1 text-[11px]"
                    >
                      <span>developers.eveonline.com</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={callbackUrl}
                      className="flex-1 bg-[#0b0e14] border border-slate-800 rounded-md px-3 py-2 font-mono text-xs text-slate-200"
                    />
                    <button
                      type="button"
                      onClick={handleCopyCallback}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-700 bg-[#0b0e14] text-slate-200 hover:border-cyan-400/50 cursor-pointer shrink-0"
                    >
                      {copiedUri ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedUri ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="eve-client-id" className="block text-slate-300 font-medium">
                    EVE Application CLIENT_ID
                  </label>
                  <input
                    id="eve-client-id"
                    type="text"
                    value={eveClientId}
                    onChange={(e) => onChangeEveClientId(e.target.value)}
                    placeholder="Enter your 32-character EVE SSO Client ID"
                    className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
                  />
                </div>

                <details className="text-[11px]">
                  <summary className="cursor-pointer text-slate-400 hover:text-slate-200 select-none">
                    View Requested ESI Scopes ({EVE_SSO_SCOPES.length} scopes incl. read_standings)
                  </summary>
                  <div className="mt-2 bg-[#0b0e14] border border-slate-800 rounded-md p-2.5 font-mono text-[10px] text-slate-400 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {EVE_SSO_SCOPES.map((s) => (
                      <div key={s} className={s.includes('standings') ? 'text-cyan-300' : ''}>
                        {s}
                      </div>
                    ))}
                  </div>
                </details>

                {ssoStatusMsg && (
                  <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 text-[11px]">
                    {ssoStatusMsg}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onSwitchToSimulation}
                    className="px-3 py-1.5 rounded-md border border-slate-700 text-slate-300 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
                  >
                    {profile.mode === 'eve_sso' ? 'Disconnect / Simulation Mode' : 'Stay in Simulation Mode'}
                  </button>
                  <button
                    type="button"
                    onClick={onConnectEveSso}
                    disabled={isSsoConnecting || !eveClientId.trim()}
                    className="px-4 py-1.5 rounded-md bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 font-medium hover:bg-cyan-500/30 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    {isSsoConnecting
                      ? 'Authenticating EVE SSO...'
                      : profile.mode === 'eve_sso'
                        ? 'Re-sync EVE SSO Scopes'
                        : 'Connect EVE SSO (PKCE)'}
                  </button>
                </div>
              </div>

              {/* 1B: Optional AI Keys (BYOK) */}
              <div className="bg-[#131822] border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                    <Sparkles className="w-4 h-4 text-indigo-400" aria-hidden="true" />
                    <span>Optional AI Market Commentary (BYOK — Local Storage Only)</span>
                    <InfoTip
                      locked
                      tooltipsEnabled={appSettings.tooltipsEnabled}
                      title="Bring Your Own AI Key (Optional)"
                      body={`All market, industry, contract, and quantitative trend tools work 100% with ZERO AI keys.\n\nIf you want natural-language commentary inside Price Projections or the Advisor:\n• Gemini Key: Create a free/personal key at aistudio.google.com/apikey.\n• OpenAI Key: Create a key at platform.openai.com/api-keys.\nKeys stay strictly in browser localStorage and use zero developer tokens.`}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 shrink-0 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={aiSettings.enabled}
                      onChange={(e) =>
                        onChangeAiSettings({ ...aiSettings, enabled: e.target.checked })
                      }
                      className="accent-indigo-400 w-3.5 h-3.5 cursor-pointer"
                    />
                    <span className="text-[11px] font-medium text-indigo-200">Enable BYOK AI</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="unified-gemini-key" className="block text-[11px] text-slate-300 font-medium">
                      Google Gemini API Key (Optional)
                    </label>
                    <input
                      id="unified-gemini-key"
                      type="password"
                      value={aiSettings.geminiKey}
                      onChange={(e) =>
                        onChangeAiSettings({ ...aiSettings, geminiKey: e.target.value })
                      }
                      placeholder="AIza..."
                      className="w-full bg-[#0b0e14] border border-slate-800 focus:border-indigo-400 focus:outline-none rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="unified-openai-key" className="block text-[11px] text-slate-300 font-medium">
                      OpenAI API Key (Optional)
                    </label>
                    <input
                      id="unified-openai-key"
                      type="password"
                      value={aiSettings.openaiKey}
                      onChange={(e) =>
                        onChangeAiSettings({ ...aiSettings, openaiKey: e.target.value })
                      }
                      placeholder="sk-..."
                      className="w-full bg-[#0b0e14] border border-slate-800 focus:border-indigo-400 focus:outline-none rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[11px]">
                  <span className="text-slate-400">Active AI Provider:</span>
                  {(['gemini', 'openai'] as const).map((prov) => (
                    <button
                      key={prov}
                      type="button"
                      onClick={() => onChangeAiSettings({ ...aiSettings, provider: prov })}
                      className={`px-2.5 py-1 rounded font-medium border cursor-pointer transition-colors ${
                        aiSettings.provider === prov
                          ? 'bg-indigo-500/20 border-indigo-400/50 text-indigo-200'
                          : 'bg-[#0b0e14] border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {prov === 'gemini' ? 'Google Gemini' : 'OpenAI'}
                    </button>
                  ))}
                </div>
              </div>

              {/* 1C: Discord Channel Webhook + Optional Share/Paste Endpoint */}
              <div className="bg-[#131822] border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-1.5 font-semibold text-slate-100">
                  <Send className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  <span>Discord Channel Webhook &amp; Share Endpoint</span>
                  <InfoTip
                    locked
                    tooltipsEnabled={appSettings.tooltipsEnabled}
                    title="Discord Webhook & Share Endpoint Setup"
                    body={`Discord Webhook:\n1. In Discord, open Channel Settings -> Integrations -> Webhooks -> New Webhook.\n2. Copy Webhook URL (https://discord.com/api/webhooks/...) and paste below.\n3. Use "Send Test Ping" to verify before pushing committed routes or corp build manifests.\n\nShare / Paste Endpoint (Optional):\nProvide an HTTPS paste service URL if you want one-click external link generation when exporting routes.`}
                  />
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="discord-webhook-url" className="block text-[11px] text-slate-300 font-medium">
                    Discord Channel Webhook URL
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="discord-webhook-url"
                      type="password"
                      value={appSettings.discordWebhookUrl}
                      onChange={(e) =>
                        onChangeAppSettings({ ...appSettings, discordWebhookUrl: e.target.value })
                      }
                      placeholder="https://discord.com/api/webhooks/..."
                      className="flex-1 bg-[#0b0e14] border border-slate-800 focus:border-emerald-400 focus:outline-none rounded px-3 py-2 font-mono text-xs text-slate-100"
                    />
                    <button
                      type="button"
                      onClick={handleSendDiscordPing}
                      disabled={discordTestStatus.kind === 'sending'}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-emerald-500/40 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-50 cursor-pointer shrink-0 font-medium"
                    >
                      <Send className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{discordTestStatus.kind === 'sending' ? 'Pinging...' : 'Send Test Ping'}</span>
                    </button>
                  </div>
                  {discordTestStatus.msg && (
                    <div
                      className={`text-[11px] font-mono ${
                        discordTestStatus.kind === 'ok' ? 'text-emerald-300' : 'text-rose-300'
                      }`}
                    >
                      {discordTestStatus.msg}
                    </div>
                  )}
                </div>

                <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                  <div className="flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
                    <label htmlFor="share-paste-url" className="text-[11px] text-slate-300 font-medium">
                      Optional Custom Share / Paste URL Endpoint
                    </label>
                  </div>
                  <input
                    id="share-paste-url"
                    type="url"
                    value={appSettings.sharePasteUrl}
                    onChange={(e) =>
                      onChangeAppSettings({ ...appSettings, sharePasteUrl: e.target.value })
                    }
                    placeholder="https://dpaste.org/api/ (optional — falls back to encoded shareable link)"
                    className="w-full bg-[#0b0e14] border border-slate-800 focus:border-cyan-400 focus:outline-none rounded px-3 py-2 font-mono text-xs text-slate-100"
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: TRADING & FEE DEFAULTS */}
          {tab === 'trading' && (
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

              {/* Order Mode + Skills */}
              <div className="pt-3 border-t border-slate-800/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-slate-200 font-medium">
                    Default Order Execution Mode &amp; Trade Skills
                  </div>
                  <div className="inline-flex rounded-md border border-slate-800 bg-[#0b0e14] p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateProfile((prev) => ({ ...prev, orderExecutionMode: 'list_orders' }))
                      }
                      className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
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
                        onUpdateProfile((prev) => ({ ...prev, orderExecutionMode: 'instant_fill' }))
                      }
                      className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
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
                        {(7.5 * (1 - 0.11 * profile.skills.accounting)).toFixed(3)}% Tax
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
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      {[0, 1, 2, 3, 4, 5].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Level {lvl} ({(7.5 * (1 - 0.11 * lvl)).toFixed(3)}%)
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
                        Base {(3.0 - 0.3 * profile.skills.brokerRelations).toFixed(2)}%
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
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      {[0, 1, 2, 3, 4, 5].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Level {lvl} ({(3.0 - 0.3 * lvl).toFixed(2)}% before standings)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="skill-adv-broker" className="text-slate-300 font-medium">
                        Adv. Broker Relations (ID 3447)
                      </label>
                      <span className="font-mono tabular-nums text-amber-300">
                        {50 + 6 * (profile.skills.advancedBrokerRelations ?? 0)}% Relist Disc
                      </span>
                    </div>
                    <select
                      id="skill-adv-broker"
                      value={profile.skills.advancedBrokerRelations ?? 0}
                      onChange={(e) =>
                        onUpdateProfile((prev) => ({
                          ...prev,
                          skills: { ...prev.skills, advancedBrokerRelations: Number(e.target.value) },
                        }))
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-xs text-slate-100"
                    >
                      {[0, 1, 2, 3, 4, 5].map((lvl) => (
                        <option key={lvl} value={lvl}>
                          Level {lvl} ({50 + 6 * lvl}% Relist Discount)
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-[11px]">
                      <label htmlFor="skill-procurement" className="text-slate-300 font-medium">
                        Procurement / Marketing
                      </label>
                      <span className="font-mono text-emerald-300">
                        P:{profile.skills.procurement ?? 0} · M:{profile.skills.marketing ?? 0}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      <select
                        id="skill-procurement"
                        value={profile.skills.procurement ?? 0}
                        onChange={(e) =>
                          onUpdateProfile((prev) => ({
                            ...prev,
                            skills: { ...prev.skills, procurement: Number(e.target.value) },
                          }))
                        }
                        className="bg-[#0b0e14] border border-slate-800 rounded px-2 py-1.5 font-mono text-xs text-slate-100"
                      >
                        {[0, 1, 2, 3, 4, 5].map((l) => (
                          <option key={l} value={l}>Proc {l}</option>
                        ))}
                      </select>
                      <select
                        id="skill-marketing"
                        value={profile.skills.marketing ?? 0}
                        onChange={(e) =>
                          onUpdateProfile((prev) => ({
                            ...prev,
                            skills: { ...prev.skills, marketing: Number(e.target.value) },
                          }))
                        }
                        className="bg-[#0b0e14] border border-slate-800 rounded px-2 py-1.5 font-mono text-xs text-slate-100"
                      >
                        {[0, 1, 2, 3, 4, 5].map((l) => (
                          <option key={l} value={l}>Mktg {l}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Exact 5-Hub NPC Standings Broker Fee Matrix + Custom Upwell + SCC */}
              <div className="pt-3 border-t border-slate-800/80 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                    <span>Exact 5-Hub NPC Broker Fees (Standings Adjusted)</span>
                    <InfoTip
                      locked
                      tooltipsEnabled={appSettings.tooltipsEnabled}
                      title="Exact NPC Broker Fee Formula"
                      body="NPC Station Broker Fee = max(1.00%, 3.00% - 0.30% × BrokerRelations - 0.03% × FactionStanding - 0.02% × CorpStanding). Synced automatically from /characters/{id}/standings/ via esi-characters.read_standings.v1."
                    />
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    {profile.npcStandings?.hasScope
                      ? 'Synced Live from ESI Standings'
                      : 'Using 0.0 Default Standings (Re-sync SSO for live)'}
                  </span>
                </div>

                <div className="border border-slate-800 rounded-lg overflow-hidden">
                  <table className="w-full text-[11px] font-mono tabular-nums">
                    <thead className="bg-[#131822] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-1.5 px-2.5 text-left font-sans">Trade Hub</th>
                        <th className="py-1.5 px-2 text-left font-sans">Faction / Corp</th>
                        <th className="py-1.5 px-2 text-right">Fac / Corp St.</th>
                        <th className="py-1.5 px-2.5 text-right">Eff. NPC Broker</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {(['jita', 'amarr', 'dodixie', 'rens', 'hek'] as TradeHubId[]).map((hid) => {
                        const b = computeExactHubBrokerFee({
                          hubId: hid,
                          brokerRelationsLvl: profile.skills.brokerRelations,
                          standings: profile.npcStandings,
                        });
                        const owner = EMPIRE_HUB_NPC_OWNERS[hid];
                        return (
                          <tr key={hid}>
                            <td className="py-1.5 px-2.5 font-sans text-slate-200 font-medium">
                              {owner.hubName}
                            </td>
                            <td className="py-1.5 px-2 font-sans text-slate-400">
                              {owner.npcFactionName} · {owner.npcCorpName}
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-300">
                              {b.factionStanding.toFixed(2)} / {b.corpStanding.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-2.5 text-right text-cyan-300 font-semibold">
                              {b.effectiveNpcBrokerPct.toFixed(3)}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Custom Upwell Broker Fee + 0.5% SCC Surcharge */}
                <div className="bg-[#131822] border border-slate-800 rounded-md p-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={appSettings.useCustomUpwellBroker}
                      onChange={(e) =>
                        onChangeAppSettings({
                          ...appSettings,
                          useCustomUpwellBroker: e.target.checked,
                        })
                      }
                      className="accent-cyan-400"
                    />
                    <span className="text-slate-200 font-medium">
                      Use Custom Upwell Structure Broker Fee (Player Market)
                    </span>
                  </label>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-slate-400">Structure %:</span>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        step={0.1}
                        disabled={!appSettings.useCustomUpwellBroker}
                        value={appSettings.customUpwellBrokerPct}
                        onChange={(e) =>
                          onChangeAppSettings({
                            ...appSettings,
                            customUpwellBrokerPct: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        className="w-16 bg-[#0b0e14] border border-slate-700 rounded px-2 py-1 font-mono text-right text-slate-100 disabled:opacity-40"
                      />
                    </div>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        disabled={!appSettings.useCustomUpwellBroker}
                        checked={appSettings.includeSccSurcharge}
                        onChange={(e) =>
                          onChangeAppSettings({
                            ...appSettings,
                            includeSccSurcharge: e.target.checked,
                          })
                        }
                        className="accent-amber-400"
                      />
                      <span>+0.5% SCC Surcharge</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: INDUSTRY & REFINING RULES */}
          {tab === 'industry' && (
            <div className="space-y-5">
              {/* 3-Stage Refining Location & Sell Location Rules */}
              <div className="bg-[#131822] border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-1.5 text-slate-100 font-semibold">
                  <Factory className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  <span>3-Stage Refining &amp; Reprocessing Location Rules (Buy → Refine → Sell)</span>
                  <InfoTip
                    tooltipsEnabled={appSettings.tooltipsEnabled}
                    title="3-Stage Reprocessing Pipeline"
                    body="Controls how the Inspection Optimizer evaluates 1-input -> multi-output refining workflows (e.g. Buy at Hub A -> jump 2 systems to Tatara B to refine -> sell outputs at B, back at A, or within Y jumps)."
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="block text-slate-300 font-medium">Stage 2: Refine Location</label>
                    <select
                      value={appSettings.refiningLocationRule}
                      onChange={(e) =>
                        onChangeAppSettings({
                          ...appSettings,
                          refiningLocationRule: e.target.value as RefiningLocationRule,
                        })
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-2 text-slate-100"
                    >
                      <option value="same_station">Same Station as Buy</option>
                      <option value="within_x_jumps">Within X Jumps of Buy</option>
                      <option value="specific_hub">Specific Trade / Indy Hub</option>
                    </select>
                    {appSettings.refiningLocationRule === 'within_x_jumps' && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-slate-400">Max Jumps from Buy:</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={appSettings.refiningMaxJumps}
                          onChange={(e) =>
                            onChangeAppSettings({
                              ...appSettings,
                              refiningMaxJumps: Math.max(1, Math.min(20, Number(e.target.value) || 2)),
                            })
                          }
                          className="w-16 bg-[#0b0e14] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                        />
                      </div>
                    )}
                    {appSettings.refiningLocationRule === 'specific_hub' && (
                      <select
                        value={appSettings.refiningHubId}
                        onChange={(e) =>
                          onChangeAppSettings({
                            ...appSettings,
                            refiningHubId: e.target.value as TradeHubId,
                          })
                        }
                        className="w-full mt-1 bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-1.5 text-slate-100"
                      >
                        {EMPIRE_HUB_LIST.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.shortLabel} ({h.systemName})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-slate-300 font-medium">Stage 3: Sell Location</label>
                    <select
                      value={appSettings.refiningSellRule}
                      onChange={(e) =>
                        onChangeAppSettings({
                          ...appSettings,
                          refiningSellRule: e.target.value as RefiningSellRule,
                        })
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-2.5 py-2 text-slate-100"
                    >
                      <option value="same_as_refine">Same as Refine Station</option>
                      <option value="back_at_buy">Back at Buy Origin Hub</option>
                      <option value="within_y_jumps">Within Y Jumps of Refine</option>
                    </select>
                    {appSettings.refiningSellRule === 'within_y_jumps' && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-slate-400">Max Jumps from Refine:</span>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={appSettings.refiningSellMaxJumps}
                          onChange={(e) =>
                            onChangeAppSettings({
                              ...appSettings,
                              refiningSellMaxJumps: Math.max(1, Math.min(20, Number(e.target.value) || 2)),
                            })
                          }
                          className="w-16 bg-[#0b0e14] border border-slate-700 rounded px-2 py-1 font-mono text-slate-100"
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* POCO Taxes & Adv Industry */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label htmlFor="poco-import" className="block text-slate-300 font-medium">
                    POCO Import Tax (%)
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
                    className="w-full bg-[#131822] border border-slate-800 rounded px-3 py-1.5 font-mono text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="poco-export" className="block text-slate-300 font-medium">
                    POCO Export Tax (%)
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
                    className="w-full bg-[#131822] border border-slate-800 rounded px-3 py-1.5 font-mono text-slate-100"
                  />
                </div>
                <div className="space-y-1">
                  <label htmlFor="skill-adv-indy" className="block text-slate-300 font-medium">
                    Adv. Industry (ID 3388)
                  </label>
                  <select
                    id="skill-adv-indy"
                    value={profile.skills.advancedIndustry ?? 0}
                    onChange={(e) =>
                      onUpdateProfile((prev) => ({
                        ...prev,
                        skills: { ...prev.skills, advancedIndustry: Number(e.target.value) },
                      }))
                    }
                    className="w-full bg-[#131822] border border-slate-800 rounded px-2.5 py-1.5 font-mono text-slate-100"
                  >
                    {[0, 1, 2, 3, 4, 5].map((lvl) => (
                      <option key={lvl} value={lvl}>
                        Lvl {lvl} (-{3 * lvl}% Time)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Blueprint Library */}
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

          {/* TAB 4: HAULING & ROUTE CADENCE */}
          {tab === 'hauling' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#131822] border border-slate-800 rounded-lg p-4">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <label htmlFor="jump-cadence" className="text-slate-200 font-medium">
                      Manual Jump Click Cadence (Seconds / Gate)
                    </label>
                    <InfoTip
                      tooltipsEnabled={appSettings.tooltipsEnabled}
                      title="Manual Gate Click Cadence"
                      body="Added to ship align time and warp speed when estimating Approach, Job, Return, and Total travel duration for courier contracts and hauling routes."
                    />
                  </div>
                  <input
                    id="jump-cadence"
                    type="number"
                    min={3}
                    max={90}
                    value={appSettings.manualJumpCadenceSec}
                    onChange={(e) =>
                      onChangeAppSettings({
                        ...appSettings,
                        manualJumpCadenceSec: Math.max(3, Math.min(90, Number(e.target.value) || 12)),
                      })
                    }
                    className="w-full bg-[#0b0e14] border border-slate-800 rounded px-3 py-2 font-mono text-slate-100"
                  />
                  <div className="text-[11px] text-slate-500">
                    Active manual pilot: ~8–12s · Relaxed / Autopilot: ~35–60s
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="default-route-pref" className="block text-slate-200 font-medium">
                    Default 2026 ESI Route Preference
                  </label>
                  <select
                    id="default-route-pref"
                    value={appSettings.defaultRoutingPreference}
                    onChange={(e) =>
                      onChangeAppSettings({
                        ...appSettings,
                        defaultRoutingPreference: e.target.value as RoutingPreference,
                      })
                    }
                    className="w-full bg-[#0b0e14] border border-slate-800 rounded px-3 py-2 text-slate-100"
                  >
                    <option value="Safer">Safer (High-Sec Preferred)</option>
                    <option value="Shorter">Shorter (Fewest Jumps)</option>
                    <option value="LessSecure">LessSecure (Low/Null Preferred)</option>
                  </select>
                  <div className="text-[11px] text-slate-500">
                    Sent via 2026 ESI <span className="font-mono">POST /route/&#123;origin&#125;/&#123;destination&#125;</span>.
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-slate-200 font-medium mb-2 inline-flex items-center gap-1.5">
                  <Ship className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                  <span>Synced Hauling Fleet ({profile.hulls.length} Fitted Hulls)</span>
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
            </div>
          )}

          {/* TAB 5: UI & ALERTS */}
          {tab === 'ui' && (
            <div className="space-y-4">
              <div className="bg-[#131822] border border-slate-800 rounded-lg p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-slate-100 font-semibold">Global Helper Tooltips</div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Toggle general info tips across the console. Critical <strong>Locked Info Tips</strong> (API Setup, Remote Order rules, and CONCORD TTK exclusions) remain accessible even when All Off.
                    </p>
                  </div>
                  <div className="inline-flex rounded-md border border-slate-700 bg-[#0b0e14] p-0.5">
                    <button
                      type="button"
                      onClick={() => onChangeAppSettings({ ...appSettings, tooltipsEnabled: true })}
                      className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                        appSettings.tooltipsEnabled
                          ? 'bg-cyan-500/20 text-cyan-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All On
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeAppSettings({ ...appSettings, tooltipsEnabled: false })}
                      className={`px-3 py-1 rounded text-xs font-medium cursor-pointer ${
                        !appSettings.tooltipsEnabled
                          ? 'bg-amber-500/20 text-amber-200'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All Off (Keep Locked)
                    </button>
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-slate-100 font-semibold">Primary Price Change Period</div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Select which range displays its exact percentage delta next to the multi-period green/red trend strip and 5-minute sparkline.
                    </p>
                  </div>
                  <div className="inline-flex rounded-md border border-slate-700 bg-[#0b0e14] p-0.5 font-mono">
                    {(['30d', '14d', '7d', '1d'] as PriceTrendPeriod[]).map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => onChangeAppSettings({ ...appSettings, priceTrendPeriod: p })}
                        className={`px-2.5 py-1 rounded text-xs cursor-pointer ${
                          appSettings.priceTrendPeriod === p
                            ? 'bg-cyan-500/20 text-cyan-200 font-semibold'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label htmlFor="maintainer-name" className="block text-slate-300 font-medium">
                      In-Game Contact Name (About Popover)
                    </label>
                    <input
                      id="maintainer-name"
                      type="text"
                      value={appSettings.maintainerContactName}
                      onChange={(e) =>
                        onChangeAppSettings({
                          ...appSettings,
                          maintainerContactName: e.target.value,
                        })
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-3 py-1.5 text-slate-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="maintainer-corp" className="block text-slate-300 font-medium">
                      In-Game Corp / Alliance Label
                    </label>
                    <input
                      id="maintainer-corp"
                      type="text"
                      value={appSettings.maintainerCorpName}
                      onChange={(e) =>
                        onChangeAppSettings({
                          ...appSettings,
                          maintainerCorpName: e.target.value,
                        })
                      }
                      className="w-full bg-[#0b0e14] border border-slate-800 rounded px-3 py-1.5 text-slate-100"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
