import { useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  KeyRound,
  Link2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { copyTextToClipboard } from '../utils/eveMultibuy.ts';

interface ApiSetupModalProps {
  isOpen: boolean;
  onClose: () => void;
  callbackUrl: string;
  hasEnvEveClientId: boolean;
  envEveClientId: string;
  customEveClientId: string;
  hasEnvGeminiKey: boolean;
  customGeminiKey: string;
  autoOpenedReason?: string | null;
  isSsoConnected: boolean;
  isSsoConnecting: boolean;
  onSaveKeys: (keys: { eveClientId: string; geminiApiKey: string }) => void;
  onSaveAndConnectSso: (keys: { eveClientId: string; geminiApiKey: string }) => void;
}

export function ApiSetupModal({
  isOpen,
  onClose,
  callbackUrl,
  hasEnvEveClientId,
  envEveClientId,
  customEveClientId,
  hasEnvGeminiKey,
  customGeminiKey,
  autoOpenedReason,
  isSsoConnected,
  isSsoConnecting,
  onSaveKeys,
  onSaveAndConnectSso,
}: ApiSetupModalProps) {
  const [eveInput, setEveInput] = useState(customEveClientId);
  const [geminiInput, setGeminiInput] = useState(customGeminiKey);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setEveInput(customEveClientId);
      setGeminiInput(customGeminiKey);
      setShowGeminiKey(false);
      setCopiedCallback(false);
      setSavedNotice(false);
    }
  }, [isOpen, customEveClientId, customGeminiKey]);

  if (!isOpen) return null;

  const effectiveEveId = (hasEnvEveClientId ? envEveClientId : eveInput).trim();
  const hasAnyGeminiKey = hasEnvGeminiKey || geminiInput.trim().length > 0;

  const handleCopyCallback = async () => {
    const ok = await copyTextToClipboard(callbackUrl);
    if (ok) {
      setCopiedCallback(true);
      window.setTimeout(() => setCopiedCallback(false), 2000);
    }
  };

  const handleSave = () => {
    onSaveKeys({
      eveClientId: eveInput.trim(),
      geminiApiKey: geminiInput.trim(),
    });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2200);
  };

  const handleClearLocal = () => {
    setEveInput('');
    setGeminiInput('');
    onSaveKeys({ eveClientId: '', geminiApiKey: '' });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2200);
  };

  const handleConnectClick = () => {
    onSaveAndConnectSso({
      eveClientId: eveInput.trim(),
      geminiApiKey: geminiInput.trim(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="API Setup — Bring Your Own Keys"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-[#0f141d] border border-slate-800 rounded-lg shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-md bg-cyan-500/15 border border-cyan-500/35 flex items-center justify-center shrink-0">
              <KeyRound className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-base font-semibold text-slate-100">
                API Setup — Bring Your Own Keys
              </h2>
              <p className="text-xs text-slate-400">
                Zero-terminal configuration. Environment variables take priority; keys pasted here stay in your browser&apos;s local storage.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close API Setup"
            className="p-1.5 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5 text-xs">
          {autoOpenedReason && (
            <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/35 text-amber-200 leading-relaxed">
              {autoOpenedReason}
            </div>
          )}

          {/* Step 1: Callback URL for EVE Developer Portal */}
          <div className="p-3.5 rounded-md bg-[#131822] border border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-medium">
                <Link2 className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                <span>Step 1 — Copy Callback URL for EVE Online</span>
              </div>
              <a
                href="https://developers.eveonline.com/applications"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:text-cyan-300 hover:underline shrink-0"
              >
                <span>developers.eveonline.com</span>
                <ExternalLink className="w-3 h-3" aria-hidden="true" />
              </a>
            </div>
            <p className="text-slate-400 leading-relaxed">
              Create a free application at the EVE Developer Portal (<em>Authentication &amp; API Access</em>) and paste this exact Callback URL:
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={callbackUrl}
                aria-label="Current EVE SSO Callback URL"
                className="flex-1 bg-[#0b0e14] border border-slate-700/80 rounded-md px-3 py-2 font-mono text-[11px] text-cyan-200 select-all"
              />
              <button
                type="button"
                onClick={handleCopyCallback}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-md border font-medium transition-colors cursor-pointer shrink-0 ${
                  copiedCallback
                    ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                    : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25'
                }`}
              >
                {copiedCallback ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-300" aria-hidden="true" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Copy Callback URL</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Step 2: EVE Client ID (Required) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="api-setup-eve-client-id" className="text-slate-200 font-medium">
                Step 2 — EVE Client ID <span className="text-rose-400 font-normal">(Required for EVE SSO)</span>
              </label>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  hasEnvEveClientId
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : eveInput.trim()
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : 'bg-amber-500/15 border-amber-500/40 text-amber-300'
                }`}
              >
                {hasEnvEveClientId
                  ? 'ENV ACTIVE'
                  : eveInput.trim()
                    ? 'BROWSER KEY'
                    : 'NOT SET'}
              </span>
            </div>

            {hasEnvEveClientId ? (
              <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 space-y-1">
                <div className="flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Configured via server environment variable (EVE_CLIENT_ID)</span>
                </div>
                <div className="font-mono text-[11px] text-emerald-300/90 break-all">
                  Active ID: {envEveClientId}
                </div>
              </div>
            ) : (
              <>
                <input
                  id="api-setup-eve-client-id"
                  type="text"
                  value={eveInput}
                  onChange={(e) => setEveInput(e.target.value)}
                  placeholder="Paste your 32-character EVE Developer Client ID"
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-[#131822] border border-slate-700/90 focus:border-cyan-400 focus:outline-none rounded-md px-3 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
                />
                <p className="text-[11px] text-slate-500">
                  Saved in <code className="text-slate-400">localStorage</code> under{' '}
                  <code className="text-slate-400">foxy_custom_eve_client_id</code>. Uses OAuth2 PKCE (no client secret needed).
                </p>
              </>
            )}
          </div>

          {/* Step 3: Gemini API Key (Optional) */}
          <div className="space-y-2 pt-1 border-t border-slate-800/80">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="api-setup-gemini-key" className="text-slate-200 font-medium inline-flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
                <span>Step 3 — Gemini API Key</span>
                <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                  hasEnvGeminiKey
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : geminiInput.trim()
                      ? 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                      : 'bg-slate-800 border-slate-700 text-slate-400'
                }`}
              >
                {hasEnvGeminiKey
                  ? 'ENV ACTIVE'
                  : geminiInput.trim()
                    ? 'BROWSER KEY'
                    : 'OPTIONAL'}
              </span>
            </div>

            <p className="text-slate-400 leading-relaxed">
              Only required for the Strategic AI Advisor sidebar. <strong className="text-slate-200 font-medium">All market scanners, order books, blueprint tools, cargo math, Multibuy, and route planners work 100% without it.</strong>
            </p>

            {hasEnvGeminiKey ? (
              <div className="p-3 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 flex items-center gap-2">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
                <span>Server environment variable (GEMINI_API_KEY) is active and kept strictly on the server.</span>
              </div>
            ) : (
              <>
                <div className="relative flex items-center">
                  <input
                    id="api-setup-gemini-key"
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiInput}
                    onChange={(e) => setGeminiInput(e.target.value)}
                    placeholder="Optional — paste a Gemini API key (aistudio.google.com)"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-full bg-[#131822] border border-slate-700/90 focus:border-cyan-400 focus:outline-none rounded-md pl-3 pr-10 py-2 font-mono text-xs text-slate-100 placeholder:text-slate-600"
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey((v) => !v)}
                    aria-label={showGeminiKey ? 'Hide Gemini API key' : 'Show Gemini API key'}
                    className="absolute right-2 p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {showGeminiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
                <p className="text-[11px] text-slate-500">
                  Saved in <code className="text-slate-400">localStorage</code> under{' '}
                  <code className="text-slate-400">foxy_custom_gemini_key</code> and forwarded only to your app&apos;s{' '}
                  <code className="text-slate-400">/api/advisor/chat</code> endpoint when you chat.
                </p>
              </>
            )}
          </div>

          {savedNotice && (
            <div className="p-2.5 rounded-md bg-emerald-500/10 border border-emerald-500/35 text-emerald-200 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              <span>API setup preferences saved to your browser.</span>
            </div>
          )}

          {/* Status Summary + Footer Actions */}
          <div className="pt-3 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
            <button
              type="button"
              onClick={handleClearLocal}
              disabled={!customEveClientId && !customGeminiKey && !eveInput && !geminiInput}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-slate-800 text-slate-400 hover:text-rose-300 hover:border-rose-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Clear Local Keys</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                className="px-3.5 py-2 rounded-md border border-slate-700 bg-[#131822] text-slate-200 hover:border-slate-500 font-medium transition-colors cursor-pointer"
              >
                Save Keys
              </button>
              <button
                type="button"
                onClick={handleConnectClick}
                disabled={!effectiveEveId || isSsoConnecting}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 font-medium hover:bg-cyan-500/30 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  {isSsoConnecting
                    ? 'Connecting EVE SSO...'
                    : isSsoConnected
                      ? 'Reconnect EVE SSO'
                      : 'Save & Connect EVE SSO'}
                </span>
              </button>
            </div>
          </div>

          {!hasAnyGeminiKey && (
            <div className="text-[11px] text-slate-500 text-right">
              AI Advisor status: Disabled (optional) — all core EVE tools remain active.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
