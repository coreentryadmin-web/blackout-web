"use client";

import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";

const STANCE_GLYPH: Record<string, string> = {
  bullish: "↑",
  bearish: "↓",
  neutral: "↔",
};

/**
 * Cross-system agreement panel (`envelope.systemReads`) — what each product independently thinks
 * about this instrument, built from tool results the turn already fetched. Absent when fewer than
 * two systems were consulted (see `system-reads-extract.ts`).
 *
 * BUG FIX (Ask Largo standing mandate, 2026-11-09): same gap as `BieGexShiftsPanel` immediately
 * above — `LargoDeskRead.tsx` already renders `envelope.systemReads.reads` as a "System reads"
 * block, but `BieAnswer.tsx` (the renderer for a not-rich-enough envelope and the no-envelope
 * markdown-shim path) never read the field at all, so a real cross-desk consensus the turn
 * actually computed vanished whenever the answer fell short of `richEnough`.
 */
export function BieSystemReadsPanel({
  systemReads,
  label = "System reads",
}: {
  systemReads: BieAnswerEnvelope["systemReads"];
  label?: string;
}) {
  const reads = systemReads?.reads;
  if (!reads || reads.length === 0) return null;
  return (
    <div className="bie-evidence">
      <p className="bie-block-label">{label}</p>
      <ul className="bie-evidence-list">
        {reads.map((r) => (
          <li key={r.system} className="bie-evidence-item" title={r.reason ?? r.basis}>
            <span className="bie-evidence-text">{r.system}</span>
            <span>{r.basis}</span>
            <span>{STANCE_GLYPH[r.stance] ?? "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
