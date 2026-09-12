## 2026-09-12 — [FINDING, P4 correctness, SPX Slayer] `useSpxLotto`'s 9:30 ET cash-open scheduler had the ICU midnight-as-"24" quirk with NO window gate — silently skipped at ET midnight — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — merged same PR. |
| **Severity** | P4 — narrow reachability window (any component mount during the 00:00-00:59 ET hour) and a soft failure mode (the one-time cash-open refresh optimization silently doesn't fire; the hook still gets fresh data on its next natural SWR revalidation, so nothing renders wrong data — it's a missed micro-optimization, not a correctness break for what members see). |

### What prompted this

Re-verifying `docs/audit/FINDINGS.md`'s 2026-09-10 entry *"The just-fixed ICU midnight-as-'24' quirk (#4703) has 10 more unnormalized call sites... OPEN, write-up only"* — that entry flagged `useSpxLotto.ts`'s `lottoPollIntervalMs()` as *"NOT obviously latent... gated behind `isLottoPollWindow()` which I did not trace."*

### What was actually found — the flagged function is latent, but a second, undocumented instance in the same file is not

Traced `isLottoPollWindow()` (`spx-play-session-guards.ts`): 7:00 AM–2:00 PM ET, never overlaps `[00:00, 00:59]` ET — so `lottoPollIntervalMs()`'s own unnormalized arithmetic is confirmed **latent**, exactly resolving the original entry's stated uncertainty. Left untouched, per this repo's own "don't fix a call site that doesn't need it" discipline (the same call `edition-stale.ts`'s fix made for its latent siblings).

But reading the rest of the same file turned up a **second occurrence the original sweep's `compose*Read`-shaped search didn't catch** (it wasn't looking for a second instance once the first was found): the `useEffect` at the bottom of `useSpxLotto()` — *"Schedule an immediate mutate() at 9:30 ET cash open"* — re-implements the identical raw `Intl.DateTimeFormat({ hour12: false })` parsing **with no window gate of any kind**, not `isLottoPollWindow()`, not even a weekday check. Any component mount during the ET midnight hour hits it unconditionally.

### Root cause

`hour12: false` renders ET midnight as hour `"24"` in this Node/ICU build, not `"00"` (the same quirk #4703 fixed in `session.ts`, and the shape this file's own `lottoPollIntervalMs` was already flagged for). Unnormalized, `etSecondsNow = h * 3600 + m * 60 + s` computes ~86400s too high for any instant in `[00:00, 00:59]` ET. `msUntilOpen = (cashOpenSeconds - etSecondsNow) * 1000` then comes out deeply negative instead of a small positive number, and `if (msUntilOpen <= 0) return;` silently skips scheduling the timer — the hook falls back to its normal SWR interval instead of getting the immediate 9:30 AM nudge.

### Fix

Extracted the computation into a new exported, directly-testable `msUntilSpxCashOpenEt(now = new Date())` (matching this file's existing `lottoPollIntervalMs` exported-pure-function convention) and applied the same `% 24` normalization already used throughout this codebase (`spx-play-session-time.ts`'s `etMinutes` — same directory — `edition-stale.ts`, `et-window.ts`, `meridian-open-session.ts`, etc.). The `useEffect` now just calls it.

### Evidence

Confirmed the exact wrong number the old inline code produced, for a real trading-day instant (2026-09-14, Monday, EDT/UTC-4) at ET 00:30:15 (`new Date("2026-09-14T04:30:15Z")`, independently confirmed via `Intl.DateTimeFormat` to render hour `"24"` in this Node/ICU build):
- OLD (unnormalized): `msUntilOpen = -54015000` → `<= 0` → skipped.
- CORRECT: `msUntilOpen = 32385000` (8h59m45s until 9:30 AM) → positive → scheduled.

RED→GREEN: 3 new tests in `useSpxLotto.test.ts` (midnight-ET positive case, past-open non-positive case, exactly-at-open zero case) — pre-fix (function didn't exist yet, `git stash` on the source file only) all 3 fail; post-fix all 3 pass. Full `src/features/spx/**/*.test.ts`: 818/818 pass. `npx tsc --noEmit`: clean.

### Blast radius

Single file, single effect. `lottoPollIntervalMs()` (same file) and its own already-correct call sites elsewhere are untouched — confirmed latent, not silently "fixed" without evidence. No other caller of the old inline logic exists (it was never exported).

### Why this was safe to fix directly (not written up)

Small, single-file, single-function fix using an already-established, repeatedly-proven repo pattern (`% 24` normalization) — the SPX lane's own recent commit history shows no activity in the ~15+ hours preceding this fix, unlike the currently very-active Swing/Legacy/0DTE lanes, so file-overlap risk was low. The 10 other still-open sites from the original sweep remain untouched and still flagged for their owning lanes — this fixes only the ONE additional site this pass found, in a file the original entry already named as worth prioritizing.
