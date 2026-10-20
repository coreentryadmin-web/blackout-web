## 2026-10-20 — [FINDING, P3 Night Hawk 0DTE] Configurable stops and scaling (env-overridable, defaults unchanged) — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Context.** Member audit directive, point 4 of the original 6-point brief: "Make stops and
scaling configurable." `PLAN_RULES.stop_pct`/`target_pct` and `TRIM_SCALE_RULES.tranche_fraction`
were hardcoded `as const` constants — a real engineering gap distinct from "don't change member-
facing behavior," since the standing instruction asks for the DEFAULT to stay unchanged, not for
the VALUE to be unconfigurable forever.

### What changed

- `plan.ts`: `PLAN_RULES.stop_pct`/`target_pct` resolve through a new, exported
  `envOverridePct(envVar, fallback, mustBeNegative)` helper — `ZERODTE_STOP_PCT`/
  `ZERODTE_TARGET_PCT` override the member-facing hard stop/target when set to a valid value of
  the correct sign (a stop must be negative, a target must be positive — the helper refuses to
  silently flip intent on a sign mismatch). Absent/invalid → the exact pre-existing -50/+100
  default, byte-identical to before this change. Same established convention this file already
  uses for `ZERODTE_CHASE_PCT`/`ZERODTE_DIRECTIONAL_LATE_CUTOFF_MINUTES`.
- `strategy-version.ts`: new `resolveTrancheFraction(fallback)` — `ZERODTE_TRIM_TRANCHE_FRACTION`
  overrides the fraction of the original position banked at each `trim_scale` tranche (default
  1/3, the E5-measured winner). Bounded to `(0, 1)` exclusive; out-of-range or malformed falls
  back rather than being clamped (clamping would hide a misconfiguration as if it were intended).
  Deliberately NOT added to `exit-engine.ts` itself, which documents itself as IO-free/no-env-
  reads (the pure decision core) — read instead in the resolution layer that already reads
  `PLAN_RULES` the same dynamic way.
- The extended-runner (200-400% target) 0.25/0.5 schedule is its OWN deliberate schedule and does
  NOT read the tranche-fraction override — only the standard path does.

### Why this is safe (the integrity concern checked before shipping)

`buildResolvedExitPolicy`'s `config_hash` fingerprints every exit constant that can move a graded
outcome specifically so two different strategy versions never silently blend into one calibration
cohort. Since `PLAN_RULES.stop_pct`/`target_pct` and the resolved tranche fraction are embedded
directly in the hashed `core` object (not the static source-code literal), an active override
correctly produces a DIFFERENT hash — two deployments running different overrides will never
silently share a calibration cohort. Verified directly: a new test confirms `config_hash` changes
when `ZERODTE_TRIM_TRANCHE_FRACTION` is set and reverts to the baseline once the env var is
removed. The existing golden-hash drift-guard test (`WS-02 DRIFT-GUARD`) still passes unmodified —
no env var is set during the normal test run, so the resolved defaults are byte-identical to
before this change and the committed golden hash does not move.

### Tests

16 new tests across `plan.test.ts` (6, `envOverridePct` behavior + a default-value guard pinning
-50/+100) and `exit-policy-snapshot.test.ts` (4 for `resolveTrancheFraction` + 2 for
`buildResolvedExitPolicy`'s override/hash interaction). RED→GREEN proven (reverted both source
files to pre-change, confirmed 10 real failures; restored, confirmed 126/126 pass across
plan/exit-policy-snapshot/strategy-version/calibration/terminal-frozen-policy/tier-export tests).
`npx tsc --noEmit`: clean. All runs on the real Node 20 binary.

### Deliberately NOT done here

- `time_stop_et_minutes` is NOT made configurable — it's a session-structure boundary (cash-close
  proximity), not a risk-sizing knob, and the adjacent NEW-COMMIT cutoff already has its own
  override (`ZERODTE_DIRECTIONAL_LATE_CUTOFF_MINUTES`).
- `TRIM_SCALE_RULES.tranches_by_regime` (the per-regime trigger thresholds: trend [40,80],
  neutral [20,50], range [15,40]) is NOT made configurable in this pass — a 6-number structured
  object is riskier to expose as a flat env var than a single bounded fraction; left as a
  deliberate scoping decision for a future pass if real demand justifies it.
- No live/production env var was actually set by this change — every default stays exactly as
  measured (E5 for trim_scale, the long-standing -50/+100 for stop/target).
