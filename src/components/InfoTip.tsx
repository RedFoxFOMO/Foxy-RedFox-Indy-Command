import { useState } from 'react';
import { Info, Lock } from 'lucide-react';

interface InfoTipProps {
  title: string;
  body?: string;
  content?: string;
  /** When true, remains visible & interactive even when global Tooltips All-Off is enabled. */
  locked?: boolean;
  /** Global user preference from Settings (defaults to true). */
  tooltipsEnabled?: boolean;
  align?: 'left' | 'right' | 'center';
  compact?: boolean;
}

export function InfoTip({
  title,
  body,
  content,
  locked = false,
  tooltipsEnabled = true,
  align = 'center',
  compact = false,
}: InfoTipProps) {
  const [open, setOpen] = useState(false);
  const resolvedBody = body ?? content ?? '';

  if (!locked && !tooltipsEnabled) {
    return null;
  }

  const alignClass =
    align === 'left'
      ? 'left-0'
      : align === 'right'
        ? 'right-0'
        : 'left-1/2 -translate-x-1/2';

  return (
    <span
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label={title}
        aria-expanded={open}
        className={`inline-flex items-center justify-center rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${
          compact ? 'p-0.5' : 'p-1'
        } ${
          locked
            ? 'text-amber-300/90 hover:text-amber-200 hover:bg-amber-500/10'
            : 'text-slate-400 hover:text-cyan-300 hover:bg-slate-800/70'
        }`}
      >
        <Info className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden="true" />
      </button>

      {open && (
        <span
          role="tooltip"
          onClick={(e) => e.stopPropagation()}
          className={`absolute bottom-full mb-2 ${alignClass} z-50 w-72 max-w-[85vw] rounded-lg border ${
            locked
              ? 'border-amber-500/45 bg-[#121620]'
              : 'border-slate-700 bg-[#10151f]'
          } p-3 text-left shadow-xl shadow-black/60 pointer-events-auto`}
        >
          <span className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-100 mb-1">
            <span>{title}</span>
            {locked && (
              <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-amber-300">
                <Lock className="w-2.5 h-2.5" aria-hidden="true" />
                Locked Tip
              </span>
            )}
          </span>
          <span className="block text-[11px] leading-relaxed text-slate-300 font-normal whitespace-pre-line">
            {resolvedBody}
          </span>
        </span>
      )}
    </span>
  );
}
