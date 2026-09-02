"use client";

import { clsx } from "clsx";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { formatPremiumCapLabel } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { dispatchGotoSwing } from "@/features/nighthawk/lib/goto-swing";
import {
  legacyMorningHeadline,
} from "@/features/nighthawk/lib/legacy-board-detail-copy";
import { VectorBoardStatusPill } from "@/features/nighthawk/components/VectorBoardStatus";
import {
  LegacyDetailBullet,
  LegacyDetailBullets,
  LegacyDetailSection,
} from "@/features/nighthawk/components/legacy-board-detail-primitives";
import type { LegacyBoardTableRow } from "@/features/nighthawk/lib/legacy-board-table-utils";
import { formatPremiumPct, premiumPctTone } from "@/features/nighthawk/lib/vector-board-table-utils";
import { LegacyManageGeometry } from "@/features/nighthawk/command-deck/legacy-play-geometry";

const usd = (n: number | null | undefined): string => (n != null ? `$${n.toFixed(2)}` : "—");

function pnlTone(pct: number | null): "up" | "down" | "muted" | undefined {
  const t = premiumPctTone(pct);
  if (t === "bull") return "up";
  if (t === "bear") return "down";
  return "muted";
}

export function LegacyPlayManageRail({
  row,
  onClose,
  sheet = false,
}: {
  row: LegacyBoardTableRow | null;
  onClose: () => void;
  sheet?: boolean;
}) {
  if (!row) {
    return (
      <aside className="vector-board-detail legacy-board-manage vector-board-detail--empty" aria-label="Trade management">
        <p className="vector-board-detail-empty-title">Select a play</p>
        <p className="vector-board-detail-empty-copy">
          Trade management, levels, and contract expression appear here. Pick reasoning loads in the
          panel below the table.
        </p>
      </aside>
    );
  }

  const play: TerminalPlay = row.play;
  const pctTone = premiumPctTone(row.premiumPct);
  const morningLine = legacyMorningHeadline(play);
  const stockTone = pnlTone(play.stockMovePct ?? null);

  return (
    <aside
      className={clsx(
        "vector-board-detail legacy-board-manage",
        sheet && "vector-board-detail--sheet"
      )}
      aria-label={`${row.ticker} trade management`}
    >
      <div className="legacy-board-manage-head">
        <div className="vector-board-detail-head">
          <div className="vector-board-detail-titleblock">
            <h2 className="vector-board-detail-ticker">{row.ticker}</h2>
            <p className="vector-board-detail-contract">{row.contractLabel}</p>
          </div>
          <button type="button" className="vector-board-detail-close" onClick={onClose} aria-label="Close detail">
            ×
          </button>
        </div>
        <div className="vector-board-detail-status-row">
          <VectorBoardStatusPill status={row.status} label={row.statusLabel} />
          <span className={clsx("legacy-manage-rec", `is-${play.recommendation.toLowerCase()}`)}>
            {play.recommendation}
          </span>
        </div>
      </div>

      <div className="legacy-board-manage-body">
        <LegacyDetailSection title="Position">
          <LegacyDetailBullets>
            <LegacyDetailBullet
              label="Premium vs entry"
              value={formatPremiumPct(row.premiumPct)}
              tone={pnlTone(row.premiumPct)}
            />
            <LegacyDetailBullet
              label="Entry → mark"
              value={`${row.entryMid != null ? usd(row.entryMid) : "—"} → ${row.markMid != null ? usd(row.markMid) : "—"}`}
            />
            <LegacyDetailBullet label="Peak" value={formatPremiumPct(row.peakPct)} tone={pnlTone(row.peakPct)} />
            <LegacyDetailBullet
              label="Stock move"
              value={formatPremiumPct(play.stockMovePct ?? null)}
              tone={stockTone}
            />
            {play.stockPrice != null ? (
              <LegacyDetailBullet label="Spot" value={usd(play.stockPrice)} />
            ) : null}
          </LegacyDetailBullets>
        </LegacyDetailSection>

        <LegacyDetailSection title="Trade plan">
          <LegacyDetailBullets>
            {play.recNote ? <LegacyDetailBullet label="Desk note" value={play.recNote} /> : null}
            {play.optionsPlay ? (
              <LegacyDetailBullet label="Contract" value={play.optionsPlay} />
            ) : (
              <LegacyDetailBullet label="Contract" value="Stock-level plan only" tone="muted" />
            )}
            {play.entry != null ? <LegacyDetailBullet label="Stock entry" value={usd(play.entry)} /> : null}
            {play.entryCostPerContract != null ? (
              <LegacyDetailBullet label="Option premium" value={`${usd(play.entryCostPerContract)}/sh`} />
            ) : null}
            <LegacyDetailBullet
              label="Premium cap"
              value={
                formatPremiumCapLabel(play.entryCostPerContract ?? null) ??
                `≤$${MAX_OPTION_PREMIUM_PER_SHARE}/sh`
              }
              tone={play.premiumCapOk === false ? "down" : undefined}
            />
          </LegacyDetailBullets>
        </LegacyDetailSection>

        <LegacyDetailSection title="Levels to manage">
          <div className="legacy-manage-levels">
            <LegacyManageGeometry play={play} />
          </div>
          <LegacyDetailBullets>
            {play.stopLevel ? <LegacyDetailBullet label="Stop" value={play.stopLevel} tone="down" /> : null}
            {play.entryRange ? <LegacyDetailBullet label="Entry zone" value={play.entryRange} /> : null}
            {play.targetLevel ? <LegacyDetailBullet label="Target" value={play.targetLevel} tone="up" /> : null}
            {play.rrRatio != null ? (
              <LegacyDetailBullet
                label="Risk : reward"
                value={`${play.rrRatio.toFixed(1)}:1`}
                tone={play.rrRatio >= 2 ? "up" : play.rrRatio < 1 ? "down" : undefined}
              />
            ) : null}
          </LegacyDetailBullets>
        </LegacyDetailSection>

        {(morningLine || play.swingPromoted) && (
          <LegacyDetailSection title="Session status">
            <LegacyDetailBullets>
              {morningLine ? (
                <LegacyDetailBullet
                  label="Pre-market"
                  value={morningLine}
                  tone={
                    play.morningStatus === "CONFIRMED"
                      ? "up"
                      : play.morningStatus === "DEGRADED"
                        ? "warn"
                        : play.morningStatus === "INVALIDATED"
                          ? "down"
                          : "muted"
                  }
                />
              ) : null}
              {play.thesisBreak?.note && play.morningStatus !== "CONFIRMED" ? (
                <LegacyDetailBullet label="Thesis" value={play.thesisBreak.note} tone="warn" />
              ) : null}
              {play.swingPromoted ? (
                <li className="legacy-detail-bullet">
                  <button
                    type="button"
                    className="legacy-manage-swing-link"
                    onClick={() => dispatchGotoSwing(play.ticker)}
                  >
                    Active on Swings Open →
                  </button>
                </li>
              ) : null}
            </LegacyDetailBullets>
          </LegacyDetailSection>
        )}
      </div>
    </aside>
  );
}
