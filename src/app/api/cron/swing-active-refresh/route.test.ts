// Regression: swing-active-refresh must handshake via after() so Cloudflare never 504s
// the cron before logCronRun fires (ops #1364 — same class as vector-universe-snapshot).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const routeSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "route.ts"),
  "utf8"
);

test("swing-active-refresh dispatches refresh in after() and returns 202", () => {
  assert.match(routeSrc, /after\(dispatchRefresh\)/, "must use after() for fire-and-forget handshake");
  assert.match(routeSrc, /status:\s*202/, "must return HTTP 202 accepted");
  assert.match(routeSrc, /logCronRun\("swing-active-refresh"/, "must log cron handshake before response");
  assert.doesNotMatch(
    routeSrc,
    /await logCronRun\("swing-active-refresh"[\s\S]*await runSwingActiveRefresh\(/,
    "logCronRun must not await the heavy refresh inline"
  );
});

test("swing-active-refresh background dispatch is wrapped in runWithBackgroundUwSweep", () => {
  assert.match(
    routeSrc,
    /import \{[^}]*\brunWithBackgroundUwSweep\b[^}]*\} from "@\/lib\/providers\/uw-rate-limiter"/
  );
  assert.match(routeSrc, /runWithBackgroundUwSweep\(\(\) => runSwingActiveRefreshCron\(started, slot\)\)/);
});

test("swing-active-refresh acquires singleton claim before work (Q37)", () => {
  assert.match(routeSrc, /SWING_ACTIVE_REFRESH_CLAIM_KEY/);
  assert.match(routeSrc, /sharedCacheSetNx\(/);
  assert.match(routeSrc, /another refresh pass is still running/);
});

// Regression (2026-10-13/14): the Q37 singleton claim above lives INSIDE the background
// function and only ever stopped THIS cron from overlapping with itself. Live CloudWatch
// (2026-10-13 13:35-13:56 UTC) showed this cron and 5 OTHER heavy crons in flight at once on the
// shared web tier, 1:1 correlated with sustained ALB tail latency — see
// heavy-cron-concurrency-guard.ts's header for the full evidence. Unlike the other 5 wired
// routes, this one's self-overlap claim is taken INSIDE the background function rather than in
// GET, so the cross-cron slot must be acquired in GET (before dispatch) and threaded through.
test("a cross-cron concurrency slot is acquired in GET before dispatch and threaded into the background function", () => {
  assert.match(
    routeSrc,
    /import \{ acquireHeavyCronSlot, type HeavyCronSlot \} from "@\/lib\/cron\/heavy-cron-concurrency-guard"/,
    "must import the shared cross-cron concurrency guard"
  );
  assert.match(
    routeSrc,
    /const slot = await acquireHeavyCronSlot\("swing-active-refresh", activeRefreshClaimTtlSec\(\)\);/,
    "must acquire a named heavy-cron slot using the same TTL as the Q37 singleton claim"
  );
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const slotAt = routeSrc.indexOf("const slot = await acquireHeavyCronSlot(");
  const dispatchAt = routeSrc.indexOf("const dispatchRefresh");
  assert.ok(
    gateAt >= 0 && slotAt > gateAt && slotAt < dispatchAt,
    "the slot must be acquired after the RTH gate and before dispatch is defined"
  );
  assert.match(
    routeSrc,
    /async function runSwingActiveRefreshCron\(started: number, slot: HeavyCronSlot\): Promise<void> \{/,
    "the background function must accept the slot so it can release it when done"
  );
});

test("a lost cross-cron concurrency race in GET skips the run with an honest idempotent-skip payload", () => {
  assert.match(
    routeSrc,
    /if \(!slot\) \{\s*const payload = \{\s*ok: true,\s*skipped: true,\s*reason: "heavy-cron concurrency slot unavailable \(idempotent skip\)",\s*\};/,
    "a lost race must skip honestly before ever calling the background function, not proceed without a slot"
  );
});

test("the slot is released both on the early self-overlap-claim-lost return and in the main finally block", () => {
  // Two release sites are correct here, not a bug: the slot is acquired once in GET, but the
  // Q37 singleton claim inside the background function can ALSO lose its own race (another
  // refresh pass already running) — that early return must still free the slot GET just handed
  // it, or a held slot would leak every time this specific race is lost.
  assert.match(
    routeSrc,
    /another refresh pass is still running \(Q37 singleton claim\)",?\s*\);\s*await slot\.release\(\);\s*return;/,
    "losing the Q37 claim after already holding a slot must release that slot before returning"
  );
  assert.match(
    routeSrc,
    /await sharedCacheDel\(SWING_ACTIVE_REFRESH_CLAIM_KEY\)\.catch\(\(\) => undefined\);\s*await slot\.release\(\);\s*\}\s*\}/,
    "the main finally block must release the slot alongside the Q37 claim on both success and error paths"
  );
});

// Ask Largo standing mandate — PR #4076 comment 6303734681's "alerting only bookends the trade"
// gap: a THESIS_BREAK_RUNGS gate firing is only member-visible once the position actually closes
// (notifySwingTerminalFromOutcome above). This adds a one-shot, deduped, non-trade alert the first
// tick the thesis gate is DETECTED, independent of whether the roll executor closed it that same
// tick. Regex-asserted against raw source (not behaviorally mocked) to match this file's own
// convention above for route.ts's DB/provider-heavy side-effect wiring.
test("swing-active-refresh fires a one-shot, deduped thesis-break alert for positions a THESIS_BREAK_RUNGS gate detected but did NOT close this tick", () => {
  assert.match(
    routeSrc,
    /import \{ THESIS_BREAK_RUNGS, type SwingManageRung \} from "@\/lib\/swing\/manage"/,
    "must import the thesis-break rung subset from manage.ts rather than re-deriving rung literals"
  );
  assert.match(
    routeSrc,
    /THESIS_BREAK_RUNGS\.has\(o\.verdict\.rung\)\s*&&\s*!o\.roll\?\.parentGraded/,
    "must only alert when a thesis gate fired AND the roll/close did not execute this tick — a position that DID close already gets the stronger STC alert above"
  );
  assert.match(
    routeSrc,
    /sharedCacheSetNx\(\s*dedupeKey/,
    "must dedupe via the shared cross-replica NX claim so the alert fires at most once per position"
  );
  assert.match(
    routeSrc,
    /notifySwingThesisBreak/,
    "must call the dedicated non-trade thesis-break notifier, not the BTO\\/STC chief-trade path"
  );
});

test("swing-active-refresh gates on isEtCashRth before dispatching Polygon/UW refresh", () => {
  assert.match(
    routeSrc,
    /import \{ isEtCashRth \} from "@\/lib\/et-market-hours"/,
    "must import the holiday-aware RTH gate"
  );
  const authAt = routeSrc.indexOf("isCronAuthorized(req)");
  const gateAt = routeSrc.indexOf("isEtCashRth()");
  const dispatchAt = routeSrc.indexOf("const dispatchRefresh");
  assert.ok(authAt >= 0 && gateAt >= 0 && dispatchAt >= 0);
  assert.ok(gateAt > authAt, "RTH gate must run after auth");
  assert.ok(gateAt < dispatchAt, "RTH gate must run before after() dispatch");
});

// BUG FIX (2026-10-24, Ask Largo x Night Hawk Swings standing mandate — live CAG repro,
// positionId 2082): `loadOptionQuote` already guards `mark` against a dead-bid backstop-ask
// artifact via `reliableMarkFromSnapshot`, but used to carry `snap.ask` straight through
// unguarded onto the SwingLiveQuote it returns — so a guarded (tiny) mid ended up sitting next
// to an unguarded (backstop) ask on the same contract, and adapters.ts's `liquidityFromContract`
// computed a nonsensical spread from the mismatched pair (e.g. "Spread: 13000.0%"). Regex-
// asserted against raw source (not behaviorally mocked), matching this file's own convention
// above for route.ts's DB/provider-heavy wiring — the real fetch/guard logic itself is unit-
// tested directly in options-snapshot.test.ts.
test("swing-active-refresh's loadOptionQuote guards ask through reliableAskFromSnapshot, not the raw snapshot ask", () => {
  assert.match(
    routeSrc,
    /import \{\s*fetchOptionsUnifiedSnapshot,\s*reliableAskFromSnapshot,\s*reliableMarkFromSnapshot,\s*\} from "@\/lib\/providers\/options-snapshot"/,
    "must import the ask-side guard alongside the existing mark-side guard"
  );
  assert.match(
    routeSrc,
    /ask:\s*reliableAskFromSnapshot\(snap\)/,
    "the quote's ask must be resolved through the same divergence guard as the mark, not read raw off snap.ask"
  );
  assert.doesNotMatch(
    routeSrc,
    /ask:\s*snap\.ask,/,
    "the raw, unguarded snap.ask must never be assigned directly onto the returned quote again"
  );
});
