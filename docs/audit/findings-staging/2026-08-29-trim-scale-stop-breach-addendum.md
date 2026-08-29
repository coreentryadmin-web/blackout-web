## ADDENDUM to the trim_scale dead-zone reopening — the same root cause can (once fixed) let a real plan-stop breach fall through to a TRIM instead of an EXIT — DOCUMENTED, NOT SHIPPED (unreachable today)

> **kind:** `FINDING`

| **Status** | DOCUMENTED — pinning regression test added; no code change (the gap is unreachable in production today, and there is nothing safe to change without the persisted-counter redesign this addendum requires) |
| **Severity** | P1 — latent risk-management defect, currently dormant |
| **Surface** | `src/lib/zerodte/exit-engine.ts` `decideTrimScale`, companion to `docs/audit/findings-staging/2026-08-29-trim-scale-dead-zone-reopened.md` |

### Root cause

This is a follow-up to the 2026-08-29 reopening of the trim_scale breakeven-floor dead zone
(`2026-08-29-trim-scale-dead-zone-reopened.md`), which established that `exit-sync.ts` derives
`trimsTaken` as `trimTranchesArmed(pinnedLivePnlPct(entry, peak), regime)` — the exact same formula
`decideTrimScale` uses internally to compute `armed` — so `armed === taken` always in production,
and `trimAvailable = armed > taken` is always `false`.

A deeper audit of the same code turned up a second, more severe consequence of that same
structural gap. Compare the two exit modes' protective-exit precedence:

- **`ratchet` mode** (`evaluateExitState`'s non-`trim_scale` branch): `const stopBreached =
  planStop != null && currentMark <= planStop; const floorBreached = floor != null && pnlPct <=
  floor; if (stopBreached || floorBreached) { ... }` — a plain OR. A real plan-stop breach
  (`stopBreached`) ALWAYS enters the EXIT-returning block, no matter what the floor is doing; the
  only question the block still resolves is which REASON label wins.
- **`decideTrimScale`**: the 2026-08-27 dead-zone patch added a `!trimAvailable` term to its
  `floorBreached`, and its plan-stop branch additionally requires `!floorBreached` before firing.
  If `trimAvailable` were ever `true` (which it is not today, but is exactly what the persisted
  trim-tranche counter named as the real fix would make possible), a real plan-stop breach can
  satisfy `stopBreached` yet fail BOTH `(stopIsHigher && !floorBreached)` and `(floorBreached &&
  sharedFloor != null)` simultaneously — falling through to the trim-ladder step, which returns a
  `TRIM` action (banking a tranche) with **no exit at all**, while the position keeps losing value.
  `ratchet` mode has no code path that can produce this outcome; `trim_scale`'s does, purely as a
  side effect of the dead-zone patch's added term having no equivalent safety net.

### Evidence

Two new regression tests in `exit-engine.test.ts`, immediately after the existing "KNOWN GAP" test
for the original dead-zone reopening:

- `"KNOWN GAP (unreachable in production today): if trimsTaken were ever independently 0 while a
  tranche is armed, a real plan-stop breach falls through to TRIM instead of EXIT"` — with an
  artificial `trimsTaken: 0` (not what the real caller ever sends) at peak +21.25% (arms tranche 1)
  and a mark crashed to -62.5% (well past the -50% plan stop), `evaluateExitState` returns
  `action: "TRIM"`, not `"EXIT"`.
- `"production-safe today: the real trimsTaken derivation (armed===taken always) still forces an
  EXIT on the same stop breach, just via the floor reason rather than plan_stop"` — the identical
  scenario, but with `trimsTaken` derived via `trimTranchesArmed(peakPnlPct, regime)` (exit-sync.ts's
  real formula) confirms `action: "EXIT"` still fires (via the floor reason, matching ratchet
  mode's own documented "higher protection wins" design — not a new discrepancy), proving the
  gap above cannot fire via the only real production call path today.

79/79 tests pass in `exit-engine.test.ts`, `npx tsc --noEmit` clean.

### Blast radius

Same as the original reopened finding: `decideTrimScale`, reached only via `evaluateExitState`
from `exit-sync.ts`'s live ledger tick. `ratchet` mode (the C-tier/untiered default and the mode
every non-`trim_scale` play uses) is structurally immune — its protective-exit gate is a plain OR
with no `trimAvailable`-style suppression term, so this addendum is `trim_scale`-specific.

### Fix rationale — no code change shipped, and why that is correct here

There is nothing safe to fix in isolation: the guard this addendum is warning about
(`!trimAvailable` on `floorBreached`, and `!floorBreached` on the plan-stop branch) never actually
executes differently today, because `trimAvailable` is always `false`. Removing or altering it now
would be a no-op at best (since the branch it guards is unreachable) and, at worst, could interact
unpredictably with the parts of `decideTrimScale` that DO execute in production (the floor-vs-
thesis-break precedence) if changed carelessly. The correct fix is not a patch to today's code — it
is a REQUIREMENT on the eventual persisted trim-tranche counter (the real fix the original
dead-zone reopening named as future work): whatever replaces `trimsTaken`'s peak-rederived value
must guarantee a real plan-stop breach can never be suppressed by an armed-but-unbanked tranche,
matching ratchet mode's unconditional stop-always-exits guarantee. This pinning test is written so
that redesign is forced to confront this scenario directly rather than silently reintroducing it.
