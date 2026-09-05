"use client";

import Link from "next/link";
import { clsx } from "clsx";
import type { TerminalPlay } from "./types";
import { playContractHeadline } from "./play-card-lifecycle";
import { playGradeLabel, playQualityPct } from "./play-card-display";
import { LargoDeskMiniPanel } from "@/features/largo/components/LargoDeskMiniPanel";

/** Center-rail Largo deep-dive for the Swing Command deck — live desk reads + play context. */
export function SwingLargoInsightsPanel({ play }: { play: TerminalPlay | null }) {
  if (!play) {
    return (
      <aside className="nh-deck-largo nh-deck-largo-empty" aria-label="Largo play insights">
        <div className="nh-deck-largo__placeholder">
          <span className="nh-deck-largo__kicker">Largo</span>
          <p>Select a play for real-time insights — regime, pillars, and desk context.</p>
        </div>
      </aside>
    );
  }

  const grade = playGradeLabel(play);
  const quality = playQualityPct(play);
  const headline = playContractHeadline(play);
  const largoHref = `/largo?desk=nighthawk&ticker=${encodeURIComponent(play.ticker)}`;

  return (
    <aside className="nh-deck-largo" aria-label={`Largo insights for ${headline}`}>
      <header className="nh-deck-largo__head">
        <div>
          <span className="nh-deck-largo__kicker">Largo · live read</span>
          <h2 className="nh-deck-largo__title">{headline}</h2>
        </div>
        <Link href={largoHref} className="nh-deck-largo__open">
          Open ↗
        </Link>
      </header>

      <div className="nh-deck-largo__meta">
        {grade && (
          <span className="nh-deck-largo__pill">
            Grade <b>{grade}</b>
            {quality != null ? ` · ${quality}` : ""}
          </span>
        )}
        {play.regime && <span className="nh-deck-largo__pill">{play.regime}</span>}
        {play.archetype && <span className="nh-deck-largo__pill">{play.archetype}</span>}
      </div>

      <LargoDeskMiniPanel desk="nighthawk" ticker={play.ticker} className="nh-deck-largo__mini" />

      {play.factors.length > 0 && (
        <section className="nh-deck-largo__section" aria-label="Score pillars">
          <h3 className="nh-deck-largo__section-title">Pillars</h3>
          <ul className="nh-deck-largo__factors">
            {play.factors.slice(0, 6).map((f) => (
              <li key={f.label}>
                <span className="lab">{f.label}</span>
                <span className={clsx("pts", f.points >= 0 ? "up" : "dn")}>
                  {f.points >= 0 ? "+" : ""}
                  {f.points}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {play.recNote && (
        <section className="nh-deck-largo__section">
          <h3 className="nh-deck-largo__section-title">Desk note</h3>
          <p className="nh-deck-largo__note">{play.recNote}</p>
        </section>
      )}
    </aside>
  );
}
