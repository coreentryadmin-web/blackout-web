"use client";

import { FRESHNESS_LABEL } from "@/features/largo/answer/answer-format";
import React from "react";
import { clsx } from "clsx";
import type { BieAnswerEnvelope, BieFreshness } from "@/lib/bie/answer-envelope";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";
import { proseSections, summariseEvidence, hasExpandableEvidence } from "./section-policy";
import { splitHeadline } from "./headline";
import { signalRowsFromLevels, tallySignals, BIAS_GLYPH } from "./signal-rows";
import { ladderFromLevels } from "./level-ladder";
import { classifyLayout, blockOrder, type AnswerBlock } from "./answer-layout";
import { formatGexChange } from "@/lib/largo/core/gex-shift-extract";
import { formatDistance } from "@/features/largo/lib/rail-levels";
import {
  deriveMarketState,
  deriveActionState,
  marketStateToBias,
  MARKET_STATE_LABEL,
  ACTION_STATE_LABEL,
} from "@/lib/largo/core/market-state";

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

/** One glyph per section meaning — the restrained set, defined once. */
const SECTION_ICON: Record<string, string> = {
  interpretation: "⚡",
  conflicts: "🟡",
  risk: "⚠️",
  invalidation: "🎯",
  flow: "🌊",
};

function sectionIcon(title: string): string {
  return SECTION_ICON[String(title ?? "").trim().toLowerCase()] ?? "";
}

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

export function LargoDeskRead({
  envelope,
  question,
}: {
  envelope: BieAnswerEnvelope;
  /** The member's question, used ONLY to choose which block leads. Optional: without it the card
   *  renders the default order, which is always a correct way to show an answer. */
  question?: string | null;
}) {
  const levels = envelope.levels ?? [];
  const layout = classifyLayout(question);
  const trade = envelope.tradeDecision;
  const isTradeLayout = layout === "trade" || Boolean(trade);

  // Only sections whose content exists nowhere else. Trade questions hide prose sections —
  // interpretation/conflicts live behind Evidence & reasoning only.
  const sections = isTradeLayout ? [] : proseSections(envelope.sections);
  const evidence = envelope.evidence ?? [];
  const evidenceSummary = summariseEvidence(evidence);

  // THE HEADLINE IS THE EXECUTIVE ANSWER. Largo writes its verdict as one long paragraph, so the
  // old `headline` was the whole thing rendered in display type — an essay in a title slot, and
  // the same reasoning appeared again below. Only the first sentence leads; the elaboration is
  // dropped from the default view because Interpretation already carries it (see section-policy).
  const { header } = splitHeadline(trade?.headline ?? envelope.headline);

  // Derived from the header, so the badge, the chips and the prose can never disagree.
  const state = deriveMarketState(envelope.headline ?? "");
  const action = deriveActionState(envelope.headline ?? "");
  const bias = marketStateToBias(state);

  const ladder = ladderFromLevels(levels);
  const signals = signalRowsFromLevels(levels);
  const tally = tallySignals(signals);

  // The question decides which block LEADS — never which blocks exist. `blockOrder` guarantees
  // every block appears exactly once under every layout, so a misclassified question costs
  // emphasis, never content. See answer-layout.ts.
  const order = blockOrder(layout);
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

  /**
   * The four reorderable blocks, built once and emitted in the order the question implies.
   *
   * Keyed by block name so `order` can permute them. Every key is always present in the map — a
   * layout can move a block but cannot remove it, which is the invariant answer-layout.ts exists
   * to guarantee. A block that has no data renders null, exactly as it did inline.
   */
  const blocks: Record<AnswerBlock, React.ReactNode> = {
    // SIGNAL TABLE. Every arrow is COMPUTED (level vs spot) or looked up in a closed convention
    // map — never inferred from phrasing. See signal-rows.ts: fewer rows is the correct failure,
    // because a fabricated arrow reads as an instruction.
    signals:
      trade && trade.signalRows.length > 0 ? (
        <div key="signals" className="largo-read-signals">
          <div className="largo-read-block-title">Signal</div>
          <div className="largo-read-sig largo-read-sig-head">
            <span className="largo-read-sig-label">Signal</span>
            <span className="largo-read-sig-read">Read</span>
            <span className="largo-read-sig-bias">Bias</span>
          </div>
          {trade.signalRows.map((r) => (
            <div key={r.signal} className="largo-read-sig">
              <span className="largo-read-sig-label">{r.signal}</span>
              <span className="largo-read-sig-read">{r.read}</span>
              <span className={clsx("largo-read-sig-bias", `largo-read-sig-${r.bias === "bullish" ? "bull" : r.bias === "bearish" || r.bias === "unstable" ? "bear" : "neutral"}`)}>
                {r.glyph}
              </span>
            </div>
          ))}
        </div>
      ) : signals.length > 0 ? (
        <div key="signals" className="largo-read-signals">
          <div className="largo-read-block-title">
            Signals <span className="largo-read-tally">{tally.bull} bull · {tally.bear} bear</span>
          </div>
          {signals.map((r: (typeof signals)[number]) => (
            <div key={r.label} className="largo-read-sig" title={r.because}>
              <span className="largo-read-sig-label">{r.label}</span>
              <span className="largo-read-sig-read">{r.reading}</span>
              <span className={clsx("largo-read-sig-bias", `largo-read-sig-${r.bias}`)}>{BIAS_GLYPH[r.bias]}</span>
            </div>
          ))}
        </div>
      ) : null,

    // DECISION MAP — price-ordered with spot in place, so the geometry is visible without reading
    // a sentence. Shared with the context rail so the two cannot disagree.
    ladder:
      ladder.length > 1 ? (
        <div key="ladder" className="largo-read-ladder">
          <div className="largo-read-block-title">📍 Decision levels</div>
          {ladder.map((r) => (
            <div
              key={`${r.label}-${r.price}`}
              className={clsx("largo-read-rung", r.isSpot && "largo-read-rung-spot")}
            >
              <span className="largo-read-rung-price">
                {r.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
              <span className="largo-read-rung-label">{r.label}</span>
              <span className="largo-read-rung-dist">{r.isSpot ? "" : formatDistance(r.distancePct)}</span>
            </div>
          ))}
        </div>
      ) : null,

    sections: (
      <React.Fragment key="sections">
        {sections.map((sec, i) => (
          <div
            key={`${sec.title}-${i}`}
            className={clsx("largo-read-section", RISK_TITLE.test(sec.title) && "largo-read-section-risk")}
          >
            <div className="largo-read-section-title">{sectionIcon(sec.title)} {sec.title}</div>
            <div className="largo-read-section-body">{renderInlineMarkdown(sec.body)}</div>
          </div>
        ))}
      </React.Fragment>
    ),

    // SYSTEM READS — what each product independently thinks, and whether they agree. The single
    // highest-value thing this platform knows and the only thing it never said out loud: every
    // product already has an opinion, they were just on five different pages.
    //
    // A bar renders ONLY where a system natively produces a 0-100 quantity (see system-reads.ts).
    // Night Hawk deliberately has none — a lane with one open call is not "100% bullish".
    systemReads: !trade && envelope.systemReads?.reads.length ? (
      <div key="systemReads" className="largo-read-signals">
        <div className="largo-read-block-title">
          System reads
          <span
            className={clsx(
              "largo-read-tally",
              envelope.systemReads.agreement.verdict === "aligned" && "largo-read-sig-bull",
              envelope.systemReads.agreement.verdict === "split" && "largo-read-sig-neutral"
            )}
          >
            {envelope.systemReads.agreement.verdict === "aligned"
              ? `✓ aligned ${envelope.systemReads.agreement.direction ?? ""}`
              : envelope.systemReads.agreement.verdict === "split"
                ? `🟡 split · ${envelope.systemReads.agreement.bullish}▲ ${envelope.systemReads.agreement.bearish}▼`
                : `${envelope.systemReads.agreement.voting} system${envelope.systemReads.agreement.voting === 1 ? "" : "s"} read`}
          </span>
        </div>
        {envelope.systemReads.reads.map((r) => (
          <div key={r.system} className="largo-read-sig" title={r.reason ?? r.basis}>
            <span className="largo-read-sig-label">{r.system}</span>
            <span className="largo-read-sig-read">{r.basis}</span>
            <span
              className={clsx(
                "largo-read-sig-bias",
                r.stance === "bullish" && "largo-read-sig-bull",
                r.stance === "bearish" && "largo-read-sig-bear",
                r.stance === "neutral" && "largo-read-sig-neutral"
              )}
            >
              {r.stance === "bullish"
                ? "🟢 ↑"
                : r.stance === "bearish"
                  ? "🔴 ↓"
                  : r.stance === "neutral"
                    ? "🟡 ↔"
                    : "◌"}
              {/* The bar is the system's OWN number, or nothing. Never a normalised stand-in. */}
              {r.strength != null ? ` ${r.strength}` : ""}
            </span>
          </div>
        ))}
      </div>
    ) : null,

    // Γ GEX SHIFT — strike-level change since the previous snapshot, from the tool's OWN structured
    // output. Direction is the tool's `stronger`/`weaker`/`flipped` field, not the sign of the
    // change: a strike CROSSING ZERO is a different event from one merely shrinking, and a sign
    // test cannot express the difference.
    gexShifts: envelope.gexShifts?.length ? (
      <div key="gexShifts" className="largo-read-signals">
        <div className="largo-read-block-title">Γ GEX shift</div>
        {envelope.gexShifts.map((g) => (
          <div key={g.strike} className="largo-read-sig">
            <span className="largo-read-sig-label">
              {g.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}
            </span>
            <span
              className={clsx(
                "largo-read-sig-read",
                g.direction === "stronger" && "largo-read-sig-bull",
                g.direction === "weaker" && "largo-read-sig-bear",
                g.direction === "flipped" && "largo-read-sig-neutral"
              )}
            >
              {formatGexChange(g.change)}
            </span>
            <span
              className={clsx(
                "largo-read-sig-bias",
                g.direction === "stronger" && "largo-read-sig-bull",
                g.direction === "weaker" && "largo-read-sig-bear",
                g.direction === "flipped" && "largo-read-sig-neutral"
              )}
            >
              {g.direction === "stronger" ? "🟢 ↑" : g.direction === "weaker" ? "🔴 ↓" : "🟡 ↔"}{" "}
              {g.direction}
            </span>
          </div>
        ))}
      </div>
    ) : null,

    invalidation: envelope.invalidation ? (
      <div key="invalidation" className="largo-read-section largo-read-section-risk">
        <div className="largo-read-section-title">🎯 Invalidation</div>
        <div className="largo-read-section-body">{renderInlineMarkdown(envelope.invalidation)}</div>
      </div>
    ) : null,
  };

  return (
    <div className="largo-read">
      <div className="largo-read-head">
        {/* The synthesis mark. Purple appears HERE and on the left rule — never in body text —
            so it reads as provenance ("Largo produced this") rather than as a theme. */}
        <span className="largo-read-mark">◈ Largo synthesis</span>
        <span className="largo-read-asof">{formatEt(envelope.asOf)}</span>
      </div>

      {/* ONE-GLANCE STATE: direction, action, confidence. Direction and action are separate
          variables — "clearly bullish" and "take a long" are different claims, and a single badge
          has to overstate one of them. */}
      <div className="largo-read-state">
        <span className={clsx("largo-read-statechip", `largo-read-bias-${bias}`)}>
          {BIAS_GLYPH[bias === "bullish" ? "bull" : bias === "bearish" ? "bear" : "neutral"]}{" "}
          {MARKET_STATE_LABEL[state]}
        </span>
        {envelope.confidence?.level && (
          <span className="largo-read-conf">{envelope.confidence.level} confidence</span>
        )}
        {action !== "unknown" && (
          <span className="largo-read-action">◌ {trade?.actionLabel ?? ACTION_STATE_LABEL[action]}</span>
        )}
      </div>

      {/* THE EXECUTIVE ANSWER — one line for trade questions; one sentence otherwise. */}
      {header && (
        <div className={clsx("largo-read-header", isTradeLayout && "largo-read-header-trade", trade?.isSpeculative && "largo-read-header-speculative")}>
          {isTradeLayout ? `${trade?.headlineGlyph ?? "🟡"} ${header}` : header}
        </div>
      )}

      {trade && (
        <div className="largo-read-trade-body">
          {trade.speculativeThesis && (
            <div className="largo-read-callout largo-read-callout-warning">
              <strong>{trade.speculativeThesis.warning}</strong>
              <p className="largo-read-speculative-summary">{trade.speculativeThesis.summary}</p>
              {trade.speculativeThesis.factors.length > 0 && (
                <ul className="largo-read-speculative-factors">
                  {trade.speculativeThesis.factors.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {trade.boardPlay && (
            <div className="largo-read-callout largo-read-callout-board">
              <strong>0DTE board play ({trade.boardPlay.status}):</strong> {trade.boardPlay.contract}
              <br />
              {trade.boardPlay.note}
            </div>
          )}
          <div className="largo-read-callout">{renderInlineMarkdown(trade.approach)}</div>
          {trade.existingPlay && (
            <div className="largo-read-callout largo-read-callout-muted">
              <strong>Existing Night Hawk contract:</strong> {trade.existingPlay.contract}, original entry{" "}
              {trade.existingPlay.originalEntry}
              <br />
              {trade.existingPlay.note}
            </div>
          )}
          {trade.bearishConfirm && (
            <div className="largo-read-callout largo-read-callout-risk">{trade.bearishConfirm}</div>
          )}
          <div className="largo-read-overall">{trade.overall}</div>
        </div>
      )}

      {!trade && envelope.confidence?.why && (
        // THROUGH THE INLINE RENDERER, like every other prose field on this component.
        // This one line printed its markdown raw: the live CRWV read showed a literal
        // "**Low**. The IV rank is median…" under the headline. Largo writes the confidence
        // rationale in the same voice as the sections above it — bold for the level, numbers it
        // expects to be stamped — and this was the only place that text reached the DOM unparsed.
        <div className="largo-read-conf-why">{renderInlineMarkdown(envelope.confidence.why)}</div>
      )}

      {order.map((b) => blocks[b])}

      {(envelope.unavailableSources?.length ?? 0) > 0 && (
        <div className="largo-read-section largo-read-section-risk">
          <div className="largo-read-section-title">Could not read</div>
          <div className="largo-read-section-body">
            {envelope.unavailableSources!.map((u) => u.source).join(" · ")}
          </div>
        </div>
      )}

      {/* EVIDENCE — collapsed by default. The audit trail is one of the strongest things Largo has
          and it is also the longest; open by default it buried the answer, and cut it would remove
          the only way to check a claim. A disclosure keeps the casual read short and the
          sophisticated read complete, and the summary line says what is behind it so the choice to
          expand is informed rather than blind. `<details>` because it must work before hydration —
          an answer whose basis is unreachable until JS lands is an answer you cannot verify. */}
      {hasExpandableEvidence(envelope) && (
        <details className="largo-read-evidence">
          <summary className="largo-read-evidence-summary">Evidence &amp; reasoning · {evidenceSummary.label}</summary>
          <div className="largo-read-evidence-body">
            {evidence.map((e, i) => (
              <div key={i} className="largo-read-ev">
                {/* The kind is a CLASS, not a text prefix. `[fact]` reaching the UI was the raw
                    Facts markdown being rendered alongside the parsed rows; the parsed rows never
                    carried the marker. */}
                <span className={clsx("largo-read-ev-kind", `largo-read-ev-${e.kind}`)}>{e.kind}</span>
                <span className="largo-read-ev-text">{renderInlineMarkdown(e.text)}</span>
                {e.provenance?.source && (
                  <span className={clsx("largo-read-ev-src", FRESH_CLASS[e.provenance.freshness ?? "unknown"])}>
                    {e.provenance.source}
                  </span>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {sources.size > 0 && (
        <div className="largo-read-data">
          {[...sources.entries()].map(([src, fresh]) => (
            <span key={src} className={clsx("largo-read-src", FRESH_CLASS[fresh])}>
              {/* SEPARATED, AND THE FRESHNESS SPELLED OUT.
                  This concatenated a SOURCE NAME directly with a FRESHNESS VALUE, and the
                  result reads as a sentence about the source: the live CRWV read showed
                  "NIGHT HAWK EDITION UNKNOWN" — which parses as the edition being unknown, on an
                  answer that had just cited that edition's Aug-4 pick. The edition was known; its
                  AGE was not. `FRESHNESS_LABEL` already carries the unambiguous wording ("Age
                  unknown"), and the separator stops the two fields reading as one phrase. */}
              {src} · {FRESHNESS_LABEL[fresh]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
