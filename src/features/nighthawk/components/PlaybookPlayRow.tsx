"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Badge } from "@/components/ui";
import type { PlaybookPlay, PlayMorningStatus } from "@/features/nighthawk/lib/types";
import { formatPremiumCapLabel } from "@/features/nighthawk/lib/play-constraints";
import { MAX_OPTION_PREMIUM_PER_SHARE } from "@/features/nighthawk/lib/constants";
import { convictionFillPct } from "@/features/nighthawk/lib/play-briefing-utils";
import { formatCheckedAtEt, isMorningConfirmStale } from "@/features/nighthawk/lib/morning-confirm-verdict";

type PlaybookPlayRowProps = {
  rank: number;
  play: PlaybookPlay;
  morningConfirm?: PlayMorningStatus;
  morningConfirmCheckedAt?: string;
  /** Opens the Hawk Intel briefing modal (PlayDetailModal). */
  onSelect?: () => void;
};

export function morningBadgeLabel(status: PlayMorningStatus["status"]): string {
  if (status === "CONFIRMED") return "Confirmed";
  if (status === "DEGRADED") return "Degraded";
  if (status === "UNVERIFIED") return "Unverified";
  return "Invalidated";
}

const MORNING_CHIP_TONE: Record<PlayMorningStatus["status"], string> = {
  CONFIRMED: "border-bull/35 bg-bull/10 text-bull",
  DEGRADED: "border-gold/35 bg-gold/10 text-gold",
  INVALIDATED: "border-bear/40 bg-bear/10 text-bear",
  UNVERIFIED: "border-sky-300/25 bg-sky-300/[0.05] text-sky-300/80",
};

export function fmtScore(raw: number | null | undefined): string {
  if (raw == null || !Number.isFinite(raw)) return "—";
  return String(Math.round(raw));
}

export function fmtIvRank(raw: number): string {
  const n = raw <= 1 && raw >= 0 ? raw * 100 : raw;
  const clamped = Math.min(100, Math.max(0, n));
  return `${Math.round(clamped)}%`;
}

function convictionTone(conviction: string): "bull" | "sky" | "neutral" {
  const c = conviction.trim().toUpperCase();
  if (c === "A+" || c === "A") return "bull";
  if (c === "B") return "sky";
  return "neutral";
}

function rankBadgeClass(rank: number): string {
  if (rank === 1) return "nh-v2-rank-badge nh-v2-rank-badge--1";
  if (rank <= 3) return "nh-v2-rank-badge nh-v2-rank-badge--top";
  return "nh-v2-rank-badge nh-v2-rank-badge--std";
}

export function PlaybookPlayRow({
  rank,
  play,
  morningConfirm,
  morningConfirmCheckedAt,
  onSelect,
}: PlaybookPlayRowProps) {
  const dir = play.direction?.toUpperCase() ?? "";
  const isBull = dir.includes("BULL") || dir === "LONG" || dir.includes("CALL");
  const isBear = dir.includes("BEAR") || dir === "SHORT" || dir.includes("PUT");
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  const morningConfirmStale =
    nowMs != null && isMorningConfirmStale(morningConfirmCheckedAt, nowMs);
  const isPulled = Boolean(play.pulled);
  const morningConfirmTitle = morningConfirm
    ? morningConfirmCheckedAt
      ? `${morningConfirm.reason} — checked ${formatCheckedAtEt(morningConfirmCheckedAt)}${
          morningConfirmStale ? " (pre-market snapshot, may be outdated)" : ""
        }`
      : morningConfirm.reason
    : undefined;

  const handleOpen = () => {
    if (onSelect) onSelect();
  };

  return (
    <article
      className={clsx(
        "nh-v2-play-card rounded-xl border border-white/[0.08] bg-white/[0.02] transition-colors",
        rank === 1 && "nh-v2-play-card--rank1",
        rank > 1 && rank <= 3 && "nh-v2-play-card--rankTop",
        isBull && "border-l-2 border-l-bull/60",
        isBear && "border-l-2 border-l-bear/60",
        !isBull && !isBear && "border-l-2 border-l-sky-400/40",
        isPulled && "opacity-60",
        morningConfirm?.status === "CONFIRMED" && !isPulled && "nh-v2-play-card--confirmed",
        morningConfirm?.status === "DEGRADED" && "nh-v2-play-card--degraded",
        morningConfirm?.status === "INVALIDATED" && "nh-v2-play-card--invalidated",
        onSelect && "nh-v2-play-card--clickable cursor-pointer hover:bg-white/[0.03]"
      )}
    >
      <button
        type="button"
        className="block w-full cursor-pointer px-4 py-3 text-left"
        onClick={handleOpen}
        disabled={!onSelect}
        aria-label={`Open briefing for ${play.ticker} ${play.direction}`}
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span aria-hidden="true" className={rankBadgeClass(rank)}>
            {rank}
          </span>
          <span className="nh-v2-play-ticker t-num font-bold text-white">{play.ticker}</span>
          <Badge tone={isBull ? "bull" : isBear ? "bear" : "neutral"} size="sm">
            {play.direction}
          </Badge>
          {play.conviction && (
            <Badge tone={convictionTone(play.conviction)} size="sm" title={`Conviction ${play.conviction}`}>
              {play.conviction}
            </Badge>
          )}
          {isPulled && (
            <Badge tone="bear" size="sm" className="font-bold" title={play.pulled_reason ?? "Pulled pre-open"}>
              Pulled
            </Badge>
          )}
          {play.gate_promoted && !isPulled && (
            <Badge tone="neutral" size="sm" title={play.gate_warnings?.join(" · ")}>
              Best Available
            </Badge>
          )}
          {morningConfirm && (
            <span
              className={clsx(
                "rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em]",
                MORNING_CHIP_TONE[morningConfirm.status],
                morningConfirmStale && "border-dashed opacity-55"
              )}
              title={morningConfirmTitle}
            >
              {morningBadgeLabel(morningConfirm.status)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-sky-300/40">score</span>
            <span className="t-num text-[12px] font-bold text-sky-200/85">{fmtScore(play.score)}</span>
            {onSelect && <span className="nh-v2-open-briefing" aria-hidden>↗</span>}
          </span>
        </div>

        {isPulled && (
          <p className="mt-2 font-mono text-[11px] leading-snug text-bear" role="status">
            {play.pulled_reason ?? "Pulled pre-open by the morning confirmation check"}
          </p>
        )}

        <div
          className={clsx(
            "nh-v2-levels-row mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3",
            isPulled && "line-through opacity-70"
          )}
        >
          <div className="nh-v2-level-cell">
            <em>Entry</em>
            <strong className="t-num">{play.entry_range}</strong>
          </div>
          <div className="nh-v2-level-cell">
            <em>Target</em>
            <strong className="t-num">{play.target}</strong>
          </div>
          <div className="nh-v2-level-cell">
            <em>Stop</em>
            <strong className="t-num">{play.stop}</strong>
          </div>
        </div>

        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-sky-300/50">Contract</span>
          <span className={clsx("t-num min-w-0 text-[11px] leading-snug text-cyan-300/90", isPulled && "line-through")}>
            {play.options_play}
          </span>
          <span
            className="rounded-md border border-gold/25 bg-gold/[0.06] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.06em] text-gold/95"
            title={`Desk cap: max $${MAX_OPTION_PREMIUM_PER_SHARE}/share entry premium`}
          >
            {formatPremiumCapLabel(play.entry_premium ?? null) ?? `≤$${MAX_OPTION_PREMIUM_PER_SHARE}`}
          </span>
        </div>

        {play.conviction && (
          <div className="nh-v2-conviction-meter">
            <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-gold/80">
              {play.conviction}
            </span>
            <div className="nh-v2-conviction-meter-track" aria-hidden>
              <div
                className="nh-v2-conviction-meter-fill"
                style={{ width: `${convictionFillPct(play.conviction)}%` }}
              />
            </div>
          </div>
        )}

        <p className="nh-v2-play-thesis">{play.thesis || play.key_signal}</p>

        {onSelect && (
          <p className="nh-v2-card-cta mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-gold/70">
            Open briefing · overview · scoring · intel
          </p>
        )}
      </button>
    </article>
  );
}
