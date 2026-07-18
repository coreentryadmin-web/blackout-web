"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";
import { PlaybookBoard } from "@/features/nighthawk/components/PlaybookBoard";
import { PlayDetailModal } from "@/features/nighthawk/components/PlayDetailModal";
import { NighthawkRadarBackdrop } from "@/features/nighthawk/components/NighthawkRadarBackdrop";
import {
  PREVIEW_EDITION,
  PREVIEW_MORNING,
  PREVIEW_PLAYS,
  PREVIEW_RECORD,
} from "@/features/nighthawk/lib/nighthawk-ui-preview-fixtures";
import type { PlaybookPlay } from "@/features/nighthawk/lib/types";

/** Mock 0DTE cards for UI preview screenshots (not live board data). */
function ZeroDtePreviewPanel() {
  const cards = [
    {
      status: "OPEN",
      contract: "NVDA 880C",
      dir: "long" as const,
      entry: "$4.20",
      mark: "$5.85",
      pnl: "+39.3%",
      note: "HOLD — flow still one-sided · trim above +50%",
    },
    {
      status: "TRIM",
      contract: "META 520P",
      dir: "short" as const,
      entry: "$3.85",
      mark: "$7.70",
      pnl: "+100%",
      note: "TRIM tagged — take half off · runner to target",
    },
  ];

  return (
    <div className="space-y-3 p-1">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 pt-1">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-bull/85">
            0DTE Command · Live
          </p>
          <h3 className="font-anton text-xl uppercase tracking-wide text-white">Today&apos;s plays</h3>
        </div>
        <Badge tone="bull" size="sm" dot>
          2 open
        </Badge>
      </div>
      {cards.map((c) => (
        <div
          key={c.contract}
          className={clsx(
            "nh-v2-zerodte-card nh-v2-zerodte-card--open rounded-xl border border-white/[0.08] px-4 py-3"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="nh-v2-live-dot" aria-hidden />
            <Badge tone="bull" size="sm">
              {c.status}
            </Badge>
            <span className="t-num text-[15px] font-bold text-white">{c.contract}</span>
            <Badge tone={c.dir === "long" ? "bull" : "bear"} size="sm">
              {c.dir}
            </Badge>
            <span className={clsx("ml-auto t-num text-[14px] font-bold nh-v2-pnl-up")}>{c.pnl}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-[12px]">
            <span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/50">Entry </span>
              <strong className="t-num text-white">{c.entry}</strong>
            </span>
            <span>
              <span className="font-mono text-[9px] uppercase tracking-widest text-sky-300/50">Mark </span>
              <strong className="t-num text-white">{c.mark}</strong>
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-snug text-sky-200/85">{c.note}</p>
        </div>
      ))}
    </div>
  );
}

/** Full-width Night Hawk v2 mock — dev/preview screenshots only. */
export function NighthawkUiPreview() {
  const [selectedPlay, setSelectedPlay] = useState<PlaybookPlay | null>(null);

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
            <ZeroDtePreviewPanel />
          </div>
        </div>
      </div>
      <PlayDetailModal
        play={selectedPlay}
        editionFor={PREVIEW_EDITION.edition_for}
        onClose={() => setSelectedPlay(null)}
      />
    </div>
  );
}
