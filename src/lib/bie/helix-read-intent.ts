/**
 * Pure helpers for the HELIX BIE read — split out of helix-read.ts so they can be unit-tested.
 *
 * helix-read.ts imports `@/lib/platform`, whose graph reaches `server-only`, so a test that imports
 * anything from it cannot load at all (the same constraint that forced helixTapeFetchOptions out of
 * product-reads.ts). Both functions below are pure — no I/O, no server imports — precisely so the
 * two defects they fix are guarded by tests.
 */

/**
 * The option-side suffix for a print/stack line: "c", "p", or "?" when the side is unknown.
 *
 * WHY THIS EXISTS. Two lines in helix-read.ts compared `option_type` against LOWERCASE literals —
 * the print list against `"put"`, the strike-stack list against `"call"` — but every producer of
 * this field emits UPPERCASE ("CALL"/"PUT": FlowAlert is typed `"CALL" | "PUT"`, and
 * computeFlowStrikeStacks normalises to `opt.startsWith("P") ? "PUT" : "CALL"`). So `"PUT" === "put"`
 * was ALWAYS false: the print list rendered every put as a call, and the stack list rendered every
 * call as a put — the two defaults were even inverted, so the same tape read one way in one section
 * and the opposite in the next. Mislabelling a $23M PUT as a call is a correctness fault, not a
 * cosmetic one. `startsWith` on the upper-cased value is immune to case AND to a bare "C"/"P".
 * Unknown returns "?" rather than guessing a side — asserting call-or-put we do not have is the
 * exact fabrication this file's own regime line already refuses with "—".
 */
export function optionSideSuffix(optionType: unknown): "c" | "p" | "?" {
  const t = String(optionType ?? "").toUpperCase();
  if (t.startsWith("C")) return "c";
  if (t.startsWith("P")) return "p";
  return "?";
}

/**
 * Which tape population this read needs. "biggest prints by premium" genuinely wants the largest
 * prints (premium-ordered); every other HELIX read wants the RECENT session, because strike stacks
 * are a rolling "what is being hit repeatedly right now" signal and leaders / tape totals describe
 * the session — feeding them a premium-ordered top-50 answers with the biggest prints of two days,
 * the same order-selection defect fixed in get_helix_derived and the HELIX↔Thermal compare card.
 */
export function parseHelixReadIntent(question?: string): {
  order: "premium" | "recent";
  topN: number | null;
  listOnly: boolean;
} {
  const m = question?.match(/\btop\s+(\d+)\b/i);
  const topN = m ? Math.min(10, Math.max(1, Number(m[1]))) : null;
  const listOnly = Boolean(question && /\b(list only|prints? by premium|biggest prints?)\b/i.test(question));
  const wantsBiggest = listOnly || topN != null;
  return { order: wantsBiggest ? "premium" : "recent", topN, listOnly };
}
