## 2026-10-19 — [FINDING, P3 Largo/Swing] Swing play-brief top-level failure paths returned bare `{available:false}` with no reason — Largo C3 gap — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Severity:** P3 — never corrupts data, but confirmed live on real traffic: a caller (or Largo
itself) reading one of these failure paths cannot tell a transient provider hiccup (retry) from a
ticker that genuinely has no brief (don't retry) from an actual bug — the exact ambiguity
`docs/audit/LARGO-PRODUCT-CONTRACT.md`'s C3 section calls a defect "even when every test passes."

**What's wrong.** `src/lib/largo/contract/product-read.ts` already defines `Unavailable =
{reason, what_is_missing, retryable}` for exactly this purpose, and the per-section
`unavailableSources` mechanism inside `composeSwingPlayBrief` already uses it correctly throughout
the brief. But every TOP-LEVEL "the whole brief is unavailable" path — in both files that can
return one — skipped it and returned a bare shape instead:

- `src/app/api/market/swing/play-brief/route.ts` (the Command Deck UI route): the 404 "play not
  found" (line 55), the 503 when `adaptSwingBriefToLargo`'s `largoRead.ok` is false (line 72), and
  the catch-all 503 on any uncaught exception (line 101).
- `src/lib/largo/swing-play-brief-read.ts` (the actual Largo-chat-facing tool wrapper,
  `swingPlayBriefForLargo`): `ticker_required`, `play_not_found`, and the thrown-error catch.

**Live confirmation:** 2 of 6 sampled production fetches (`GET
/api/market/swing/play-brief?...`, NVDA and SLV, 2026-10-19) returned HTTP 503 with body exactly
`{"available": false, "degraded": true}` — no `reason`, no `what_is_missing`, no `retryable`.

**Fix.** Each failure path now carries an additive `unavailable: {reason, what_is_missing,
retryable}` field alongside its existing `available`/`error` fields (never replacing them, per the
contract's own ADDITIVE principle):
- `ticker_required` / "play not found" — `retryable: false` (an empty ticker or a genuinely
  nonexistent position isn't fixed by asking again).
- `play_not_found` in the Largo tool wrapper — same, `retryable: false`, reason includes the
  ticker.
- The route's `largoRead.ok === false` branch forwards `largoRead.unavailable` verbatim — it's
  already a `ProductRead<T>` with the full `Unavailable` shape attached, previously discarded.
- Every catch-all (uncaught exception in either file) — `retryable: true`, since an unhandled
  error is exactly the ambiguous "transient or a real bug" case the type exists to flag, and
  neither layer can distinguish the two any better than the caller.

**Evidence.** `src/lib/largo/swing-play-brief-read.test.ts`'s three existing failure-path tests
extended with `unavailable` assertions; RED proof via `git stash` on both source files (3/4 fail —
exactly the three new assertions, the pre-existing `available:false`/`error` checks still pass
since those fields are untouched) → GREEN (4/4) post-fix. `npx tsc --noEmit -p .` clean.
`play-brief-adapter.test.ts` + `contract/product-read.test.ts` (15 tests total across the touched
files' direct dependents) pass unchanged.

Found via this session's standing Ask Largo deep-dive mandate, independently adversarially
verified (3/3 verification votes confirmed) before fixing.
