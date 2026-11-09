"use client";

import { clsx } from "clsx";
import type { BieAnswerEnvelope } from "@/lib/bie/answer-envelope";
import { LargoMessageBody } from "@/features/largo/components/LargoMessageBody";
import { renderInlineMarkdown } from "@/features/largo/components/inline-markdown";
import { LargoAnswerCaveats } from "@/features/largo/answer/LargoAnswerCaveats";
import { splitAnswerCaveats } from "@/features/largo/answer/answer-caveats";
import { splitHeadline } from "@/features/largo/answer/headline";
import { parseEtStamp } from "@/lib/largo/temporal/bar-session-date";

// Accepts an ISO instant OR a Largo C1 ET stamp ("YYYY-MM-DD HH:mm ET" — e.g. swing play-briefs'
// `envelope.asOf`). `new Date(iso)` returns Invalid Date on the ET-stamp shape, which silently
// dropped this "as of" label on every swing brief (found live 2026-09-14) — same fallback
// `@/lib/et-clock`'s internal `toMs` already uses for the same reason.
function formatEt(iso: string | null | undefined): string {
  if (!iso) return "";
  const parsed = Date.parse(iso);
  const ms = Number.isNaN(parsed) ? parseEtStamp(iso) : parsed;
  if (ms == null || Number.isNaN(ms)) return "";
  const d = new Date(ms);
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d)} ET`;
}

/**
 * Talon-style concrete read — verdict + one dense paragraph, no card chrome.
 */
export function LargoConcreteAnswer({
  content,
  envelope,
  className,
}: {
  content: string;
  envelope?: BieAnswerEnvelope | null;
  className?: string;
}) {
  const { body, caveats } = splitAnswerCaveats(content);
  const headline = envelope?.headline?.trim() ?? "";
  const { header, rest } = headline ? splitHeadline(headline) : { header: "", rest: "" };
  const verdict = header || rest.split(/[.—]\s/)[0]?.trim() || "";
  // THE VERDICT IS LIFTED OUT OF THE PROSE, SO THE PROSE MUST GIVE IT UP.
  //
  // `envelope.headline` is derived FROM the answer's opening sentence, and `body` is the whole
  // answer — so rendering both printed that sentence twice, back to back, in every Concrete answer
  // whose headline came from the prose.
  //
  // MEASURED ON PROD 2026-08-20 at 1024x1366, "Where are the SPX gamma walls?":
  //     Call wall 7900, put wall 7640.                          <- verdict <p>
  //     Call wall 7900, put wall 7640. The put wall is 1.16 ...  <- body, same sentence again
  //
  // Stripped only on a NORMALISED MATCH, never unconditionally: the envelope may legitimately
  // carry a headline that is a fresh summary rather than a lift, and cutting the body's real first
  // sentence in that case would delete content the member needs. Absent a match the body is
  // untouched — the duplication is the bug, not the presence of a verdict.
  const bodyWithoutVerdict = verdict ? dropLeadingSentence(body, verdict) : body;

  // BUG FIX: `envelope.tradeDecision` is documented in `decision-read.ts` as a "non-negotiable
  // honesty flag" (board-committed vs speculative, edition vs ledger) that must NOT be gated
  // behind any particular UI mode — but until this fix, only `LargoDeskRead.tsx` (the Deep-dive
  // renderer, reached only when a member switches modes AND the envelope clears an unrelated
  // `richEnough` bar) ever read it. Concrete is the DEFAULT `answerMode` in
  // `LargoAnswerMessage.tsx`, so for the overwhelming majority of real answers this warning —
  // e.g. "this ticker isn't on today's 0DTE board, this read is speculative" — never reached the
  // member at all. Mirrors `LargoDeskRead`'s own `integrityNotes` construction exactly so the
  // same envelope produces the same notes regardless of which renderer shows it.
  const trade = envelope?.tradeDecision;
  const integrityNotes: string[] = [];
  if (trade?.notOnBoardWarning) integrityNotes.push(trade.notOnBoardWarning);
  if (trade?.boardPlay) integrityNotes.push(`Board: ${trade.boardPlay.contract} (${trade.boardPlay.status})`);
  if (trade?.existingPlay) integrityNotes.push(`Edition: ${trade.existingPlay.contract}`);

  return (
    <article className={clsx("largo-concrete-answer", className)}>
      {envelope?.asOf ? (
        <div className="largo-concrete-meta font-mono">
          <span className="largo-concrete-mark">Largo</span>
          <span className="largo-concrete-asof">{formatEt(envelope.asOf)}</span>
        </div>
      ) : null}

      {verdict ? (
        <p className="largo-concrete-verdict">{renderInlineMarkdown(verdict)}</p>
      ) : null}

      {integrityNotes.length > 0 ? (
        <div className="largo-read-integrity">
          {integrityNotes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {trade?.existingPlay?.note && <p className="largo-read-integrity-note">{trade.existingPlay.note}</p>}
          {trade?.boardPlay?.note && <p className="largo-read-integrity-note">{trade.boardPlay.note}</p>}
        </div>
      ) : null}

      <LargoMessageBody
        content={bodyWithoutVerdict}
        className={clsx("largo-concrete-body", verdict && "largo-concrete-body-after-verdict")}
      />

      <LargoAnswerCaveats caveats={caveats} />
    </article>
  );
}

/** Comparable form: markdown emphasis, punctuation and spacing removed. */
function normalizeForCompare(v: string): string {
  return v
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.,;:—–-]+$/g, "")
    .trim()
    .toLowerCase();
}

/**
 * Remove `sentence` from the front of `text` when the two are the same claim.
 *
 * Compares NORMALISED, because the verdict has been through `stripEmphasis` while the body still
 * carries its markdown — a raw equality check would miss "**Call wall 7900**" vs "Call wall 7900"
 * and leave the duplication in place.
 */
function dropLeadingSentence(text: string, sentence: string): string {
  const want = normalizeForCompare(sentence);
  if (!want) return text;
  // Only the first sentence is a candidate; a match later in the answer is a legitimate callback.
  const m = /^([\s\S]*?[.!?])(\s|$)/.exec(text.trim());
  if (!m) return text;
  if (normalizeForCompare(m[1]) !== want) return text;
  return text.trim().slice(m[0].length).trimStart();
}
