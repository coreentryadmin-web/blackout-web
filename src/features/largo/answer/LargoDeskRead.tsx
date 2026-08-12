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

const RISK_TITLE = /^(invalidation|risk|what would change|caution|warning)/i;

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

/** Avoid double emoji when the model already prefixed the verdict. */
function displayHeader(text: string): string {
  return text.replace(/^[🟡🟢🔴⚠️]\s*/, "").trim();
}

export function LargoDeskRead({
  envelope,
  question,
}: {
  envelope: BieAnswerEnvelope;
  question?: string | null;
}) {
  const levels = envelope.levels ?? [];
  const layout = classifyLayout(question);
  const trade = envelope.tradeDecision;
  const isTradeLayout = layout === "trade" || Boolean(trade);

  const sections = proseSections(envelope.sections);
  const hasInterpretation = sections.some((s) => s.title.toLowerCase() === "interpretation");
  const evidence = envelope.evidence ?? [];
  const evidenceSummary = summariseEvidence(evidence);

  // Model Verdict is the answer — never replaced by code-side heuristics.
  const { header, rest } = splitHeadline(envelope.headline);

  const state = deriveMarketState(envelope.headline ?? "");
  const action = deriveActionState(envelope.headline ?? "");
  const bias = envelope.bias ?? marketStateToBias(state);

  const ladder = ladderFromLevels(levels);
  const signals = signalRowsFromLevels(levels);
  const tally = tallySignals(signals);
  const order = blockOrder(layout);

  const sources = new Map<string, BieFreshness>();
  for (const e of envelope.evidence ?? []) {
    const label = e.provenance?.source;
    if (!label) continue;
    const f = e.provenance?.freshness ?? "unknown";
    const rank: Record<BieFreshness, number> = { live: 0, recent: 1, unknown: 2, stale: 3 };
    const prev = sources.get(label);
    if (!prev || rank[f] > rank[prev]) sources.set(label, f);
  }

  const showFallbackSignals = trade && trade.signalRows.length > 0;
  const showLevelSignals = !showFallbackSignals && signals.length > 0;

  const blocks: Record<AnswerBlock, React.ReactNode> = {
    signals: showFallbackSignals ? (
      <div key="signals" className="largo-read-signals">
        <div className="largo-read-block-title">Signal</div>
        <div className="largo-read-sig largo-read-sig-head">
          <span className="largo-read-sig-label">Signal</span>
          <span className="largo-read-sig-read">Read</span>
          <span className="largo-read-sig-bias">Bias</span>
        </div>
        {trade!.signalRows.map((r) => (
          <div key={r.signal} className="largo-read-sig">
            <span className="largo-read-sig-label">{r.signal}</span>
            <span className="largo-read-sig-read">{r.read}</span>
            <span
              className={clsx(
                "largo-read-sig-bias",
                `largo-read-sig-${r.bias === "bullish" ? "bull" : r.bias === "bearish" || r.bias === "unstable" ? "bear" : "neutral"}`
              )}
            >
              {r.glyph}
            </span>
          </div>
        ))}
      </div>
    ) : showLevelSignals ? (
      <div key="signals" className="largo-read-signals">
        <div className="largo-read-block-title">
          Signals <span className="largo-read-tally">{tally.bull} bull · {tally.bear} bear</span>
        </div>
        {signals.map((r) => (
          <div key={r.label} className="largo-read-sig" title={r.because}>
            <span className="largo-read-sig-label">{r.label}</span>
            <span className="largo-read-sig-read">{r.reading}</span>
            <span className={clsx("largo-read-sig-bias", `largo-read-sig-${r.bias}`)}>{BIAS_GLYPH[r.bias]}</span>
          </div>
        ))}
      </div>
    ) : null,

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
            <div className="largo-read-section-title">
              {sectionIcon(sec.title)} {sec.title}
            </div>
            <div className="largo-read-section-body">{renderInlineMarkdown(sec.body)}</div>
          </div>
        ))}
      </React.Fragment>
    ),

    systemReads: envelope.systemReads?.reads.length ? (
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
              {r.stance === "bullish" ? "🟢 ↑" : r.stance === "bearish" ? "🔴 ↓" : r.stance === "neutral" ? "🟡 ↔" : "◌"}
              {r.strength != null ? ` ${r.strength}` : ""}
            </span>
          </div>
        ))}
      </div>
    ) : null,

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
              {g.direction === "stronger" ? "🟢 ↑" : g.direction === "weaker" ? "🔴 ↓" : "🟡 ↔"} {g.direction}
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

  const biasKey = bias === "bullish" ? "bull" : bias === "bearish" ? "bear" : "neutral";

  return (
    <div className="largo-read">
      <div className="largo-read-head">
        <span className="largo-read-mark">◈ Largo synthesis</span>
        <span className="largo-read-asof">{formatEt(envelope.asOf)}</span>
      </div>

      <div className="largo-read-state">
        <span className={clsx("largo-read-statechip", `largo-read-bias-${bias}`)}>
          {BIAS_GLYPH[biasKey]} {MARKET_STATE_LABEL[state]}
        </span>
        {envelope.confidence?.level && (
          <span className="largo-read-conf">{envelope.confidence.level} confidence</span>
        )}
        {trade?.actionLabel && (
          <span className={clsx("largo-read-action", trade.isSpeculative && "largo-read-action-warn")}>
            {trade.isSpeculative ? "⚠️" : "◌"} {trade.actionLabel}
          </span>
        )}
        {!trade?.actionLabel && action !== "unknown" && (
          <span className="largo-read-action">◌ {ACTION_STATE_LABEL[action]}</span>
        )}
      </div>

      {header && (
        <div className={clsx("largo-read-header", isTradeLayout && "largo-read-header-trade")}>
          {displayHeader(header)}
        </div>
      )}

      {rest && !hasInterpretation && (
        <div className="largo-read-header-rest">{renderInlineMarkdown(rest)}</div>
      )}

      {trade && (trade.notOnBoardWarning || trade.boardPlay || trade.existingPlay) && (
        <div className="largo-read-trade-body">
          {trade.notOnBoardWarning && (
            <div className="largo-read-callout largo-read-callout-warning">{trade.notOnBoardWarning}</div>
          )}
          {trade.boardPlay && (
            <div className="largo-read-callout largo-read-callout-board">
              <strong>0DTE board ({trade.boardPlay.status}):</strong> {trade.boardPlay.contract}
              <br />
              {trade.boardPlay.note}
            </div>
          )}
          {trade.existingPlay && (
            <div className="largo-read-callout largo-read-callout-muted">
              <strong>Evening edition pick:</strong> {trade.existingPlay.contract}, entry{" "}
              {trade.existingPlay.originalEntry}
              <br />
              {trade.existingPlay.note}
            </div>
          )}
        </div>
      )}

      {envelope.confidence?.why && (
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

      {hasExpandableEvidence(envelope) && (
        <details className="largo-read-evidence">
          <summary className="largo-read-evidence-summary">
            Evidence &amp; reasoning · {evidenceSummary.label}
          </summary>
          <div className="largo-read-evidence-body">
            {evidence.map((e, i) => (
              <div key={i} className="largo-read-ev">
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
              {src} · {FRESHNESS_LABEL[fresh]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
