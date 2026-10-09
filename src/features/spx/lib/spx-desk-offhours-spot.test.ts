import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: off-hours pulse must not clobber lastPulseForSignals with price:0 or serve
 * empty shells when the matrix already has a grounded spot (platform-integrity spx-desk-spot).
 */
test("buildSpxDeskPulse: closed market reuses lastPulseForSignals instead of price:0", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*lastPulseForSignals\?\.price[\s\S]*market_label: label/,
    "closed-market branch must return last good pulse when available"
  );
  assert.doesNotMatch(
    src,
    /lastPulseForSignals = closedPulse/,
    "must not overwrite lastPulseForSignals with a zero-price closed shell"
  );
});

test("buildSpxDesk: falls back to lastPulseForSignals when index snap is empty", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /const price =[\s\S]*spxSnap\?\.price \?\? lastPulseForSignals\?\.price \?\? priorFromBars\.pdc \?\? 0;/,
    "full desk build must reuse last RTH print or prior session close off-hours"
  );
});

test("buildSpxDeskPulse: cold replica off-hours falls back to priorDayForPulseLane pdc", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*priorDayForPulseLane\(\)[\s\S]*prior\.pdc/,
    "closed-market branch must anchor to prior session close when lastPulse is empty"
  );
});

test("buildSpxDeskPulse: cold replica awaits the real prior-day fetch when priorDayForPulseLane is still empty", () => {
  // priorDayForPulseLane() is "never block cold" — on a true cold cache it fires
  // fetchPriorDayCached() in the background and returns pdc:null immediately, so the FIRST
  // off-hours request after a rollout must not stop at that null; it needs to await the real
  // fetch (fetchPriorDayCached is idempotent — returns the fresh cache if another caller already
  // populated it) before falling through to the empty/closedPulse shell.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*let prior = await priorDayForPulseLane\(\);\s*\n\s*if \(!\(prior\.pdc != null && prior\.pdc > 0\)\) \{\s*\n\s*prior = await fetchPriorDayCached\(\)\.catch\(\(\) => prior\);/,
    "closed-market branch must await fetchPriorDayCached() when the fire-and-forget priorDayForPulseLane() is still empty"
  );
});

test("buildSpxDeskPulse: cold replica prefers TODAY's own close once the regular session has closed (2026-09-12 fix)", () => {
  // Root-cause fix for the live 2026-09-12 bug: `prior` above (priorDayForPulseLane /
  // fetchPriorDayCached) is EXCLUSIVE of today by design (correct for RTH/pivot callers), so
  // once today's own session has genuinely closed (label === "EXTENDED", still the same ET
  // calendar day) it must be overridden with today's own settled bar rather than served as-is
  // — otherwise a cold replica serves a stale prior-day close as "today's" off-hours price.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /if \(!rthOpen && !premarketPlan\) \{[\s\S]*let prior = await priorDayForPulseLane\(\);[\s\S]*if \(label === "EXTENDED"\) \{\s*\n\s*const todaysOwnClose = await fetchTodaysOwnCloseIfSessionComplete\(\)\.catch\(\(\) => null\);\s*\n\s*if \(todaysOwnClose\?\.pdc != null && todaysOwnClose\.pdc > 0\) \{\s*\n\s*prior = \{ \.\.\.todaysOwnClose, pdh: priorDayLevels\.pdh, pdl: priorDayLevels\.pdl \};/,
    "closed-market branch must override the exclusive-of-today prior's price/close with today's own close once the session is EXTENDED"
  );
});

test("buildSpxDeskPulse: EXTENDED-hours override must NOT roll pdh/pdl forward onto today's own range (2026-10-07 fix)", () => {
  // Regression for the bug the test above's comment now also documents: the 2026-09-12 fix
  // correctly rolled TODAY's own close forward for the quoted price/prior_close once the
  // regular session ends (EXTENDED), but it replaced `prior` wholesale, which also clobbered
  // pdh/pdl with today's own just-closed high/low. SpxSniperHeader renders those fields under
  // an explicit "Prior-day high"/"Prior-day low" label (tone "resistance"), and
  // mergePulseIntoDesk's stickyStructureLevel always prefers a non-null pulse.pdh/pdl over the
  // base desk's own (correct) value — so this propagated into /api/market/spx/merged and the
  // live member dashboard every evening, disagreeing with the sibling /api/market/spx/desk
  // route (which never applies this override) on the same field name. Confirmed live
  // 2026-10-07: /merged and /pulse both served 2026-10-07's own intraday pdh/pdl
  // (7807.02/7763.34) while /desk and raw Polygon daily bars agreed on 2026-10-06's real
  // prior-day range (7844.52/7805.96).
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /const priorDayLevels = \{ pdh: prior\.pdh, pdl: prior\.pdl, pdc: prior\.pdc \};/,
    "must snapshot the true exclusive-of-today pdh/pdl (and pdc, added 2026-10-09 for the sibling prior_close bug) before the EXTENDED override can replace `prior`"
  );
  assert.doesNotMatch(
    src,
    /prior = todaysOwnClose;/,
    "must never replace `prior` wholesale with today's own bar — that clobbers pdh/pdl too"
  );
});

test("buildSpxDeskPulse: EXTENDED-hours override must NOT roll prior_close forward onto today's own close (2026-10-09 fix)", () => {
  // Regression, same shape as the pdh/pdl fix above but for `prior_close` itself. The
  // 2026-09-12 fix let `prior.pdc` roll forward to TODAY's own close so the EXTENDED-window
  // `price` field shows a live-looking close instead of a stale prior-day one — but the final
  // return statement then read `prior_close: prior.pdc`, reusing that SAME overridden value, so
  // `price` and `prior_close` were IDENTICAL all evening (both today's own close). A field
  // literally named "prior close" must mean the session strictly BEFORE today, never today's
  // own close — confirmed live 2026-10-09: /pulse served price=prior_close=7765.36 (today's
  // close) while the sibling /desk route correctly reported prior_close=7801.77 (yesterday's).
  // `pulseChangePctFromPriorClose` derives change% as (price - priorClose) / priorClose, which
  // silently reads exactly 0.00% whenever the two inputs are equal — hiding a real, nonzero day
  // change behind a false "flat" read, the 2026-08-07 P0 shape.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /const priorDayLevels = \{ pdh: prior\.pdh, pdl: prior\.pdl, pdc: prior\.pdc \};/,
    "priorDayLevels must also snapshot the true exclusive-of-today pdc before the EXTENDED override can replace `prior`"
  );
  assert.match(
    src,
    /prior_close: priorDayLevels\.pdc,/,
    "the EXTENDED-window return must serve prior_close from the snapshotted true prior-day pdc, not the (possibly overridden) `prior.pdc`"
  );
  assert.doesNotMatch(
    src,
    /if \(label === "EXTENDED"\)[\s\S]{0,400}prior_close: prior\.pdc,/,
    "the EXTENDED-window return block must not serve prior_close straight off `prior.pdc` — scoped to this block only, since other builders (buildSpxDesk/buildSpxDeskPulseMinimal) legitimately use an unrelated `prior.pdc` that never passes through the EXTENDED override"
  );
});

test("fetchTodaysOwnCloseIfSessionComplete: delegates to latestSessionAndItsOwnPrior, not a bare priorDayFromDailyBars(bars, today, true) (2026-10-09 midnight-rollover fix)", () => {
  // Pre-fix this called `priorDayFromDailyBars(bars, today, true)` directly and discarded the
  // bars — which worked fine for "today's own close" in isolation but left the CALLER's
  // separate `priorDayLevels` snapshot (from `priorDayForPulseLane()`) anchored to the same raw
  // `today`, which can have already rolled to the next calendar date for hours before this
  // EXTENDED label itself rolls (see `latestSessionAndItsOwnPrior`'s own header, spx-session.ts,
  // for the live repro and the anchorSessionComplete=true invariant's own test coverage, now
  // exercised one layer down in spx-session.test.ts).
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /async function fetchTodaysOwnCloseIfSessionComplete\(\)[\s\S]*?const \{ latest, prior \} = latestSessionAndItsOwnPrior\(bars, today\);\s*\n\s*return \{ \.\.\.latest, prior \};/,
    "must derive both the latest session AND its own true prior from the SAME bars fetch, anchored to the matched bar's own date"
  );
});

test("buildSpxDeskPulse: EXTENDED override re-snapshots priorDayLevels from todaysOwnClose.prior, not the (possibly already-rolled-over) priorDayForPulseLane anchor (2026-10-09 midnight-rollover fix)", () => {
  // Live repro 2026-10-09 ~04:29 UTC (00:29 ET): the EARLIER 2026-10-09 fix (the test above this
  // one in file history) correctly stopped the override from reading `prior.pdc` AFTER it had
  // been overwritten — but `priorDayLevels` itself was snapshotted from `priorDayForPulseLane()`,
  // which separately anchors to raw `todayEtYmd()`. Once ET crosses midnight, that anchor rolls
  // to the NEXT calendar date hours before the EXTENDED label itself rolls (PT-clock-driven), so
  // `priorDayLevels` was ALSO already one session too recent by the time the override fired —
  // `price` and `prior_close` collapsed onto the same bar again, just via a different omission.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  const block = src.match(
    /if \(label === "EXTENDED"\) \{\s*\n\s*const todaysOwnClose = await fetchTodaysOwnCloseIfSessionComplete\(\)\.catch\(\(\) => null\);[\s\S]{0,2000}?\n\s*\}\s*\n\s*\}\s*\n\s*if \(prior\.pdc/
  );
  assert.ok(block, `expected to find the EXTENDED override block, got no match in:\n${src.slice(src.indexOf('if (label === "EXTENDED")'), src.indexOf('if (label === "EXTENDED")') + 1800)}`);
  assert.match(
    block![0],
    /if \(todaysOwnClose\.prior\.pdc != null\) \{\s*\n\s*priorDayLevels\.pdh = todaysOwnClose\.prior\.pdh;\s*\n\s*priorDayLevels\.pdl = todaysOwnClose\.prior\.pdl;\s*\n\s*priorDayLevels\.pdc = todaysOwnClose\.prior\.pdc;/,
    "once the EXTENDED override fires, priorDayLevels must be re-snapshotted from todaysOwnClose's own (bars-anchored) prior, not left at its raw-today-anchored value"
  );
});

test("buildSpxDeskPulseMinimal: price chain includes prior.pdc", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  const minimalIdx = src.indexOf("export async function buildSpxDeskPulseMinimal");
  const priceLine = src.slice(minimalIdx).match(
    /const price = spxSnap\?\.price \?\? lastPulseForSignals\?\.price \?\? prior\.pdc \?\? 0;/
  );
  assert.ok(priceLine, "minimal pulse must fall back to prior.pdc on cold cache");
});

test("stickyDeskGexFallback: preserves gex_net, gex_king, max_pain from last good state", () => {
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /lastGoodGexNet: number \| null = null;/,
    "must declare sticky variable for gex_net"
  );
  assert.match(
    src,
    /lastGoodGexKing: number \| null = null;/,
    "must declare sticky variable for gex_king"
  );
  assert.match(
    src,
    /lastGoodMaxPain: number \| null = null;/,
    "must declare sticky variable for max_pain"
  );
  assert.match(
    src,
    /function stickyDeskGexFallback[\s\S]*gex_net: lastGoodGexNet,/,
    "stickyDeskGexFallback must return lastGoodGexNet instead of null"
  );
  assert.match(
    src,
    /function stickyDeskGexFallback[\s\S]*gex_king: lastGoodGexKing,/,
    "stickyDeskGexFallback must return lastGoodGexKing instead of null"
  );
  assert.match(
    src,
    /function stickyDeskGexFallback[\s\S]*max_pain: lastGoodMaxPain,/,
    "stickyDeskGexFallback must return lastGoodMaxPain instead of null"
  );
  assert.match(
    src,
    /lastGoodGexNet = pos\.net_gex;/,
    "resolveCanonicalDeskGex must capture net_gex from fresh fetch"
  );
  assert.match(
    src,
    /lastGoodGexKing = king;/,
    "resolveCanonicalDeskGex must capture king from fresh fetch"
  );
  assert.match(
    src,
    /lastGoodMaxPain = pos\.max_pain;/,
    "resolveCanonicalDeskGex must capture max_pain from fresh fetch"
  );
});

test("buildSpxDesk: EXTENDED-hours prior_close must not collapse onto today's own close after ET midnight (2026-10-09 fix)", () => {
  // Root cause: `priorDayFromDailyBars(dailyBars)` here used bare default args (today,
  // anchorSessionComplete=false) unconditionally. That's correct BEFORE ET midnight — today's
  // own just-settled bar (barYmd === today) is excluded, correctly landing on the true prior
  // day — but WRONG from ET midnight through the next session's open: todayEtYmd() has already
  // rolled to the NEXT calendar date, so YESTERDAY's close bar (the one `price` is frozen on,
  // via the live WS snapshot with no fresher tick to offer) now satisfies `barYmd < today`
  // unconditionally and gets returned as "prior" too — collapsing price === prior_close for the
  // whole post-midnight stretch of every EXTENDED evening. Confirmed live 2026-10-09 ~06:43 UTC
  // (02:43 ET): GET /api/market/spx/desk served price=prior_close=7765.36 (2026-10-08's close)
  // while the sibling, already-fixed /api/market/spx/pulse route (buildSpxDeskPulse, #5729/
  // #5735) correctly reported prior_close=7801.77 (2026-10-07's real prior close) for the exact
  // same instant — the identical root cause reincarnated in this sibling function, which was
  // never given pulse's EXTENDED-hours override (those PRs only touched buildSpxDeskPulse).
  // Fix: reuse latestSessionAndItsOwnPrior (spx-session.ts, already used/tested by the pulse
  // fix) to derive the true prior whenever the EXTENDED label says today's own session has
  // already closed, instead of a bare priorDayFromDailyBars call that can't tell "today just
  // closed" apart from "today hasn't started yet" once todayEtYmd() has rolled over.
  const src = readFileSync(join(process.cwd(), "src/features/spx/lib/spx-desk.ts"), "utf8");
  assert.match(
    src,
    /const label = marketStatusLabel\(new Date\(\), marketNow\);[\s\S]{0,2000}?const priorFromBars =\s*\n\s*label === "EXTENDED"\s*\n\s*\? latestSessionAndItsOwnPrior\(dailyBars, today\)\.prior\s*\n\s*: priorDayFromDailyBars\(dailyBars, today\);/,
    "buildSpxDesk must derive priorFromBars from latestSessionAndItsOwnPrior's true prior during the EXTENDED window, not a bare priorDayFromDailyBars(dailyBars) that collapses onto today's own close after ET midnight"
  );
  assert.doesNotMatch(
    src,
    /const priorFromBars = priorDayFromDailyBars\(dailyBars\);/,
    "the old unconditional call must be gone, not left alongside the new EXTENDED-aware branch"
  );
});
