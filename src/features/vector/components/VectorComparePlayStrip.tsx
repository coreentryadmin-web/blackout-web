"use client";

import { useState } from "react";
import clsx from "clsx";
import { VectorPlayCard } from "@/features/vector/components/VectorPlayCard";
import { VectorPlayIntelStrip } from "@/features/vector/components/VectorPlayIntelStrip";
import { VectorContractPicksCard } from "@/features/vector/components/VectorContractPicksCard";
import { VectorReplayPlayGate } from "@/features/vector/components/VectorReplayPlayGate";
import { VectorPlayAnalyticsDrawer } from "@/features/vector/components/VectorPlayAnalyticsDrawer";
import { useVectorActionablePicks } from "@/features/vector/lib/use-vector-actionable-picks";
import type { VectorPlayDeskSnapshot } from "@/features/vector/lib/vector-play-desk-snapshot";

type Props = {
  ticker: string;
  snapshot: VectorPlayDeskSnapshot | null;
  liveSession: boolean;
  replayPaused: boolean;
  className?: string;
};

/**
 * Focused-ticker play rail for Vector Compare — mirrors the single-chart action column
 * (play card + intel + contract picks) without duplicating Helix/matrix/scanner rails.
 */
export function VectorComparePlayStrip({ ticker, snapshot, liveSession, replayPaused, className }: Props) {
  const [playAnalyticsOpen, setPlayAnalyticsOpen] = useState(false);
  const helixFlows = snapshot?.helixFlows ?? [];
  const playEmit = snapshot?.playEmit ?? null;
  const play = playEmit?.play ?? null;
  const chartReplayMode = replayPaused || (snapshot?.chartReplayMode ?? false);

  const {
    active: contractPicks,
    closed: closedContractPicks,
    loading: contractPicksLoading,
  } = useVectorActionablePicks(ticker, playEmit, helixFlows, liveSession, chartReplayMode);

  if (!snapshot && !play) return null;

  return (
    <section
      className={clsx("vector-compare-play-strip", className)}
      aria-label={`${ticker} play engine`}
      data-ticker={ticker}
    >
      <header className="vector-compare-play-strip-head">
        <span className="vector-compare-play-strip-kicker">Focused play</span>
        <span className="vector-compare-play-strip-ticker">{ticker}</span>
      </header>
      <div className="vector-compare-play-strip-body">
        {chartReplayMode ? <VectorReplayPlayGate className="vector-compare-play-strip-gate" /> : null}
        <VectorPlayCard
          play={play}
          replayPaused={chartReplayMode}
          onOpenAnalytics={() => setPlayAnalyticsOpen(true)}
        />
        <VectorPlayIntelStrip
          regime={snapshot?.regime ?? null}
          expectedMove={snapshot?.expectedMove ?? []}
          confluence={snapshot?.confluence ?? null}
          wallIntegrity={snapshot?.wallIntegrity ?? { call: null, put: null }}
        />
        <VectorContractPicksCard
          ticker={ticker}
          play={play}
          picks={contractPicks}
          closedPicks={closedContractPicks}
          loading={contractPicksLoading}
          spot={playEmit?.spot ?? null}
          gammaFlip={playEmit?.gammaFlip ?? null}
          replayPaused={chartReplayMode}
        />
      </div>
      <VectorPlayAnalyticsDrawer
        open={playAnalyticsOpen}
        onClose={() => setPlayAnalyticsOpen(false)}
        ticker={ticker}
        play={play}
        playEmit={playEmit}
        regime={snapshot?.regime ?? null}
        magnet={snapshot?.magnet ?? null}
        proximity={snapshot?.proximity ?? null}
        expectedMove={snapshot?.expectedMove ?? []}
        confluence={snapshot?.confluence ?? null}
        wallIntegrity={snapshot?.wallIntegrity ?? { call: null, put: null }}
      />
    </section>
  );
}
