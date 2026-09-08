import { test } from "node:test";
import assert from "node:assert/strict";
import { LEARN_ARTICLES } from "./articles";
import { ARTICLE_FAQS } from "./article-faqs";
import { PLAN_RULES, PLAN_RULES_TIME_STOP_ET_LABEL } from "@/lib/zerodte/plan";
import { ZERODTE_RECORD_METHODOLOGY } from "@/lib/zerodte/record";
import { TRACK_RECORD_METHODOLOGY } from "@/lib/track-record-page";

// 2026-09-02, P1 (user report): the public /methodology page — the page that exists
// specifically so a member can independently reproduce the 0DTE Command ledger — quoted
// the mechanical hard-exit time as 15:50 ET in one place and 15:30 ET in another on the
// SAME page, because ZERODTE_RECORD_METHODOLOGY (record.ts) still hardcoded a stale "15:30"
// copy from before the engine's PLAN_RULES.time_stop_et_minutes moved to 15:50 (plan.ts),
// while sibling copy (MethodologyContent.tsx, TRACK_RECORD_METHODOLOGY) had been updated.
// The fix made every methodology string interpolate PLAN_RULES_TIME_STOP_ET_LABEL instead
// of hardcoding the time, so a future change to the engine constant can't re-introduce this
// drift silently — but only for the strings this test can see. Pin the value here (so the
// "before" state — record.ts's stale hardcoded literal — is proven wrong by this test) and
// sweep every public Learn article/FAQ for the specific stale phrase pattern, since prose
// content can't practically interpolate a constant.
test("PLAN_RULES_TIME_STOP_ET_LABEL matches the engine's actual time-stop constant", () => {
  const [h, m] = PLAN_RULES_TIME_STOP_ET_LABEL.split(":").map(Number);
  assert.equal(h * 60 + m, PLAN_RULES.time_stop_et_minutes);
});

test("the live 0DTE methodology strings quote the current hard-exit time, not a stale one", () => {
  assert.match(ZERODTE_RECORD_METHODOLOGY, new RegExp(`${PLAN_RULES_TIME_STOP_ET_LABEL}-ET`));
  assert.match(TRACK_RECORD_METHODOLOGY, new RegExp(`${PLAN_RULES_TIME_STOP_ET_LABEL} ET`));
  // Guards the exact contradiction the user reported: neither string may name a DIFFERENT
  // hard-exit time than the one above (a plain "15:30" check would also false-positive on
  // the unrelated new-play-entry-cutoff constant, which genuinely is 15:30 ET elsewhere on
  // the site — so this narrowly matches only the "stop/target/time-stop" triple pattern).
  assert.doesNotMatch(ZERODTE_RECORD_METHODOLOGY, /-50%\/\+100%\/15:30-ET/);
  assert.doesNotMatch(TRACK_RECORD_METHODOLOGY, /hard exit 15:30 ET/);
});

// Narrow, phrase-based sweep (same discipline as no-execution-claims.test.ts): matches the
// specific "stop/target + wrong hard-exit time" shape that actually contradicts the engine,
// not every incidental "15:30" — that string legitimately appears elsewhere (the 15:30 ET
// NEW-PLAY entry cutoff, the 14:00-15:30 late-block bucket) and a broad ban would false-positive
// on correct, unrelated copy.
const STALE_HARD_EXIT_PATTERNS = [
  /15:30 et time stop/i,
  /15:30 et cutoff to avoid/i,
  /15:30 et time stops/i,
];

test("no Learn article describes the 0DTE hard-exit/time-stop using a stale time", () => {
  const offenders: string[] = [];
  for (const article of LEARN_ARTICLES) {
    if (STALE_HARD_EXIT_PATTERNS.some((re) => re.test(article.body))) {
      offenders.push(article.slug);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these articles quote the 0DTE hard-exit/time-stop as 15:30 ET, contradicting the ` +
      `engine's actual ${PLAN_RULES_TIME_STOP_ET_LABEL} ET (PLAN_RULES.time_stop_et_minutes): ${offenders.join(", ")}`
  );
});

test("no Learn article FAQ answer describes the 0DTE hard-exit/time-stop using a stale time", () => {
  const offenders: string[] = [];
  for (const [slug, items] of Object.entries(ARTICLE_FAQS)) {
    for (const item of items) {
      if (STALE_HARD_EXIT_PATTERNS.some((re) => re.test(item.answer))) {
        offenders.push(`${slug}: ${item.question}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these FAQ answers quote the 0DTE hard-exit/time-stop as 15:30 ET, contradicting the ` +
      `engine's actual ${PLAN_RULES_TIME_STOP_ET_LABEL} ET: ${offenders.join(", ")}`
  );
});

// A second, unrelated defect found while investigating the above: a literal unresolved git
// merge-conflict block (<<<<<<< / ======= / >>>>>>>) was committed directly into an article
// body and shipped to production content. Cheap, permanent guard against it recurring.
test("no Learn article body contains an unresolved git merge-conflict marker", () => {
  const markerRe = /^(<{7}|={7}|>{7})/m;
  const offenders = LEARN_ARTICLES.filter((a) => markerRe.test(a.body)).map((a) => a.slug);
  assert.deepEqual(
    offenders,
    [],
    `these articles contain a literal unresolved merge-conflict marker in their body: ${offenders.join(", ")}`
  );
});
