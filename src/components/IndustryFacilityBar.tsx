import { Building2, ChevronDown, ChevronUp, Factory, RefreshCw } from 'lucide-react';
import { INDUSTRY_PRESET_SYSTEMS } from '../data/eveCatalog.ts';
import { getUpwellStructureBonuses } from '../engines/decisionEngines.ts';
import type {
  IndustryCostSnapshot,
  IndustryStructureConfig,
  IndustryStructureType,
  RigTier,
} from '../types/eve.ts';
import { useCollapsibleCard } from '../utils/collapseStore.ts';

interface IndustryFacilityBarProps {
  config: IndustryStructureConfig;
  industryCosts: IndustryCostSnapshot | null;
  isRefreshingCosts: boolean;
  onChangeConfig: (next: IndustryStructureConfig) => void;
  onRefreshCosts: () => void;
}

const STRUCTURE_OPTIONS: { id: IndustryStructureType; label: string; tag: string }[] = [
  { id: 'npc_station', label: 'NPC Station', tag: '0% ME · 0% Cost · 0.25% Tax' },
  { id: 'raitaru', label: 'Raitaru (M)', tag: '-1% ME · -3% Cost · -15% TE' },
  { id: 'azbel', label: 'Azbel (L)', tag: '-1% ME · -4% Cost · -20% TE' },
  { id: 'sotiyo', label: 'Sotiyo (XL)', tag: '-1% ME · -5% Cost · -30% TE' },
  { id: 'athanor', label: 'Athanor (M)', tag: 'Refinery · -2% Cost · -15% TE' },
  { id: 'tatara', label: 'Tatara (L)', tag: 'Refinery · -4% Cost · -25% TE' },
];

const RIG_TIERS: { id: RigTier; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 't1', label: 'T1' },
  { id: 't2', label: 'T2' },
];

export function IndustryFacilityBar({
  config,
  industryCosts,
  isRefreshingCosts,
  onChangeConfig,
  onRefreshCosts,
}: IndustryFacilityBarProps) {
  const [collapsed, toggleCollapsed] = useCollapsibleCard('panel-industry-facility', false);

  const sysIndices = industryCosts?.costIndicesBySystem[config.systemId];
  const mfgIndexPct = (sysIndices?.manufacturing ?? 0.042) * 100;
  const invIndexPct = (sysIndices?.invention ?? 0.024) * 100;
  const copyIndexPct = (sysIndices?.copying ?? 0.018) * 100;
  const bonuses = getUpwellStructureBonuses(config);
  const isUpwell = config.structureType !== 'npc_station';

  const handleSelectSystem = (systemId: number) => {
    const preset = INDUSTRY_PRESET_SYSTEMS.find((s) => s.systemId === systemId);
    onChangeConfig({
      ...config,
      systemId,
      systemName: preset?.systemName ?? `System ${systemId}`,
    });
  };

  const handleSelectStructure = (structureType: IndustryStructureType) => {
    onChangeConfig({
      ...config,
      structureType,
      facilityTaxPct: structureType === 'npc_station' ? 0.25 : Math.max(0.25, config.facilityTaxPct),
      meRig: structureType === 'npc_station' ? 'none' : config.meRig,
      teRig: structureType === 'npc_station' ? 'none' : config.teRig,
      costRig: structureType === 'npc_station' ? 'none' : config.costRig,
    });
  };

  return (
    <section
      aria-label="Live System Cost Indices and Upwell Structure Rig Bonuses"
      className="bg-[#131822] border border-slate-800/90 rounded-lg overflow-hidden"
    >
      {/* Collapsible Header */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0e131b]/70">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <Factory className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Live System Cost Indices &amp; Upwell Rig Bonuses
          </h2>
          <span className="font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border border-cyan-500/30 bg-cyan-500/10 text-cyan-200">
            {config.systemName} · Mfg {mfgIndexPct.toFixed(2)}% · Inv {invIndexPct.toFixed(2)}%
          </span>
          <span className="font-mono tabular-nums text-[11px] px-2 py-0.5 rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
            {bonuses.label}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onRefreshCosts}
            disabled={isRefreshingCosts}
            title="Refresh live CCP /industry/systems/ cost indices and /markets/prices/ adjusted values"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded border border-slate-700/90 bg-[#0b0e14] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-50 transition-colors cursor-pointer"
          >
            <RefreshCw
              className={`w-3 h-3 ${isRefreshingCosts ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            <span>{isRefreshingCosts ? 'Syncing ESI...' : 'Sync Cost Indices'}</span>
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand Industry Facility controls' : 'Collapse Industry Facility controls'}
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
        <div className="p-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Solar System & Live Indices */}
          <div className="lg:col-span-4 space-y-2.5">
            <label className="block">
              <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                Manufacturing System (CCP ESI Index)
              </span>
              <select
                value={config.systemId}
                onChange={(e) => handleSelectSystem(Number(e.target.value))}
                className="mt-1 w-full bg-[#0b0e14] border border-slate-700/90 rounded-md px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
              >
                {INDUSTRY_PRESET_SYSTEMS.map((sys) => {
                  const sIdx = industryCosts?.costIndicesBySystem[sys.systemId];
                  const pctLabel = sIdx ? ` (Mfg ${(sIdx.manufacturing * 100).toFixed(2)}%)` : '';
                  return (
                    <option key={sys.systemId} value={sys.systemId}>
                      {sys.systemName} — {sys.note}
                      {pctLabel}
                    </option>
                  );
                })}
              </select>
            </label>

            <div className="grid grid-cols-3 gap-2 pt-0.5">
              <div className="bg-[#0e131b] border border-slate-800 rounded px-2.5 py-1.5">
                <div className="text-[10px] text-slate-500">Mfg Index</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-amber-300 mt-0.5">
                  {mfgIndexPct.toFixed(2)}%
                </div>
              </div>
              <div className="bg-[#0e131b] border border-slate-800 rounded px-2.5 py-1.5">
                <div className="text-[10px] text-slate-500">Invention</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-cyan-300 mt-0.5">
                  {invIndexPct.toFixed(2)}%
                </div>
              </div>
              <div className="bg-[#0e131b] border border-slate-800 rounded px-2.5 py-1.5">
                <div className="text-[10px] text-slate-500">Copying</div>
                <div className="font-mono tabular-nums text-xs font-semibold text-slate-200 mt-0.5">
                  {copyIndexPct.toFixed(2)}%
                </div>
              </div>
            </div>
          </div>

          {/* Upwell Structure Selector */}
          <div className="lg:col-span-4 space-y-2">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              <span className="inline-flex items-center gap-1">
                <Building2 className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                <span>Engineering Complex</span>
              </span>
              <span className="font-mono text-[10px] text-slate-500 normal-case">
                +4.0% SCC Surcharge
              </span>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {STRUCTURE_OPTIONS.map((opt) => {
                const active = config.structureType === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSelectStructure(opt.id)}
                    className={`px-2.5 py-2 rounded-md border text-left transition-colors cursor-pointer ${
                      active
                        ? 'border-cyan-400/70 bg-cyan-500/15 text-cyan-100'
                        : 'border-slate-800 bg-[#0b0e14] text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5 truncate">
                      {opt.tag}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* High-Sec Rigs + Facility Tax */}
          <div className="lg:col-span-4 space-y-2.5">
            <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 uppercase tracking-wider">
              <span>High-Sec Rig Bonuses</span>
              <label className="inline-flex items-center gap-1.5 normal-case text-slate-300">
                <span className="text-[11px] text-slate-400">Facility Tax %</span>
                <input
                  type="number"
                  min={0}
                  max={25}
                  step={0.25}
                  value={config.facilityTaxPct}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(25, Number(e.target.value) || 0));
                    onChangeConfig({ ...config, facilityTaxPct: v });
                  }}
                  className="w-16 bg-[#0b0e14] border border-slate-700 rounded px-1.5 py-0.5 text-right font-mono tabular-nums text-xs text-slate-100 focus:outline-none focus:border-cyan-400"
                />
              </label>
            </div>

            <div className="space-y-1.5">
              {(
                [
                  {
                    key: 'meRig',
                    label: 'ME Rig (Materials)',
                    hint: 'T1 -2.0% · T2 -2.4%',
                  },
                  {
                    key: 'costRig',
                    label: 'Cost Rig (Job Fee)',
                    hint: 'T1 -2.0% · T2 -2.4%',
                  },
                  {
                    key: 'teRig',
                    label: 'TE Rig (Job Time)',
                    hint: 'T1 -20% · T2 -24%',
                  },
                ] as const
              ).map((rigRow) => (
                <div
                  key={rigRow.key}
                  className="flex items-center justify-between gap-2 bg-[#0e131b] border border-slate-800/80 rounded px-2.5 py-1.5"
                >
                  <div className="min-w-0">
                    <div className="text-xs text-slate-200 font-medium">{rigRow.label}</div>
                    <div className="text-[10px] text-slate-500 font-mono">{rigRow.hint}</div>
                  </div>
                  <div className="inline-flex rounded border border-slate-800 bg-[#0b0e14] p-0.5 shrink-0">
                    {RIG_TIERS.map((tier) => {
                      const active = config[rigRow.key] === tier.id;
                      return (
                        <button
                          key={tier.id}
                          type="button"
                          disabled={!isUpwell && tier.id !== 'none'}
                          onClick={() =>
                            onChangeConfig({
                              ...config,
                              [rigRow.key]: tier.id,
                            })
                          }
                          className={`px-2 py-0.5 text-[11px] font-mono rounded transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
                            active
                              ? 'bg-amber-500/20 text-amber-200'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {tier.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
