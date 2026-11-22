import type { MultiPeriodTrend, PriceTrendPeriod } from '../types/eve.ts';

interface PriceTrendRibbonProps {
  trend: MultiPeriodTrend;
  primaryPeriod: PriceTrendPeriod;
  compact?: boolean;
  showSparkline?: boolean;
  tooltipsEnabled?: boolean;
}

function MiniSparkline({ points, isUp }: { points: number[]; isUp: boolean }) {
  const safe = points.length >= 2 ? points : [1, 1];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = Math.max(1e-9, max - min);
  const width = 46;
  const height = 16;

  const path = safe
    .map((v, i) => {
      const x = (i / Math.max(1, safe.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      aria-label="5-minute live momentum sparkline"
    >
      <path
        d={path}
        fill="none"
        stroke={isUp ? '#10b981' : '#ef4444'}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PriceTrendRibbon({
  trend,
  primaryPeriod,
  compact = false,
  showSparkline = true,
  tooltipsEnabled = true,
}: PriceTrendRibbonProps) {
  const items: { key: PriceTrendPeriod; val: number }[] = [
    { key: '30d', val: trend.change30dPct },
    { key: '14d', val: trend.change14dPct },
    { key: '7d', val: trend.change7dPct },
    { key: '1d', val: trend.change1dPct },
  ];

  const spark = trend.sparkline5m ?? [];
  const sparkUp =
    spark.length >= 2 ? spark[spark.length - 1] >= spark[0] : trend.change1dPct >= 0;

  return (
    <div
      className={`inline-flex flex-wrap items-center gap-1.5 font-mono tabular-nums ${
        compact ? 'text-[10px]' : 'text-[11px]'
      }`}
      title={
        tooltipsEnabled
          ? `30d: ${trend.change30dPct >= 0 ? '+' : ''}${trend.change30dPct.toFixed(1)}% | 14d: ${trend.change14dPct >= 0 ? '+' : ''}${trend.change14dPct.toFixed(1)}% | 7d: ${trend.change7dPct >= 0 ? '+' : ''}${trend.change7dPct.toFixed(1)}% | 1d: ${trend.change1dPct >= 0 ? '+' : ''}${trend.change1dPct.toFixed(1)}%`
          : undefined
      }
    >
      {items.map((it) => {
        const isPos = it.val >= 0;
        const isPrimary = it.key === primaryPeriod;
        return (
          <span
            key={it.key}
            className={`inline-flex items-center gap-0.5 ${
              isPrimary
                ? isPos
                  ? 'text-emerald-300 font-semibold'
                  : 'text-rose-300 font-semibold'
                : isPos
                  ? 'text-emerald-400/80'
                  : 'text-rose-400/80'
            }`}
          >
            <span>{it.key}</span>
            <span aria-hidden="true">{isPos ? '▲' : '▼'}</span>
            {isPrimary && (
              <span>
                {isPos ? '+' : ''}
                {it.val.toFixed(1)}%
              </span>
            )}
          </span>
        );
      })}
      {showSparkline && (
        <span className="inline-flex items-center gap-1 pl-1 border-l border-slate-800 text-slate-500">
          <MiniSparkline points={spark} isUp={sparkUp} />
          <span className="text-[9px]">5m</span>
        </span>
      )}
    </div>
  );
}
