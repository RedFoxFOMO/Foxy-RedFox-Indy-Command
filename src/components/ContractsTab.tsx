import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  FileText,
  MapPin,
  Package,
  RefreshCw,
  Route,
  ShieldAlert,
  Truck,
} from 'lucide-react';
import { EMPIRE_HUB_LIST, EMPIRE_HUB_MAP } from '../data/eveCatalog.ts';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import { getDotlanRouteUrl, getDotlanSystemUrl } from '../utils/dotlan.ts';
import { formatDurationCompact } from '../utils/eveMarketMath.ts';
import { copyTextToClipboard } from '../utils/eveMultibuy.ts';
import {
  COURIER_HULL_PRESETS,
  evaluateCourierContracts,
  evaluateItemAndBpcContracts,
} from '../utils/v22Engines.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  EvaluatedCourierContract,
  EvaluatedItemBpcContract,
  IndustryStructureConfig,
  MarketSnapshot,
  PilotProfile,
  RawPublicContract,
  TradeHubId,
} from '../types/eve.ts';
import { InfoTip } from './InfoTip.tsx';

interface ContractsTabProps {
  profile: PilotProfile;
  snapshot: MarketSnapshot;
  structureConfig: IndustryStructureConfig;
  appSettings: AppSettingsV22;
  eveAccessToken: string | null;
  onPinToRoute: (card: ActionCardData) => void;
  onOpenSettings: () => void;
}

type SortKey =
  | 'profitIsk'
  | 'profitPct'
  | 'collateralStatus'
  | 'incomeHr'
  | 'totalJumps'
  | 'volumeM3'
  | 'rewardOrPrice';

export function ContractsTab({
  profile,
  snapshot,
  structureConfig,
  appSettings,
  eveAccessToken,
  onPinToRoute,
  onOpenSettings,
}: ContractsTabProps) {
  const [mode, setMode] = useState<'courier' | 'item_bpc'>('courier');
  const [hubId, setHubId] = useState<TradeHubId>('jita');
  const [rawContracts, setRawContracts] = useState<RawPublicContract[]>([]);
  const [jumpMatrix, setJumpMatrix] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [roundTrip, setRoundTrip] = useState(true);
  const [selectedHullId, setSelectedHullId] = useState<string>(COURIER_HULL_PRESETS[2].id);
  const [reprocessOutputMode, setReprocessOutputMode] = useState<'instant' | 'sell_order'>('instant');
  const [qtyMultiplierByContract, setQtyMultiplierByContract] = useState<Record<number, number>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>('profitIsk');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [openEveStatus, setOpenEveStatus] = useState<string | null>(null);

  const selectedHub = EMPIRE_HUB_MAP[hubId] ?? EMPIRE_HUB_MAP.jita;

  const availableHulls = useMemo(() => {
    const owned = (profile.hulls || []).map((h) => ({
      id: `owned:${h.id}`,
      name: `${h.name} (Owned · ${formatM3(h.capacityM3)})`,
      capacityM3: h.capacityM3,
      alignSec: h.hullClass === 'blockade_runner' ? 3.5 : h.hullClass === 'dst' ? 9.8 : h.hullClass === 'freighter' ? 26 : 7.5,
      warpAuPerSec: h.hullClass === 'blockade_runner' ? 6.0 : h.hullClass === 'dst' ? 3.8 : h.hullClass === 'freighter' ? 1.5 : 4.5,
    }));
    return [...owned, ...COURIER_HULL_PRESETS];
  }, [profile.hulls]);

  const activeHull = useMemo(
    () => availableHulls.find((h) => h.id === selectedHullId) ?? COURIER_HULL_PRESETS[2],
    [availableHulls, selectedHullId]
  );

  const loadContracts = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const apiUrl = `/api/contracts/public?regionId=${selectedHub.regionId}&type=${
        mode === 'courier' ? 'courier' : 'item_exchange'
      }`;
      const res = await fetch(apiUrl);
      if (!res.ok) throw new Error(`Contracts proxy returned HTTP ${res.status}`);
      const json = (await res.json()) as { contracts?: RawPublicContract[] };
      const list = Array.isArray(json.contracts) ? json.contracts : [];
      setRawContracts(list);

      // Batch 3-leg routing distances for courier contracts via POST /api/route/distances (2026 ESI POST /route)
      if (mode === 'courier' && list.length > 0) {
        const pairs: { origin: number; destination: number }[] = [];
        for (const c of list.slice(0, 20)) {
          const s = c.start_system_id;
          const e = c.end_system_id;
          if (s && s > 0) {
            if (profile.currentSystemId !== s) pairs.push({ origin: profile.currentSystemId, destination: s });
            if (e && e > 0 && s !== e) pairs.push({ origin: s, destination: e });
            if (e && e > 0 && e !== profile.currentSystemId) pairs.push({ origin: e, destination: profile.currentSystemId });
          }
        }
        if (pairs.length > 0) {
          const routeRes = await fetch('/api/route/distances', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pairs: pairs.slice(0, 60),
              preference: appSettings.defaultRoutingPreference,
            }),
          });
          if (routeRes.ok) {
            const rJson = (await routeRes.json()) as { distances?: Record<string, number> };
            if (rJson.distances) setJumpMatrix(rJson.distances);
          }
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load public contracts.');
    } finally {
      setLoading(false);
    }
  }, [selectedHub.regionId, mode, profile.currentSystemId, appSettings.defaultRoutingPreference]);

  useEffect(() => {
    void loadContracts();
  }, [loadContracts]);

  const courierRows = useMemo<EvaluatedCourierContract[]>(() => {
    const base = evaluateCourierContracts({
      rawContracts,
      regionId: selectedHub.regionId,
      regionName: selectedHub.regionName,
      snapshot,
      jumpMatrix,
      pilotSystemId: profile.currentSystemId,
      hull: activeHull,
      manualClickCadenceSec: appSettings.manualJumpCadenceSec,
      roundTrip,
    });
    const mult = (c: EvaluatedCourierContract) => Math.max(1, qtyMultiplierByContract[c.contractId] ?? 1);
    return [...base].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const ma = mult(a);
      const mb = mult(b);
      switch (sortKey) {
        case 'profitIsk':
          return (a.netProfitIsk * ma - b.netProfitIsk * mb) * dir;
        case 'profitPct':
          return (a.profitPct - b.profitPct) * dir;
        case 'collateralStatus':
          return (a.collateralCoveragePct - b.collateralCoveragePct) * dir;
        case 'incomeHr':
          return (a.incomePerTotalHrIsk - b.incomePerTotalHrIsk) * dir;
        case 'totalJumps':
          return (a.totalJumps - b.totalJumps) * dir;
        case 'volumeM3':
          return (a.volumeM3 * ma - b.volumeM3 * mb) * dir;
        case 'rewardOrPrice':
          return (a.rewardIsk * ma - b.rewardIsk * mb) * dir;
      }
    });
  }, [
    rawContracts,
    selectedHub,
    snapshot,
    jumpMatrix,
    profile.currentSystemId,
    activeHull,
    appSettings.manualJumpCadenceSec,
    roundTrip,
    qtyMultiplierByContract,
    sortKey,
    sortDir,
  ]);

  const itemRows = useMemo<EvaluatedItemBpcContract[]>(() => {
    const base = evaluateItemAndBpcContracts({
      rawContracts,
      regionId: selectedHub.regionId,
      regionName: selectedHub.regionName,
      snapshot,
      profile,
      structureConfig,
      appSettings,
      reprocessOutputMode,
    });
    const mult = (c: EvaluatedItemBpcContract) => Math.max(1, qtyMultiplierByContract[c.contractId] ?? 1);
    return [...base].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const ma = mult(a);
      const mb = mult(b);
      switch (sortKey) {
        case 'profitIsk':
          return (a.netProfitIsk * ma - b.netProfitIsk * mb) * dir;
        case 'profitPct':
          return (a.profitPct - b.profitPct) * dir;
        case 'collateralStatus':
          return (a.valuationDeltaPct - b.valuationDeltaPct) * dir;
        case 'volumeM3':
          return (a.volumeM3 * ma - b.volumeM3 * mb) * dir;
        case 'rewardOrPrice':
          return (a.contractPriceIsk * ma - b.contractPriceIsk * mb) * dir;
        default:
          return (a.netProfitIsk * ma - b.netProfitIsk * mb) * dir;
      }
    });
  }, [
    rawContracts,
    selectedHub,
    snapshot,
    profile,
    structureConfig,
    appSettings,
    reprocessOutputMode,
    qtyMultiplierByContract,
    sortKey,
    sortDir,
  ]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return null;
    return sortDir === 'asc' ? (
      <ArrowUp className="w-3 h-3 inline ml-0.5 text-cyan-300" />
    ) : (
      <ArrowDown className="w-3 h-3 inline ml-0.5 text-cyan-300" />
    );
  };

  const handleOpenInEve = async (contractId: number) => {
    if (profile.mode !== 'eve_sso' || !eveAccessToken) {
      setOpenEveStatus('Connect EVE SSO in Settings (with esi-ui.open_window.v1) to open contracts in-game.');
      return;
    }
    setOpenEveStatus(null);
    try {
      const res = await fetch('/api/eve/ui/open-contract', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eveAccessToken}`,
        },
        body: JSON.stringify({ contractId }),
      });
      if (!res.ok) {
        const j = (await res.json()) as { error?: string };
        setOpenEveStatus(j.error || `EVE ESI returned HTTP ${res.status}`);
      } else {
        setOpenEveStatus(`Opened Contract #${contractId} in your active EVE Online client.`);
      }
    } catch {
      setOpenEveStatus('Unable to reach EVE UI endpoint.');
    }
  };

  const handleCopyVerifyManifest = async (contractId: number, lines: string[]) => {
    const ok = await copyTextToClipboard(lines.join('\n'));
    if (ok) {
      setCopiedId(contractId);
      setTimeout(() => setCopiedId((prev) => (prev === contractId ? null : prev)), 2000);
    }
  };

  const handlePinCourier = (c: EvaluatedCourierContract) => {
    const mult = Math.max(1, qtyMultiplierByContract[c.contractId] ?? 1);
    const card: ActionCardData = {
      id: `contract-courier-${c.contractId}`,
      engine: 'regional_trade',
      engineLabel: 'Courier Contract',
      title: `Courier #${c.contractId}: ${c.startSystemName} → ${c.endSystemName}`,
      subtitle: `${formatM3(c.volumeM3 * mult)} · Collateral ${formatIsk(c.collateralIsk * mult)} · ${c.totalJumps}j`,
      categories: [],
      stationAnchor: c.startStationName,
      recommendedHull: activeHull.name,
      hullClass: 'dst',
      requiredCapitalIsk: c.collateralIsk * mult,
      totalVolumeM3: c.volumeM3 * mult,
      safeDailyQty: `${mult} contract${mult > 1 ? 's' : ''}`,
      marketDepthUnits: mult,
      marketDepthDetail: c.classificationLabel,
      outputUnits: mult,
      perUnitNetProfitIsk: c.rewardIsk,
      netProfitIsk: c.rewardIsk * mult,
      grossRevenueIsk: c.rewardIsk * mult,
      netMarginPct: c.profitPct,
      roiPct: c.profitPct,
      executionMode: 'instant_fill',
      salesTaxPct: 0,
      brokerFeePct: 0,
      riskLabel: c.classification === 'bait_scam' ? 'Watch Depth' : 'Nominal',
      steps: [
        `Accept Courier Contract #${c.contractId} in-game (ESI contracts are read-only for acceptance).`,
        `Pick up ${formatM3(c.volumeM3 * mult)} at ${c.startStationName}.`,
        `Deliver to ${c.endStationName} (${c.jobJumps}j job leg · ${formatDurationCompact(c.totalTimeSec)} total).`,
      ],
      inspection: {
        summaryText: `Courier #${c.contractId}: ${c.classificationLabel}.`,
        columns: [
          { key: 'leg', label: 'Leg', align: 'left' },
          { key: 'jumps', label: 'Jumps', align: 'right' },
          { key: 'time', label: 'Est Time', align: 'right' },
        ],
        rows: [
          { leg: 'Approach', jumps: c.approachJumps, time: formatDurationCompact(c.approachTimeSec) },
          { leg: 'Job', jumps: c.jobJumps, time: formatDurationCompact(c.jobTimeSec) },
          { leg: 'Return', jumps: c.returnJumps, time: formatDurationCompact(c.returnTimeSec) },
        ],
      },
      routeChains: [
        {
          cardId: `contract-courier-${c.contractId}`,
          cardTitle: `Courier #${c.contractId}: ${c.startSystemName} -> ${c.endSystemName}`,
          legs: [
            {
              action: 'buy',
              systemId: c.startSystemId,
              systemName: c.startSystemName,
              stationName: c.startStationName,
              cargoDeltaM3: c.volumeM3 * mult,
              iskCost: c.collateralIsk * mult,
              items: [{ name: `Courier Package #${c.contractId}`, quantity: mult, iskAmount: c.collateralIsk * mult, volumeM3: c.volumeM3 * mult }],
            },
            {
              action: 'sell',
              systemId: c.endSystemId,
              systemName: c.endSystemName,
              stationName: c.endStationName,
              cargoDeltaM3: -(c.volumeM3 * mult),
              iskPayout: c.rewardIsk * mult,
              netProfitIsk: c.rewardIsk * mult,
              items: [{ name: `Courier Package #${c.contractId}`, quantity: mult, iskAmount: c.rewardIsk * mult, volumeM3: c.volumeM3 * mult }],
            },
          ],
        },
      ],
    };
    onPinToRoute(card);
  };

  const handlePinItemBpc = (c: EvaluatedItemBpcContract) => {
    const mult = Math.max(1, qtyMultiplierByContract[c.contractId] ?? 1);
    const card: ActionCardData = {
      id: `contract-item-${c.contractId}`,
      engine: c.hasBpc ? 'indy_invention' : 'regional_trade',
      engineLabel: c.hasBpc ? 'BPC Contract' : 'Item Contract',
      title: `Contract #${c.contractId}: ${c.title}`,
      subtitle: `${c.bestStrategy.replace('_', ' ')} · ${c.stationName}`,
      categories: [],
      stationAnchor: c.stationName,
      recommendedHull: activeHull.name,
      hullClass: 't1_industrial',
      requiredCapitalIsk: c.contractPriceIsk * mult,
      totalVolumeM3: c.volumeM3 * mult,
      safeDailyQty: `${mult}x`,
      marketDepthUnits: mult,
      marketDepthDetail: `${c.valuationBadge} (${c.valuationDeltaPct.toFixed(1)}%)`,
      outputUnits: mult,
      perUnitNetProfitIsk: c.netProfitIsk,
      netProfitIsk: c.netProfitIsk * mult,
      grossRevenueIsk: c.bestValueIsk * mult,
      netMarginPct: c.profitPct,
      roiPct: c.profitPct,
      executionMode: reprocessOutputMode === 'instant' ? 'instant_fill' : 'list_orders',
      salesTaxPct: 7.5 * (1 - 0.11 * profile.skills.accounting),
      brokerFeePct: 0,
      riskLabel: c.netProfitIsk > 0 ? 'High Margin' : 'Watch Depth',
      steps: [
        `Inspect & accept Contract #${c.contractId} in-game at ${c.stationName}.`,
        `Execute optimal strategy: ${c.bestStrategy.replace('_', ' ')} for ${formatIsk(c.netProfitIsk * mult)} est. net profit.`,
      ],
      inspection: {
        summaryText: `Contract #${c.contractId} evaluated across Instant Sale, Sell Orders, Reprocessing, and BPC Build.`,
        columns: [
          { key: 'item', label: 'Included Item', align: 'left' },
          { key: 'qty', label: 'Qty', align: 'right' },
        ],
        rows: c.items.map((it) => ({ item: it.name, qty: it.quantity * mult })),
      },
      routeChains: [
        {
          cardId: `contract-item-${c.contractId}`,
          cardTitle: `Contract #${c.contractId}: ${c.title}`,
          legs: [
            {
              action: 'buy',
              systemId: selectedHub.systemId,
              systemName: c.systemName,
              stationName: c.stationName,
              cargoDeltaM3: c.volumeM3 * mult,
              iskCost: c.contractPriceIsk * mult,
              netProfitIsk: c.netProfitIsk * mult,
              items: c.items.slice(0, 6).map((it) => ({
                typeId: it.typeId,
                name: it.name,
                quantity: it.quantity * mult,
                iskAmount: (c.contractPriceIsk * mult) / Math.max(1, c.items.length),
                volumeM3: (c.volumeM3 * mult) / Math.max(1, c.items.length),
              })),
            },
          ],
        },
      ],
    };
    onPinToRoute(card);
  };

  return (
    <div className="space-y-4">
      {/* Controls Toolbar */}
      <div className="bg-[#10151f] border border-slate-800 rounded-lg p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-md border border-slate-700 bg-[#0b0e14] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode('courier')}
                className={`px-3 py-1.5 rounded font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                  mode === 'courier'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Truck className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Courier Evaluator</span>
              </button>
              <button
                type="button"
                onClick={() => setMode('item_bpc')}
                className={`px-3 py-1.5 rounded font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                  mode === 'item_bpc'
                    ? 'bg-cyan-500/20 text-cyan-200'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Package className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Item &amp; BPC Valuation</span>
              </button>
            </div>

            <select
              value={hubId}
              onChange={(e) => setHubId(e.target.value as TradeHubId)}
              aria-label="Contract Region"
              className="bg-[#0b0e14] border border-slate-700 rounded-md px-2.5 py-1.5 text-xs text-slate-100"
            >
              {EMPIRE_HUB_LIST.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.regionName} ({h.systemName})
                </option>
              ))}
            </select>

            <InfoTip
              locked
              tooltipsEnabled={appSettings.tooltipsEnabled}
              title="EVE ESI Contract Read-Only Notice"
              body="Public regional contracts are fetched live via 2026 ESI (/contracts/public/{region_id}). EVE ESI is strictly read-only for contract creation & acceptance — use Open in EVE or the Copy Verify Manifest button to accept/verify in-game."
            />
          </div>

          <button
            type="button"
            onClick={() => void loadContracts()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 text-xs font-medium hover:bg-cyan-500/25 disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'Scanning ESI...' : 'Scan Public Contracts'}</span>
          </button>
        </div>

        {/* Mode-specific secondary controls */}
        {mode === 'courier' ? (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-400">Hauler Hull:</span>
              <select
                value={selectedHullId}
                onChange={(e) => setSelectedHullId(e.target.value)}
                className="bg-[#0b0e14] border border-slate-700 rounded px-2.5 py-1 text-xs text-slate-100"
              >
                {availableHulls.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <div className="inline-flex rounded border border-slate-700 bg-[#0b0e14] p-0.5">
                <button
                  type="button"
                  onClick={() => setRoundTrip(true)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    roundTrip ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  Round-Trip (3-Leg)
                </button>
                <button
                  type="button"
                  onClick={() => setRoundTrip(false)}
                  className={`px-2 py-0.5 rounded text-[11px] cursor-pointer ${
                    !roundTrip ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  One-Way / Chained
                </button>
              </div>
            </div>
            <div className="font-mono text-[11px] text-slate-400 flex items-center gap-2">
              <span>Origin: {profile.currentSystemName}</span>
              <span>·</span>
              <span>Cadence: {appSettings.manualJumpCadenceSec}s/gate</span>
              <button
                type="button"
                onClick={onOpenSettings}
                className="text-cyan-400 hover:underline cursor-pointer"
              >
                Tune in Settings
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Reprocess Output Execution:</span>
              <div className="inline-flex rounded border border-slate-700 bg-[#0b0e14] p-0.5">
                <button
                  type="button"
                  onClick={() => setReprocessOutputMode('instant')}
                  className={`px-2.5 py-0.5 rounded text-[11px] cursor-pointer ${
                    reprocessOutputMode === 'instant' ? 'bg-emerald-500/20 text-emerald-200' : 'text-slate-400'
                  }`}
                >
                  Instant Fill (Buy Orders)
                </button>
                <button
                  type="button"
                  onClick={() => setReprocessOutputMode('sell_order')}
                  className={`px-2.5 py-0.5 rounded text-[11px] cursor-pointer ${
                    reprocessOutputMode === 'sell_order' ? 'bg-cyan-500/20 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  List Sell Orders
                </button>
              </div>
            </div>
            <div className="text-[11px] text-slate-400">
              Evaluates Instant Sale, Sell Orders, Reprocess/Refine Yield, and Multi-BPC Full-Run Proportional Profit.
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
          {errorMsg}
        </div>
      )}
      {openEveStatus && (
        <div className="rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-3 py-2 text-xs text-cyan-200">
          {openEveStatus}
        </div>
      )}

      {/* COURIER TABLE */}
      {mode === 'courier' && (
        <div className="bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#131822] border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3 text-left font-medium">Route &amp; Contract</th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('rewardOrPrice')} className="cursor-pointer hover:text-slate-100">
                      Reward {renderSortIcon('rewardOrPrice')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('collateralStatus')} className="cursor-pointer hover:text-slate-100">
                      Collateral / Bait {renderSortIcon('collateralStatus')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('totalJumps')} className="cursor-pointer hover:text-slate-100">
                      Total Jumps {renderSortIcon('totalJumps')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('volumeM3')} className="cursor-pointer hover:text-slate-100">
                      Volume m³ {renderSortIcon('volumeM3')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('incomeHr')} className="cursor-pointer hover:text-slate-100">
                      Income/Hr {renderSortIcon('incomeHr')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('profitIsk')} className="cursor-pointer hover:text-slate-100">
                      Profit ISK {renderSortIcon('profitIsk')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('profitPct')} className="cursor-pointer hover:text-slate-100">
                      Profit % {renderSortIcon('profitPct')}
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {loading && courierRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500 font-mono">
                      Fetching live ESI regional courier contracts &amp; calculating 3-leg POST /route paths...
                    </td>
                  </tr>
                ) : courierRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      No public courier contracts returned on page 1 for {selectedHub.regionName}. Try switching regions or scanning again.
                    </td>
                  </tr>
                ) : (
                  courierRows.map((c) => {
                    const mult = Math.max(1, qtyMultiplierByContract[c.contractId] ?? 1);
                    const isExpanded = expandedId === c.contractId;
                    const badgeColor =
                      c.classification === 'bait_scam'
                        ? 'text-rose-300'
                        : c.classification === 'over_valued'
                          ? 'text-amber-300'
                          : c.classification === 'under_valued'
                            ? 'text-emerald-300'
                            : 'text-slate-300';
                    return (
                      <tr key={c.contractId} className="hover:bg-slate-900/50 align-top">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-100 flex items-center gap-1.5">
                            <span>
                              {c.startSystemName} → {c.endSystemName}
                            </span>
                            <a
                              href={getDotlanRouteUrl(c.startSystemName, c.endSystemName)}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open route in DOTLAN"
                              className="text-cyan-400 hover:text-cyan-200 inline-flex items-center gap-0.5 text-[10px]"
                            >
                              <MapPin className="w-3 h-3" />
                              <span>DOTLAN</span>
                            </a>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[260px]">
                            #{c.contractId} · {c.title}
                          </div>
                          <div className="text-[10px] font-mono text-slate-500 mt-0.5">
                            App {c.approachJumps}j ({formatDurationCompact(c.approachTimeSec)}) · Job {c.jobJumps}j ({formatDurationCompact(c.jobTimeSec)})
                            {roundTrip ? ` · Ret ${c.returnJumps}j (${formatDurationCompact(c.returnTimeSec)})` : ' · One-Way'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-300 whitespace-nowrap">
                          <div>{formatIsk(c.rewardIsk * mult)}</div>
                          <div className="text-[10px] text-slate-500">{formatIsk(c.iskPerJump)}/j</div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-200">{formatIsk(c.collateralIsk * mult)}</div>
                          <div className={`text-[10px] font-semibold flex items-center justify-end gap-1 ${badgeColor}`}>
                            {c.classification === 'bait_scam' && <ShieldAlert className="w-3 h-3" />}
                            <span>
                              {c.classificationLabel} ({c.collateralCoveragePct.toFixed(0)}%)
                            </span>
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          <div>{c.totalJumps}j</div>
                          <div className="text-[10px] text-slate-500">{formatDurationCompact(c.totalTimeSec)}</div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          <div>{formatM3(c.volumeM3 * mult)}</div>
                          <div className={`text-[10px] ${c.volumeM3 * mult > activeHull.capacityM3 ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {c.volumeM3 * mult > activeHull.capacityM3 ? 'Exceeds Hull' : 'Fits Hull'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-cyan-300">{formatIsk(c.incomePerTotalHrIsk)}/hr</div>
                          <div className="text-[10px] text-slate-500">Job: {formatIsk(c.incomePerJobHrIsk)}/hr</div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-300 font-semibold whitespace-nowrap">
                          {formatIsk(c.netProfitIsk * mult)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {c.profitPct.toFixed(2)}%
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <div className="inline-flex items-center border border-slate-700 rounded bg-[#0b0e14] px-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setQtyMultiplierByContract((p) => ({
                                    ...p,
                                    [c.contractId]: Math.max(1, (p[c.contractId] ?? 1) - 1),
                                  }))
                                }
                                className="px-1 text-slate-300 hover:text-cyan-300 cursor-pointer"
                              >
                                −
                              </button>
                              <span className="font-mono text-[10px] px-1 text-slate-200">{mult}x</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setQtyMultiplierByContract((p) => ({
                                    ...p,
                                    [c.contractId]: Math.min(25, (p[c.contractId] ?? 1) + 1),
                                  }))
                                }
                                className="px-1 text-slate-300 hover:text-cyan-300 cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleOpenInEve(c.contractId)}
                              title="Open Contract in EVE Online client"
                              className="px-2 py-1 rounded border border-slate-700 bg-[#131822] text-slate-200 hover:border-cyan-400/50 text-[10px] cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3 inline mr-0.5" />
                              EVE
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePinCourier(c)}
                              title="Pin Courier Job to Unified Route Pool"
                              className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 text-[10px] cursor-pointer"
                            >
                              <Route className="w-3 h-3 inline mr-0.5" />
                              Pin
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedId(isExpanded ? null : c.contractId)}
                              className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          {isExpanded && (
                            <div className="mt-2 p-2.5 rounded border border-slate-800 bg-[#0b0e14] text-left font-mono text-[10px] text-slate-300 space-y-1">
                              <div>Start: {c.startStationName}</div>
                              <div>End: {c.endStationName}</div>
                              <div>
                                Collateral Delta: {c.collateralDeltaIsk >= 0 ? '+' : ''}
                                {formatIsk(c.collateralDeltaIsk)} ({c.collateralCoveragePct.toFixed(1)}% of est. cargo value)
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  void handleCopyVerifyManifest(c.contractId, [
                                    `Courier Contract #${c.contractId}`,
                                    `Pickup: ${c.startStationName}`,
                                    `Dropoff: ${c.endStationName}`,
                                    `Volume: ${c.volumeM3} m3 | Collateral: ${c.collateralIsk} ISK | Reward: ${c.rewardIsk} ISK`,
                                  ])
                                }
                                className="mt-1 inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 text-cyan-200 hover:bg-slate-700 cursor-pointer"
                              >
                                {copiedId === c.contractId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                <span>{copiedId === c.contractId ? 'Copied Manifest' : 'Copy Verify Manifest'}</span>
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ITEM & BPC VALUATION TABLE */}
      {mode === 'item_bpc' && (
        <div className="bg-[#0e131b] border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-[#131822] border-b border-slate-800 text-slate-400 text-[11px]">
                  <th className="py-2.5 px-3 text-left font-medium">Contract &amp; Contents</th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('rewardOrPrice')} className="cursor-pointer hover:text-slate-100">
                      Ask Price {renderSortIcon('rewardOrPrice')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">Instant / Sell</th>
                  <th className="py-2.5 px-2 text-right font-medium">Reprocess</th>
                  <th className="py-2.5 px-2 text-right font-medium">BPC Residual</th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('collateralStatus')} className="cursor-pointer hover:text-slate-100">
                      Valuation {renderSortIcon('collateralStatus')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('profitIsk')} className="cursor-pointer hover:text-slate-100">
                      Profit ISK {renderSortIcon('profitIsk')}
                    </button>
                  </th>
                  <th className="py-2.5 px-2 text-right font-medium">
                    <button type="button" onClick={() => toggleSort('profitPct')} className="cursor-pointer hover:text-slate-100">
                      Profit % {renderSortIcon('profitPct')}
                    </button>
                  </th>
                  <th className="py-2.5 px-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {loading && itemRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500 font-mono">
                      Fetching public Item &amp; BPC contracts and hydrating included contents...
                    </td>
                  </tr>
                ) : itemRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-500">
                      No public Item / BPC contracts returned on page 1 for {selectedHub.regionName}.
                    </td>
                  </tr>
                ) : (
                  itemRows.map((c) => {
                    const mult = Math.max(1, qtyMultiplierByContract[c.contractId] ?? 1);
                    const isExpanded = expandedId === c.contractId;
                    const badgeCls =
                      c.valuationBadge === 'under_valued'
                        ? 'text-emerald-300'
                        : c.valuationBadge === 'over_priced'
                          ? 'text-rose-300'
                          : 'text-slate-300';
                    const badgeText =
                      c.valuationBadge === 'under_valued'
                        ? 'Under-Valued'
                        : c.valuationBadge === 'over_priced'
                          ? 'Over-Priced'
                          : 'Fair Price';
                    return (
                      <tr key={c.contractId} className="hover:bg-slate-900/50 align-top">
                        <td className="py-2.5 px-3">
                          <div className="font-medium text-slate-100 flex items-center gap-1.5">
                            <span>{c.title}</span>
                            {c.hasBpc && (
                              <span className="font-mono text-[10px] text-cyan-300">[BPC]</span>
                            )}
                            <a
                              href={getDotlanSystemUrl(c.systemName)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:underline text-[10px]"
                            >
                              DOTLAN
                            </a>
                          </div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[260px]">
                            #{c.contractId} · {c.items.length} item line{c.items.length === 1 ? '' : 's'} · {c.stationName}
                          </div>
                          {isExpanded && (
                            <div className="mt-2 p-2.5 rounded border border-slate-800 bg-[#0b0e14] space-y-2 text-[11px]">
                              {c.bpcAllocations.length > 0 && (
                                <div className="space-y-1">
                                  <div className="font-semibold text-cyan-300">
                                    BPC Multi-Run Proportional Profit Allocation
                                  </div>
                                  {c.bpcAllocations.map((b) => (
                                    <div key={`${b.typeId}-${b.runs}`} className="font-mono text-[10px] text-slate-300 flex justify-between gap-3">
                                      <span>
                                        {b.blueprintName} ({b.runs} runs · ME{b.me}/TE{b.te})
                                      </span>
                                      <span className={b.residualProfitIsk >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                                        Build {formatIsk(b.fullBuildCostIsk)} → Rev {formatIsk(b.outputInstantRevIsk)} · Res {formatIsk(b.residualProfitIsk)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div className="space-y-0.5 font-mono text-[10px] text-slate-400">
                                {c.items.slice(0, 8).map((it) => (
                                  <div key={it.recordId}>
                                    {it.name} × {(it.quantity * mult).toLocaleString('en-US')}
                                    {it.isBlueprintCopy ? ` (BPC ME${it.materialEfficiency ?? 0}/TE${it.timeEfficiency ?? 0} ${it.runs ?? 1}r)` : ''}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-200 whitespace-nowrap">
                          {formatIsk(c.contractPriceIsk * mult)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className="text-slate-200">{formatIsk(c.instantSaleValueIsk * mult)}</div>
                          <div className="text-[10px] text-slate-500">Order: {formatIsk(c.sellOrderValueIsk * mult)}</div>
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {formatIsk(c.reprocessValueIsk * mult)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          {c.hasBpc ? (
                            <span className={c.bpcResidualProfitIsk >= 0 ? 'text-cyan-300' : 'text-rose-300'}>
                              {formatIsk(c.bpcResidualProfitIsk * mult)}
                            </span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums whitespace-nowrap">
                          <div className={`font-semibold ${badgeCls}`}>{badgeText}</div>
                          <div className="text-[10px] text-slate-400">
                            {c.valuationDeltaIsk >= 0 ? '+' : ''}
                            {formatIsk(c.valuationDeltaIsk * mult)} ({c.valuationDeltaPct >= 0 ? '+' : ''}
                            {c.valuationDeltaPct.toFixed(1)}%)
                          </div>
                        </td>
                        <td
                          className={`py-2.5 px-2 text-right font-mono tabular-nums font-semibold whitespace-nowrap ${
                            c.netProfitIsk >= 0 ? 'text-emerald-300' : 'text-rose-400'
                          }`}
                        >
                          {formatIsk(c.netProfitIsk * mult)}
                        </td>
                        <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-300 whitespace-nowrap">
                          {c.profitPct.toFixed(1)}%
                        </td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1">
                            <div className="inline-flex items-center border border-slate-700 rounded bg-[#0b0e14] px-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setQtyMultiplierByContract((p) => ({
                                    ...p,
                                    [c.contractId]: Math.max(1, (p[c.contractId] ?? 1) - 1),
                                  }))
                                }
                                className="px-1 text-slate-300 hover:text-cyan-300 cursor-pointer"
                              >
                                −
                              </button>
                              <span className="font-mono text-[10px] px-1 text-slate-200">{mult}x</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setQtyMultiplierByContract((p) => ({
                                    ...p,
                                    [c.contractId]: Math.min(25, (p[c.contractId] ?? 1) + 1),
                                  }))
                                }
                                className="px-1 text-slate-300 hover:text-cyan-300 cursor-pointer"
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={() => void handleOpenInEve(c.contractId)}
                              title="Open Contract in EVE Online client"
                              className="px-2 py-1 rounded border border-slate-700 bg-[#131822] text-slate-200 hover:border-cyan-400/50 text-[10px] cursor-pointer"
                            >
                              <ExternalLink className="w-3 h-3 inline mr-0.5" />
                              EVE
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                void handleCopyVerifyManifest(
                                  c.contractId,
                                  c.items.map((it) => `${it.name}\t${it.quantity * mult}`)
                                )
                              }
                              title="Copy Contract Pack/Verify Manifest"
                              className="px-2 py-1 rounded border border-slate-700 bg-[#131822] text-slate-200 hover:border-emerald-400/50 text-[10px] cursor-pointer"
                            >
                              {copiedId === c.contractId ? <Check className="w-3 h-3 text-emerald-400 inline" /> : <FileText className="w-3 h-3 inline" />}
                            </button>
                            <button
                              type="button"
                              onClick={() => handlePinItemBpc(c)}
                              title="Pin to Unified Route Pool"
                              className="px-2 py-1 rounded border border-cyan-500/40 bg-cyan-500/15 text-cyan-200 hover:bg-cyan-500/25 text-[10px] cursor-pointer"
                            >
                              <Route className="w-3 h-3 inline mr-0.5" />
                              Pin
                            </button>
                            <button
                              type="button"
                              onClick={() => setExpandedId(isExpanded ? null : c.contractId)}
                              className="p-1 text-slate-400 hover:text-slate-100 cursor-pointer"
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-3.5 py-2 border-t border-slate-800 bg-[#0b0e14] text-[11px] text-slate-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>
              ESI public contracts are read-only for creation and acceptance. Verify exact item quantities &amp; BPC ME/TE/Runs inside the EVE Online client window before accepting.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
