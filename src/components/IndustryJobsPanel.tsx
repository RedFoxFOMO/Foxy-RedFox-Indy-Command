import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  Plus,
  RefreshCw,
  Sparkles,
  Table2,
} from 'lucide-react';
import { formatIsk, formatPct } from '../engines/decisionEngines.ts';
import type { ActionCardData, CharacterIndustryJob, PilotProfile } from '../types/eve.ts';
import { useCollapsibleCard } from '../utils/collapseStore.ts';

interface IndustryJobsPanelProps {
  profile: PilotProfile;
  indyCards: ActionCardData[];
  queuedRouteCardIds: string[];
  isRefreshingJobs: boolean;
  jobsError: string | null;
  onRefreshJobs: () => void;
  onInspectCard: (card: ActionCardData) => void;
  onAddToRoute: (cardId: string) => void;
}

function formatCountdown(endIso: string, nowMs: number): { label: string; isReady: boolean; pctDone: number } {
  const endMs = Date.parse(endIso);
  if (!Number.isFinite(endMs)) return { label: '—', isReady: false, pctDone: 0 };
  const diffSec = Math.floor((endMs - nowMs) / 1000);
  if (diffSec <= 0) {
    return { label: 'READY TO DELIVER', isReady: true, pctDone: 100 };
  }
  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const mins = Math.floor((diffSec % 3600) / 60);
  const secs = diffSec % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  return {
    label: days > 0 ? `${days}d ${hh}:${mm}:${ss}` : `${hh}:${mm}:${ss}`,
    isReady: false,
    pctDone: 0,
  };
}

function computeProgressPct(startIso: string, endIso: string, nowMs: number): number {
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 50;
  const pct = ((nowMs - start) / (end - start)) * 100;
  return Math.max(0, Math.min(100, pct));
}

export function IndustryJobsPanel({
  profile,
  indyCards,
  queuedRouteCardIds,
  isRefreshingJobs,
  jobsError,
  onRefreshJobs,
  onInspectCard,
  onAddToRoute,
}: IndustryJobsPanelProps) {
  const [collapsed, toggleCollapsed] = useCollapsibleCard('panel-industry-jobs', false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const jobs: CharacterIndustryJob[] = profile.industryJobs ?? [];

  // EVE Online slot formulas:
  // Manufacturing max slots = 1 + Mass Production + Advanced Mass Production (max 11)
  // Science (Invention / ME / TE / Copy) max slots = 1 + Laboratory Operation + Advanced Lab Op (max 11)
  const maxMfgSlots =
    1 + (profile.skills.massProduction ?? 5) + (profile.skills.advancedMassProduction ?? 4);
  const maxScienceSlots =
    1 +
    (profile.skills.laboratoryOperation ?? 5) +
    (profile.skills.advancedLaboratoryOperation ?? 4);

  const slotStats = useMemo(() => {
    const activeJobs = jobs.filter((j) => j.status === 'active' || j.status === 'ready');
    const mfgActive = activeJobs.filter((j) => j.activityId === 1).length;
    const sciActive = activeJobs.filter((j) =>
      [3, 4, 5, 8].includes(j.activityId)
    ).length;
    const readyCount = activeJobs.filter(
      (j) => j.status === 'ready' || Date.parse(j.endDate) <= nowMs
    ).length;
    return {
      totalActive: activeJobs.length,
      mfgActive,
      mfgOpen: Math.max(0, maxMfgSlots - mfgActive),
      sciActive,
      sciOpen: Math.max(0, maxScienceSlots - sciActive),
      readyCount,
    };
  }, [jobs, maxMfgSlots, maxScienceSlots, nowMs]);

  // Automated "Next Best BPO/BPC to Start" recommendation based on current hub margins
  // Excludes products already running in active manufacturing jobs
  const nextBestRecommendation = useMemo(() => {
    const runningProductIds = new Set(
      jobs
        .filter((j) => j.activityId === 1 && j.productTypeId)
        .map((j) => j.productTypeId!)
    );
    const positiveIndy = indyCards
      .filter((c) => c.netProfitIsk > 0)
      .sort((a, b) => b.netProfitIsk - a.netProfitIsk);

    const notRunning = positiveIndy.find(
      (c) => !c.primaryTypeId || !runningProductIds.has(c.primaryTypeId)
    );
    return notRunning ?? positiveIndy[0] ?? null;
  }, [indyCards, jobs]);

  const isNextBestQueued = nextBestRecommendation
    ? queuedRouteCardIds.includes(nextBestRecommendation.id)
    : false;

  return (
    <section
      aria-label="Active Industry Jobs and Slot Monitor"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Header Row */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0e131b]/70">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <Cpu className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Active Industry Jobs &amp; Slot Monitor
          </h2>
          <span
            className={`font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border ${
              slotStats.mfgOpen > 0
                ? 'border-amber-500/45 bg-amber-500/10 text-amber-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            Mfg {slotStats.mfgActive}/{maxMfgSlots}
          </span>
          <span
            className={`font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border ${
              slotStats.sciOpen > 0
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            Sci/Inv {slotStats.sciActive}/{maxScienceSlots}
          </span>
          {slotStats.readyCount > 0 && (
            <span className="font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border border-emerald-400/60 bg-emerald-500/15 text-emerald-200 font-semibold">
              {slotStats.readyCount} Ready to Deliver
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefreshJobs}
            disabled={isRefreshingJobs || profile.mode !== 'eve_sso'}
            title={
              profile.mode === 'eve_sso'
                ? 'Refresh running jobs from EVE ESI (/characters/{id}/industry/jobs/)'
                : 'Connect EVE SSO to fetch live running industry jobs'
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#0b0e14] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3 h-3 ${isRefreshingJobs ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isRefreshingJobs ? 'Syncing Jobs...' : 'Refresh Jobs'}</span>
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand Industry Jobs monitor' : 'Collapse Industry Jobs monitor'}
            className="p-1.5 rounded border border-slate-700/80 bg-[#0b0e14] text-slate-400 hover:text-slate-100 hover:border-slate-600 transition-colors cursor-pointer"
          >
            {collapsed ? (
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="divide-y divide-slate-800/80">
          {/* Open Slot Alert + Next Best BPO/BPC Recommendation Banner */}
          {(slotStats.mfgOpen > 0 || slotStats.sciOpen > 0) && (
            <div className="px-4 py-3 bg-amber-500/5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <AlertTriangle
                  className="w-4 h-4 text-amber-400 shrink-0 mt-0.5"
                  aria-hidden="true"
                />
                <div className="text-xs leading-relaxed">
                  <div className="text-amber-200 font-medium">
                    Open Industry Slots Detected:{' '}
                    <span className="font-mono tabular-nums">
                      {slotStats.mfgOpen} Manufacturing · {slotStats.sciOpen} Science/Invention
                    </span>{' '}
                    idle.
                  </div>
                  {nextBestRecommendation && (
                    <div className="text-slate-300 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="inline-flex items-center gap-1 text-cyan-300 font-medium">
                        <Sparkles className="w-3 h-3" aria-hidden="true" />
                        <span>Next Best BPO/BPC to Start:</span>
                      </span>
                      <span className="text-slate-100 font-semibold">
                        {nextBestRecommendation.title}
                      </span>
                      <span className="font-mono tabular-nums text-emerald-400">
                        +{formatIsk(nextBestRecommendation.netProfitIsk)} ({formatPct(nextBestRecommendation.roiPct)} ROI)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {nextBestRecommendation && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onInspectCard(nextBestRecommendation)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-slate-700 bg-[#0b0e14] text-slate-200 hover:border-cyan-400/50 hover:text-cyan-200 transition-colors cursor-pointer"
                  >
                    <Table2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Inspect BOM</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onAddToRoute(nextBestRecommendation.id)}
                    disabled={isNextBestQueued}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border border-cyan-500/45 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{isNextBestQueued ? 'Queued in Route' : 'Queue Build'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {jobsError && (
            <div className="px-4 py-2 bg-rose-500/10 text-xs text-rose-300">{jobsError}</div>
          )}

          {/* Running Jobs Table */}
          {jobs.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-400">
              No active Manufacturing, Invention, or Research jobs reported. Start a blueprint run in-game and click Refresh Jobs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-[#0e131b]/80 border-b border-slate-800 text-slate-400">
                    <th className="py-2 px-4 text-left font-medium">Activity</th>
                    <th className="py-2 px-3 text-left font-medium">Blueprint / Output</th>
                    <th className="py-2 px-3 text-right font-medium">Runs</th>
                    <th className="py-2 px-3 text-left font-medium">Facility</th>
                    <th className="py-2 px-3 text-right font-medium">Job Fee</th>
                    <th className="py-2 px-4 text-right font-medium">Live Countdown</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {jobs.map((job) => {
                    const timer = formatCountdown(job.endDate, nowMs);
                    const pct = computeProgressPct(job.startDate, job.endDate, nowMs);
                    const isMfg = job.activityId === 1;
                    return (
                      <tr key={job.jobId} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <span
                            className={`inline-block font-mono text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                              isMfg
                                ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
                                : job.activityId === 8
                                  ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300'
                                  : 'border-indigo-400/40 bg-indigo-500/10 text-indigo-300'
                            }`}
                          >
                            {job.activityLabel}
                          </span>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="text-slate-100 font-medium">{job.productName}</div>
                          <div className="text-[10px] text-slate-500">{job.blueprintName}</div>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          {job.runs.toLocaleString('en-US')}
                        </td>
                        <td
                          className="py-2.5 px-3 text-slate-400 max-w-[230px] truncate"
                          title={job.facilityName}
                        >
                          {job.facilityName}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400 whitespace-nowrap">
                          {(() => {
                            const fee = job.cost ?? job.costIsk ?? 0;
                            return fee > 0 ? formatIsk(fee) : '—';
                          })()}
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex flex-col items-end gap-1 min-w-[130px]">
                            <span
                              className={`inline-flex items-center gap-1 font-mono tabular-nums font-semibold ${
                                timer.isReady ? 'text-emerald-400' : 'text-cyan-300'
                              }`}
                            >
                              {timer.isReady ? (
                                <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              ) : (
                                <Clock className="w-3 h-3" aria-hidden="true" />
                              )}
                              <span>{timer.label}</span>
                            </span>
                            <div className="w-28 h-1 rounded-full bg-slate-800 overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  timer.isReady ? 'bg-emerald-400' : 'bg-cyan-400'
                                }`}
                                style={{ width: `${Math.round(pct)}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {profile.mode === 'simulation' && (
            <div className="px-4 py-2 bg-[#0e131b]/50 text-[11px] text-slate-500">
              Showing Simulation Baseline jobs. Connect EVE SSO to monitor your character&apos;s live Tranquility industry queue (`esi-industry.read_character_jobs.v1`).
            </div>
          )}
        </div>
      )}
    </section>
  );
}
