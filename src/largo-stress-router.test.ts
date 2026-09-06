import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isCompoundQuestion, isNonsenseQuestion } from "@/lib/bie/question-focus";
import { scoreAnswer } from "../scripts/largo-stress-scoring.mjs";

test("largo-stress routeQuestion: nonsense before compound (??? → clarify_read)", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "scripts", "largo-stress-run.mjs"), "utf8");
  assert.match(
    src,
    /isNonsenseQuestion\(q\)[\s\S]*isCompoundQuestion\(q\)/,
    "stress harness must gate nonsense before compound — ??? has three ? marks",
  );
  assert.ok(isNonsenseQuestion("???"));
  assert.equal(isCompoundQuestion("???"), false, "nonsense punctuation is not compound");
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
