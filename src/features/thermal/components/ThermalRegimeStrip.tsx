"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import type { RegimeStripSegment, ThermalRegimeStripModel } from "@/features/thermal/lib/thermal-regime-strip";

const SEGMENT_TONE: Record<NonNullable<RegimeStripSegment["tone"]>, string> = {
  bull: "text-emerald-300",
  bear: "text-rose-300",
  flip: "text-cyan-300",
  wall: "text-sky-200",
  sky: "text-sky-300",
  neutral: "text-sky-300",
};

const BADGE_TONE: Record<NonNullable<ThermalRegimeStripModel["badge"]>["tone"], string> = {
  bull: "text-emerald-300",
  bear: "text-rose-300",
  wall: "text-sky-200",
  sky: "text-sky-300",
  neutral: "text-sky-300",
};

function Pipe() {
  return (
    <span aria-hidden className="hidden shrink-0 px-0.5 font-mono text-[11px] text-sky-300/35 sm:inline">
      |
    </span>
  );
}

function RegimeSegment({ seg }: { seg: RegimeStripSegment }) {
  const tone = seg.tone ? SEGMENT_TONE[seg.tone] : "text-white";
  return (
    <span
      className="inline-flex min-w-0 shrink-0 items-baseline gap-1.5 whitespace-nowrap"
      data-regime-segment={seg.key}
    >
      {seg.icon ? (
        <span aria-hidden className="text-[12px] leading-none">
          {seg.icon}
        </span>
      ) : null}
      <span className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-sky-300/75">
        {seg.label}
      </span>
      <span
        data-level-value={seg.key}
        className={clsx("font-mono text-[13px] font-bold tabular-nums leading-none", tone)}
      >
        {seg.value}
      </span>
      {seg.delta ? (
        <span
          className={clsx(
            "font-mono text-[10px] font-bold tabular-nums",
            seg.tone === "bear" ? "text-rose-300" : "text-emerald-300"
          )}
        >
          ↑{seg.delta.replace(/^\+/, "")}
        </span>
      ) : null}
    </span>
  );
}

export function ThermalRegimeStrip({
  model,
  trailing,
  className,
}: {
  model: ThermalRegimeStripModel;
  /** Optional trailing slot (e.g. HELIX flow summary). */
  trailing?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "thermal-regime-strip rounded-xl border border-white/12 bg-[rgba(8,9,14,0.55)] px-3 py-2 backdrop-blur",
        className
      )}
      data-thermal-regime-strip
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-sky-300/80">
          Thermal state
        </span>
        <span
          data-key-levels-kicker
          className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-300/70"
        >
          {model.kicker}
        </span>
      </div>

      <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
        <div
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5"
          role="group"
          aria-label="Dealer regime intelligence"
        >
          {model.badge ? (
            <>
              <span
                className={clsx(
                  "inline-flex items-center gap-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em]",
                  BADGE_TONE[model.badge.tone]
                )}
                data-regime-posture={model.badge.text}
              >
                <span aria-hidden>{model.badge.emoji}</span>
                {model.badge.text}
              </span>
              <Pipe />
            </>
          ) : (
            <span
              // Was `text-sky-300/55` — #7dd3fc at 55% α composited on the
              // translucent panel bg falls to ~3.4:1 against the panel, below
              // WCAG AA 4.5:1 for small (11px) text. Bumped to /85 which reads
              // clean against the dark panel and matches the tone of the badge
              // it replaces on regime-forming loads.
              className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-sky-300/85"
            >
              Regime forming
            </span>
          )}

          {model.segments.map((seg, i) => (
            <span key={seg.key} className="inline-flex items-center gap-x-2">
              {i > 0 ? <Pipe /> : null}
              <RegimeSegment seg={seg} />
            </span>
          ))}
        </div>

        {trailing ? <div className="min-w-0 shrink-0 xl:max-w-[15.5rem]">{trailing}</div> : null}
      </div>

      {model.interpretation ? (
        <p
          className="mt-2 border-t border-white/8 pt-2 font-mono text-[11px] leading-snug text-sky-100"
          data-regime-interpretation
        >
          {model.interpretation}
        </p>
      ) : null}

      {model.footnote ? (
        // Was `text-sky-300/60` at 9px on the translucent panel — fails WCAG AA
        // for small text (needs ≥4.5:1). Bumped to /85 so the footnote is
        // legible against the dark bg without competing with the interpretation
        // line above it.
        <p className="mt-1.5 font-mono text-[9px] leading-snug text-sky-300/85">{model.footnote}</p>
      ) : null}
    </div>
  );
}
