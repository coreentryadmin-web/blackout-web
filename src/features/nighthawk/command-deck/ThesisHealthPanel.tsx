"use client";

import clsx from "clsx";
import type { ThesisHealthPayload, ThesisPillarState } from "@/lib/zerodte/thesis-health";
import type { Recommendation } from "./types";

function barWidth(score: number): string {
  return `${Math.round(Math.max(0, Math.min(1, score)) * 100)}%`;
}

function rungClass(rung: ThesisHealthPayload["rung"]): string {
  switch (rung) {
    case "INTACT":
    case "MINOR":
      return "ok";
    case "WEAKENING":
      return "warn";
    default:
      return "brk";
  }
}

function pillarIcon(p: ThesisPillarState): string {
  if (p.status === "na") return "—";
  if (p.status === "intact" || p.status === "strengthened") return "✓";
  if (p.status === "faded") return "~";
  return "✗";
}

function PillarBars({ pillar, side }: { pillar: ThesisPillarState; side: "entry" | "now" }) {
  const score = side === "entry" ? pillar.commitScore : pillar.currentScore;
  const label = side === "entry" ? pillar.commitLabel : pillar.currentLabel;
  if (pillar.status === "na") {
    return (
      <div className="nh-deck-thcol">
        <div className="nh-deck-thbar empty" />
        <span className="nh-deck-thlbl">n/a</span>
      </div>
    );
  }
  return (
    <div className="nh-deck-thcol">
      <div className="nh-deck-thbar">
        <div className={clsx("fill", side === "entry" ? "entry" : "now", pillar.status)} style={{ width: barWidth(score) }} />
      </div>
      <span className="nh-deck-thlbl">{label}</span>
    </div>
  );
}

export function ThesisHealthPanel({
  health,
  liveRec,
}: {
  health: ThesisHealthPayload;
  liveRec: Recommendation;
}) {
  const rc = rungClass(health.rung);
  const healthPct = Math.max(0, Math.min(100, health.health));

  return (
    <div className="nh-deck-thesis-health">
      <div className="nh-deck-th-hd">
        <span className="nh-deck-th-title">THESIS HEALTH</span>
        <span className={clsx("nh-deck-th-rung", rc)}>{health.rung.replace("_", " ")}</span>
      </div>

      <div className="nh-deck-th-hero">
        <div className="nh-deck-th-meter" aria-hidden>
          <div className="track">
            <div className={clsx("fill", rc)} style={{ width: `${healthPct}%` }} />
          </div>
        </div>
        <div className="nh-deck-th-score">{healthPct}</div>
      </div>

      <div className="nh-deck-th-delta">
        <span className="k">Entry</span>
        <span className="v">{health.entryIndex}</span>
        <span className="arr">→</span>
        <span className="k">Current</span>
        <span className="v">{health.currentIndex}</span>
        <span className="arr">→</span>
        <span className={clsx("d", health.delta >= 0 ? "up" : "dn")}>
          Δ {health.delta >= 0 ? "+" : ""}{health.delta}
        </span>
      </div>

      <div className="nh-deck-th-time">
        {health.committedAtEt && <span>Commit {health.committedAtEt.split(" ").slice(-2).join(" ")}</span>}
        <span> · Now {health.computedAtEt}</span>
      </div>

      <div className="nh-deck-th-grid-hd">
        <span className="col-pillar">Pillar</span>
        <span className="col-entry">At commit</span>
        <span className="col-now">Now</span>
        <span className="col-st">Δ</span>
      </div>

      {health.pillars.filter((p) => p.status !== "na").map((p) => (
        <div key={p.id} className={clsx("nh-deck-th-row", p.status)}>
          <div className="col-pillar">
            <span className="nm">{p.label}</span>
            <span className="wt">{Math.round(p.weight * 100)}%</span>
          </div>
          <PillarBars pillar={p} side="entry" />
          <PillarBars pillar={p} side="now" />
          <span className={clsx("col-st", p.status === "lost" ? "brk" : p.status === "faded" ? "warn" : "ok")}>
            {pillarIcon(p)}
          </span>
        </div>
      ))}

      {/* Raw Cortex evidence dump (source/detail strings straight from the internal veto/support/
          oppose engine — "cortex", "veto", "oppose" vocabulary) was removed here per the Night
          Hawk panel declutter audit (docs/audit/FINDINGS.md, 2026-08-04): it leaked internal
          engineering telemetry with no member-facing explanation, and the `advisory` line below
          already gives the plain-English equivalent. `health.cortexSources` itself is untouched
          (still populated by `extractCortexSources` in thesis-health.ts) — only this render was
          cut, in case another consumer of the same commit-snapshot data needs it later. */}

      <div className="nh-deck-th-moves">
        <div className="nh-deck-lab">Why health moved</div>
        <ul>
          {health.moves.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      </div>

      <div className="nh-deck-th-advisory">
        <span className="lb">Advisory</span>
        <span className="tx">{health.advisory}</span>
        <span className="mgmt">Management: {liveRec}</span>
      </div>
    </div>
  );
}
