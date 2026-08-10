"use client";

import { clsx } from "clsx";
import type { BieAnswerEnvelope, BieFreshness } from "@/lib/bie/answer-envelope";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";

/**
 * LARGO DESK READ — the structured answer surface.
 *
 * WHY THIS EXISTS. A Largo answer was rendering as a paragraph, which made a cross-product
 * synthesis look like chat output. That is not only a presentation problem: prose forces the
 * member to RE-READ to find the level, the invalidation and the freshness every single time,
 * because those facts move around depending on how the sentence came out. A fixed layout puts the
 * same fact in the same place in every answer, which is what makes it readable at a glance under
 * pressure and what a paragraph can never do however well written.
 *
 * IT RENDERS THE ENVELOPE, IT DOES NOT PARSE PROSE. Every field here comes from the structured
 * `BieAnswerEnvelope` the answer contract already produces. The tempting shortcut — regex the
 * markdown into a table — would produce a layout that silently degrades whenever the model phrases
 * something differently, and the failure would look like a UI bug rather than a missing field.
 * When a field is absent the block is OMITTED; nothing is invented to fill the grid.
 *
 * FALLS BACK, NEVER BLOCKS. `LargoAnswerMessage` keeps the markdown path for answers with no
 * envelope (drifted contract, rehydrated history, a trivial reply). A member must never lose an
 * answer because it did not fit a template.
 */

const BIAS_CLASS: Record<string, string> = {
  bullish: "largo-read-bias-bullish",
  bearish: "largo-read-bias-bearish",
  neutral: "largo-read-bias-neutral",
  mixed: "largo-read-bias-neutral",
};

const FRESH_CLASS: Record<BieFreshness, string> = {
  live: "largo-read-src-live",
  recent: "largo-read-src-recent",
  stale: "largo-read-src-stale",
  unknown: "largo-read-src",
};

/** Sections whose content is a STOP condition get the red treatment — they end trades. */
const RISK_TITLE = /^(invalidation|risk|what would change|caution|warning)/i;

function biasClass(bias: string | null | undefined): string {
  return BIAS_CLASS[String(bias ?? "").toLowerCase()] ?? "largo-read-bias-neutral";
}

function formatEt(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d)} ET`;
}

export function LargoDeskRead({ envelope }: { envelope: BieAnswerEnvelope }) {
  const levels = envelope.levels ?? [];
  const sections = envelope.sections ?? [];
  // Freshness per distinct source. Deduped because six evidence rows from HELIX should read as one
  // source chip, not six — the member is asking "how fresh is HELIX", not "how many rows".
  const sources = new Map<string, BieFreshness>();
  for (const e of envelope.evidence ?? []) {
    const label = e.provenance?.source;
    if (!label) continue;
    const f = e.provenance?.freshness ?? "unknown";
    // Worst freshness wins: one stale reading makes the source stale. Presenting a source as live
    // because SOME of its rows were fresh is the exact "never present stale as live" failure.
    const rank: Record<BieFreshness, number> = { live: 0, recent: 1, unknown: 2, stale: 3 };
    const prev = sources.get(label);
    if (!prev || rank[f] > rank[prev]) sources.set(label, f);
  }

  return (
    <div className="largo-read">
      <div className="largo-read-head">
        {/* The synthesis mark. Purple appears HERE and on the left rule — never in body text —
            so it reads as provenance ("Largo produced this") rather than as a theme. */}
        <span className="largo-read-mark">◈ Largo synthesis</span>
        <span className="largo-read-asof">{formatEt(envelope.asOf)}</span>
      </div>

      <div className="largo-read-verdict">
        <span className={clsx("largo-read-bias", biasClass(envelope.bias))}>
          {envelope.headline || String(envelope.bias ?? "").toUpperCase() || "READ"}
        </span>
        {envelope.confidence?.level && (
          <span className="largo-read-conf">{envelope.confidence.level} confidence</span>
        )}
        {/* The WHY is shown, not just the level. A confidence number with no reason is a number
            nobody can argue with, which is the opposite of useful. */}
        {envelope.confidence?.why && (
          <span className="largo-read-conf-why">{envelope.confidence.why}</span>
        )}
      </div>

      {levels.length > 0 && (
        <div className="largo-read-levels">
          {levels.slice(0, 8).map((l, i) => (
            <div key={`${l.label}-${i}`} className="largo-read-level">
              <span className="largo-read-level-label">{l.label}</span>
              <span className="largo-read-level-price">
                {typeof l.price === "number" ? l.price.toLocaleString() : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {sections.map((s, i) => (
        <div
          key={`${s.title}-${i}`}
          className={clsx("largo-read-section", RISK_TITLE.test(s.title) && "largo-read-section-risk")}
        >
          <div className="largo-read-section-title">{s.title}</div>
          <div className="largo-read-section-body">{renderInlineMarkdown(s.body)}</div>
        </div>
      ))}

      {envelope.invalidation && (
        <div className="largo-read-section largo-read-section-risk">
          <div className="largo-read-section-title">Invalidation</div>
          <div className="largo-read-section-body">{renderInlineMarkdown(envelope.invalidation)}</div>
        </div>
      )}

      {/* Sources requested but UNAVAILABLE are surfaced, not omitted. A missing source silently
          dropped turns "we could not see" into "there was nothing there". */}
      {(envelope.unavailableSources?.length ?? 0) > 0 && (
        <div className="largo-read-section largo-read-section-risk">
          <div className="largo-read-section-title">Could not read</div>
          <div className="largo-read-section-body">
            {envelope.unavailableSources!.map((u) => u.source).join(" · ")}
          </div>
        </div>
      )}

      {sources.size > 0 && (
        <div className="largo-read-data">
          {[...sources.entries()].map(([src, fresh]) => (
            <span key={src} className={clsx("largo-read-src", FRESH_CLASS[fresh])}>
              {src} {fresh}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
