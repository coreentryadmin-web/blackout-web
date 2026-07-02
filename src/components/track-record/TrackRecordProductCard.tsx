import { clsx } from "clsx";
import { ProductMark, type MarkProduct } from "@/components/marks/ProductMark";
import { Badge, Card, Stat } from "@/components/ui";
import type { NhStats, SpxStats } from "./types";
import { fmtPct, profitFactorTone, TRACK_RECORD_MIN_SAMPLE } from "./format";

type TrackRecordProductCardProps = {
  product: MarkProduct;
  productLabel: string;
  title: string;
  checkpoint: string;
  stats: SpxStats | NhStats;
  variant: "spx" | "nighthawk";
};

export function TrackRecordProductCard({
  product,
  productLabel,
  title,
  checkpoint,
  stats,
  variant,
}: TrackRecordProductCardProps) {
  return (
    <Card padding="sm" className="motion-safe:animate-[panel-rise_0.32s_cubic-bezier(0.22,1,0.36,1)_both]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <ProductMark product={product} size={36} className="shrink-0" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-secondary">
              {productLabel}
            </p>
            <p className="font-sans text-base font-semibold text-white">{title}</p>
          </div>
        </div>
        <Badge tone="sky" size="sm">
          {checkpoint}
        </Badge>
      </div>

      {variant === "spx" ? (
        <SpxStatsGrid stats={stats as SpxStats} />
      ) : (
        <NightHawkStatsGrid stats={stats as NhStats} />
      )}
    </Card>
  );
}

function SpxStatsGrid({ stats }: { stats: SpxStats }) {
  const earlyData = stats.total < TRACK_RECORD_MIN_SAMPLE;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {earlyData ? (
        <div className="col-span-2 flex flex-col justify-center gap-1 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] p-4 sm:col-span-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
            Win rate
          </span>
          <span className="font-mono text-sm text-sky-300">
            Collecting data
          </span>
          <span className="font-mono text-[10px] text-sky-300/60">
            {stats.total}/{TRACK_RECORD_MIN_SAMPLE} trades
          </span>
        </div>
      ) : (
        <Stat
          label="Win rate"
          value={fmtPct(stats.winRatePct)}
          tone="accent"
          display
          className="col-span-2 sm:col-span-1"
        />
      )}
      <Stat label="Total signals" value={stats.total} tone="neutral" />
      <Stat label="Wins" value={stats.wins} tone="bull" />
      <Stat label="Losses" value={stats.losses} tone="bear" />
    </div>
  );
}

function NightHawkStatsGrid({ stats }: { stats: NhStats }) {
  // Same discipline as the SPX card above: ratio stats (win rate, avg winner/loser,
  // profit factor) hide behind "Collecting data" below the shared minimum sample —
  // previously Night Hawk showed raw percentages from ANY sample while SPX gated at
  // 30, so a 2-winner window rendered a confident-looking "Avg winner 44.3%" (audit
  // MEDIUM). Counts stay visible: they're honest at any N.
  const earlyData = stats.total < TRACK_RECORD_MIN_SAMPLE;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {earlyData ? (
          <div className="col-span-2 flex flex-col justify-center gap-1 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] p-4 sm:col-span-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
              Win rate · Avg winner · Avg loser
            </span>
            <span className="font-mono text-sm text-sky-300">Collecting data</span>
            <span className="font-mono text-[10px] text-sky-300/60">
              {stats.total}/{TRACK_RECORD_MIN_SAMPLE} plays resolved
            </span>
          </div>
        ) : (
          <>
            <Stat
              label="Win rate"
              value={fmtPct(stats.winRatePct)}
              tone="accent"
              display
              className="col-span-2 sm:col-span-1"
            />
            <Stat label="Avg winner" value={fmtPct(stats.avgWinnerPct)} tone="bull" />
            <Stat label="Avg loser" value={fmtPct(stats.avgLoserPct)} tone="bear" />
          </>
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total" value={stats.total} tone="neutral" />
        <Stat label="Wins" value={stats.wins} tone="bull" />
        <Stat label="Losses" value={stats.losses} tone="bear" />
        <div className="flex flex-col gap-1.5 rounded-xl border border-white/10 bg-[rgba(8,9,14,0.5)] p-4 backdrop-blur">
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-mute">
            Profit factor
          </span>
          <span
            className={clsx(
              "t-num text-2xl font-bold leading-none",
              earlyData ? "text-sky-300" : profitFactorTone(stats.profitFactor)
            )}
          >
            {earlyData ? "—" : stats.profitFactor != null ? stats.profitFactor.toFixed(2) : "—"}
          </span>
        </div>
      </div>
    </>
  );
}
