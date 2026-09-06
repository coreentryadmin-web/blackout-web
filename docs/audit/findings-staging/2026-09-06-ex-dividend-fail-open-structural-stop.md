# 2026-09-06 — Ex-dividend read failure silently re-enabled the Q39 fail-open structural-stop bug

> **kind:** FINDING

| Field | Value |
|-------|-------|
| **Severity** | P1 |
| **Area** | Swing management — `resolveSwingExDividendContext` (`ex-dividend-reads.ts`), `structuralStopBroken` (`manage.ts`), Q39 |
| **Status** | FIXED |

## Symptom

`SWING-SYSTEM-CTO-AUDIT-2026-09-06.md` finding #24: `resolveSwingExDividendContext`'s catch-all
returned `{ exDividendSession: false, exDividendCash: null }` on ANY `fetchPolygonDividends`
failure (rate limit, timeout, network blip) — a return value byte-identical to "confirmed: today
is not an ex-dividend day for this ticker."

## Root cause

Q39 (`ex-dividend-adjustment.ts`, shipped in #3909/#3929) exists specifically so a legitimate
ex-dividend mechanical price drop on a LONG position is not misread as a structural-stop breach —
`underlyingPriceForStructuralStop` adds the cash dividend back onto the underlying spot before the
LONG compare, but ONLY when `exDividendSession === true`. Before this fix, a Polygon error on the
dividends fetch collapsed straight to `exDividendSession: false`, which is indistinguishable from
"no ex-div happened" to every downstream consumer. `manage.ts`'s `structuralStopBroken()` then ran
its normal, un-adjusted LONG compare (`underlying ≤ stop`), so a genuine ex-div gap arriving on a
day the dividends feed happened to be unreachable would fire `EXIT`/`structural_stop` — the exact
false-breach Q39 was built to prevent, reintroduced by a transient provider error instead of by
missing Q39 logic. A container/network-level blip (not a data problem with the ticker at all) could
therefore trigger a real capital-preservation EXIT on a still-valid LONG thesis.

The separate concern raised in the audit (a poisoned 6h cache remembering the failure) does **not**
hold in the current code: the `catch` branch returns without ever calling `CACHE.set(...)` — only
the success path caches. So the live risk is per-call fail-open, not cache-poisoning; the fix
targets the real mechanism.

## Blast radius

Two call sites carried the identical fail-open shape and both needed the fix:
1. `resolveSwingExDividendContext`'s own `catch` (`ex-dividend-reads.ts`).
2. `swing-active-refresh/route.ts`'s outer `.catch(() => ({ exDividendSession: false, exDividendCash: null }))`
   wrapping the call in the per-position `Promise.all` — a defense-in-depth duplicate of the same
   shape (the inner function never actually rejects, but this outer catch had to match the new
   contract or it would silently discard the `dataUnavailable` signal on the one path that could
   still reach it).

Also missing: a real behavior test. `ex-dividend-reads-freshness.test.ts` only `readFileSync`s the
source and regex-asserts substrings (e.g. that `isWsUpdatedAtFresh` is imported) — it never imports
or calls `resolveSwingExDividendContext`, so it would pass unchanged even with this bug present.
`grep -rln resolveSwingExDividendContext src --include=*.test.ts` returned nothing before this fix.

## Fix

Distinguish "unknown" from "confirmed no ex-div" instead of collapsing both into `false`:
- `ex-dividend-reads.ts`: `resolveSwingExDividendContext` now returns a third field,
  `dataUnavailable: boolean` — `true` only on the catch path (the Polygon read itself failed),
  `false` on every real resolution (including a genuine non-ex-div day).
- `swing-active-refresh/route.ts`: the outer `.catch` fallback now also sets `dataUnavailable: true`,
  and the assembled `ManageSyncReads` forwards it as `exDividendDataUnavailable`.
- `manage-sync.ts`: `ManageSyncReads` gains `exDividendDataUnavailable?: boolean`, forwarded into
  `SwingManageInput.exDividendDataUnavailable` in `planManageSync`.
- `manage.ts`: `SwingManageInput` gains `exDividendDataUnavailable?: boolean`. In
  `structuralStopBroken()`, when the LONG un-adjusted-or-adjusted compare would declare a breach
  AND `exDividendDataUnavailable === true`, the function now returns `broken: false` with an
  explanatory reason instead of `broken: true` — fail SAFE (skip enforcing this cycle; the next
  refresh, ~15 min later per the cron's own cadence, retries with fresh ex-div data) rather than
  fail-open (silently trust the unverifiable `false`).

Scoped deliberately narrow: the skip applies ONLY to the LONG branch (the only branch the ex-div
adjustment ever touches — `underlyingPriceForStructuralStop` is a no-op for SHORT), and ONLY when
the compare is ABOUT to declare a breach. A SHORT structural-stop breach with
`exDividendDataUnavailable: true` still enforces normally (no ex-div gap risk to guard against on
that side) — verified by a dedicated test. When the ex-div read succeeds (the common case),
behavior is byte-identical to before this fix.

## Fix rationale

Considered shortening/removing the failure-path cache TTL instead, per the audit's alternative —
rejected because the current code never caches a failure at all (verified by reading the `catch`
branch), so that fix would have addressed a mechanism that isn't actually present and left the real
per-call fail-open bug live. Considered making `exDividendSession` itself nullable (tri-state)
instead of adding a separate `dataUnavailable` flag — rejected as a larger blast radius for a
single-issue PR: `exDividendSession` is read in `ex-dividend-adjustment.ts`'s
`underlyingPriceForStructuralStop` as a plain boolean gate (`!opts.exDividendSession`), and widening
its type to `boolean | null` would require touching that function's guard and its own tests too,
for no behavioral gain over an additive sibling flag. The additive flag keeps every existing
`exDividendSession`/`exDividendCash` consumer and test unchanged while giving `manage.ts` exactly
the one bit of information it actually needs (was this cycle's read trustworthy?).

## Evidence

RED→GREEN (git-stash proof, Node 20):
- Pre-fix (`ex-dividend-reads.ts`/`manage.ts`/`manage-sync.ts`/`route.ts` stashed back to `main`,
  new tests kept): `manage.test.ts` — 2 new tests fail: `structural_stop: ex-div data-unavailable
  fails SAFE …` fails with `expected 'structural_stop' to not equal 'structural_stop'` (i.e. it DID
  enforce); `ex-dividend-reads.test.ts` — all 4 new tests fail with `dataUnavailable` reading
  `undefined` where `true`/`false` was expected.
- Post-fix (fix restored): both files pass in full — `ex-dividend-reads.test.ts` 4/4,
  `manage.test.ts` 22/22 (including the two new tests and every pre-existing structural-stop case,
  e.g. the Q39 adjustment test and the SHORT-direction test, unchanged).
- Full swing suite: `node --experimental-test-module-mocks --import tsx --test src/lib/swing/*.test.ts`
  → 644 pass / 0 fail.
- `src/app/api/cron/swing-active-refresh/route.test.ts` → 3/3 pass (the ManageSyncReads consumer
  site).
- `npx tsc --noEmit` → clean.

## New tests

- `src/lib/swing/ex-dividend-reads.test.ts` (new file) — real behavior tests that actually import
  and call `resolveSwingExDividendContext`, mocking `fetchPolygonDividends` (via
  `node:test`'s `mock.module`, `--experimental-test-module-mocks`) to succeed on an ex-div day,
  succeed on a non-ex-div day (a confirmed `false`, not unknown), and throw (asserts
  `dataUnavailable: true`). Also confirms a failed read is not cached (immediately followed by a
  fresh successful call for a different ticker/session-day key). Does not touch or duplicate the
  existing `ex-dividend-reads-freshness.test.ts`'s source-scan freshness assertions.
- `src/lib/swing/manage.test.ts` — two new tests: the fail-safe skip on LONG when
  `exDividendDataUnavailable: true` (proving the SAME inputs breach without the flag, so the test
  actually exercises the guard rather than an input that never would have fired), and a companion
  proving a genuine SHORT breach still enforces even with the flag set (the adjustment — and
  therefore this guard — is LONG-only).
