> **kind:** FINDING

## Chart technicals silently omitted "Dealer gamma regime" whenever Vector's own read was "unknown", even when a fresh GEX-matrix posture existed two sections down in the same brief — FIXED

| **Status** | FIXED (this commit) |
|---|---|

**Root cause:** `chartTechnicalsSection` (`src/lib/swing/play-brief-intel.ts:276`) read `vec.regime?.posture`
directly and correctly excluded the literal string `"unknown"` from being *displayed* as a resolved
value (so it was never the same defect class as the three `resolveGammaPosture` fixes shipped earlier
today) — but unlike `dealerPostureLine` (`play-brief-narrative.ts`), `evidenceFromContext`
(`play-brief.ts`), and `counterThesisLine` (`play-brief-narrative.ts`) — all three of which now
delegate to the shared `resolveGammaPosture` helper and fall through to a fresh, non-stale
GEX-matrix posture when Vector's own regime is `"unknown"` — this section had **no fallback path at
all**. It simply omitted the "Dealer gamma regime" line whenever Vector's read was `"unknown"`, even
when the GEX matrix could resolve a real answer.

Not a wrong-value bug (silence, not fabrication) — a completeness gap: a trader reading only "Chart
technicals" saw nothing where a determinable answer existed elsewhere in the same brief.

**Evidence (live reproduction, 2026-09-15, TSM real swing-discovery WATCH brief):** the same brief's
"Trade manager read" section (already using `resolveGammaPosture`) printed `"**Right now** — spot
**419.48** · dealers **short gamma** — moves can accelerate through walls"` (resolved via the
GEX-matrix fallback, net GEX -58.5M, since Vector's own raw posture read was `"unknown"`), while
"Chart technicals" — reading the same underlying Vector snapshot — had no "Dealer gamma regime" line
at all for the same ticker/read.

**Blast radius:** any committed or watch position whose Vector regime read is `"unknown"` while a
fresh GEX-matrix posture is available — "Chart technicals" specifically; the other three sections
already carry the correct fallback since earlier today's fix.

**Fix:** `chartTechnicalsSection` gained an optional 4th parameter, `ctx?: SwingPlayBriefContext |
null`, defaulting to `undefined` so every existing caller keeps the old vec-only behavior unchanged.
When `ctx` is supplied (the real production call site now passes it), the posture is resolved via
`resolveGammaPosture(ctx, vec, readMs)` instead of reading `vec.regime?.posture` directly — same
helper the other three call sites already use, so this closes the last unfixed gap in the family
without re-deriving the fallback logic a fourth time. The existing "transition" special-casing
(`"**transition** (near flip)"`) is preserved unchanged, since `resolveGammaPosture` can still return
`"transition"` from a live Vector read (only the GEX-matrix fallback is restricted to `"long"|"short"`).

**Fix rationale:** an optional trailing parameter (rather than replacing the existing `sessionDate`
param or requiring every caller to pass a full context) keeps the change minimal and backward
compatible — the ~10 existing unit tests for this function that call it without a `ctx` argument
continue to exercise the exact pre-fix behavior unchanged, while the one real production call site
(`play-brief-intel.ts`'s `buildIntelSections`, which already has `ctx` in scope) gets the fix.

**Test:** RED→GREEN proven (git-stashed the source fix, confirmed the new regression test's "with
ctx" assertion fails — no "Dealer gamma regime" line at all, matching the exact production symptom —
against pre-fix code; restored and confirmed green, including a companion assertion that the
no-`ctx` call shape still preserves the old silent-omission behavior exactly, proving no regression
for any caller that hasn't been updated). Full `src/lib/swing/*.test.ts` suite (1142 tests, up from
1141) green, `tsc --noEmit` and `eslint` clean on both changed files.
