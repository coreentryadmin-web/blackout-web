import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN_ARTICLES } from "./articles";

// BlackOut is analytics-only — no order routing, no broker execution (the homepage says so
// explicitly: "No order routing, no broker lock-in — pure intelligence delivered to your
// screen."). So a Learn article describing the 15:30 ET time stop must never say BlackOut
// itself "closes" a position — it can only mark a TRACKED play closed in its own ledger and
// alert the member to act at their own broker. Two articles said "closes all 0DTE positions" /
// "is closed by 3:30 PM" (execution language) before this test was written — found via a
// 2026-09 QA review that correctly flagged it as a security/precision issue, not copywriting.
// Narrow ON PURPOSE: general options-education prose says things like "SPY closes at $550.02"
// or "OI decreases when a position closes" constantly and correctly — that's the UNDERLYING
// closing, not BlackOut executing anything. The actual bug (found via a 2026-09 QA review) was
// two specific sentences describing BlackOut's OWN time-stop/stop-loss mechanism as the one
// doing the closing — implying order execution BlackOut (analytics-only, no broker routing)
// cannot actually perform. Regression-guard the exact broken phrasing rather than a broad
// heuristic (which false-positives on "hard exit before the close" and similar honest prose).
const EXECUTION_CLAIM_PHRASES = [
  "closes all 0dte positions",
  "any open 0dte position is closed by",
];

test("no Learn article claims BlackOut itself closes a position (execution language)", () => {
  const offenders: string[] = [];
  for (const article of LEARN_ARTICLES) {
    const lower = article.body.toLowerCase();
    if (EXECUTION_CLAIM_PHRASES.some((phrase) => lower.includes(phrase))) {
      offenders.push(article.slug);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these articles describe BlackOut's own stop/time-stop mechanism as executing a close, ` +
      `instead of "marks the tracked play closed": ${offenders.join(", ")}`
  );
});

// The FAQ/homepage previously claimed "zero delay"/"the instant the market moves"/"never a
// stale snapshot" — absolute claims the platform's own Risk Disclaimer contradicts ("third-party
// market data may be delayed, inaccurate, or incomplete"). Same discipline applies to Learn
// content: no article may promise zero-delay/instant/never-stale data.
test("no Learn article promises zero-delay/instant/never-stale data", () => {
  const offenders: string[] = [];
  for (const article of LEARN_ARTICLES) {
    if (/zero delay|never a? stale|instant(?:ly)? (?:the market|updates?)/i.test(article.body)) {
      offenders.push(article.slug);
    }
  }
  assert.deepEqual(offenders, [], `these articles overclaim data freshness: ${offenders.join(", ")}`);
});

test("no Learn article title or description uses banned overnight-playbook positioning", () => {
  const offenders: string[] = [];
  for (const article of LEARN_ARTICLES) {
    const combined = `${article.title}\n${article.description}\n${article.metaDescription ?? ""}`;
    if (/overnight playbook/i.test(combined)) {
      offenders.push(article.slug);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these articles still position Night Hawk as an overnight playbook in title/description: ${offenders.join(", ")}`
  );
});
