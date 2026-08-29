# Admin per-play tier export — unblocks the C-tier/untiered exit-mode backtest

> **kind:** FINDING

## Symptom

Task tracking (item #59, `docs/audit/0DTE-RESEARCH.md`'s "Follow-up scoped but BLOCKED"
note, 2026-08-28) flagged that `resolveExitModeForTier`'s C-tier/untiered → ratchet policy
(`src/lib/zerodte/exit-sync.ts`) was shipped from the E5 exit-engine study, but that study's
276/352-play sweep never split by real tier at all — "C-tier's signal quality doesn't justify
the looser runway" is a plausible prior, not a measured result. The doc named two blockers to
measuring it for real: (1) no reachable data source carries `entry_premium`/`top_strike`/
`expiry` per historical play, and (2) `zerodte-sim.mjs`'s own simulated candidates can't be
tiered correctly (missing live VIX/Cortex reads at candidate-generation time).

## Root cause

Blocker (1) turns out to be narrower than stated: `entry_premium`, `top_strike`, and `expiry`
were never actually missing from the data layer — `src/lib/db.ts`'s `fetchZeroDteSetupLogRange`
(the same function `/api/market/zerodte/record` already calls) returns them on every
`ZeroDteSetupLogRow` (see `mapZeroDteLogRow`). The gap was that `record.ts`'s
`buildZeroDteRecord` — the only thing that ever turned those rows into an HTTP response —
aggregates them into public track-record stats and drops the per-play fields a re-pricing
backtest needs. Nothing was missing from the database; nothing exposed it.

## Fix

Added `GET /api/admin/zerodte/tier-export` (admin-gated via the same `requireAdminApi()`
pattern as `/api/admin/zerodte/graduation`), which fetches the same `ZeroDteSetupLogRow`s and
returns the per-play fields directly: `entry_premium`, `top_strike`, `expiry`,
`first_flagged_at`, `plan_outcome`/`plan_pnl_pct` (the existing mechanical grade, for
cross-check only), and — the field this whole exercise is about — `tier`, derived via
`tierFromEntryContext()` (the SAME pinned-`entry_context` adapter `record.ts`/`calibration.ts`
already use, so a row's tier here is byte-identical to what the live system assigned at
commit, never re-guessed). Per-row shaping lives in a new pure function,
`buildTierExportRow()` (`src/lib/zerodte/tier-export.ts`), so the tier-derivation logic is
unit-testable without a live database — the route itself is a thin fetch+serialize wrapper.

This resolves blocker (1) from the research doc. Blocker (2) (a real backtest script that
fetches each play's real OCC contract minute bars and re-grades under `ratchet` vs
`trim_scale` via the existing `gradeThroughExitEngine` A/B) is NOT part of this change — see
"What was deliberately left undone" below.

## Blast radius

One new route (`src/app/api/admin/zerodte/tier-export/route.ts`) and one new pure lib module
(`src/lib/zerodte/tier-export.ts`). Read-only, admin-gated, no schema change, no write path.
Does not touch `resolveExitModeForTier`, `exit-engine.ts`, or any live exit-management
behavior — the C-tier/untiered → ratchet policy is completely unchanged by this PR.

## Fix rationale

Chose to expose the existing fields via a new admin route (option (a) from the research doc)
rather than wiring live VIX/Cortex into `zerodte-sim.mjs`'s candidate loop (option (b)):
smaller, safer change, and it uses REAL historical tier assignments rather than a simulated
candidate pool that would need its own confound-risk validation.

## What was deliberately left undone

The actual backtest — pulling this export, fetching each real historical contract's OCC
minute bars from Polygon, and re-grading C-tier/untiered rows under `ratchet` vs `trim_scale`
via `gradeThroughExitEngine` — is a separate, larger piece of work (a new offline script, plus
its own live-data verification) and is NOT part of this PR. This PR only removes the "no
reachable data" blocker; the measurement itself, and any resulting change to
`resolveExitModeForTier`'s policy, stays a follow-up. No gate or exit-mode behavior changed.

| **Status** | FIXED (unblocks the measurement; the measurement itself is a follow-up) |
