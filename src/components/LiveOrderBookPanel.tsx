import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Compass,
  Copy,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { EVE_ANCHORS } from '../data/eveCatalog.ts';
import { formatIsk } from '../engines/decisionEngines.ts';
import { getDotlanSystemUrl } from '../utils/dotlan.ts';
import {
  computeEve4SigFigTick,
  computeRelistFeePreview,
} from '../utils/eveMarketMath.ts';
import { copyTextToClipboard } from '../utils/eveMultibuy.ts';
import { deriveQuickMultiPeriodTrend } from '../utils/v22Engines.ts';
import type {
  ActionCardData,
  AppSettingsV22,
  LiveOrderBookEntry,
  LiveOrderBookResponse,
  PilotProfile,
} from '../types/eve.ts';
import { InfoTip } from './InfoTip.tsx';
import { PriceTrendRibbon } from './PriceTrendRibbon.tsx';

interface LiveOrderBookPanelProps {
  card: ActionCardData;
  profile: PilotProfile;
  eveAccessToken: string | null;
  appSettings?: AppSettingsV22;
  effectiveQty?: number;
  advisedQty?: number;
  onOpenSsoSettings: () => void;
}

interface OrderBookTargetItem {
  typeId: number;
  name: string;
  buyQty: number;
  sellQty: number;
  buySystemId: number;
  buySystemName: string;
  buyStationId?: number;
  buyStationName: string;
  buyRegionId: number;
  sellSystemId: number;
  sellSystemName: string;
  sellRegionId: number;
}

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'] as const;

function getRegionForSystem(systemId?: number): number {
  if (!systemId) return EVE_ANCHORS.THE_FORGE_REGION_ID;
  if (systemId === EVE_ANCHORS.DODIXIE_SYSTEM_ID) return EVE_ANCHORS.SINQ_LAISON_REGION_ID;
  if (systemId === 30002187) return 10000043; // Amarr / Domain
  if (systemId === 30002510) return 10000030; // Rens / Heimatar
  if (systemId === 30002053) return 10000042; // Hek / Metropolis
  return EVE_ANCHORS.THE_FORGE_REGION_ID;
}

/**
 * Exact EVE Online Procurement (16596) & Marketing (16598) range rules:
 * 0 = Station only
 * 1 = Same Solar System (0 jumps)
 * 2 = Up to 5 jumps (same region)
 * 3 = Up to 10 jumps (same region)
 * 4 = Up to 20 jumps (same region)
 * 5 = Entire Region
 */
function evaluateRemoteBuyRange(params: {
  procurementLevel: number;
  pilotSystemId: number;
  pilotStationId?: number;
  pilotStationName: string;
  buySystemId: number;
  buyStationId?: number;
  buyStationName: string;
  jumpsToBuySystem?: number;
  sameRegion?: boolean;
}): {
  inRange: boolean;
  levelLabel: string;
  requiredLevelLabel: string | null;
  crossRegion: boolean;
  jumps: number;
  summary: string;
} {
  const lvl = Math.max(0, Math.min(5, Math.floor(params.procurementLevel)));
  const levelLabel = ROMAN[lvl] ?? String(lvl);

  const sameSystem = params.pilotSystemId === params.buySystemId;
  const sameStation =
    sameSystem &&
    ((params.pilotStationId !== undefined &&
      params.buyStationId !== undefined &&
      params.pilotStationId === params.buyStationId) ||
      params.pilotStationName.toLowerCase().includes(params.buyStationName.slice(0, 14).toLowerCase()) ||
      params.buyStationName.toLowerCase().includes(params.pilotStationName.slice(0, 14).toLowerCase()));

  const jumps = sameSystem ? 0 : (params.jumpsToBuySystem ?? 3);
  const crossRegion = params.sameRegion === false;

  if (sameStation) {
    return {
      inRange: true,
      levelLabel,
      requiredLevelLabel: null,
      crossRegion: false,
      jumps: 0,
      summary: `In Remote Buy Range (Procurement Lvl ${levelLabel}) — Docked at Buy station; ready to place Buy Order in-game now`,
    };
  }

  if (crossRegion) {
    return {
      inRange: false,
      levelLabel,
      requiredLevelLabel: null,
      crossRegion: true,
      jumps,
      summary: `Out of Remote Range (${jumps} jumps away in another region — travel to Buy region required)`,
    };
  }

  // Max jump allowance within same region
  const maxJumpsByLevel = [-1, 0, 5, 10, 20, Infinity];
  const allowedJumps = maxJumpsByLevel[lvl];
  const inRange = jumps <= allowedJumps;

  if (inRange) {
    return {
      inRange: true,
      levelLabel,
      requiredLevelLabel: null,
      crossRegion: false,
      jumps,
      summary: `In Remote Buy Range (Procurement Lvl ${levelLabel}) — Can place Buy Order in-game now to lock inventory before undocking`,
    };
  }

  // Minimum Procurement level needed for this same-region distance
  const reqLevel =
    jumps === 0 ? 1 : jumps <= 5 ? 2 : jumps <= 10 ? 3 : jumps <= 20 ? 4 : 5;
  const reqLabel = ROMAN[reqLevel];

  return {
    inRange: false,
    levelLabel,
    requiredLevelLabel: reqLabel,
    crossRegion: false,
    jumps,
    summary: `Out of Remote Range (${jumps} ${jumps === 1 ? 'jump' : 'jumps'} away — requires Procurement Lvl ${reqLabel} or traveling to station)`,
  };
}

/**
 * Walks down an ordered array of live ESI orders and flags every order
 * contributing to the card's calculated trade volume so the pilot can
 * verify real depth before undocking.
 */
function annotateOrderDepth(
  orders: LiveOrderBookEntry[],
  targetQty: number
): {
  rows: (LiveOrderBookEntry & {
    rowNumber: number;
    fillsQty: number;
    cumulativeFilledQty: number;
    isHighlighted: boolean;
    isPartialFill: boolean;
  })[];
  coveredQty: number;
  shortfallQty: number;
  highlightedCount: number;
  fillReachedRow: number | null;
  totalIsk: number;
  weightedAvgPrice: number;
} {
  const goal = Math.max(0, Math.round(targetQty));
  let remaining = goal;
  let coveredQty = 0;
  let highlightedCount = 0;
  let fillReachedRow: number | null = null;
  let totalIsk = 0;

  const rows = orders.map((order, index) => {
    const rowNumber = index + 1;
    if (remaining <= 0) {
      return {
        ...order,
        rowNumber,
        fillsQty: 0,
        cumulativeFilledQty: coveredQty,
        isHighlighted: false,
        isPartialFill: false,
      };
    }
    const take = Math.min(order.volumeRemain, remaining);
    remaining -= take;
    coveredQty += take;
    totalIsk += take * order.price;
    const isHighlighted = take > 0;
    const isPartialFill = take > 0 && take < order.volumeRemain;
    if (isHighlighted) {
      highlightedCount += 1;
      if (remaining === 0 && fillReachedRow === null) {
        fillReachedRow = rowNumber;
      }
    }
    return {
      ...order,
      rowNumber,
      fillsQty: take,
      cumulativeFilledQty: coveredQty,
      isHighlighted,
      isPartialFill,
    };
  });

  return {
    rows,
    coveredQty,
    shortfallQty: Math.max(0, goal - coveredQty),
    highlightedCount,
    fillReachedRow,
    totalIsk,
    weightedAvgPrice: coveredQty > 0 ? totalIsk / coveredQty : 0,
  };
}

export function LiveOrderBookPanel({
  card,
  profile,
  eveAccessToken,
  appSettings,
  effectiveQty,
  advisedQty,
  onOpenSsoSettings,
}: LiveOrderBookPanelProps) {
  // Derive inspectable item targets from the card's routeChains & primaryTypeId
  const targetItems = useMemo<OrderBookTargetItem[]>(() => {
    const map = new Map<number, OrderBookTargetItem>();

    for (const chain of card.routeChains || []) {
      const buyLeg = chain.legs.find((l) => l.action === 'buy');
      const sellLeg = chain.legs.find((l) => l.action === 'sell');

      const buySystemId = buyLeg?.systemId ?? EVE_ANCHORS.JITA_SYSTEM_ID;
      const buySystemName = buyLeg?.systemName ?? 'Jita';
      const buyStationId = buyLeg?.stationId;
      const buyStationName = buyLeg?.stationName ?? EVE_ANCHORS.JITA_STATION_NAME;
      const buyRegionId = getRegionForSystem(buySystemId);

      const sellSystemId = sellLeg?.systemId ?? EVE_ANCHORS.JITA_SYSTEM_ID;
      const sellSystemName = sellLeg?.systemName ?? 'Jita';
      const sellRegionId =
        card.destinationRegionId ?? getRegionForSystem(sellSystemId);

      // Pair items appearing on buy/sell legs
      const allLegItems = [
        ...(buyLeg?.items ?? []).map((it) => ({ ...it, side: 'buy' as const })),
        ...(sellLeg?.items ?? []).map((it) => ({ ...it, side: 'sell' as const })),
      ];

      for (const it of allLegItems) {
        if (!it.typeId || it.typeId <= 0) continue;
        const existing = map.get(it.typeId);
        if (existing) {
          if (it.side === 'buy') existing.buyQty += it.quantity;
          if (it.side === 'sell') existing.sellQty += it.quantity;
        } else {
          map.set(it.typeId, {
            typeId: it.typeId,
            name: it.name,
            buyQty: it.side === 'buy' ? it.quantity : 0,
            sellQty: it.side === 'sell' ? it.quantity : 0,
            buySystemId,
            buySystemName,
            buyStationId,
            buyStationName,
            buyRegionId,
            sellSystemId,
            sellSystemName,
            sellRegionId,
          });
        }
      }
    }

    // Ensure card.primaryTypeId is first if present
    const list = Array.from(map.values());
    if (card.primaryTypeId && !map.has(card.primaryTypeId)) {
      const firstBuyLeg = card.routeChains?.[0]?.legs.find((l) => l.action === 'buy');
      const firstSellLeg = card.routeChains?.[0]?.legs.find((l) => l.action === 'sell');
      list.unshift({
        typeId: card.primaryTypeId,
        name: card.primaryItemName || card.title,
        buyQty: card.outputUnits,
        sellQty: card.outputUnits,
        buySystemId: firstBuyLeg?.systemId ?? EVE_ANCHORS.JITA_SYSTEM_ID,
        buySystemName: firstBuyLeg?.systemName ?? 'Jita',
        buyStationId: firstBuyLeg?.stationId ?? EVE_ANCHORS.JITA_STATION_ID,
        buyStationName: firstBuyLeg?.stationName ?? EVE_ANCHORS.JITA_STATION_NAME,
        buyRegionId: getRegionForSystem(firstBuyLeg?.systemId ?? EVE_ANCHORS.JITA_SYSTEM_ID),
        sellSystemId: firstSellLeg?.systemId ?? EVE_ANCHORS.DODIXIE_SYSTEM_ID,
        sellSystemName: firstSellLeg?.systemName ?? 'Dodixie',
        sellRegionId:
          card.destinationRegionId ??
          getRegionForSystem(firstSellLeg?.systemId ?? EVE_ANCHORS.DODIXIE_SYSTEM_ID),
      });
    } else if (card.primaryTypeId) {
      list.sort((a, b) =>
        a.typeId === card.primaryTypeId ? -1 : b.typeId === card.primaryTypeId ? 1 : 0
      );
    }

    return list.slice(0, 16);
  }, [card]);

  const [selectedTypeId, setSelectedTypeId] = useState<number>(
    () => targetItems[0]?.typeId ?? card.primaryTypeId ?? 0
  );
  const [data, setData] = useState<LiveOrderBookResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingMarket, setOpeningMarket] = useState(false);
  const [copiedTickOrderId, setCopiedTickOrderId] = useState<number | null>(null);
  const [marketFeedback, setMarketFeedback] = useState<{
    kind: 'success' | 'warn' | 'error';
    text: string;
    needsSso?: boolean;
  } | null>(null);

  const activeTarget = useMemo(
    () =>
      targetItems.find((t) => t.typeId === selectedTypeId) ?? targetItems[0] ?? null,
    [targetItems, selectedTypeId]
  );

  useEffect(() => {
    if (activeTarget && activeTarget.typeId !== selectedTypeId) {
      setSelectedTypeId(activeTarget.typeId);
    }
  }, [activeTarget, selectedTypeId]);

  const fetchOrderBook = useCallback(async () => {
    if (!activeTarget || activeTarget.typeId <= 0) return;
    setIsLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        typeId: String(activeTarget.typeId),
        buyRegionId: String(activeTarget.buyRegionId),
        sellRegionId: String(activeTarget.sellRegionId),
        buySystemId: String(activeTarget.buySystemId),
        pilotSystemId: String(profile.currentSystemId),
      });
      const res = await fetch(`/api/market/orderbook?${qs.toString()}`);
      const json = (await res.json()) as LiveOrderBookResponse & { error?: string };
      if (!res.ok) {
        throw new Error(json.error || `Order book returned HTTP ${res.status}`);
      }
      setData(json);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to fetch live ESI order book.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeTarget, profile.currentSystemId]);

  useEffect(() => {
    fetchOrderBook();
  }, [fetchOrderBook]);

  const handleOpenMarketInEve = async () => {
    if (!activeTarget) return;
    if (profile.mode !== 'eve_sso' || !eveAccessToken) {
      setMarketFeedback({
        kind: 'warn',
        text: 'Connect EVE SSO (with esi-ui.open_window.v1) to open this Market Details window in EVE Online.',
        needsSso: true,
      });
      return;
    }

    setOpeningMarket(true);
    setMarketFeedback(null);
    try {
      const res = await fetch('/api/eve/ui/open-market', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${eveAccessToken}`,
        },
        body: JSON.stringify({
          typeId: activeTarget.typeId,
          itemName: activeTarget.name,
        }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || `ESI returned HTTP ${res.status}`);
      }
      setMarketFeedback({
        kind: 'success',
        text: `Opened "${activeTarget.name}" Market Details in your EVE Online client.`,
      });
    } catch (err) {
      setMarketFeedback({
        kind: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to open Market Details window in EVE.',
        needsSso: true,
      });
    } finally {
      setOpeningMarket(false);
    }
  };

  if (!activeTarget) {
    return (
      <div className="px-4 py-3 text-xs text-slate-400">
        No live market item ID available for this opportunity.
      </div>
    );
  }

  const baseCardQty = Math.max(
    1,
    Math.round(advisedQty ?? card.baseBatchQty ?? card.outputUnits ?? 1)
  );
  const liveEffectiveQty = Math.max(1, Math.round(effectiveQty ?? baseCardQty));
  const qtyScale = baseCardQty > 0 ? liveEffectiveQty / baseCardQty : 1;
  const isCustomQty = liveEffectiveQty !== baseCardQty;

  const rawBuyQty = activeTarget.buyQty > 0 ? activeTarget.buyQty : baseCardQty;
  const rawSellQty = activeTarget.sellQty > 0 ? activeTarget.sellQty : baseCardQty;

  const targetBuyQty =
    activeTarget.typeId === card.primaryTypeId && card.engine !== 'indy_invention'
      ? liveEffectiveQty
      : Math.max(1, Math.round(rawBuyQty * qtyScale));
  const targetSellQty =
    activeTarget.typeId === card.primaryTypeId && card.engine !== 'indy_invention'
      ? liveEffectiveQty
      : Math.max(1, Math.round(rawSellQty * qtyScale));

  const sellHubDepth = annotateOrderDepth(
    data?.topSellOrdersAtBuyHub ?? [],
    targetBuyQty
  );
  const buyHubDepth = annotateOrderDepth(
    data?.topBuyOrdersAtSellHub ?? [],
    targetSellQty
  );

  const procurementLevel = profile.skills.procurement ?? 0;
  const marketingLevel = profile.skills.marketing ?? 0;

  const remoteRange = evaluateRemoteBuyRange({
    procurementLevel,
    pilotSystemId: profile.currentSystemId,
    pilotStationId: profile.currentStationId,
    pilotStationName: profile.currentStationName,
    buySystemId: activeTarget.buySystemId,
    buyStationId: activeTarget.buyStationId,
    buyStationName: activeTarget.buyStationName,
    jumpsToBuySystem: data?.jumpsToBuySystem,
    sameRegion: data?.sameRegion,
  });

  const topSellPrice = data?.topSellOrdersAtBuyHub?.[0]?.price ?? 0;
  const yesterdayAvg = data?.yesterdayAvgPrice ?? 0;
  const prevSessionSell = data?.prevSessionSellMin ?? 0;

  const trendData = useMemo(() => {
    if (topSellPrice > 0) {
      const refPrice = yesterdayAvg > 0 ? yesterdayAvg : prevSessionSell > 0 ? prevSessionSell : topSellPrice;
      return deriveQuickMultiPeriodTrend(
        activeTarget.typeId,
        {
          sellMin: topSellPrice,
          sellPercentile: refPrice,
          sellVolume: 100,
          buyMax: data?.topBuyOrdersAtSellHub?.[0]?.price ?? topSellPrice * 0.94,
          buyPercentile: refPrice * 0.94,
          buyVolume: 100,
        },
        refPrice
      );
    }
    return card.multiPeriodTrend ?? null;
  }, [topSellPrice, yesterdayAvg, prevSessionSell, activeTarget.typeId, card.multiPeriodTrend, data?.topBuyOrdersAtSellHub]);

  const handleCopyTickPrice = async (
    orderId: number,
    competitorPrice: number,
    direction: 'undercut_sell' | 'outbid_buy'
  ) => {
    const tickPrice = computeEve4SigFigTick(competitorPrice, direction);
    const ok = await copyTextToClipboard(String(tickPrice));
    if (!ok) return;
    setCopiedTickOrderId(orderId);
    window.setTimeout(() => setCopiedTickOrderId((prev) => (prev === orderId ? null : prev)), 1800);
  };

  return (
    <div className="border-t border-slate-800/90 bg-[#0b0f17] px-5 py-4 space-y-3.5">
      {/* Header + Multi-Period Trend Ribbon + DOTLAN + Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2.5 min-w-0">
          <span className="text-xs font-semibold text-slate-100">
            Live ESI Market Depth &amp; Remote Range
          </span>
          <span className="text-[11px] font-mono text-slate-400">
            · {activeTarget.name} (#{activeTarget.typeId})
          </span>
          {topSellPrice > 0 && (
            <span className="font-mono text-xs text-slate-100 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
              {formatIsk(topSellPrice, false)}
            </span>
          )}
          {trendData && (
            <PriceTrendRibbon
              trend={trendData}
              primaryPeriod={appSettings?.priceTrendPeriod ?? '7d'}
              showSparkline={true}
              tooltipsEnabled={appSettings?.tooltipsEnabled ?? true}
            />
          )}
          <a
            href={getDotlanSystemUrl(activeTarget.buySystemName)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-800 bg-[#131822] text-[10px] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200"
          >
            <Compass className="w-2.5 h-2.5 text-cyan-400" />
            <span>DOTLAN ({activeTarget.buySystemName})</span>
          </a>
        </div>

        <button
          type="button"
          onClick={fetchOrderBook}
          disabled={isLoading}
          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded border border-slate-800 bg-[#131822] text-slate-300 hover:border-cyan-400/50 hover:text-cyan-200 disabled:opacity-50 transition-colors cursor-pointer"
        >
          <RefreshCw
            className={`w-3 h-3 ${isLoading ? 'animate-spin text-cyan-400' : ''}`}
            aria-hidden="true"
          />
          <span>{isLoading ? 'Loading ESI...' : 'Refresh Orders'}</span>
        </button>
      </div>

      {/* Multi-Item Selector (when a card buys/sells multiple SKUs) */}
      {targetItems.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {targetItems.map((it) => (
            <button
              key={it.typeId}
              type="button"
              onClick={() => setSelectedTypeId(it.typeId)}
              className={`px-2 py-1 text-[11px] rounded border transition-colors cursor-pointer ${
                it.typeId === activeTarget.typeId
                  ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-200 font-medium'
                  : 'border-slate-800 bg-[#131822] text-slate-400 hover:text-slate-200'
              }`}
            >
              {it.name}
            </button>
          ))}
        </div>
      )}

      {/* Concise Remote Buy Range Strip + Locked InfoTip Advisory + Open Market in EVE */}
      <div
        className={`px-3 py-2 rounded-lg border flex flex-wrap items-center justify-between gap-2 text-xs ${
          remoteRange.inRange
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            : 'border-amber-500/40 bg-amber-500/10 text-amber-200'
        }`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {remoteRange.inRange ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" aria-hidden="true" />
          )}
          <span className="font-medium truncate">
            {remoteRange.inRange
              ? `In Remote Buy Range (${remoteRange.jumps}j · Procurement ${remoteRange.levelLabel})`
              : `Out of Remote Range (${remoteRange.jumps}j · Needs ${
                  remoteRange.crossRegion
                    ? 'Same Region'
                    : `Procurement ${remoteRange.requiredLevelLabel}`
                })`}
          </span>
          <InfoTip
            locked
            tooltipsEnabled={appSettings?.tooltipsEnabled ?? true}
            title="Remote Order Range Rules (Procurement & Marketing)"
            content={`${remoteRange.summary}. Pilot: ${profile.currentSystemName} -> Buy Hub: ${activeTarget.buySystemName} (${remoteRange.jumps}j). Procurement (ID 16596) Lvl ${remoteRange.levelLabel}: 0=Station, I=System, II=5j, III=10j, IV=20j, V=Region. Marketing (ID 16598) Lvl ${ROMAN[Math.max(0, Math.min(5, Math.floor(marketingLevel)))]} controls remote Sell Orders.`}
          />
        </div>

        <button
          type="button"
          onClick={handleOpenMarketInEve}
          disabled={openingMarket}
          title={`Open ${activeTarget.name} Market Details in EVE Online`}
          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded border transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 ${
            remoteRange.inRange
              ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30'
              : 'border-cyan-400/50 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25'
          }`}
        >
          <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{openingMarket ? 'Opening...' : 'Open Market in EVE'}</span>
        </button>
      </div>

      {marketFeedback && (
        <div
          className={`px-3 py-2 rounded border text-[11px] flex items-center justify-between gap-2 ${
            marketFeedback.kind === 'success'
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : marketFeedback.kind === 'warn'
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                : 'border-rose-500/40 bg-rose-500/10 text-rose-200'
          }`}
        >
          <span>{marketFeedback.text}</span>
          {marketFeedback.needsSso && (
            <button
              type="button"
              onClick={onOpenSsoSettings}
              className="text-cyan-300 hover:text-cyan-200 underline font-medium whitespace-nowrap shrink-0 cursor-pointer"
            >
              EVE SSO
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="px-3 py-2 rounded border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200">
          {error}
        </div>
      )}

      {/* Dual Full-Depth Scrollable EVE-Style Live Regional Order Book Tables */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3.5">
        {/* Table 1: Full Live Sell Orders at Buy Hub (Lowest Price First) */}
        <div className="border border-slate-800/90 rounded-lg bg-[#10151f] overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-800/90 bg-[#131822] flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-emerald-300 truncate">
                Sell Orders ({sellHubDepth.rows.length}) · {data?.buyRegionName || activeTarget.buySystemName}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                Lowest price first · Covers {sellHubDepth.coveredQty.toLocaleString('en-US')} /{' '}
                {targetBuyQty.toLocaleString('en-US')} buy qty
                {sellHubDepth.weightedAvgPrice > 0
                  ? ` · Avg ${formatIsk(sellHubDepth.weightedAvgPrice, false)}`
                  : ''}
              </div>
            </div>
            <span
              className={`font-mono text-[10px] px-2 py-0.5 rounded border shrink-0 font-semibold ${
                sellHubDepth.fillReachedRow !== null
                  ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-200'
                  : 'border-amber-500/50 bg-amber-500/15 text-amber-200'
              }`}
            >
              {sellHubDepth.fillReachedRow !== null
                ? `Fill Depth Reached at Row #${sellHubDepth.fillReachedRow}`
                : sellHubDepth.rows.length > 0
                  ? `Shortfall after Row #${sellHubDepth.rows.length} (-${sellHubDepth.shortfallQty.toLocaleString('en-US')})`
                  : 'No Sell Depth'}
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0d121a] shadow-[0_1px_0_rgba(30,41,59,0.9)]">
                <tr className="border-b border-slate-800/80 text-slate-400">
                  <th className="py-1.5 px-2 text-center font-medium w-9">#</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">Price (ISK)</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">Vol Remain</th>
                  <th className="py-1.5 px-2.5 text-left font-medium">Station</th>
                  <th className="py-1.5 px-2 text-right font-medium">4-Sig Tick</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {isLoading && !data ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500 font-mono">
                      Querying live ESI regional sell orders...
                    </td>
                  </tr>
                ) : sellHubDepth.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No active Sell orders returned in this region.
                    </td>
                  </tr>
                ) : (
                  sellHubDepth.rows.map((order) => {
                    const nextTick = computeEve4SigFigTick(order.price, 'undercut_sell');
                    const relist = computeRelistFeePreview({
                      oldPrice: order.price,
                      newPrice: nextTick,
                      volumeRemain: Math.min(order.volumeRemain, targetBuyQty),
                      isBuyOrder: false,
                      brokerRelationsLvl: profile.skills.brokerRelations,
                      advBrokerRelationsLvl: profile.skills.advancedBrokerRelations ?? 0,
                      accountingLvl: profile.skills.accounting,
                    });
                    return (
                      <tr
                        key={order.orderId}
                        className={
                          order.isPartialFill
                            ? 'bg-emerald-500/20 text-slate-100 ring-1 ring-inset ring-emerald-400/45'
                            : order.isHighlighted
                              ? 'bg-emerald-500/12 text-slate-100'
                              : 'text-slate-400 hover:bg-slate-800/30'
                        }
                      >
                        <td className="py-1.5 px-2 text-center font-mono tabular-nums text-[10px] text-slate-500 whitespace-nowrap">
                          <span className={order.isHighlighted ? 'text-emerald-300 font-semibold' : ''}>
                            #{order.rowNumber}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                          <span className={order.isHighlighted ? 'text-emerald-300' : 'text-slate-300'}>
                            {order.price.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <span>{order.volumeRemain.toLocaleString('en-US')}</span>
                          {order.isHighlighted && (
                            <span
                              className={`ml-1 text-[9px] px-1 py-0.5 rounded ${
                                order.isPartialFill
                                  ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                                  : 'text-emerald-300'
                              }`}
                            >
                              {order.isPartialFill
                                ? `partial ${order.fillsQty.toLocaleString('en-US')}`
                                : `take ${order.fillsQty.toLocaleString('en-US')}`}
                            </span>
                          )}
                        </td>
                        <td
                          className="py-1.5 px-2.5 text-left truncate max-w-[160px]"
                          title={order.stationName}
                        >
                          {order.stationName}
                        </td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleCopyTickPrice(order.orderId, order.price, 'undercut_sell')}
                            title={`Copy exact 4-sig-fig undercut tick ${nextTick.toLocaleString('en-US')} ISK · Relist fee est: ${formatIsk(relist.modificationFeeIsk)}`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                              copiedTickOrderId === order.orderId
                                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                                : 'border-slate-700 bg-slate-900 text-amber-300 hover:border-amber-400/50'
                            }`}
                          >
                            {copiedTickOrderId === order.orderId ? (
                              <Check className="w-2.5 h-2.5" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                            <span>{copiedTickOrderId === order.orderId ? 'Copied' : nextTick.toLocaleString('en-US')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table 2: Full Live Buy Orders at Sell Hub (Highest Price First) */}
        <div className="border border-slate-800/90 rounded-lg bg-[#10151f] overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-800/90 bg-[#131822] flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-amber-300 truncate">
                Buy Orders ({buyHubDepth.rows.length}) · {data?.sellRegionName || activeTarget.sellSystemName}
              </div>
              <div className="text-[10px] text-slate-400 font-mono tabular-nums">
                Highest price first · Covers {buyHubDepth.coveredQty.toLocaleString('en-US')} /{' '}
                {targetSellQty.toLocaleString('en-US')} sell qty
                {buyHubDepth.weightedAvgPrice > 0
                  ? ` · Avg ${formatIsk(buyHubDepth.weightedAvgPrice, false)}`
                  : ''}
              </div>
            </div>
            <span
              className={`font-mono text-[10px] px-2 py-0.5 rounded border shrink-0 font-semibold ${
                buyHubDepth.fillReachedRow !== null
                  ? 'border-sky-500/45 bg-sky-500/15 text-sky-200'
                  : 'border-amber-500/50 bg-amber-500/15 text-amber-200'
              }`}
            >
              {buyHubDepth.fillReachedRow !== null
                ? `Fill Depth Reached at Row #${buyHubDepth.fillReachedRow}`
                : buyHubDepth.rows.length > 0
                  ? `Shortfall after Row #${buyHubDepth.rows.length} (-${buyHubDepth.shortfallQty.toLocaleString('en-US')})`
                  : 'List Sell Order'}
            </span>
          </div>

          <div className="max-h-72 overflow-y-auto overflow-x-auto">
            <table className="w-full text-[11px] border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0d121a] shadow-[0_1px_0_rgba(30,41,59,0.9)]">
                <tr className="border-b border-slate-800/80 text-slate-400">
                  <th className="py-1.5 px-2 text-center font-medium w-9">#</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">Price (ISK)</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">Vol Remain</th>
                  <th className="py-1.5 px-2.5 text-left font-medium">Station</th>
                  <th className="py-1.5 px-2 text-right font-medium">Outbid Tick</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {isLoading && !data ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500 font-mono">
                      Querying live ESI regional buy orders...
                    </td>
                  </tr>
                ) : buyHubDepth.rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-500">
                      No active Buy orders returned in this region.
                    </td>
                  </tr>
                ) : (
                  buyHubDepth.rows.map((order) => {
                    const nextTick = computeEve4SigFigTick(order.price, 'outbid_buy');
                    return (
                      <tr
                        key={order.orderId}
                        className={
                          order.isPartialFill
                            ? 'bg-sky-500/20 text-slate-100 ring-1 ring-inset ring-sky-400/45'
                            : order.isHighlighted
                              ? 'bg-sky-500/12 text-slate-100'
                              : 'text-slate-400 hover:bg-slate-800/30'
                        }
                      >
                        <td className="py-1.5 px-2 text-center font-mono tabular-nums text-[10px] text-slate-500 whitespace-nowrap">
                          <span className={order.isHighlighted ? 'text-sky-300 font-semibold' : ''}>
                            #{order.rowNumber}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                          <span className={order.isHighlighted ? 'text-amber-300' : 'text-slate-300'}>
                            {order.price.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </span>
                        </td>
                        <td className="py-1.5 px-2.5 text-right font-mono tabular-nums whitespace-nowrap">
                          <span>{order.volumeRemain.toLocaleString('en-US')}</span>
                          {order.isHighlighted && (
                            <span
                              className={`ml-1 text-[9px] px-1 py-0.5 rounded ${
                                order.isPartialFill
                                  ? 'bg-amber-500/20 text-amber-200 border border-amber-400/40'
                                  : 'text-sky-300'
                              }`}
                            >
                              {order.isPartialFill
                                ? `partial ${order.fillsQty.toLocaleString('en-US')}`
                                : `fill ${order.fillsQty.toLocaleString('en-US')}`}
                            </span>
                          )}
                        </td>
                        <td
                          className="py-1.5 px-2.5 text-left truncate max-w-[160px]"
                          title={`${order.stationName} · Min Vol: ${order.minVolume}`}
                        >
                          {order.stationName}
                          {order.minVolume > 1 && (
                            <span className="ml-1 text-[9px] font-mono text-amber-400">
                              (min {order.minVolume})
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleCopyTickPrice(order.orderId, order.price, 'outbid_buy')}
                            title={`Copy exact 4-sig-fig outbid tick ${nextTick.toLocaleString('en-US')} ISK`}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-mono cursor-pointer transition-colors ${
                              copiedTickOrderId === order.orderId
                                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
                                : 'border-slate-700 bg-slate-900 text-cyan-300 hover:border-cyan-400/50'
                            }`}
                          >
                            {copiedTickOrderId === order.orderId ? (
                              <Check className="w-2.5 h-2.5" />
                            ) : (
                              <Copy className="w-2.5 h-2.5" />
                            )}
                            <span>{copiedTickOrderId === order.orderId ? 'Copied' : nextTick.toLocaleString('en-US')}</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Subtle footer timestamp & depth legend */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-500 font-mono">
        <span>
          Highlighted rows walk your live effective volume (
          {isCustomQty
            ? `Custom Qty: ${liveEffectiveQty.toLocaleString('en-US')} · Advised: ${baseCardQty.toLocaleString('en-US')}`
            : `Advised Qty: ${baseCardQty.toLocaleString('en-US')}`}
          ) · Scroll to inspect full regional depth.
        </span>
        {data?.fetchedAt && (
          <span>
            ESI Live ·{' '}
            {new Date(data.fetchedAt).toLocaleTimeString('en-US', {
              hour12: false,
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </span>
        )}
      </div>
    </div>
  );
}
