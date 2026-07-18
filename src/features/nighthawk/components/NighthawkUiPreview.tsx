"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PlaybookBoard } from "@/features/nighthawk/components/PlaybookBoard";
import { PlayDetailModal } from "@/features/nighthawk/components/PlayDetailModal";
import { NighthawkRadarBackdrop } from "@/features/nighthawk/components/NighthawkRadarBackdrop";
import { ZeroDteUiPreviewPanel } from "@/features/nighthawk/components/ZeroDteUiPreviewPanel";
import {
  PREVIEW_EDITION,
  PREVIEW_INTEL_BY_TICKER,
  PREVIEW_MORNING,
  PREVIEW_PLAYS,
  PREVIEW_RECORD,
} from "@/features/nighthawk/lib/nighthawk-ui-preview-fixtures";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";

/** Full-width Night Hawk v2 mock — dev/preview screenshots only. */
export function NighthawkUiPreview() {
  const searchParams = useSearchParams();
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);

  const defaultZerodteExpanded = searchParams.get("zerodte") === "expanded" ? "nvda" : null;

  useEffect(() => {
    const playTicker = searchParams.get("play")?.toUpperCase();
    if (!playTicker) return;
    const match = PREVIEW_PLAYS.find((p) => p.ticker.toUpperCase() === playTicker);
    if (match) setSelectedPlay(match);
  }, [searchParams]);

  return (
    <div className="nh-v2-page nighthawk-page-shell relative min-h-[calc(100svh-var(--nav-offset))] px-2 pb-4 pt-4 md:px-3">
      <NighthawkRadarBackdrop />
      <div className="relative z-10 mx-auto max-w-[1600px]">
        <header className="nh-v2-page-header mb-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold/80">UI preview · v2 polish</p>
          <h1 className="font-anton text-4xl uppercase tracking-wide text-white">Night Hawk</h1>
          <p className="mt-1 text-sm text-sky-300/80">
            Playbook amber column · 0DTE live green · ranked play cards · radar ambient
          </p>
        </header>
        <div className="nighthawk-layout grid min-h-[720px] flex-1 gap-2 lg:grid-cols-[2fr_3fr]">
          <div className="nh-v2-col-playbook">
            <PlaybookBoard
              edition={PREVIEW_EDITION}
              onPlaySelect={setSelectedPlay}
              confirmByTicker={PREVIEW_MORNING}
              playStatusAvailable
              morningConfirmCheckedAt={new Date().toISOString()}
              record={PREVIEW_RECORD}
            />
          </div>
          <div className="nh-v2-col-zerodte nh-v2-col-zerodte--live">
            <ZeroDteUiPreviewPanel defaultExpandedId={defaultZerodteExpanded} />
          </div>
        </div>
      </div>
      <PlayDetailModal
        play={selectedPlay}
        editionFor={PREVIEW_EDITION.edition_for}
        onClose={() => setSelectedPlay(null)}
        morningConfirm={
          selectedPlay ? PREVIEW_MORNING.get(selectedPlay.ticker.toUpperCase()) : undefined
        }
        morningConfirmCheckedAt={new Date().toISOString()}
        previewExplanation={
          selectedPlay ? PREVIEW_INTEL_BY_TICKER[selectedPlay.ticker.toUpperCase()] : null
        }
      />
    </div>
  );
}
