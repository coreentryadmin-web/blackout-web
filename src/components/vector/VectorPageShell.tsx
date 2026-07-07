"use client";

import { PageShell, PageHeader, FreshnessChip } from "@/components/ui";
import { ProductMark } from "@/components/marks/ProductMark";
import { VectorChart, type VectorBar } from "@/components/vector/VectorChart";
import type { VectorWalls } from "@/lib/api";

type Props = {
  initialBars: VectorBar[];
  initialWalls: VectorWalls | null;
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

/** /vector page frame — mirrors GridPageShell's PageShell/PageHeader/ProductMark structure. */
export function VectorPageShell({ initialBars, initialWalls, sessionYmd, liveSession }: Props) {
  const sessionLabel = formatSessionLabel(sessionYmd);
  const subtitle = liveSession
    ? "SPX price action with live GEX wall nodes — updates every second during the session."
    : `Showing ${sessionLabel} session close — chart and gamma walls are static until the market reopens.`;

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
          <VectorChart initialBars={initialBars} initialWalls={initialWalls} liveSession={liveSession} />
        </div>
      </div>
    </PageShell>
  );
}
