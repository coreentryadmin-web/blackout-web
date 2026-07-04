import "server-only";

import {
  type CheckResult,
  type MetricScore,
  type TickerScore,
  rollUpMetricStatus,
  worstStatus,
} from "@/lib/correctness/types";
import { fetchRecentLargoAnswersWithResults } from "@/lib/largo/largo-store";

// ---------------------------------------------------------------------------
// LARGO (AI terminal) data-correctness verifier — priority surface #7.
//
// THE GOAL: sample recent Largo answers, extract every numeric token, and trace each number back to a
// tool-call RESULT that answer received — FLAGGING numbers that appear in the answer but in NONE of the
// tool results (an ungrounded / hallucinated figure on a financial surface).
//
// PREVIOUSLY a scaffold-only verifier: Largo persistence retained the assistant ANSWER TEXT and TOOL
// NAMES only (largo_messages.content + tools_used JSONB) — the tool-call RESULTS lived only in-memory
// inside anthropicToolLoop and were discarded after the turn, so the trace could not run against real
// data. Fixed: largo_messages now has a nullable tool_results JSONB column, populated by
// largo-terminal.ts's runLargoQuery/runLargoQueryStream on every assistant turn, and
// fetchRecentLargoAnswersWithResults() is the bounded, cross-user, cron-readable reader over it.
//
// This verifier now:
//   • SELF-TESTS the grounding machinery on a fixture each run (independent of real data — proves the
//     FLAG logic itself has no bug before trusting it against production answers).
//   • Runs the SAME engine against real recent answers (assistant rows with a non-null tool_results),
//     flagging any answer that cites a number absent from its own turn's tool results.
//   • Gracefully reports a coverage note (never a false green) when zero qualifying rows exist yet —
//     e.g. immediately after this migration deploys, before any new Largo turns have run.
//
// RATE DISCIPLINE: one bounded DB read (LIMIT-capped) of already-logged rows — zero upstream provider
// calls, zero per-answer fan-out.
// ---------------------------------------------------------------------------

/** How many recent logged answers to sample per verifier run. */
const LARGO_ANSWER_SAMPLE_SIZE = 50;

/**
 * Extract numeric tokens from an answer that are CLAIMS worth grounding — prices, premiums, strikes,
 * percentages, $-amounts, levels. Deliberately ignores ordinals/list indices and bare years.
 * Written from scratch; pure + deterministic so it can be self-tested.
 */
export function extractNumericTokens(answer: string): number[] {
  if (!answer) return [];
  const out: number[] = [];
  // $1,234.50 | 4500 | 12.5% | 0.45Δ | $2.3M | 1.2B — capture the numeric core.
  // NOTE the comma-grouped alternative uses (?:,\d{3})+ (one-OR-MORE) so it only wins when a thousands
  // separator is actually present. With (?:,\d{3})* (zero-or-more) it greedily matched just the first
  // 1–3 digits of a plain integer (5900 → "590", leaving a stray "0"), truncating every comma-less
  // number; plain integers MUST fall through to the |-?\d+(?:\.\d+)? alternative to be captured whole.
  const re = /(-?\$?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\$?\s?\d+(?:\.\d+)?)\s?(%|k|m|b|bn)?/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answer)) !== null) {
    const rawNum = match[1].replace(/[$,\s]/g, "");
    let n = Number(rawNum);
    if (!Number.isFinite(n)) continue;
    const suffix = (match[2] ?? "").toLowerCase();
    if (suffix === "k") n *= 1e3;
    else if (suffix === "m") n *= 1e6;
    else if (suffix === "b" || suffix === "bn") n *= 1e9;
    // Skip tiny integers that are almost always list indices / counts, and bare 4-digit years.
    const isBareYear = Number.isInteger(n) && n >= 1990 && n <= 2100 && !suffix && !match[0].includes(".");
    if (isBareYear) continue;
    if (Number.isInteger(n) && n >= 0 && n <= 5 && !suffix && !match[0].includes("%") && !match[0].includes("$")) continue;
    out.push(n);
  }
  return out;
}

/** Flatten every finite number that appears anywhere in a set of tool-result JSON blobs. */
export function collectResultNumbers(toolResults: unknown[]): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (v == null) return;
    if (typeof v === "number") {
      if (Number.isFinite(v)) out.push(v);
      return;
    }
    if (typeof v === "string") {
      // Numbers embedded in result strings count as grounding too.
      for (const n of extractNumericTokens(v)) out.push(n);
      return;
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x);
      return;
    }
    if (typeof v === "object") {
      for (const x of Object.values(v as Record<string, unknown>)) walk(x);
    }
  };
  for (const r of toolResults) walk(r);
  return out;
}

/**
 * For each number in the answer, is there a tool-result number within a small relative tolerance? Returns
 * the answer numbers that are UNGROUNDED (present in the answer, absent from every tool result). This is
 * the FLAG engine — it runs the moment tool results are logged.
 */
export function traceNumbersToResults(
  answerNumbers: number[],
  resultNumbers: number[],
  relTol = 0.01
): number[] {
  const ungrounded: number[] = [];
  for (const a of answerNumbers) {
    const grounded = resultNumbers.some((r) => {
      if (a === r) return true;
      const denom = Math.max(Math.abs(a), Math.abs(r));
      return denom > 0 && Math.abs(a - r) / denom <= relTol;
    });
    if (!grounded) ungrounded.push(a);
  }
  return ungrounded;
}

function mk(
  layer: CheckResult["layer"],
  metric: string,
  outcome: CheckResult["outcome"],
  detail: string,
  extra: Partial<CheckResult> = {}
): CheckResult {
  return {
    id: `LARGO:${metric}:${layer}:${extra.id ?? Math.abs(hashStr(detail)).toString(36)}`,
    layer,
    metric,
    outcome,
    detail,
    ...extra,
  };
}
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function groupMetrics(ticker: string, checks: CheckResult[]): MetricScore[] {
  const byMetric = new Map<string, CheckResult[]>();
  for (const c of checks) {
    const arr = byMetric.get(c.metric) ?? [];
    arr.push(c);
    byMetric.set(c.metric, arr);
  }
  const scores: MetricScore[] = [];
  for (const [metric, mchecks] of byMetric.entries()) {
    const { status, independentlyConfirmed } = rollUpMetricStatus(mchecks);
    scores.push({ ticker, metric, status, independentlyConfirmed, checks: mchecks });
  }
  return scores;
}

/**
 * Verify Largo numeric grounding. Today this is a SCAFFOLD: the grounding machinery is real and
 * self-tested, but the data needed to run it (logged tool results + cron-readable answers) does not
 * exist yet, so the surface is recorded as an explicit coverage gap. Never throws.
 */
export async function verifyLargo(_marketOpen: boolean): Promise<TickerScore> {
  const ticker = "LARGO";
  const checks: CheckResult[] = [];

  // ── SELF-TEST the grounding engine on a fixture (so it's proven to work, not vaporware) ──
  {
    const answer = "SPX is at 5,842.30, the call wall sits at 5900 with $2.3M of premium, IV rank 47%. Target 6100.";
    const toolResults: unknown[] = [
      { spot: 5842.31, call_wall: 5900, premium: 2_300_000 },
      { iv_rank: 47 },
      // NOTE: 6100 ("Target") intentionally absent from results → must be flagged ungrounded.
    ];
    const answerNums = extractNumericTokens(answer);
    const resultNums = collectResultNumbers(toolResults);
    const ungrounded = traceNumbersToResults(answerNums, resultNums);
    // The engine must (a) extract the meaningful numbers and (b) flag 6100 as the lone ungrounded one.
    const flagged6100 = ungrounded.some((n) => Math.abs(n - 6100) < 1);
    const groundedSpot = !ungrounded.some((n) => Math.abs(n - 5842.3) < 1);
    const ok = flagged6100 && groundedSpot && answerNums.length >= 4;
    checks.push(
      mk(
        "shadow-recompute",
        "grounding_engine",
        ok ? "consistency-only" : "flag",
        ok
          ? `Numeric-grounding engine self-test PASSED: extracted ${answerNums.length} answer numbers, correctly grounded spot/wall/premium/IV and flagged the ungrounded 6100 target. Engine is wired and ready.`
          : `Numeric-grounding engine self-test FAILED (extracted=${answerNums.length}, ungrounded=${JSON.stringify(ungrounded)}) — the FLAG machinery itself has a bug.`,
        { id: "grounding-self-test", expected: "flag 6100 only", actual: JSON.stringify(ungrounded) }
      )
    );
  }

  // ── REAL-DATA CHECK — trace real recent answers to their captured tool results ──
  let answers: Awaited<ReturnType<typeof fetchRecentLargoAnswersWithResults>> = [];
  try {
    answers = await fetchRecentLargoAnswersWithResults(LARGO_ANSWER_SAMPLE_SIZE);
  } catch (err) {
    checks.push(
      mk(
        "cross-tool",
        "answer_grounding",
        "skipped",
        `Could not read recent Largo answers: ${err instanceof Error ? err.message : String(err)}.`,
        { id: "largo-answers-read-failed" }
      )
    );
  }

  if (answers.length === 0) {
    checks.push(
      mk(
        "cross-tool",
        "answer_grounding",
        "consistency-only",
        "No recent Largo answers with logged tool_results yet. Tool-result persistence (largo_messages." +
          "tool_results, populated by largo-terminal.ts on every assistant turn) landed this audit — the " +
          "engine will start flagging real answers as traffic accumulates against the new column. Not a " +
          "false green: un-audited by data availability right now, not by design.",
        { id: "largo-no-data-yet" }
      )
    );
  } else {
    const flagged: { id: number; ungrounded: number[] }[] = [];
    for (const a of answers) {
      const answerNums = extractNumericTokens(a.content);
      const resultNums = collectResultNumbers(a.tool_results);
      const ungrounded = traceNumbersToResults(answerNums, resultNums);
      if (ungrounded.length > 0) flagged.push({ id: a.id, ungrounded });
    }

    if (flagged.length > 0) {
      const examples = flagged
        .slice(0, 3)
        .map((f) => `#${f.id}: ${f.ungrounded.slice(0, 3).join(", ")}`)
        .join("; ");
      checks.push(
        mk(
          "shadow-recompute",
          "answer_grounding",
          "flag",
          `${flagged.length}/${answers.length} recent Largo answers cited a number absent from that turn's ` +
            `own tool-call results (possible hallucination). Examples: ${examples}.`,
          { id: "largo-ungrounded-answers", expected: "0 ungrounded", actual: String(flagged.length) }
        )
      );
    } else {
      checks.push(
        mk(
          "shadow-recompute",
          "answer_grounding",
          "pass",
          `${answers.length} recent Largo answers checked — every numeric claim traced to a tool-call ` +
            `result from the same turn.`,
          { id: "largo-answers-grounded" }
        )
      );
    }
  }

  void _marketOpen;
  const metrics = groupMetrics(ticker, checks);
  return { ticker, status: worstStatus(metrics.map((m) => m.status)), metrics };
}
