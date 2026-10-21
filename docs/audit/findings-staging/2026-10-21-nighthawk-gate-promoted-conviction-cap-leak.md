> **kind:** FINDING

## Night Hawk Legacy: gate-promoted conviction cap did not propagate to `key_signal`, `tier`, or the rescue-play path — FIXED

**Root cause.** `capGatePromotedConviction()` (`src/features/nighthawk/lib/publish-gates.ts`) exists
specifically to prevent a gate-promoted (rescued-past-a-failed-quality-gate) play from displaying an
unearned "A"/"A+" conviction — it caps the member-facing `conviction` field at "B". Live health-check
spot-check (2026-10-21, 5-engine monitor cycle, `GET /api/market/nighthawk/edition`) found a real
MSTR play where this cap was visibly bypassed by TWO other surfaces reading the same uncapped
merit-tier computation, plus a THIRD construction path that never applied the cap at all:

1. **`key_signal` (prose summary).** `buildDeterministicThesis()` (`deterministic-edition.ts:633`)
   builds `key_signal` as `` `${dir} — ${drivers} · score ${scored.score} (${scored.conviction})` ``
   — embedding `scored.conviction` (the UNCAPPED merit-tier letter) as a literal substring, BEFORE
   `gate_promoted` is even known (promotion happens later, in `edition-builder.ts`/`claude-edition.ts`).
   `capGatePromotedConviction` never touched this string. Live repro: `conviction: "B"` (correctly
   capped) next to `key_signal: "...score 52 (A)"` on the SAME play record.
2. **`tier` field (provenance object).** `publish-context.ts`'s `buildNighthawkPublishContext()`
   independently recomputes `assignNighthawkTier(nhTierInputFromScored(scored))` for its own `tier`
   field, never reading or capping against `play.conviction`. Live repro: `conviction: "B"` next to
   `tier: { tier: "A", factors: [{label: "Prime score band", detail: "...the overnight sweet spot"},
   ...] }` — the SAME record carrying both the correctly-capped badge and an uncapped rationale
   object whose own factors read as an A-grade case.
3. **`buildRescuePlays()`'s path (`claude-edition.ts`).** Every OTHER `gate_promoted: true`
   construction site (`edition-builder.ts`'s critic-rescue, `publish-gates.ts`'s `promoteTopBlocked`)
   wraps its output in `capGatePromotedConviction`. The `buildRescuePlays` → `claude-edition.ts`
   rescue fallback (fires when normal synthesis produces zero plays) assigned `detPlays = rescue`
   bare — the member-facing `conviction` field ITSELF could leak an uncapped A/A+ on a play that
   bypassed every geometry/premium/grounding check, the exact over-trust risk the cap exists to
   prevent, on what is arguably the LOWEST-trust population of plays in the whole pipeline.

Confirmed via direct source trace (not taken on faith from the health-check script): grep for every
`gate_promoted: true` assignment site and its paired `capGatePromotedConviction` call, and read
`capGatePromotedConviction`'s own (unchanged-until-now) definition to confirm it only ever touched
`conviction`.

**Evidence.** RED→GREEN proof via `git stash` on the four source files alone (never the test files):
stashed, 7 new assertions failed across 4 test files (`nighthawk-tiers.test.ts`,
`publish-gates.test.ts`, `publish-context.test.ts`, `claude-edition.test.ts`) — 79/86 pass; restored,
86/86 pass. `tsc --noEmit` clean. Ran the FULL `src/features/nighthawk/lib/*.test.ts` suite
(1529 tests) post-fix to check for ripple effects from the shared helper: 1529/1529 pass.

**Blast radius.** One root cause (the gate-promotion safety cap not consistently propagated to every
surface that re-derives a tier/conviction letter from the same uncapped merit-tier computation),
three independent call sites, fixed together per this repo's standing policy ("duplicated logic in a
second file counts — fix and note all of them").

**Fix rationale.**
- Added `capGatePromotedTierAssignment()` (`nighthawk-tiers.ts`) — caps a full
  `NighthawkTierAssignment` (not just a bare conviction string) for a gate-promoted "A" result,
  APPENDING an honest disclosure factor rather than silently truncating the measured-evidence
  factors (same "disclose, don't flatten" discipline this file's honesty spine already follows for
  the A+ promotion rule) — so the capped tier's own rationale explains itself instead of just
  reading as an unexplained downgrade, or worse, still reading as an uncontested A-grade case.
- `publish-context.ts`'s `tier` field now runs through this same helper, gated on `play.gate_promoted`.
- `capGatePromotedConviction()` now ALSO rewrites `key_signal`'s trailing `(A)`/`(A+)` token to
  `(B)` (anchored at the string's end via regex, so only the grade token is touched — the rest of
  the sentence is untouched) when it caps `conviction`.
- `claude-edition.ts`'s rescue-play assignment now reads `detPlays = rescue.map(capGatePromotedConviction)`,
  matching every other gate_promoted construction site in the pipeline.

Nothing else was changed — `assignNighthawkTier`'s own band logic, the A+ promotion honesty spine,
and every other call site of these functions are untouched.

| **Status** | FIXED |
|---|---|

**Fix**: PR (branch `fix/legacy-gate-promoted-conviction-leak`).
