"use client";

import { PageShell, PageHeader, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { VectorChart, type VectorBar } from "@/components/vector/VectorChart";
import type { VectorDarkPoolLevel, VectorWalls } from "@/lib/api";
import type { WallHistorySample } from "@/lib/providers/vector-wall-history";

type Props = {
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
  initialWallHistory: WallHistorySample[];
  initialGammaFlip: number | null;
  initialDarkPoolLevels: VectorDarkPoolLevel[];
  sessionYmd: string;
  liveSession: boolean;
};

function formatSessionLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  return dt.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
  });
}

/** /vector page frame — mirrors the other tool shells' (e.g. NighthawkPageShell) PageShell/PageHeader/ProductMark structure. */
export function VectorPageShell({
  initialBars,
  initialWalls,
  initialWallHistory,
  initialGammaFlip,
  initialDarkPoolLevels,
  sessionYmd,
  liveSession,
}: Props) {
  const sessionLabel = formatSessionLabel(sessionYmd);
  const subtitle = liveSession
    ? "SPX candles ~1s on the axis; gamma wall beads every 15s; flip + dark-pool guides live."
    : `Showing ${sessionLabel} session — scrub replay to watch gamma walls form through the day.`;

  return (
    <PageShell fullBleed className="vector-page-shell">
      <div className="px-2 sm:px-4 xl:px-6">
        <PageHeader
          kicker="Live SPX chart"
          title="Vector"
          subtitle={subtitle}
          badge={<ProductMark product="vector" size={44} animated={false} />}
          actions={
            <FreshnessChip
              status={liveSession ? "live" : "cached"}
              label={liveSession ? "Live session" : "Session close"}
            />
          }
        />
        <div className="mt-5">
          <VectorChart
            initialBars={initialBars}
            initialWalls={initialWalls}
            initialWallHistory={initialWallHistory}
            initialGammaFlip={initialGammaFlip}
            initialDarkPoolLevels={initialDarkPoolLevels}
            sessionYmd={sessionYmd}
            liveSession={liveSession}
          />
        </div>
      </div>
    </PageShell>
  );
}
