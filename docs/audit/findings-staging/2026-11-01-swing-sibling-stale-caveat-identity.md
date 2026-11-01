> **kind:** FINDING

## Swing `siblingPositionsNote` reused `optionMarkStaleCaveat`'s "same quote Mark flagged above" text for a genuinely different sibling contract — false provenance claim — FIXED

**Status:** Fixed, regression tests added (`src/lib/swing/play-brief-absence.test.ts`,
`src/lib/swing/play-brief.test.ts`).

### Root cause

`optionMarkStaleCaveat` (`src/lib/swing/play-brief-absence.ts`) renders one of three mutually
exclusive caveats for an aged/unsynced option quote. Its stale branch:

```ts
if (optionMarkIsStale(play, readMs)) {
  return " _(stale — same quote Mark flagged above)_";
}
```

was written for — and is true by construction at — every call site that passes the brief's own
subject `play`: `pnlSection`'s Peak/Trough/Greeks/Spread/Exec-P&L lines, and the narrative/
coaching bullets in `play-brief-narrative.ts`/`play-brief-narrative-coaching.ts`. All of these
read `play.contract`, the exact snapshot the Position section's own "Mark:" line already
rendered a few lines above in the SAME document — "same quote Mark flagged above" is a true
statement there.

`siblingPositionsNote` (`src/lib/swing/play-brief.ts`) reuses this exact function for an OTHER
(sibling) committed position on a DIFFERENT strike/expiry — it adapts a `HorizonPlay` row that
is explicitly **not** `ctx.play` into the same `OptionMarkFreshnessSource` shape and calls
`optionMarkStaleCaveat` on it. There, "Mark flagged above" refers to the brief's SUBJECT
contract, not the sibling's own — the literal "same quote" claim is false: the sibling's quote
was never "flagged above" anywhere in the document, because the Mark line above is about a
different option contract entirely.

This was introduced on 2026-10-26 (live repro SWING:MRNA:68) when `optionMarkStaleCaveat` was
wired into `siblingPositionsNote` to fix a real *absence*-of-disclosure problem (a stale sibling
P&L rendering with zero caveat, Largo C3) — the fix correctly added a caveat, but reused the
verbatim string without noticing it also asserts an *identity* claim that does not hold for this
call site.

### Evidence

- **Live repro:** `GET /api/market/swing/play-brief?playId=SWING:MRNA:68` — a real, live
  committed position with 2 siblings on the book. The Position section renders `Mark: $29.48
  (195C...) (stale)`. The "Other concurrent position(s)" section then renders, for the 225C
  sibling (its own distinct ~$10.48 quote): `P&L +18.4% _(stale — same quote Mark flagged
  above)_` — but that P&L is derived from the 225C contract's OWN quote, never from the
  $29.48/195C quote "flagged above" in the Position section. The same false claim reproduces
  reciprocally for every other multi-position ticker currently on the book (MRNA has 3 siblings;
  TEM/NVAX/SMR/OWL/GDDY/SNDQ/IP/SG each have 2, per the live horizons committed list at the time
  this finding was filed).
- **RED (pre-fix):** `optionMarkStaleCaveat(play, readMs, false)` (new 3rd-arg call) and the
  `composeSwingPlayBrief` sibling-section tests both failed before the fix — the sibling line
  rendered the literal `_(stale — same quote Mark flagged above)_` text instead of an honest,
  sibling-scoped caveat. Confirmed by temporarily reverting the two source files
  (`play-brief-absence.ts`, `play-brief.ts`) to their pre-fix `origin/main` state while keeping
  the new tests: `play-brief-absence.test.ts` → 112/113 pass, 1 fail (the new
  `sameContractAsMarkAbove=false` test); `play-brief.test.ts` → 186/188 pass, 2 fail (the updated
  NRG-sibling test and the new two-sibling MRNA-shape test).
- **GREEN (post-fix):** restoring the fix, both files pass in full —
  `play-brief-absence.test.ts` 113/113, `play-brief.test.ts` 188/188 (301/301 combined).
  `play-brief-narrative.test.ts` + `play-brief-narrative-coaching.test.ts` + `play-brief-intel.test.ts`
  (713 tests, every other `optionMarkStaleCaveat` call site) still pass unchanged — the default
  (same-contract) wording is byte-identical to before, so no regression on the primary-play call
  sites.
- `npx tsc --noEmit -p .` clean on the full project after the fix.

### Blast radius

- `optionMarkStaleCaveat` has exactly 8 call sites across 3 files
  (`play-brief.ts` ×2 — `pnlSection`'s P&L/Peak/Trough/Greeks/Spread/Exec-P&L lines (one shared
  `staleCaveat` variable) and `siblingPositionsNote`; `play-brief-narrative.ts` ×3; `play-brief-
  narrative-coaching.ts` ×2). Only `siblingPositionsNote` was affected — every other call site
  passes the brief's own subject `play`, where the "same quote Mark flagged above" claim is
  true by construction and is left completely unchanged (verified by the unaffected 713-test run
  above).
- Live tickers currently exposed to the false claim (any multi-position ticker renders it once
  per sibling with an aged `markAsOf`): MRNA (3 concurrent positions), TEM, NVAX, SMR, OWL, GDDY,
  SNDQ, IP, SG (2 each) — any of these whose sibling quote happens to be stale (>18 min since
  `swing-active-refresh`'s last tick, `SWING_OPTION_MARK_STALE_MS`) renders the false claim until
  this fix deploys.

### Fix rationale

Added an explicit third parameter, `sameContractAsMarkAbove: boolean = true`, to
`optionMarkStaleCaveat`. Defaulting to `true` preserves every existing call site's behavior
byte-for-byte with zero changes required at those sites. `siblingPositionsNote` is the one call
site updated to pass `false`, which swaps the borrowed "same quote Mark flagged above" wording
for an honest, sibling-scoped caveat that cites the sibling's own last-synced timestamp:
`_(stale — its own quote, last synced <ET stamp>)_`. The timestamp is safe to format
unconditionally in that branch because `optionMarkIsStale` returning `true` already guarantees
`play.markAsOf` is a real, truthy value (it returns `false` early on `!play.markAsOf`).

Considered giving `siblingPositionsNote` its own, fully separate wording function instead of
widening the shared one — rejected because the other two branches (`optionMarkGenuinelyUnknown`'s
"entry-time read" caveat and the live-quote-no-timestamp caveat) are correct and identity-neutral
as written; duplicating those two branches into a second function just to fix the one branch
that actually has an identity problem would reintroduce the "two readers, one drifts" risk this
same file's own history already warns about (the 2026-10-25 extraction of this exact function out
of `pnlSection`'s inline ternary was done for precisely that reason).

### Deliberately left unchanged

- The `optionMarkGenuinelyUnknown` and live-quote-no-timestamp branches of
  `optionMarkStaleCaveat` — neither makes an identity claim, so neither needed a parameter.
- Every call site other than `siblingPositionsNote` — all pass the brief's own subject `play`,
  where the default (`true`) wording remains correct.
- The absence-disclosure logic itself (the 2026-10-26 fix that first wired this caveat into
  `siblingPositionsNote`) — this fix only corrects the wording's truth value, not whether a
  caveat is shown at all.
