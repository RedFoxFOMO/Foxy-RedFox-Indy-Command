import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Check,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Route,
  Send,
  Wrench,
} from 'lucide-react';
import { MARKET_CATEGORIES } from '../data/eveCatalog.ts';
import { formatIsk } from '../engines/decisionEngines.ts';
import type { AdvisorAction, ChatMessage } from '../types/eve.ts';

interface AdvisorSidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  queuedRouteCount: number;
  onSwitchToRoute: () => void;
  messages: ChatMessage[];
  isLoading: boolean;
  onSendMessage: (prompt: string) => void;
  onResetChat: () => void;
  onExecuteAction: (action: AdvisorAction) => void;
  appliedActionIds: string[];
  currentSystemName: string;
  activeCategoryCount: number;
  activeTabLabel: string;
}

const QUICK_PROMPT_CHIPS: { label: string; prompt: string }[] = [
  {
    label: 'Analyze Top Trades',
    prompt:
      'Analyze Top Trades: Review my current top ranked opportunities, wallet balance, and checked market categories. Recommend the highest-ROI execution sequence from my current station, attach a Switch Tab button to the best engine tab, and attach a "+ Add to Jita Shopping List" button if any inputs or manifest goods should be purchased.',
  },
  {
    label: 'Optimize Shopping List',
    prompt:
      'Optimize Shopping List: Audit my consolidated Jita shopping list for volume efficiency, 1-jump outside Jita discounts, and missing T2 datacores or fuel inputs. Propose any recommended additions with a "+ Add to Jita Shopping List" button and a Switch Tab button for Indy & T2 or Reprocessing.',
  },
  {
    label: 'Audit Blueprints',
    prompt:
      'Audit Blueprints: Audit my tracked BPOs and BPCs for Ishisomo State War Academy manufacturing and Propel Dynamics vanilla T2 invention. Identify the highest-margin runs, flag any missing materials or datacores with a "+ Add to Jita Shopping List" button, and include a Switch Tab button to Indy & T2.',
  },
];

function renderFormattedLines(content: string) {
  const lines = content.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return <div key={i} className="h-2" />;
    }

    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    const rendered = parts.map((part, pIdx) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={pIdx} className="font-semibold text-slate-100">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={pIdx}>{part}</span>;
    });

    if (/^#{1,3}\s+/.test(trimmed)) {
      return (
        <div key={i} className="font-display text-sm font-semibold text-cyan-300 mt-2 mb-1">
          {trimmed.replace(/^#{1,3}\s+/, '')}
        </div>
      );
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      return (
        <div key={i} className="pl-1 py-0.5 text-slate-200 leading-relaxed">
          {rendered}
        </div>
      );
    }

    if (/^[-*]\s+/.test(trimmed)) {
      return (
        <div key={i} className="pl-3 py-0.5 text-slate-300 leading-relaxed">
          • {rendered}
        </div>
      );
    }

    return (
      <p key={i} className="text-slate-300 leading-relaxed">
        {rendered}
      </p>
    );
  });
}

export function AdvisorSidebar({
  isCollapsed,
  onToggleCollapse,
  queuedRouteCount,
  onSwitchToRoute,
  messages,
  isLoading,
  onSendMessage,
  onResetChat,
  onExecuteAction,
  appliedActionIds,
  currentSystemName,
  activeCategoryCount,
  activeTabLabel,
}: AdvisorSidebarProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const appliedSet = new Set(appliedActionIds);

  useEffect(() => {
    if (!isCollapsed && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isCollapsed]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    onSendMessage(text);
  };

  if (isCollapsed) {
    return (
      <aside
        aria-label="Right Command Rail (Collapsed)"
        className="w-full lg:w-12 shrink-0 bg-[#0e131b] border-t lg:border-t-0 lg:border-l border-slate-800/90 flex lg:flex-col items-center justify-between lg:justify-start px-4 py-2.5 lg:px-0 lg:py-3.5 gap-3"
      >
        <div className="flex lg:flex-col items-center gap-2">
          <button
            type="button"
            onClick={onSwitchToRoute}
            title="Open Route & Manifest Optimizer"
            aria-label="Open Route & Manifest Optimizer"
            className="inline-flex items-center gap-1.5 lg:flex-col p-2 rounded-md text-cyan-300 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <Route className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="font-display text-xs font-semibold tracking-wide lg:[writing-mode:vertical-rl] lg:rotate-180 lg:mt-1.5 whitespace-nowrap">
              Route{queuedRouteCount > 0 ? ` (${queuedRouteCount})` : ''}
            </span>
          </button>

          <button
            type="button"
            onClick={onToggleCollapse}
            title="Expand Gemini Strategic Advisor"
            aria-label="Expand Gemini Strategic Advisor"
            className="inline-flex items-center gap-1.5 lg:flex-col p-2 rounded-md text-slate-300 hover:text-cyan-300 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <PanelRightOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="font-display text-xs font-semibold tracking-wide lg:[writing-mode:vertical-rl] lg:rotate-180 lg:mt-1.5 whitespace-nowrap">
              AI Advisor
            </span>
          </button>
        </div>
        <span className="text-[11px] font-mono text-slate-500 lg:hidden">
          Route Optimizer · AI Advisor
        </span>
      </aside>
    );
  }

  return (
    <aside
      aria-label="Gemini AI Strategic Advisor"
      className="w-full shrink-0 bg-[#0e131b] border-t lg:border-t-0 flex flex-col h-[540px] lg:h-full"
    >
      {/* Sidebar Header */}
      <div className="px-4 py-3.5 border-b border-slate-800/90 flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Strategic Advisor
          </h2>
          <div className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
            gemini-4-hydrogen · {currentSystemName} · {activeTabLabel} · {activeCategoryCount}/{MARKET_CATEGORIES.length}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onSwitchToRoute}
            title="Switch to Route & Manifest Optimizer"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium text-cyan-300 hover:text-cyan-200 rounded border border-cyan-500/35 bg-cyan-500/10 hover:bg-cyan-500/20 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Route className="w-3 h-3" aria-hidden="true" />
            <span>Route{queuedRouteCount > 0 ? ` (${queuedRouteCount})` : ''}</span>
          </button>
          <button
            type="button"
            onClick={onResetChat}
            title="Reset conversation"
            className="inline-flex items-center gap-1 px-2 py-1.5 text-xs text-slate-400 hover:text-slate-100 rounded border border-slate-800 hover:border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" aria-hidden="true" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={onToggleCollapse}
            title="Collapse Strategic Advisor"
            aria-label="Collapse Strategic Advisor"
            className="p-1.5 text-slate-400 hover:text-cyan-300 rounded border border-slate-800 hover:border-slate-700 transition-colors shrink-0 cursor-pointer"
          >
            <PanelRightClose className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Chat Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`text-xs ${
              msg.role === 'user'
                ? 'ml-6 bg-cyan-500/10 border border-cyan-500/25 rounded-lg p-3 text-slate-100'
                : msg.error
                  ? 'bg-rose-500/10 border border-rose-500/30 rounded-lg p-3.5 text-rose-200'
                  : 'bg-[#131822] border border-slate-800/90 rounded-lg p-3.5'
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 mb-1.5">
              <span
                className={
                  msg.role === 'user'
                    ? 'text-cyan-300 font-medium'
                    : 'text-slate-400 font-medium'
                }
              >
                {msg.role === 'user' ? 'Capsuleer' : 'Quartermaster AI'}
              </span>
              <span className="font-mono tabular-nums">{msg.timestamp}</span>
            </div>

            <div className="space-y-0.5">{renderFormattedLines(msg.content)}</div>

            {/* Structured Interactive Action Buttons returned by Gemini */}
            {msg.actions && msg.actions.length > 0 && (
              <div className="mt-3 pt-2.5 border-t border-slate-800/80 space-y-2">
                {msg.actions.map((action) => {
                  const isApplied = appliedSet.has(action.id);

                  if (action.type === 'add_to_shopping_list') {
                    const estTotal = action.items.reduce(
                      (s, it) => s + it.estimatedCostIsk,
                      0
                    );
                    const previewSummary = action.items
                      .slice(0, 3)
                      .map((it) => `${it.quantity.toLocaleString('en-US')}× ${it.name}`)
                      .join(', ');

                    return (
                      <div key={action.id} className="space-y-1">
                        <button
                          type="button"
                          disabled={isApplied}
                          onClick={() => onExecuteAction(action)}
                          className={`w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                            isApplied
                              ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 cursor-default'
                              : 'bg-amber-500/12 border-amber-400/45 text-amber-200 hover:bg-amber-500/20'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5 truncate">
                            {isApplied ? (
                              <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span className="truncate">
                              {isApplied ? 'Added to Jita Shopping List' : action.label}
                            </span>
                          </span>
                          {estTotal > 0 && (
                            <span className="font-mono tabular-nums text-[11px] opacity-85 shrink-0">
                              {formatIsk(estTotal)}
                            </span>
                          )}
                        </button>
                        <div className="text-[11px] text-slate-400 px-1 truncate">
                          {previewSummary}
                          {action.items.length > 3
                            ? ` +${action.items.length - 3} more`
                            : ''}
                        </div>
                      </div>
                    );
                  }

                  return (
                    <button
                      key={action.id}
                      type="button"
                      onClick={() => onExecuteAction(action)}
                      className="w-full inline-flex items-center justify-between gap-2 px-3 py-2 text-xs font-medium rounded-md border border-cyan-500/35 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                    >
                      <span className="truncate">{action.label}</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            )}

            {msg.toolsUsed && msg.toolsUsed.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center gap-1.5 text-[11px] text-slate-500 font-mono">
                <Wrench className="w-3 h-3 text-cyan-400/80 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Engines queried: {msg.toolsUsed.join(', ')}
                </span>
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="bg-[#131822] border border-slate-800/90 rounded-lg p-3.5 text-xs text-slate-400">
            Analyzing live dashboard telemetry &amp; computing tactical actions...
          </div>
        )}
      </div>

      {/* 3 One-Click Quick-Prompt Chips Above Input Box */}
      <div className="px-3.5 py-2.5 border-t border-slate-800/70 bg-[#0b0e14]/70 shrink-0">
        <div className="grid grid-cols-3 gap-1.5">
          {QUICK_PROMPT_CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={isLoading}
              onClick={() => onSendMessage(chip.prompt)}
              className="px-2 py-1.5 text-[11px] font-medium text-slate-200 bg-[#131822] border border-slate-800 hover:border-cyan-400/50 hover:text-cyan-200 rounded transition-colors disabled:opacity-50 text-center whitespace-nowrap truncate cursor-pointer"
              title={chip.label}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {/* Input Composer */}
      <form
        onSubmit={handleSubmit}
        className="p-3 border-t border-slate-800/90 bg-[#0d1118] flex items-center gap-2 shrink-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about screen numbers, builds, routes, or strategy..."
          className="flex-1 min-w-0 bg-[#131822] border border-slate-800 focus:border-cyan-400/70 focus:outline-none rounded-md px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          aria-label="Send message to advisor"
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 hover:bg-cyan-500/30 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Send className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Send</span>
        </button>
      </form>
    </aside>
  );
}
