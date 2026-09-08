"use client";

import Link from "next/link";
import { VectorPlayCard } from "@/features/vector/components/VectorPlayCard";
import { VectorPlayIntelStrip } from "@/features/vector/components/VectorPlayIntelStrip";
import type { SpxPlayPayload } from "@/features/spx/lib/spx-play-engine";
import type { VectorPlayDeskSnapshot } from "@/features/vector/lib/vector-play-desk-snapshot";
import { SpxPlayVerdictBar } from "./SpxPlayVerdictBar";

type Props = {
  vectorDesk: VectorPlayDeskSnapshot | null;
  slayerPlay: SpxPlayPayload | null;
  slayerLoading?: boolean;
  sessionActive?: boolean;
  compactDefaultCollapsed?: boolean;
};

/**
 * SPX desk play rail — Vector suggests the trade idea; Slayer verdict bar tracks desk execution
 * (commit, gates, open position). Replaces a standalone verdict bar as the primary narrative.
 */
export function SpxVectorPlayRail({
  vectorDesk,
  slayerPlay,
  slayerLoading = false,
  sessionActive = true,
  compactDefaultCollapsed = false,
}: Props) {
  const vectorPlay = vectorDesk?.playEmit?.play ?? null;
  const showVector = sessionActive && vectorPlay != null;
  const slayerOpen =
    slayerPlay?.phase === "OPEN" ||
    slayerPlay?.open_play != null ||
    slayerPlay?.action === "HOLD" ||
    slayerPlay?.action === "TRIM";

  return (
    <div className="spx-vector-play-rail" data-testid="spx-vector-play-rail">
      {showVector ? (
        <section className="spx-vector-play-rail__signal" aria-label="Vector suggested SPX play">
          <header className="spx-vector-play-rail__head">
            <span className="spx-vector-play-rail__title">Suggested play</span>
            <Link href="/vector?ticker=SPX" className="spx-vector-play-rail__full-link">
              Open in Vector →
            </Link>
          </header>
          <VectorPlayCard
            play={vectorPlay}
            replayPaused={vectorDesk?.chartReplayMode ?? false}
            className="spx-vector-play-rail__card"
          />
          <VectorPlayIntelStrip
            regime={vectorDesk?.regime ?? null}
            expectedMove={vectorDesk?.expectedMove ?? []}
            confluence={vectorDesk?.confluence ?? null}
            wallIntegrity={
              vectorDesk?.wallIntegrity ?? { call: null, put: null }
            }
            className="spx-vector-play-rail__intel"
          />
        </section>
      ) : null}

      <section
        className="spx-vector-play-rail__execution"
        aria-label="SPX Slayer desk execution"
      >
        {showVector ? (
          <header className="spx-vector-play-rail__head spx-vector-play-rail__head--execution">
            <span className="spx-vector-play-rail__title">
              {slayerOpen ? "Live desk position" : "Desk execution"}
            </span>
          </header>
        ) : null}
        <SpxPlayVerdictBar
          play={slayerPlay}
          playLoading={slayerLoading}
          sessionActive={sessionActive}
          compactDefaultCollapsed={compactDefaultCollapsed}
        />
      </section>
    </div>
  );
}
