/**
 * Pure verdict helpers for the Largo truncation probe.
 *
 * WHY A PROBE LIKE THIS NEEDS ITS OWN RULES. The thing being asked is "did the payload you
 * received get cut off?", and the instrument answering it is the same model that would be
 * reading a cut-off payload. That makes two failure modes cheap and one expensive:
 *
 *   - cheap: the model answers something unparseable → we call it INDETERMINATE and move on.
 *   - cheap: the model answers TRUNCATED → that is self-reported evidence of a real problem,
 *     and a model has no incentive to invent it.
 *   - EXPENSIVE: the model answers COMPLETE for everything because the question never actually
 *     reached it, or because it is agreeing rather than observing. A run of all-COMPLETE is
 *     indistinguishable from a run that never ran.
 *
 * So this module encodes one rule above all: **a clean bill of health is only reportable when a
 * CONTROL that is known to be truncated actually came back TRUNCATED in the same run.** Without
 * that, every COMPLETE is downgraded to UNVERIFIED. This is the same discipline the Meridian
 * harnesses learned — "the probe never ran" must never read as "nothing wrong here".
 */

/** Verdicts a single tool probe can produce. */
export const VERDICTS = /** @type {const} */ (["TRUNCATED", "COMPLETE", "INDETERMINATE"]);

/**
 * Read a model reply into a verdict + the last top-level key it claims to see.
 *
 * Deliberately strict. The reply must contain exactly one of the two words as a standalone token;
 * a reply containing both (e.g. "not TRUNCATED, it is COMPLETE") is INDETERMINATE rather than
 * guessed at, because the two readings invert the finding.
 */
export function parseProbeReply(reply) {
  const text = typeof reply === "string" ? reply : "";
  const hasTrunc = /\bTRUNCATED\b/.test(text);
  const hasComplete = /\bCOMPLETE\b/.test(text);
  const verdict = hasTrunc && hasComplete ? "INDETERMINATE" : hasTrunc ? "TRUNCATED" : hasComplete ? "COMPLETE" : "INDETERMINATE";
  // The last-key claim is corroboration, never the verdict itself: a model that can name the
  // final key of a payload is demonstrably reading the payload rather than pattern-matching the
  // question. Optional — its absence downgrades nothing.
  //
  // Prefer a QUOTED identifier: models write the key as `analytics` / "analytics", and a loose
  // "word after the phrase 'key'" match happily captures the filler instead — the first draft of
  // this returned "I" from "the last top-level key I can actually see is `analytics`".
  const quoted = [...text.matchAll(/[`'"]([a-z0-9_]{2,})[`'"]/gi)].map((m) => m[1]);
  const labelled = /last(?:\s+top-level)?\s+key\s*(?:is|:|=)\s*([a-z0-9_]{2,})/i.exec(text);
  return { verdict, last_key: quoted.at(-1) ?? labelled?.[1] ?? null };
}

/**
 * Roll per-tool results into a run verdict.
 *
 * `controlVerdict` is the result for a tool KNOWN to exceed the cap. When it is anything other
 * than TRUNCATED, the instrument did not demonstrate it can detect truncation at all, and every
 * COMPLETE in the run is reported as UNVERIFIED instead of clean.
 */
export function summarizeRun(rows, controlVerdict) {
  const controlProven = controlVerdict === "TRUNCATED";
  const truncated = rows.filter((r) => r.verdict === "TRUNCATED");
  const complete = rows.filter((r) => r.verdict === "COMPLETE");
  const indeterminate = rows.filter((r) => r.verdict === "INDETERMINATE");
  return {
    control_proven: controlProven,
    truncated: truncated.map((r) => r.tool),
    // Only meaningful once the control fired; otherwise these are unverified, not clean.
    clean: controlProven ? complete.map((r) => r.tool) : [],
    unverified: controlProven ? [] : complete.map((r) => r.tool),
    indeterminate: indeterminate.map((r) => r.tool),
    // A run FAILS on any truncation found, and also when the control never proved the
    // instrument — a silent no-op run must not exit 0 and read as a pass.
    ok: controlProven && truncated.length === 0 && indeterminate.length === 0,
  };
}

/** The question. Kept here so the runner and its tests cannot drift on the wording. */
export function probeQuestion(tool, args = "") {
  const call = args ? `${tool} with ${args}` : tool;
  return (
    `Call ${call} and nothing else. Do not answer any other question. ` +
    `Does the raw tool result you received end with the literal characters …[truncated] ? ` +
    `Reply with exactly one word, TRUNCATED or COMPLETE, then on the next line name the LAST ` +
    `top-level key you can actually see in that result.`
  );
}
