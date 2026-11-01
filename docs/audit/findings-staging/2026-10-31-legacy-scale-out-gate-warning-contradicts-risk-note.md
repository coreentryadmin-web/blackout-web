# Night Hawk Legacy G-N2 gate_warnings text contradicts the play's own scale_out risk_note — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P2 (member-facing correctness/trust) |

## What broke

Every currently-published Night Hawk Legacy play with `exit_style:"scale_out"` ("Banger exit")
carries a publish-time `gate_warnings` entry that directly contradicts the SAME play's own
`risk_note`.

Live evidence (2026-10-31, `GET /api/market/nighthawk/edition?date=2026-10-30`, STM):

```
gate_warnings: ["target $55.99 is 2.4019x ATR14 ($2.14) from the entry edge $50.85
  (max 2x) — not achievable in the one-session grading horizon"]
risk_note: "Banger exit — scale out, don't hold to expiry: realize 50% at 2x, trail the
  runner at 50% of its peak, hard stop -60%. These cheap OTM weeklies spike then decay —
  the exit is the edge." (exit_style: "scale_out")
```

Reproduced identically on AXTI and ORCL (same 2026-10-30 edition) and NU (2026-10-27
edition) — this fires on essentially every gate-promoted Legacy scale_out play, not a
one-off.

## Root cause

`evaluateNighthawkPublishGates` (`src/features/nighthawk/lib/publish-gates.ts`, G-N2
`target_unreachable`) generated the block's member-facing `reason` text unconditionally
whenever a play's target sat beyond `GATE_TARGET_MAX_ATR_MULTIPLE` × ATR14 from its entry
edge — always asserting "not achievable in the one-session grading horizon," with no
branch on `exit_style`.

That claim is simply false for a `scale_out` play. `play-outcomes.ts`'s
`resolveBangerScaleOutGrades`/`gradeBangerScaleOut` never grades these plays on the
published stock target touching in one session at all — it grades the OPTION's own
forward bars held toward expiry (up to ~9 days) under a 2×-partial /
trailing-runner-at-50%-of-peak / hard-stop-at-−60% rule that never references this gate's
stock target/ATR distance. The gate's G-N2 check is still meaningful (the stock target is a
reference level on the card), but its one-session-horizon framing is the wrong grading
model for exactly the plays `exit_style:"scale_out"` marks.

`promoteTopBlocked` (same file) copies `block.reason` verbatim into the published play's
`gate_warnings[]` (`gate_warnings: b.result.blocks.map((block) => block.reason)`), so the
misleading text reaches the member-facing card unchanged, right next to the (correct)
`risk_note` built by `bangerScaleOutNote` (`src/lib/zerodte/scale-out.ts`) in
`deterministic-edition.ts`, which sets `exit_style = "scale_out"` and the `risk_note`
*before* the play ever reaches the publish gates (STAGE 6, `edition-builder.ts`) — so
`play.exit_style` is reliably populated by the time G-N2 evaluates.

## Fix

Branch the G-N2 `target_unreachable` block's `reason` TEXT ONLY on `opts.play.exit_style`:

- `exit_style === "scale_out"` → describe the target distance as a reference level, and
  accurately name the real grading basis (the option's own forward bars, 2× partial, trail
  the runner, −60% stop) instead of the false one-session-horizon claim.
- otherwise → unchanged, byte-identical to before (these plays really are graded on the
  stock target touching in the Legacy one-session horizon, per `target-reachability.ts`).

The gate's **verdict** (BLOCK/PUBLISH), the **numeric `value`/`threshold`** pinned in
`checks[]` (used by `isPromotableBlockedPlay`/`NON_PROMOTABLE_GATE_CODES` for promotion
eligibility and by the admin calibration histogram), and G-N2's actual gating/promotion
logic are all unchanged for every play, scale_out or not — only the member-facing prose
differs.

## Blast radius

Single call site generates this text (`publish-gates.ts`); `promoteTopBlocked` and
`applyNighthawkPublishGates`/`evaluateNighthawkPublishGates` are the only consumers, and
both forward `block.reason` unmodified — no other file duplicates this string (verified via
repo-wide grep for the literal phrase). No other gate (G-N1/G-N3/G-N4) references
`exit_style`, so this fix is scoped to G-N2 only, as instructed.

## Verify

- `export PATH=/opt/node20/bin:$PATH`
- `npx tsx --experimental-test-module-mocks --test src/features/nighthawk/lib/publish-gates.test.ts`
  — 41/41 pass, including two new regression tests: one scale_out play hitting G-N2 (new
  text, verdict/value/threshold unchanged) and one non-scale_out play hitting G-N2 (original
  "one-session grading horizon" text byte-identical, proving no regression for plays that
  really are graded on that horizon).
- RED→GREEN proven by reverting only the source fix (`git show HEAD:...publish-gates.ts`)
  against the new tests: the scale_out regression test failed, the non-scale_out one still
  passed — then the fix was restored and the full suite passed again (41/41).
- `npx tsc --noEmit` — clean, no new type errors.
