import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isNonsenseQuestion } from "@/lib/bie/question-focus";
import { scoreAnswer } from "../scripts/largo-stress-scoring.mjs";

/** Mirrors scripts/largo-stress-run.mjs isCompoundQuestion (stress-only, not production router). */
function isCompoundQuestion(question: string): boolean {
  const q = (question ?? "").trim();
  if (!q) return false;
  if ((q.match(/\?/g) ?? []).length >= 2) return true;
  if (/\band also\b/i.test(q)) {
    const parts = q.split(/\band also\b/i).map((s) => s.trim()).filter((s) => s.length >= 8);
    if (parts.length >= 2) return true;
  }
  return false;
}

test("largo-stress routeQuestion: nonsense before compound (??? → clarify_read)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "scripts", "largo-stress-run.mjs"), "utf8");
  assert.match(
    src,
    /isNonsenseQuestion\(q\)[\s\S]*isCompoundQuestion\(q\)/,
    "stress harness must gate nonsense before compound — ??? has three ? marks",
  );
  assert.ok(isNonsenseQuestion("???"));
  assert.ok(isCompoundQuestion("???"));
  const route = { intent: "clarify_read" as const, ticker: null };
  const scored = scoreAnswer({ q: "???", intent: "clarify_read" }, route, "Please ask a specific market question.", 200);
  assert.equal(scored.verdict, "OK", scored.issues.join(", "));
});

test("concept_read answers may explain without inventing numbers (calendar spread)", () => {
  const route = { intent: "concept_read" as const, ticker: null };
  const answer =
    "A calendar spread buys a longer-dated option and sells a nearer-dated option at the same strike. " +
    "It expresses a view on term structure and time decay rather than a directional rip.";
  const scored = scoreAnswer(
    { q: "calendar spread on SPY", intent: /concept_read|clarify_read/ },
    route,
    answer,
    200,
  );
  assert.notEqual(scored.verdict, "BAD", scored.issues.join(", "));
});
