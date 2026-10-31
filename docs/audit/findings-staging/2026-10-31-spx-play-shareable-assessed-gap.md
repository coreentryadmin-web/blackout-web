> **kind:** FINDING

## SPX Slayer `isSpxPlaySnapshotShareable()` trusts a degenerate closed-market snapshot forever — FIXED

**Status:** Fixed, regression tests added (`src/features/spx/lib/spx-play-freshness.test.ts`).

### Root cause

`isSpxPlaySnapshotShareable()` (`src/features/spx/lib/spx-play-freshness.ts`) decided whether a
cached SPX play snapshot could be shared cross-replica purely off `session_phase === "closed"`:

```ts
export function isSpxPlaySnapshotShareable(
  value: { as_of?: string | null; session_phase?: string | null } | null | undefined,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!value) return false;
  if (value.session_phase === "closed") return true;
  return isSpxPlaySnapshotFreshEnough(value.as_of, nowMs, maxAgeMs);
}
```

`session_phase === "closed"` is NOT the same claim as "this is a genuine, fully-assessed
closed-market read." `evaluateSpxPlayCore`'s closed-market branch
(`src/features/spx/lib/spx-play-engine.ts:~1727-1821`) stamps `assessed: closedConfluence != null`,
and `closedConfluence` is `null` (hence `assessed:false`) whenever `desk.source === "none"` (a
cold-cache bootstrap shell) or `desk.price <= 0` — producing a placeholder payload with
`score:0`, `factors:[]`, `direction:null`, `grade:"D"`, `gates.play_idea:null` while
`session_phase` is still `"closed"`. `scanningPayload` (`spx-play-payload.ts`) has the identical
shape: `assessed: confluence != null` with `session_phase: currentSessionPhase(desk)`, which can
also report `"closed"`. `SpxPlayPayload.assessed`'s own doc comment is explicit about what
`false` means: "`grade`/`score`/`rawScore` are placeholder literals… NOT a measurement."

`isSpxPlaySnapshotShareable()` had no check on `assessed` at all, so a degenerate placeholder was
treated as equally trustworthy-forever as a genuine closed-market read — and because the
lock-winner write path (`evaluateSpxPlayStateCrossReplica`, `spx-service.ts:332-339`) publishes
every eval result to the shared `spx-play-read:<date>` Redis key unconditionally (no
`shouldCache`-style guard, unlike the sibling `getSpxPlayState()`'s own
`shouldCache: (value) => value.assessed !== false` at line ~469), a degenerate snapshot could be
written once and then served to every replica/member/BIE/Largo reader indefinitely — well past
this route's own freshness budgets (5s member read cache, 20s cross-replica peek bound).

### Evidence

Live, 2026-10-31 (Saturday, market genuinely closed), authenticated via `mintClerkPremiumSession`
against `blackouttrades.com`, polling `GET /api/market/spx/play` every ~20s:

- `15:04:55Z` — genuine read: `assessed:true`, `score:40`, `direction:"long"`, `grade:"C"`, 12 real
  factors summing exactly to 40 (GEX support +18, 0DTE flow +14, Market tide -10, TRIN +6, Session
  window +6, ADD +5, EMA 20 -5, TICK +4, VIX curve +4, News risk -2, Mega-caps 0, Live tape 0).
- `15:05:15Z` (+20s) — `assessed:false`, `score:0`, `direction:null`, `grade:"D"`, `factors:[]`,
  `gates.play_idea:null`, `as_of` **regressed** to `2026-10-31T14:56:30.479Z` — ~9 minutes OLDER
  than the good read just served.
- `15:05:38Z` (+23s) — byte-identical degenerate snapshot, same `as_of` `14:56:30.479Z` unchanged
  across two separate requests 23s apart — proving it was served from a stable cache entry, not
  independently recomputed.

Mechanically reproduced by calling the real, unmodified `isSpxPlaySnapshotShareable(...)` directly
against `{as_of: <9-min-old timestamp>, session_phase: "closed", assessed: false}`: it returned
`true` pre-fix (should be `false`).

**RED→GREEN proof** (`src/features/spx/lib/spx-play-freshness.ts`/`.test.ts`): with the `assessed`
check temporarily removed (restoring the pre-fix body, source file edited directly — the file is
new enough in this run that a `git stash` round-trip wasn't needed, and a direct edit/restore is
simpler to verify byte-for-byte), the new regression test
`"BUG: a degenerate closed-market snapshot (assessed:false) is NOT shareable past the freshness
bound"` failed (`true !== false`) while the other 14 tests in the file stayed green. Restoring the
fix made all 15 pass.

- `npx tsc --noEmit` — clean.
- `npx tsx --experimental-test-module-mocks --test src/features/spx/lib/spx-play-freshness.test.ts`
  — 15/15 pass.
- Sibling suites that exercise this function live, re-run clean (no regression):
  `spx-service-play-cache-staleness.test.ts` (3/3 — including its own closed-market case, which
  passes `assessed: true` and is therefore unaffected by the new `assessed !== false` check),
  `spx-service-cross-replica-lock.test.ts` (1/1), `spx-service-merged-desk-bg-refresh.test.ts`
  (2/2), `spx-service.play.test.ts` (15/15), `spx-play-payload.test.ts` (9/9),
  `spx-play-engine.test.ts` (15/15).

### Blast radius

`isSpxPlaySnapshotShareable()` is consulted at all three cross-replica Redis-read sites in
`spx-service.ts`: `waitForPeerSpxPlaySnapshot`, `evaluateSpxPlayStateCrossReplica`'s
lock-not-won branch, and `spxPlayReadFallback`. All three gate on the same function, so the fix
closes the gap everywhere it was open rather than at one call site only. The degenerate-snapshot
source itself (the lock-winner write having no `shouldCache` guard) is left unchanged — see
"Deliberately left unchanged" below.

### Fix rationale

Added `assessed?: boolean | null` to the function's input type and required
`value.assessed !== false` alongside `session_phase === "closed"` before granting the
indefinite-age exemption — matching the sibling `shouldCache` guard on the primary
`spx-play-read:<date>` cache key (`getSpxPlayState()`, same file area) so both "cross-replica
sharing" and "primary caching" now agree on what counts as a genuine closed-market read.
`assessed` left `undefined` (a snapshot that predates the flag, or any live-market snapshot, which
never sets it to `false`) still passes `!== false`, so the 2026-10-25 live-market/closed-market
fix this file already carries is unchanged — verified by the pre-existing test
`"a closed-market snapshot (session_phase: closed) is shareable regardless of its as_of age"`
(no `assessed` field) still passing after the fix.

A degenerate snapshot does NOT become universally unshareable — it still falls through to the
plain `isSpxPlaySnapshotFreshEnough` bound, so a request made moments after a real lock-loss can
still briefly share it (the single-flight purpose this gate exists for) without caching it
indefinitely. This is the smaller, more surgical fix: it closes the "regardless of age" exemption
specifically for the placeholder case, rather than removing the `session_phase === "closed"`
exemption altogether (which would reopen the exact 2026-10-25 regression this function was built
to fix for genuine closed-market reads).

### Deliberately left unchanged

- The lock-winner write path (`evaluateSpxPlayStateCrossReplica`, `spx-service.ts:332-339`)
  still publishes every eval result unconditionally, with no `shouldCache`-style guard — so a
  degenerate snapshot can still be written to the shared Redis key in the first place. This read
  fix stops it from being trusted past its real freshness bound once written, which addresses the
  live symptom (served stale for many minutes); adding a write-side guard there too would be a
  reasonable follow-up but is a separate, additive change to a different function, out of scope
  for this single-issue fix.
- `evaluateSpxPlayCore`'s closed-market branch and `scanningPayload`'s `assessed` derivation —
  both are already correct (per `SpxPlayPayload.assessed`'s own doc comment) and are the source of
  truth this fix now actually respects, not a bug to change.
