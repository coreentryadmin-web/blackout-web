> **kind:** FINDING

## `closedCapturePct` rendered "Captured -4014% of peak" on a real closed swing position — fix/closed-capture-pct-round-trip — 2026-09-13

- **What was broken (found live via a `proxy-browser.cjs` post-deploy visual check of the Ask
  Largo Structure Ladder redesign, 2026-09-13):** `closedCapturePct()`
  (`src/features/nighthawk/command-deck/play-card-lifecycle.ts`) computes `(realized / peak) *
  100` to show "% of the trade's best-ever return that was actually banked at close." It guards
  `peak <= 0` (no positive excursion to have captured a % of) but never guarded `realized < 0` —
  once a trade round-trips past breakeven into a realized loss, dividing a negative realized
  return by a small positive peak blows up to an arbitrarily large, sign-flipped number. Live
  screenshot of a real closed AAPL 327.5C 5DTE swing position (`Peak +1.4%`, `Realized -56%`)
  rendered **"Captured -4014% of peak"** in production on `ZeroDteCommandPanel.tsx`'s trade-outcome
  detail rail — a number with no honest reading, shown to members as if it meant something.
- **Why it wasn't caught earlier:** this exact failure mode was already identified and fixed
  **twice** elsewhere in this same codebase — `src/lib/swing/mfe-capture.ts`'s
  `mfeCaptureOutcome()` (whose own header comment names the identical -158.9%-style blowup and
  returns a distinct `round_trip` outcome instead) and `src/lib/platform/zerodte-service.ts`'s
  `mfeCapturePct()` (whose comment literally says "Mirrors the same fix already shipped for swing
  plays"). `closedCapturePct` is a **third, independent copy of the same ratio math**, written
  separately for the command-deck's post-trade-attribution display, and it never got the
  round-trip guard the other two already carry. Three implementations of one idea drifting apart
  is exactly how a fixed bug reappears under a new name.
- **Blast radius:** `closedCapturePct` is the fallback used whenever `play.mfeCapturePct` (the
  server-pinned field) is absent — which, per `mfe-capture.ts`'s own comment, is **always** true
  for swing plays today (never populated server-side). So every CLOSED swing/LEAPS position that
  round-tripped past breakeven into a loss was exposed to this, not just the one instance found
  live. 0DTE positions are not affected the same way in practice (their `mfe_capture_pct` ledger
  field is populated via the already-guarded `zerodte-service.ts` `mfeCapturePct()`, so
  `closedCapturePct`'s own unguarded fallback branch is only reached when that upstream field is
  itself missing).
- **Fix:** added `|| realized < 0` to `closedCapturePct`'s existing guard clause, so a round-tripped
  loss returns `null` (the panel already omits the "Captured" line entirely when this is null —
  see `ZeroDteCommandPanel.tsx:234`, `mfeCapture != null` gate) — same behavior contract as the two
  existing sibling implementations, now genuinely consistent across all three.
- **Fix rationale:** did not attempt to unify the three implementations into one shared helper in
  this PR — `mfe-capture.ts`'s `mfeCaptureOutcome` returns a richer discriminated-union type (a
  `round_trip` variant carrying `peakPct`/`exitPnlPct` for narrative text), while
  `closedCapturePct`/`zerodte-service.ts`'s `mfeCapturePct` are simple `number | null` returns for a
  single UI number — collapsing them is a real refactor with its own blast radius, out of scope
  for a one-line guard fix. Flagged here so a future consolidation pass has this write-up as
  context.
- **Evidence:** reproduced the exact production value with the pre-fix function
  (`closedCapturePct({ status: "CLOSED", exitPnlPct: -56.2, peak: 1.4 })` → `-4014.28...`, matching
  the live screenshot). New tests in `play-card-lifecycle.test.ts`: a round-tripped loss against a
  small peak (the exact reproduced case) and a small negative realized against a large peak both
  assert `null`. RED→GREEN confirmed via `git stash` on `play-card-lifecycle.ts` (new test failed
  pre-fix with the exact `-4014...` value, passed post-fix). Full suite 14100/14100 pass (3
  pre-existing unrelated skips), `tsc --noEmit` clean.

| **Status** | Fixed — PR opened, CI pending |
