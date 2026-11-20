import { useEffect, useMemo, useState } from 'react';
import {
  ExternalLink,
  Flame,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { formatIsk, formatM3 } from '../engines/decisionEngines.ts';
import type {
  HotSystemIntel,
  OptimizedRouteResult,
  OptimizedStop,
  SolarSystemCoord,
} from '../types/eve.ts';
import type { RouteIntelMatrix } from '../utils/routeOptimizer.ts';

// Client-side permanent cache of real EVE Online (x, y, z) solar system coordinates
const clientCoordCache = new Map<number, SolarSystemCoord>();

interface PrepStepInfo {
  hullName: string;
  jumps: number;
  systemId: number;
  systemName: string;
  stationName: string;
}

interface VisualRouteMapProps {
  optimized: OptimizedRouteResult;
  routeIntel: RouteIntelMatrix;
  originSystemId: number;
  originSystemName: string;
  prepStep0?: PrepStepInfo | null;
}

type NodeKind = 'buy' | 'sell' | 'combined' | 'process' | 'start' | 'end' | 'transit';

interface MapNode {
  systemId: number;
  name: string;
  securityStatus: number;
  rawX: number;
  rawZ: number;
  sx: number;
  sy: number;
  kind: NodeKind;
  isStart: boolean;
  isEnd: boolean;
  isPrep: boolean;
  hotIntel?: HotSystemIntel;
  stops: OptimizedStop[];
  buyCount: number;
  sellCount: number;
  totalBuyIsk: number;
  totalSellIsk: number;
  peakCargoM3: number;
  peakCargoIsk: number;
  stopNumbers: number[];
}

interface MapLeg {
  id: string;
  orderIndex: number;
  label: string;
  kind: 'prep' | 'buy' | 'sell' | 'combined' | 'process' | 'return';
  fromSystemId: number;
  toSystemId: number;
  fromName: string;
  toName: string;
  stationName: string;
  waypoints: number[];
  jumps: number;
  cargoM3: number;
  cargoIsk: number;
  buysCount: number;
  sellsCount: number;
  buyIsk: number;
  sellIsk: number;
  hotSystems: HotSystemIntel[];
  stopNumber?: number;
}

function securityColor(sec: number): string {
  if (sec >= 0.85) return '#38bdf8';
  if (sec >= 0.5) return '#34d399';
  if (sec > 0.0) return '#fbbf24';
  return '#fb7185';
}

function legStrokeColor(kind: MapLeg['kind'], hasHot: boolean): string {
  if (hasHot) return '#f43f5e';
  switch (kind) {
    case 'buy':
      return '#10b981';
    case 'sell':
      return '#f59e0b';
    case 'combined':
      return '#a855f7';
    case 'prep':
      return '#38bdf8';
    case 'return':
      return '#22d3ee';
    default:
      return '#67e8f9';
  }
}

export function VisualRouteMap({
  optimized,
  routeIntel,
  originSystemId,
  originSystemName,
  prepStep0,
}: VisualRouteMapProps) {
  const [coords, setCoords] = useState<Record<number, SolarSystemCoord>>({});
  const [isLoadingCoords, setIsLoadingCoords] = useState(false);
  const [coordError, setCoordError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number>(1);
  const [expanded, setExpanded] = useState<boolean>(false);
  const [hoveredNodeId, setHoveredNodeId] = useState<number | null>(null);
  const [hoveredLegId, setHoveredLegId] = useState<string | null>(null);

  // Build ordered sequence of legs & collect every solar system ID on the active route
  const { legs, allSystemIds, hotMap } = useMemo(() => {
    const builtLegs: MapLeg[] = [];
    const sysSet = new Set<number>([originSystemId]);
    const hMap = new Map<number, HotSystemIntel>();

    let cursorSystemId = originSystemId;
    let cursorSystemName = originSystemName;
    let legOrder = 0;

    // Optional Prep Step 0 leg (pick up parked hull)
    if (prepStep0 && prepStep0.systemId > 0 && prepStep0.systemId !== cursorSystemId) {
      const pairKey = `${cursorSystemId}:${prepStep0.systemId}`;
      const wp = routeIntel.waypointsByPair[pairKey]?.length
        ? routeIntel.waypointsByPair[pairKey]
        : [cursorSystemId, prepStep0.systemId];
      const hot = routeIntel.hotSystemsByPair[pairKey] ?? [];
      for (const id of wp) sysSet.add(id);
      for (const hs of hot) hMap.set(hs.systemId, hs);

      builtLegs.push({
        id: 'leg-prep-0',
        orderIndex: legOrder++,
        label: `Prep: Pick up ${prepStep0.hullName}`,
        kind: 'prep',
        fromSystemId: cursorSystemId,
        toSystemId: prepStep0.systemId,
        fromName: cursorSystemName,
        toName: prepStep0.systemName,
        stationName: prepStep0.stationName,
        waypoints: wp,
        jumps: prepStep0.jumps,
        cargoM3: 0,
        cargoIsk: 0,
        buysCount: 0,
        sellsCount: 0,
        buyIsk: 0,
        sellIsk: 0,
        hotSystems: hot,
      });
      cursorSystemId = prepStep0.systemId;
      cursorSystemName = prepStep0.systemName;
    }

    // Sequential Stop Legs
    for (const stop of optimized.stops) {
      const pairKey = `${cursorSystemId}:${stop.systemId}`;
      const rawWp =
        stop.waypointsFromPrev && stop.waypointsFromPrev.length >= 2
          ? stop.waypointsFromPrev
          : routeIntel.waypointsByPair[pairKey]?.length
            ? routeIntel.waypointsByPair[pairKey]
            : cursorSystemId === stop.systemId
              ? [stop.systemId]
              : [cursorSystemId, stop.systemId];

      for (const id of rawWp) sysSet.add(id);
      sysSet.add(stop.systemId);
      for (const hs of stop.hotSystems) hMap.set(hs.systemId, hs);

      const hasBuy = stop.buys.length > 0;
      const hasSell = stop.sells.length > 0;
      const legKind: MapLeg['kind'] =
        hasBuy && hasSell ? 'combined' : hasBuy ? 'buy' : hasSell ? 'sell' : 'process';

      builtLegs.push({
        id: `leg-stop-${stop.stopNumber}`,
        orderIndex: legOrder++,
        label: `Stop ${stop.stopNumber}: ${stop.systemName}`,
        kind: legKind,
        fromSystemId: cursorSystemId,
        toSystemId: stop.systemId,
        fromName: cursorSystemName,
        toName: stop.systemName,
        stationName: stop.stationName,
        waypoints: rawWp,
        jumps: stop.jumpsFromPrev,
        cargoM3: stop.peakCargoM3,
        cargoIsk: stop.transitCargoIsk,
        buysCount: stop.buys.length,
        sellsCount: stop.sells.length,
        buyIsk: stop.totalBuyIsk,
        sellIsk: stop.totalSellIsk,
        hotSystems: stop.hotSystems,
        stopNumber: stop.stopNumber,
      });

      cursorSystemId = stop.systemId;
      cursorSystemName = stop.systemName;
    }

    // Optional Return / End Hub leg
    const endSystemId = optimized.endHub?.systemId;
    if (
      endSystemId &&
      endSystemId > 0 &&
      optimized.returnLegJumps &&
      optimized.returnLegJumps > 0 &&
      endSystemId !== cursorSystemId
    ) {
      const pairKey = `${cursorSystemId}:${endSystemId}`;
      const wp = routeIntel.waypointsByPair[pairKey]?.length
        ? routeIntel.waypointsByPair[pairKey]
        : [cursorSystemId, endSystemId];
      const hot = routeIntel.hotSystemsByPair[pairKey] ?? [];
      for (const id of wp) sysSet.add(id);
      for (const hs of hot) hMap.set(hs.systemId, hs);

      builtLegs.push({
        id: 'leg-return',
        orderIndex: legOrder++,
        label: `End Hub: ${optimized.returnLegSystemName || optimized.endHub?.systemName || 'Destination'}`,
        kind: 'return',
        fromSystemId: cursorSystemId,
        toSystemId: endSystemId,
        fromName: cursorSystemName,
        toName: optimized.returnLegSystemName || optimized.endHub?.systemName || 'End Hub',
        stationName: optimized.returnLegStationName || 'Return Station',
        waypoints: wp,
        jumps: optimized.returnLegJumps,
        cargoM3: 0,
        cargoIsk: 0,
        buysCount: 0,
        sellsCount: 0,
        buyIsk: 0,
        sellIsk: 0,
        hotSystems: hot,
      });
    }

    return {
      legs: builtLegs,
      allSystemIds: Array.from(sysSet).sort((a, b) => a - b),
      hotMap: hMap,
    };
  }, [optimized, routeIntel, originSystemId, originSystemName, prepStep0]);

  const systemIdsKey = allSystemIds.join(',');

  // Fetch real EVE Online solar system (x, z) coordinates from /api/route/system-coords
  useEffect(() => {
    if (allSystemIds.length === 0) return;

    const cachedHit: Record<number, SolarSystemCoord> = {};
    const missing: number[] = [];
    for (const id of allSystemIds) {
      const c = clientCoordCache.get(id);
      if (c) {
        cachedHit[id] = c;
      } else {
        missing.push(id);
      }
    }

    if (Object.keys(cachedHit).length > 0) {
      setCoords((prev) => ({ ...prev, ...cachedHit }));
    }

    if (missing.length === 0) {
      setIsLoadingCoords(false);
      setCoordError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingCoords(true);
    setCoordError(null);

    fetch('/api/route/system-coords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ systemIds: missing }),
    })
      .then(async (res) => {
        const json = (await res.json()) as {
          systems?: Record<string, SolarSystemCoord>;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(json.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        const incoming: Record<number, SolarSystemCoord> = {};
        for (const item of Object.values(json.systems ?? {})) {
          if (item && typeof item.systemId === 'number') {
            clientCoordCache.set(item.systemId, item);
            incoming[item.systemId] = item;
          }
        }
        setCoords((prev) => ({ ...prev, ...incoming }));
      })
      .catch((err) => {
        if (cancelled) return;
        setCoordError(
          err instanceof Error ? err.message : 'Unable to fetch EVE solar system coordinates.'
        );
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCoords(false);
      });

    return () => {
      cancelled = true;
    };
  }, [systemIdsKey]);

  // Project real New Eden (x, z) coordinates onto our 2D SVG canvas
  const VIEW_W = 540;
  const VIEW_H = expanded ? 420 : 280;
  const PAD_X = 46;
  const PAD_Y = 38;

  const { nodesById, nodeList } = useMemo(() => {
    const rawEntries: {
      systemId: number;
      name: string;
      securityStatus: number;
      rawX: number;
      rawZ: number;
    }[] = [];

    for (const id of allSystemIds) {
      const c = coords[id];
      if (c) {
        rawEntries.push({
          systemId: id,
          name: c.name,
          securityStatus: c.securityStatus,
          rawX: c.x,
          // In EVE's classic 2D starmap, +X is East and -Z is North (Jita North of Dodixie)
          rawZ: -c.z,
        });
      }
    }

    if (rawEntries.length === 0) {
      return { nodesById: new Map<number, MapNode>(), nodeList: [] as MapNode[] };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const e of rawEntries) {
      if (e.rawX < minX) minX = e.rawX;
      if (e.rawX > maxX) maxX = e.rawX;
      if (e.rawZ < minZ) minZ = e.rawZ;
      if (e.rawZ > maxZ) maxZ = e.rawZ;
    }

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const usableW = VIEW_W - PAD_X * 2;
    const usableH = VIEW_H - PAD_Y * 2;

    // Preserve true New Eden aspect ratio while fitting inside viewport
    let scale = 1;
    if (spanX > 0 && spanZ > 0) {
      scale = Math.min(usableW / spanX, usableH / spanZ);
    } else if (spanX > 0) {
      scale = usableW / spanX;
    } else if (spanZ > 0) {
      scale = usableH / spanZ;
    }

    const projectedW = spanX * scale;
    const projectedH = spanZ * scale;
    const offsetX = PAD_X + (usableW - projectedW) / 2;
    const offsetY = PAD_Y + (usableH - projectedH) / 2;

    // Aggregate stop actions per system
    const stopsBySys = new Map<number, OptimizedStop[]>();
    for (const stop of optimized.stops) {
      const list = stopsBySys.get(stop.systemId) ?? [];
      list.push(stop);
      stopsBySys.set(stop.systemId, list);
    }

    const endSystemId =
      optimized.returnLegJumps && optimized.returnLegJumps > 0
        ? optimized.endHub?.systemId
        : optimized.stops[optimized.stops.length - 1]?.systemId;

    const map = new Map<number, MapNode>();
    const list: MapNode[] = [];

    for (const e of rawEntries) {
      const sx =
        rawEntries.length === 1
          ? VIEW_W / 2
          : offsetX + (e.rawX - minX) * scale;
      const sy =
        rawEntries.length === 1
          ? VIEW_H / 2
          : offsetY + (e.rawZ - minZ) * scale;

      const stopsHere = stopsBySys.get(e.systemId) ?? [];
      const buyCount = stopsHere.reduce((s, st) => s + st.buys.length, 0);
      const sellCount = stopsHere.reduce((s, st) => s + st.sells.length, 0);
      const procCount = stopsHere.reduce((s, st) => s + st.processes.length, 0);
      const totalBuyIsk = stopsHere.reduce((s, st) => s + st.totalBuyIsk, 0);
      const totalSellIsk = stopsHere.reduce((s, st) => s + st.totalSellIsk, 0);
      const peakCargoM3 = stopsHere.reduce((m, st) => Math.max(m, st.peakCargoM3), 0);
      const peakCargoIsk = stopsHere.reduce((m, st) => Math.max(m, st.transitCargoIsk), 0);
      const stopNumbers = stopsHere.map((st) => st.stopNumber);

      const isStart = e.systemId === originSystemId;
      const isEnd = e.systemId === endSystemId;
      const isPrep = Boolean(prepStep0 && prepStep0.systemId === e.systemId);

      let kind: NodeKind = 'transit';
      if (buyCount > 0 && sellCount > 0) {
        kind = 'combined';
      } else if (buyCount > 0) {
        kind = 'buy';
      } else if (sellCount > 0) {
        kind = 'sell';
      } else if (procCount > 0) {
        kind = 'process';
      } else if (isStart) {
        kind = 'start';
      } else if (isEnd) {
        kind = 'end';
      }

      const node: MapNode = {
        systemId: e.systemId,
        name: e.name,
        securityStatus: e.securityStatus,
        rawX: e.rawX,
        rawZ: e.rawZ,
        sx,
        sy,
        kind,
        isStart,
        isEnd,
        isPrep,
        hotIntel: hotMap.get(e.systemId),
        stops: stopsHere,
        buyCount,
        sellCount,
        totalBuyIsk,
        totalSellIsk,
        peakCargoM3,
        peakCargoIsk,
        stopNumbers,
      };
      map.set(e.systemId, node);
      list.push(node);
    }

    // Gentle local repulsion only for major stop nodes that land within <13px of another major node
    const major = list.filter((n) => n.kind !== 'transit');
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < major.length; i++) {
        for (let j = i + 1; j < major.length; j++) {
          const a = major[i];
          const b = major[j];
          const dx = b.sx - a.sx;
          const dy = b.sy - a.sy;
          const dist = Math.hypot(dx, dy);
          if (dist < 16) {
            const angle = dist > 0.01 ? Math.atan2(dy, dx) : (i + j) * 0.9;
            const push = (16 - dist) / 2;
            a.sx = Math.max(PAD_X * 0.6, Math.min(VIEW_W - PAD_X * 0.6, a.sx - Math.cos(angle) * push));
            a.sy = Math.max(PAD_Y * 0.6, Math.min(VIEW_H - PAD_Y * 0.6, a.sy - Math.sin(angle) * push));
            b.sx = Math.max(PAD_X * 0.6, Math.min(VIEW_W - PAD_X * 0.6, b.sx + Math.cos(angle) * push));
            b.sy = Math.max(PAD_Y * 0.6, Math.min(VIEW_H - PAD_Y * 0.6, b.sy + Math.sin(angle) * push));
          }
        }
      }
    }

    return { nodesById: map, nodeList: list };
  }, [allSystemIds, coords, optimized, originSystemId, prepStep0, hotMap, VIEW_H]);

  // Build directional SVG paths for each leg (curving slightly if bidirectional travel overlaps)
  const renderedLegs = useMemo(() => {
    const pairUsage = new Map<string, number>();

    return legs
      .map((leg) => {
        const pts: { x: number; y: number }[] = [];
        for (const sysId of leg.waypoints) {
          const node = nodesById.get(sysId);
          if (node) pts.push({ x: node.sx, y: node.sy });
        }
        if (pts.length < 2) return null;

        // Detect bidirectional corridor reuse (e.g., Jita -> Dodixie and Dodixie -> Jita)
        const undirectedKey =
          leg.fromSystemId < leg.toSystemId
            ? `${leg.fromSystemId}:${leg.toSystemId}`
            : `${leg.toSystemId}:${leg.fromSystemId}`;
        const seenCount = pairUsage.get(undirectedKey) ?? 0;
        pairUsage.set(undirectedKey, seenCount + 1);

        // Offset perpendicular normal on second pass so return arrows remain visible
        const offsetPx = seenCount === 0 ? 0 : seenCount % 2 === 1 ? 8 : -8;

        const shifted = pts.map((p, idx) => {
          if (offsetPx === 0 || idx === 0 || idx === pts.length - 1) return p;
          const prev = pts[idx - 1];
          const next = pts[idx + 1];
          const dx = next.x - prev.x;
          const dy = next.y - prev.y;
          const len = Math.hypot(dx, dy) || 1;
          return {
            x: p.x + (-dy / len) * offsetPx,
            y: p.y + (dx / len) * offsetPx,
          };
        });

        // Pull final segment slightly back from target node center so arrowhead sits cleanly at node rim
        const lastIdx = shifted.length - 1;
        const pPrev = shifted[lastIdx - 1];
        const pEnd = shifted[lastIdx];
        const segDx = pEnd.x - pPrev.x;
        const segDy = pEnd.y - pPrev.y;
        const segLen = Math.hypot(segDx, segDy) || 1;
        const trim = Math.min(12, segLen * 0.45);
        const trimmedEnd = {
          x: pEnd.x - (segDx / segLen) * trim,
          y: pEnd.y - (segDy / segLen) * trim,
        };

        let d: string;
        let midPt: { x: number; y: number };

        if (shifted.length === 2 && offsetPx !== 0) {
          // Smooth quadratic arc for direct 1-jump round trips
          const mx = (shifted[0].x + trimmedEnd.x) / 2;
          const my = (shifted[0].y + trimmedEnd.y) / 2;
          const dx = trimmedEnd.x - shifted[0].x;
          const dy = trimmedEnd.y - shifted[0].y;
          const len = Math.hypot(dx, dy) || 1;
          const cx = mx + (-dy / len) * (offsetPx * 1.8);
          const cy = my + (dx / len) * (offsetPx * 1.8);
          d = `M ${shifted[0].x.toFixed(1)} ${shifted[0].y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${trimmedEnd.x.toFixed(1)} ${trimmedEnd.y.toFixed(1)}`;
          midPt = {
            x: 0.25 * shifted[0].x + 0.5 * cx + 0.25 * trimmedEnd.x,
            y: 0.25 * shifted[0].y + 0.5 * cy + 0.25 * trimmedEnd.y,
          };
        } else {
          const allPts = [...shifted.slice(0, lastIdx), trimmedEnd];
          d = allPts
            .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
            .join(' ');
          const midIdx = Math.floor(allPts.length / 2);
          const a = allPts[Math.max(0, midIdx - 1)];
          const b = allPts[midIdx];
          midPt = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        }

        const hasHot = leg.hotSystems.length > 0;
        const stroke = legStrokeColor(leg.kind, hasHot);

        return {
          leg,
          d,
          midPt,
          stroke,
          hasHot,
          isDashed: leg.kind === 'return' || leg.kind === 'prep',
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [legs, nodesById]);

  // Compute zoomed viewBox centered on the canvas
  const viewBox = useMemo(() => {
    const z = Math.max(1, Math.min(2.6, zoom));
    const w = VIEW_W / z;
    const h = VIEW_H / z;
    const x = (VIEW_W - w) / 2;
    const y = (VIEW_H - h) / 2;
    return `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`;
  }, [zoom, VIEW_H]);

  const hoveredNode = hoveredNodeId !== null ? nodesById.get(hoveredNodeId) ?? null : null;
  const hoveredLeg =
    hoveredLegId !== null ? legs.find((l) => l.id === hoveredLegId) ?? null : null;

  // Render major stops on top of transit dots
  const sortedNodes = useMemo(() => {
    const weight = (n: MapNode) => {
      if (n.kind === 'combined') return 5;
      if (n.kind === 'buy' || n.kind === 'sell') return 4;
      if (n.kind === 'process' || n.isStart || n.isEnd) return 3;
      if (n.hotIntel) return 2;
      return 1;
    };
    return [...nodeList].sort((a, b) => weight(a) - weight(b));
  }, [nodeList]);

  const renderCanvasContent = (
    <div
      className={`bg-[#090d14] border border-slate-800/90 rounded-lg overflow-hidden flex flex-col ${
        expanded ? 'w-full max-w-4xl shadow-2xl' : ''
      }`}
    >
      {/* Map Header & Zoom Controls */}
      <div className="px-3 py-2 border-b border-slate-800/80 bg-[#0e131b] flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="text-[11px] font-semibold text-slate-200 truncate">
            New Eden 2D Route Map
          </span>
          <span className="text-[10px] font-mono tabular-nums text-slate-500">
            {nodeList.length} sys · {optimized.totalJumps}j
          </span>
          {isLoadingCoords && (
            <RefreshCw className="w-3 h-3 text-cyan-400 animate-spin shrink-0" aria-hidden="true" />
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(2.6, Number((z + 0.35).toFixed(2))))}
            title="Zoom in"
            aria-label="Zoom in route map"
            className="p-1 rounded border border-slate-800 text-slate-400 hover:text-cyan-200 hover:border-slate-700 cursor-pointer"
          >
            <ZoomIn className="w-3 h-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(1, Number((z - 0.35).toFixed(2))))}
            title="Zoom out"
            aria-label="Zoom out route map"
            className="p-1 rounded border border-slate-800 text-slate-400 hover:text-cyan-200 hover:border-slate-700 cursor-pointer"
          >
            <ZoomOut className="w-3 h-3" aria-hidden="true" />
          </button>
          {zoom > 1 && (
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Reset zoom"
              aria-label="Reset route map zoom"
              className="p-1 rounded border border-slate-800 text-slate-400 hover:text-cyan-200 hover:border-slate-700 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Return map to sidebar' : 'Expand Visual Route Map'}
            aria-label={expanded ? 'Return map to sidebar' : 'Expand Visual Route Map'}
            className="p-1 rounded border border-slate-800 text-slate-400 hover:text-cyan-200 hover:border-cyan-400/50 cursor-pointer"
          >
            {expanded ? (
              <Minimize2 className="w-3 h-3" aria-hidden="true" />
            ) : (
              <Maximize2 className="w-3 h-3" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Interactive SVG Starmap */}
      <div className="relative bg-[#070a10]">
        {coordError && (
          <div className="px-3 py-2 text-[11px] text-rose-300 bg-rose-500/10 border-b border-rose-500/25">
            {coordError}
          </div>
        )}

        {nodeList.length === 0 ? (
          <div className="h-[210px] flex items-center justify-center text-xs text-slate-500 font-mono">
            {isLoadingCoords
              ? 'Loading EVE Online ESI (x, z) solar coordinates...'
              : 'Queue opportunity cards to plot route coordinates.'}
          </div>
        ) : (
          <svg
            viewBox={viewBox}
            className={`w-full block select-none ${expanded ? 'h-[420px]' : 'h-[250px]'}`}
            role="img"
            aria-label="Interactive EVE Online 2D Buy and Sell Route Map"
          >
            <defs>
              {/* Directional arrowheads per leg color */}
              {[
                { id: 'arrow-buy', color: '#10b981' },
                { id: 'arrow-sell', color: '#f59e0b' },
                { id: 'arrow-combined', color: '#a855f7' },
                { id: 'arrow-hot', color: '#f43f5e' },
                { id: 'arrow-prep', color: '#38bdf8' },
                { id: 'arrow-return', color: '#22d3ee' },
              ].map((m) => (
                <marker
                  key={m.id}
                  id={m.id}
                  viewBox="0 0 10 10"
                  refX="7"
                  refY="5"
                  markerWidth="5.5"
                  markerHeight="5.5"
                  orient="auto-start-reverse"
                >
                  <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" fill={m.color} />
                </marker>
              ))}
            </defs>

            {/* Subtle Galactic Coordinate Grid */}
            <g stroke="#1e293b" strokeOpacity="0.38" strokeWidth="0.75">
              {[0.2, 0.4, 0.6, 0.8].map((f) => (
                <line
                  key={`vx-${f}`}
                  x1={VIEW_W * f}
                  y1={0}
                  x2={VIEW_W * f}
                  y2={VIEW_H}
                />
              ))}
              {[0.25, 0.5, 0.75].map((f) => (
                <line
                  key={`hz-${f}`}
                  x1={0}
                  y1={VIEW_H * f}
                  x2={VIEW_W}
                  y2={VIEW_H * f}
                />
              ))}
            </g>

            {/* Compass Axis Hint (Real EVE X / -Z Orientation) */}
            <text
              x={VIEW_W - 10}
              y={14}
              textAnchor="end"
              fill="#475569"
              fontSize="8"
              fontFamily="monospace"
            >
              ESI (X, Z) · N↑
            </text>

            {/* Directional Jump Paths */}
            {renderedLegs.map(({ leg, d, midPt, stroke, hasHot, isDashed }) => {
              const isHighlighted = hoveredLegId === leg.id;
              const markerId = hasHot
                ? 'arrow-hot'
                : leg.kind === 'buy'
                  ? 'arrow-buy'
                  : leg.kind === 'sell'
                    ? 'arrow-sell'
                    : leg.kind === 'combined'
                      ? 'arrow-combined'
                      : leg.kind === 'prep'
                        ? 'arrow-prep'
                        : 'arrow-return';

              return (
                <g
                  key={leg.id}
                  className="cursor-pointer"
                  onMouseEnter={() => {
                    setHoveredLegId(leg.id);
                    setHoveredNodeId(null);
                  }}
                  onMouseLeave={() => setHoveredLegId(null)}
                >
                  {/* Wide invisible hit target for easy hover */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={12} />
                  {/* Visible directional vector */}
                  <path
                    d={d}
                    fill="none"
                    stroke={stroke}
                    strokeWidth={isHighlighted ? 3 : 2}
                    strokeOpacity={isHighlighted ? 1 : 0.82}
                    strokeDasharray={isDashed ? '5 4' : undefined}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    markerEnd={`url(#${markerId})`}
                  />
                  {/* Sequential Leg Step Pill on Midpoint */}
                  {leg.jumps > 0 && (
                    <g transform={`translate(${midPt.x}, ${midPt.y})`}>
                      <circle
                        r={7.5}
                        fill="#090d14"
                        stroke={stroke}
                        strokeWidth={isHighlighted ? 1.8 : 1.2}
                      />
                      <text
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill="#e2e8f0"
                        fontSize="7.5"
                        fontFamily="monospace"
                        fontWeight="700"
                      >
                        {leg.kind === 'prep'
                          ? '0'
                          : leg.kind === 'return'
                            ? 'R'
                            : String(leg.stopNumber ?? leg.orderIndex + 1)}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* Solar System Nodes */}
            {sortedNodes.map((node) => {
              const isHovered = hoveredNodeId === node.systemId;
              const isMajor = node.kind !== 'transit';
              const radius =
                node.kind === 'combined'
                  ? 8.5
                  : node.kind === 'buy' || node.kind === 'sell'
                    ? 7.5
                    : node.kind === 'process' || node.isStart || node.isEnd
                      ? 6.5
                      : node.hotIntel
                        ? 4.8
                        : 3.2;

              return (
                <g
                  key={node.systemId}
                  transform={`translate(${node.sx}, ${node.sy})`}
                  className="cursor-pointer"
                  onMouseEnter={() => {
                    setHoveredNodeId(node.systemId);
                    setHoveredLegId(null);
                  }}
                  onMouseLeave={() => setHoveredNodeId(null)}
                >
                  {/* Larger invisible hover hit area */}
                  <circle r={Math.max(11, radius + 5)} fill="transparent" />

                  {/* RED RING: Flagged Hot / Gatecamp System */}
                  {node.hotIntel && (
                    <>
                      <circle
                        r={radius + 5.5}
                        fill="#f43f5e"
                        fillOpacity="0.14"
                        stroke="#f43f5e"
                        strokeWidth={node.hotIntel.severity === 'critical' ? 2 : 1.5}
                        strokeDasharray="3 2"
                      />
                      <circle
                        r={radius + 2.5}
                        fill="none"
                        stroke="#fb7185"
                        strokeWidth="1.2"
                      />
                    </>
                  )}

                  {/* Start Beacon Outer Ring */}
                  {node.isStart && (
                    <circle
                      r={radius + 3.5}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="1.2"
                      strokeOpacity="0.85"
                    />
                  )}

                  {/* Node Core by Role */}
                  {node.kind === 'combined' ? (
                    /* PURPLE SPLIT NODE: Combined BUY & SELL Hub */
                    <g>
                      {/* Left half: BUY green */}
                      <path
                        d={`M 0 ${-radius} A ${radius} ${radius} 0 0 0 0 ${radius} Z`}
                        fill="#10b981"
                      />
                      {/* Right half: SELL gold/amber */}
                      <path
                        d={`M 0 ${-radius} A ${radius} ${radius} 0 0 1 0 ${radius} Z`}
                        fill="#f59e0b"
                      />
                      {/* Purple Split Ring & Divider */}
                      <line
                        x1={0}
                        y1={-radius}
                        x2={0}
                        y2={radius}
                        stroke="#a855f7"
                        strokeWidth="1.6"
                      />
                      <circle
                        r={radius}
                        fill="none"
                        stroke="#c084fc"
                        strokeWidth={isHovered ? 2.6 : 2}
                      />
                    </g>
                  ) : node.kind === 'buy' ? (
                    /* GREEN NODE: BUY Stop */
                    <circle
                      r={radius}
                      fill="#10b981"
                      stroke={isHovered ? '#ecfdf5' : '#064e3b'}
                      strokeWidth={isHovered ? 2 : 1.5}
                    />
                  ) : node.kind === 'sell' ? (
                    /* BLUE/GOLD NODE: SELL Stop */
                    <g>
                      <circle
                        r={radius}
                        fill="#38bdf8"
                        stroke="#f59e0b"
                        strokeWidth={isHovered ? 2.6 : 2}
                      />
                      <circle r={radius * 0.42} fill="#fbbf24" />
                    </g>
                  ) : node.kind === 'process' ? (
                    <circle
                      r={radius}
                      fill="#06b6d4"
                      stroke={isHovered ? '#ecfeff' : '#083344'}
                      strokeWidth="1.6"
                    />
                  ) : node.kind === 'start' ? (
                    <rect
                      x={-5.5}
                      y={-5.5}
                      width={11}
                      height={11}
                      rx={2}
                      fill="#0ea5e9"
                      stroke="#cffafe"
                      strokeWidth={isHovered ? 2 : 1.4}
                    />
                  ) : node.kind === 'end' ? (
                    <circle
                      r={radius}
                      fill="#0e131b"
                      stroke="#22d3ee"
                      strokeWidth="2"
                      strokeDasharray="2.5 1.5"
                    />
                  ) : (
                    /* Transit intermediate jump dot */
                    <circle
                      r={radius}
                      fill={node.hotIntel ? '#f43f5e' : securityColor(node.securityStatus)}
                      fillOpacity={isHovered ? 1 : 0.85}
                      stroke="#090d14"
                      strokeWidth="0.9"
                    />
                  )}

                  {/* Label for Major Stops & Hot Systems */}
                  {(isMajor || node.hotIntel || isHovered) && (
                    <g transform={`translate(0, ${-radius - 6})`}>
                      <text
                        textAnchor="middle"
                        fill={
                          node.hotIntel
                            ? '#fda4af'
                            : node.kind === 'combined'
                              ? '#e9d5ff'
                              : node.kind === 'buy'
                                ? '#a7f3d0'
                                : node.kind === 'sell'
                                  ? '#fde68a'
                                  : '#e2e8f0'
                        }
                        fontSize={isMajor ? '9.5' : '8'}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                        fontWeight={isMajor ? '700' : '500'}
                        style={{
                          paintOrder: 'stroke',
                          stroke: '#070a10',
                          strokeWidth: '3px',
                          strokeLinejoin: 'round',
                        }}
                      >
                        {node.name}
                        {node.isStart ? ' ★' : ''}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {/* Interactive Hover Telemetry Readout Bar (Zero-Clipping) */}
      <div className="px-3 py-2 border-t border-slate-800/80 bg-[#0d121a] min-h-[62px] text-[11px]">
        {hoveredNode ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-semibold text-slate-100 truncate">
                  {hoveredNode.name}
                </span>
                <span
                  className="font-mono text-[10px]"
                  style={{ color: securityColor(hoveredNode.securityStatus) }}
                >
                  {hoveredNode.securityStatus.toFixed(1)}
                </span>
                <span className="text-slate-600">·</span>
                <span
                  className={`font-medium ${
                    hoveredNode.kind === 'combined'
                      ? 'text-purple-300'
                      : hoveredNode.kind === 'buy'
                        ? 'text-emerald-300'
                        : hoveredNode.kind === 'sell'
                          ? 'text-amber-300'
                          : hoveredNode.kind === 'start'
                            ? 'text-cyan-300'
                            : 'text-slate-400'
                  }`}
                >
                  {hoveredNode.kind === 'combined'
                    ? 'BUY & SELL Hub'
                    : hoveredNode.kind === 'buy'
                      ? 'BUY Stop'
                      : hoveredNode.kind === 'sell'
                        ? 'SELL Stop'
                        : hoveredNode.kind === 'process'
                          ? 'Indy / Stage Stop'
                          : hoveredNode.kind === 'start'
                            ? 'Starting System'
                            : hoveredNode.kind === 'end'
                              ? 'End / Return Hub'
                              : 'Transit System'}
                </span>
              </div>
              {hoveredNode.stopNumbers.length > 0 && (
                <span className="font-mono text-[10px] text-cyan-300 shrink-0">
                  Stop #{hoveredNode.stopNumbers.join(', #')}
                </span>
              )}
            </div>

            {hoveredNode.hotIntel && (
              <div className="flex items-center justify-between gap-2 text-rose-300 text-[10px] font-mono">
                <span className="inline-flex items-center gap-1 truncate">
                  <Flame className="w-3 h-3 text-rose-400 shrink-0" aria-hidden="true" />
                  <span>
                    HOT GATECAMP: {hoveredNode.hotIntel.shipKills} ship /{' '}
                    {hoveredNode.hotIntel.podKills} pod kills (1h)
                  </span>
                </span>
                <a
                  href={hoveredNode.hotIntel.zkillUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-amber-300 underline shrink-0"
                >
                  <span>zKill</span>
                  <ExternalLink className="w-2.5 h-2.5" aria-hidden="true" />
                </a>
              </div>
            )}

            {hoveredNode.stops.length > 0 ? (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[10px] font-mono tabular-nums text-slate-300">
                {hoveredNode.buyCount > 0 && (
                  <span className="text-emerald-300">
                    BUY {hoveredNode.buyCount} ({formatIsk(hoveredNode.totalBuyIsk)})
                  </span>
                )}
                {hoveredNode.sellCount > 0 && (
                  <span className="text-amber-300">
                    SELL {hoveredNode.sellCount} (+{formatIsk(hoveredNode.totalSellIsk)})
                  </span>
                )}
                <span className="text-slate-400">
                  Cargo: {formatM3(hoveredNode.peakCargoM3)} · {formatIsk(hoveredNode.peakCargoIsk)}
                </span>
              </div>
            ) : (
              <div className="text-[10px] text-slate-400">
                {hoveredNode.isStart
                  ? `Departure anchor (${originSystemName})`
                  : hoveredNode.isEnd
                    ? optimized.returnLegStationName || 'Return staging destination'
                    : 'Jump-through transit system along active ESI route'}
              </div>
            )}
          </div>
        ) : hoveredLeg ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-100 truncate">
                {hoveredLeg.fromName} → {hoveredLeg.toName}
              </span>
              <span className="font-mono text-[10px] text-cyan-300 shrink-0">
                {hoveredLeg.jumps}j
              </span>
            </div>
            <div className="text-[10px] text-slate-400 truncate">
              {hoveredLeg.stationName}
            </div>
            <div className="flex flex-wrap items-center gap-x-2.5 text-[10px] font-mono tabular-nums">
              {hoveredLeg.buysCount > 0 && (
                <span className="text-emerald-300">
                  BUY {hoveredLeg.buysCount} (-{formatIsk(hoveredLeg.buyIsk)})
                </span>
              )}
              {hoveredLeg.sellsCount > 0 && (
                <span className="text-amber-300">
                  SELL {hoveredLeg.sellsCount} (+{formatIsk(hoveredLeg.sellIsk)})
                </span>
              )}
              <span className="text-slate-300">
                Load: {formatM3(hoveredLeg.cargoM3)} ({formatIsk(hoveredLeg.cargoIsk)})
              </span>
              {hoveredLeg.hotSystems.length > 0 && (
                <span className="text-rose-400">
                  {hoveredLeg.hotSystems.length} hot gate{hoveredLeg.hotSystems.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col justify-center h-full space-y-1.5">
            <div className="text-[10px] text-slate-400">
              Hover any system node or jump arrow for station actions, cargo load, and gatecamp kills.
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-300">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span>BUY</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full bg-sky-400 border border-amber-400 inline-block" />
                <span>SELL</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="w-2.5 h-2.5 rounded-full border border-purple-400 inline-block"
                  style={{
                    background: 'linear-gradient(90deg, #10b981 50%, #f59e0b 50%)',
                  }}
                />
                <span>BUY &amp; SELL</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-full border border-dashed border-rose-500 bg-rose-500/20 inline-block" />
                <span className="text-rose-300">Hot / Gatecamp</span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (expanded) {
    return (
      <div
        className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-label="Expanded Visual Buy and Sell Route Map"
        onClick={() => setExpanded(false)}
      >
        <div onClick={(e) => e.stopPropagation()} className="w-full max-w-4xl">
          {renderCanvasContent}
        </div>
      </div>
    );
  }

  return renderCanvasContent;
}
