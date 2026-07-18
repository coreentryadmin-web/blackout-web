"use client";

import { useMemo, useState, useEffect } from "react";
import { clsx } from "clsx";
import { Modal } from "@/components/ui";
import useSWR from "swr";
import { postNightHawkPlayExplain } from "@/lib/api";
import type { PlaybookPlay, PlayMorningStatus } from "@/features/nighthawk/lib/types";
import { parseExplainSections, convictionFillPct } from "@/features/nighthawk/lib/play-briefing-utils";
import { BriefingTabs, type BriefingTabId } from "./briefing/BriefingTabs";
import { PlaybookBriefingPanel } from "./briefing/PlaybookBriefingPanel";
import { IntelExplainSections } from "./briefing/IntelExplainSections";

type PlayDetailModalProps = {
  play: PlaybookPlay | null;
  editionFor: string | null;
  onClose: () => void;
  morningConfirm?: PlayMorningStatus;
  morningConfirmCheckedAt?: string;
  /** Dev preview only — skips live explain fetch when set. */
  previewExplanation?: string | null;
};

export function PlayDetailModal({
  play,
  editionFor,
  onClose,
  morningConfirm,
  morningConfirmCheckedAt,
  previewExplanation,
}: PlayDetailModalProps) {
  const [tab, setTab] = useState<BriefingTabId>("overview");

  useEffect(() => {
    if (play) setTab("overview");
  }, [play?.ticker, play?.rank]);

  const swrKey =
    play && editionFor && previewExplanation == null
      ? `nighthawk-explain:${editionFor}:${play.ticker}`
      : null;

  const { data, error, isLoading } = useSWR(
    swrKey,
    () =>
      postNightHawkPlayExplain({
        edition_for: editionFor!,
        ticker: play!.ticker,
      }),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  );

  const intelSections = useMemo(() => {
    if (previewExplanation) return parseExplainSections(previewExplanation);
    if (!data?.explanation) return [];
    return parseExplainSections(data.explanation);
  }, [data?.explanation, previewExplanation]);

  const intelLoading = previewExplanation != null ? false : isLoading;
  const intelError = previewExplanation != null ? null : error;

  const isBull =
    play?.direction?.toUpperCase().includes("BULL") ||
    play?.direction === "LONG" ||
    play?.direction?.toUpperCase().includes("CALL");

  const header = play && (
    <div>
      <p className="nighthawk-modal-kicker">Hawk Intel · Rank #{play.rank}</p>
      <h2 id="nighthawk-play-detail-title" className="nighthawk-play-detail-title">
        {play.ticker}{" "}
        <span
          className={clsx(
            "nighthawk-play-direction",
            isBull ? "nighthawk-play-direction-bull" : "nighthawk-play-direction-bear"
          )}
        >
          {play.direction}
        </span>
      </h2>
      <p className="nighthawk-play-detail-sub">
        {play.conviction ? `${play.conviction} conviction · ` : ""}
        Score {play.score != null ? play.score : "—"}
        {play.flow_streak_days != null ? ` · ${play.flow_streak_days}d flow streak` : ""}
        {play.iv_rank != null ? ` · IV ${play.iv_rank}` : ""}
      </p>
    </div>
  );

  return (
    <Modal
      open={!!play}
      onClose={onClose}
      title={header}
      className={clsx(
        "nighthawk-modal nighthawk-play-detail-modal nh-v2-modal nh-v2-briefing-modal",
        isBull ? "nighthawk-modal-gold" : "nighthawk-modal-bear"
      )}
    >
      {play && (
        <>
          {play.conviction && (
            <div className="nh-v2-conviction-hero nh-v2-conviction-hero--compact">
              <span className="nh-v2-conviction-hero-label">{play.conviction}</span>
              <div className="nh-v2-conviction-meter min-w-0 flex-1">
                <div className="nh-v2-conviction-meter-track">
                  <div
                    className="nh-v2-conviction-meter-fill"
                    style={{ width: `${convictionFillPct(play.conviction)}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <BriefingTabs value={tab} onChange={setTab} intelLoading={intelLoading} />

          <div className="nh-v2-briefing-modal-body">
            {tab === "overview" && (
              <PlaybookBriefingPanel
                play={play}
                mode="overview"
                morningConfirm={morningConfirm}
                morningConfirmCheckedAt={morningConfirmCheckedAt}
              />
            )}
            {tab === "scoring" && (
              <PlaybookBriefingPanel
                play={play}
                mode="scoring"
                morningConfirm={morningConfirm}
                morningConfirmCheckedAt={morningConfirmCheckedAt}
              />
            )}
            {tab === "intel" && (
              <div className="nh-v2-intel-pane">
                {intelLoading && (
                  <div className="nighthawk-play-detail-loading nh-v2-intel-loading">
                    <div className="nighthawk-power-ring" />
                    <p>Building Hawk Intel briefing</p>
                    <span>Flow · positioning · technicals · catalysts</span>
                  </div>
                )}
                {intelError && (
                  <p className="nighthawk-modal-error">
                    Could not load Hawk Intel. {intelError instanceof Error ? intelError.message : "Try again."}
                  </p>
                )}
                {!intelLoading && !intelError && intelSections.length > 0 && (
                  <IntelExplainSections sections={intelSections} cached={previewExplanation ? true : data?.cached} />
                )}
                {!intelLoading && !intelError && intelSections.length === 0 && data?.explanation && (
                  <IntelExplainSections sections={[{ title: "Briefing", body: data.explanation }]} cached={data?.cached} />
                )}
              </div>
            )}
          </div>

          <p className="nighthawk-play-detail-disclaimer nh-v2-briefing-disclaimer">
            Educational only — not investment advice. Every trade is your own decision.
          </p>
        </>
      )}
    </Modal>
  );
}
