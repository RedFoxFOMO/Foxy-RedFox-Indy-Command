import { useState } from 'react';
import { Info, Mail, Settings, ShieldCheck, X } from 'lucide-react';
import { APP_RELEASE_DATE, APP_VERSION } from '../utils/dotlan.ts';

interface AboutInfoPopoverProps {
  maintainerContactName?: string;
  maintainerCorpName?: string;
  onOpenSettings: () => void;
  position?: 'top' | 'bottom';
  compact?: boolean;
}

export function AboutInfoPopover({
  maintainerContactName = 'Reccemaster',
  maintainerCorpName = 'RedFoxFOMO',
  onOpenSettings,
  position = 'bottom',
  compact = false,
}: AboutInfoPopoverProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-flex items-center">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="About Foxy RedFox Indy Command & Quick-Start Info"
        className={`inline-flex items-center gap-1 ${compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'} rounded border border-slate-800 bg-[#121722] font-mono text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors cursor-pointer whitespace-nowrap shrink-0`}
      >
        <span>v{APP_VERSION}</span>
        <Info className="w-3 h-3 text-cyan-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="About Foxy RedFox Indy Command"
          className={`absolute ${
            position === 'top' ? 'bottom-full mb-2 right-0' : 'top-full mt-2 left-0'
          } z-50 w-80 max-w-[90vw] rounded-lg border border-slate-700 bg-[#0e131c] p-4 shadow-2xl shadow-black/70 text-xs text-slate-300 space-y-3`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display text-sm font-semibold text-slate-100">
                Foxy RedFox Indy Command
              </div>
              <div className="font-mono text-[11px] text-cyan-300 mt-0.5">
                v{APP_VERSION} · Released {APP_RELEASE_DATE}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close about info"
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-slate-800 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="border-t border-slate-800 pt-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
              <Mail className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span>In-Game Contact &amp; Support</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              EVE Mail:{' '}
              <span className="font-mono text-slate-100 font-semibold">
                {maintainerContactName || 'Reccemaster'}
              </span>
              {maintainerCorpName ? ` (${maintainerCorpName})` : ''}. Feedback, bug reports, and industrial tool suggestions welcome in-game!
            </p>
          </div>

          <div className="border-t border-slate-800 pt-2.5 space-y-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-200">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
              <span>Quick-Start Setup Tip</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Open the unified <span className="text-slate-200 font-medium">Settings</span> modal to link your EVE Online SSO Client ID (PKCE), optional personal Gemini/OpenAI keys, and Discord channel webhooks — stored locally in your browser with zero paywalls.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-md bg-cyan-500/20 border border-cyan-400/50 text-cyan-100 font-medium hover:bg-cyan-500/30 transition-colors cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Open Settings</span>
          </button>
        </div>
      )}
    </div>
  );
}
