"use client";

import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";
import type { AnswerCaveat } from "./answer-caveats";

const KIND_LABEL: Record<AnswerCaveat["kind"], string> = {
  coherence: "Internal check",
  integrity: "Data integrity hold",
  provenance: "Source note",
  "source-conflict": "Source conflict",
  plan: "Timeframe note",
  verification: "Grounding note",
  other: "Note",
};

/** Honesty caveats appended post-generation — styled, not buried in prose blockquotes. */
export function LargoAnswerCaveats({ caveats }: { caveats: readonly AnswerCaveat[] }) {
  if (!caveats.length) return null;
  return (
    <div className="largo-answer-caveats">
      {caveats.map((c, i) => (
        <div key={i} className="largo-answer-caveat" data-kind={c.kind}>
          <span className="largo-answer-caveat-label">{KIND_LABEL[c.kind]}</span>
          <div className="largo-answer-caveat-body">{renderInlineMarkdown(c.body)}</div>
        </div>
      ))}
    </div>
  );
}
