"use client";

import { FRESHNESS_LABEL } from "@/features/largo/answer/answer-format";
import React from "react";
import { clsx } from "clsx";
import type { BieAnswerEnvelope, BieFreshness } from "@/lib/bie/answer-envelope";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";
import { extractLargoSegments } from "@/features/largo/blocks/extract";
import { LargoBlockView } from "@/features/largo/blocks/LargoBlocks";
import { proseSections, summariseEvidence, hasExpandableEvidence } from "./section-policy";
import { splitHeadline } from "./headline";
import { signalRowsFromLevels, tallySignals, BIAS_GLYPH } from "./signal-rows";
import { ladderFromLevels } from "./level-ladder";
import { classifyLayout, blockOrder, type AnswerBlock } from "./answer-layout";
import { deskReadVisibility } from "./desk-read-layout";
import { formatGexChange } from "@/lib/largo/core/gex-shift-extract";
import { formatDistance } from "@/features/largo/lib/rail-levels";
import {
  deriveActionState,
  marketStateToBias,
  MARKET_STATE_LABEL,
  ACTION_STATE_LABEL,
} from "@/lib/largo/core/market-state";

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
    hour12: false,
  }).format(d)} ET`;
}

function displayHeader(text: string): string {
  return text.replace(/^[🟡🟢🔴⚠️◌]\s*/, "").trim();
}

export function LargoDeskRead({
  envelope,
  question,
  markdownSource,
}: {
  envelope: BieAnswerEnvelope;
  question?: string | null;
  /** Raw answer markdown — used for inline blocks + dedupe (comparison vs fallback signals). */
  markdownSource?: string | null;
}) {
  const vis = deskReadVisibility(envelope, markdownSource);
  const trade = envelope.tradeDecision;
  const layout = classifyLayout(question);
  const sections = proseSections(envelope.sections);
  const hasInterpretation = sections.some((s) => s.title.toLowerCase() === "interpretation");
  const evidence = envelope.evidence ?? [];
  const evidenceSummary = summariseEvidence(evidence);

  const { header, rest } = splitHeadline(envelope.headline);
  const bias = marketStateToBias(vis.state);
  const action = deriveActionState(envelope.headline ?? "");

  const ladder = ladderFromLevels(envelope.levels ?? []);
  const levelSignals = signalRowsFromLevels(envelope.levels ?? []);
  const tally = tallySignals(levelSignals);
  const order = blockOrder(layout);

  const inlineBlocks = vis.showInlineBlocks
    ? extractLargoSegments(String(markdownSource ?? "")).filter((s) => s.kind === "block")
    : [];

  const sources = new Map<string, BieFreshness>();
  for (const e of evidence) {
    const label = e.provenance?.source;
    if (!label) continue;
    const f = e.provenance?.freshness ?? "unknown";
    const rank: Record<BieFreshness, number> = { live: 0, recent: 1, unknown: 2, stale: 3 };
    const prev = sources.get(label);
    if (!prev || rank[f] > rank[prev]) sources.set(label, f);
  }

  const blocks: Record<AnswerBlock, React.ReactNode> = {
    signals:
      vis.showFallbackSignals && trade ? (
        <div key="signals" className="largo-read-signals">
          <div className="largo-read-block-title">Signal alignment</div>
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
      ) : vis.showLevelSignals ? (
        <div key="signals" className="largo-read-signals">
          <div className="largo-read-block-title">
            Levels <span className="largo-read-tally">{tally.bull} bull · {tally.bear} bear</span>
          </div>
          {levelSignals.map((r) => (
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
          <div className="largo-read-block-title">Decision levels</div>
          {ladder.map((r) => (
            <div key={`${r.label}-${r.price}`} className={clsx("largo-read-rung", r.isSpot && "largo-read-rung-spot")}>
              <span className="largo-read-rung-price">{r.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
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
            className={clsx(
              "largo-read-section",
              sec.title.toLowerCase() === "conflicts" && "largo-read-section-conflicts",
              RISK_TITLE.test(sec.title) && "largo-read-section-risk"
            )}
          >
            <div className="largo-read-section-title">{sectionIcon(sec.title)} {sec.title}</div>
            <div className="largo-read-section-body">{renderInlineMarkdown(sec.body)}</div>
          </div>
        ))}
      </React.Fragment>
    ),

    systemReads: vis.showSystemReads ? (
      <div key="systemReads" className="largo-read-signals">
        <div className="largo-read-block-title">System reads</div>
        {envelope.systemReads!.reads.map((r) => (
          <div key={r.system} className="largo-read-sig" title={r.reason ?? r.basis}>
            <span className="largo-read-sig-label">{r.system}</span>
            <span className="largo-read-sig-read">{r.basis}</span>
            <span className={clsx("largo-read-sig-bias", r.stance === "bullish" && "largo-read-sig-bull", r.stance === "bearish" && "largo-read-sig-bear", r.stance === "neutral" && "largo-read-sig-neutral")}>
              {r.stance === "bullish" ? "↑" : r.stance === "bearish" ? "↓" : r.stance === "neutral" ? "↔" : "—"}
            </span>
          </div>
        ))}
      </div>
    ) : null,

    gexShifts: envelope.gexShifts?.length ? (
      <div key="gexShifts" className="largo-read-signals">
        <div className="largo-read-block-title">GEX shift</div>
        {envelope.gexShifts.map((g) => (
          <div key={g.strike} className="largo-read-sig">
            <span className="largo-read-sig-label">{g.strike.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            <span className="largo-read-sig-read">{formatGexChange(g.change)}</span>
            <span className="largo-read-sig-bias">{g.direction}</span>
          </div>
        ))}
      </div>
    ) : null,

    invalidation: envelope.invalidation ? (
      <div key="invalidation" className="largo-read-section largo-read-section-risk">
        <div className="largo-read-section-title">Invalidation</div>
        <div className="largo-read-section-body">{renderInlineMarkdown(envelope.invalidation)}</div>
      </div>
    ) : null,
  };

  const biasKey = bias === "bullish" ? "bull" : bias === "bearish" ? "bear" : "neutral";
  const integrityNotes: string[] = [];
  if (trade?.notOnBoardWarning) integrityNotes.push(trade.notOnBoardWarning);
  if (trade?.boardPlay) integrityNotes.push(`Board: ${trade.boardPlay.contract} (${trade.boardPlay.status})`);
  if (trade?.existingPlay) integrityNotes.push(`Edition: ${trade.existingPlay.contract}`);

  return (
    <div className="largo-read">
      <div className="largo-read-head">
        <span className="largo-read-mark">Largo</span>
        <span className="largo-read-asof">{formatEt(envelope.asOf)}</span>
      </div>

      {header && <div className="largo-read-header">{renderInlineMarkdown(displayHeader(header))}</div>}

      {rest && !hasInterpretation && (
        <div className="largo-read-lead">{renderInlineMarkdown(rest)}</div>
      )}

      {(vis.showStateChip || trade?.actionLabel) && (
        <div className="largo-read-meta">
          {vis.showStateChip && (
            <span className={clsx("largo-read-statechip", `largo-read-bias-${bias}`)}>
              {BIAS_GLYPH[biasKey]} {MARKET_STATE_LABEL[vis.state]}
            </span>
          )}
          {trade?.actionLabel && (
            <span className={clsx("largo-read-action", trade.isSpeculative && "largo-read-action-warn")}>
              {trade.isSpeculative ? "⚠" : ""} {trade.actionLabel}
            </span>
          )}
          {!trade?.actionLabel && vis.showActionChip && action !== "unknown" && (
            <span className="largo-read-action">{ACTION_STATE_LABEL[action]}</span>
          )}
          {envelope.confidence?.level && (
            <span className="largo-read-conf">{envelope.confidence.level}</span>
          )}
        </div>
      )}

      {integrityNotes.length > 0 && (
        <div className="largo-read-integrity">
          {integrityNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {trade?.existingPlay?.note && <p className="largo-read-integrity-note">{trade.existingPlay.note}</p>}
          {trade?.boardPlay?.note && <p className="largo-read-integrity-note">{trade.boardPlay.note}</p>}
        </div>
      )}

      {vis.showConfidenceWhy && envelope.confidence?.why && (
        <div className="largo-read-conf-why">{renderInlineMarkdown(envelope.confidence.why)}</div>
      )}

      {inlineBlocks.length > 0 && (
        <div className="largo-read-blocks">
          {inlineBlocks.map((seg, i) =>
            seg.kind === "block" ? <LargoBlockView key={i} block={seg.block} /> : null
          )}
        </div>
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
          <summary className="largo-read-evidence-summary">Supporting evidence · {evidenceSummary.label}</summary>
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
