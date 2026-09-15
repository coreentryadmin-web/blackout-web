> **kind:** FINDING

## Swing `premium_stop` hard-stop could be permanently disabled by an unrelated edge rung — FIXED

| | |
|---|---|
| **Status** | FIXED (this commit) |
| **Severity** | P1 (capital-preservation, live-trading-path) |
| **Surface** | `latchSwingLiveStatus` (`src/lib/swing/manage-sync.ts`) |

### Root cause

`latchSwingLiveStatus` latched the ledger `status` to `"TRIM"` whenever `verdict.enforced &&
(verdict.action === "TAKE_PARTIAL" || verdict.action === "EXIT_RUNNER")` — checking only the
*action*, never *which rung* produced it. Six independent edge rungs
(`catalyst_shift`/`regime_shift`/`profit_ladder`/`flow_decay`/`rel_strength_loss`/`vol_collapse`,
`SWING_EDGE_RUNGS` in `manage.ts`) each graduate on their own evidence bucket via the PR-16
calibration ladder and can independently return `TAKE_PARTIAL`/`EXIT_RUNNER` once enforced — but
only `profit_ladder` actually means "a real premium partial happened."

The chain this breaks: `scaledAlready` (read next tick from `row.status === "TRIM"`, `manage-sync.ts:306`)
feeds `deriveScaleOutAction` (`zerodte/scale-out.ts`, shared with 0DTE/Banger/Legacy), which
permanently disables the −60% `premium_stop` capital-preservation hard stop once `scaledAlready` is
true — it assumes a partial was already banked, so it only re-arms the trailing-stop check for a
runner. If e.g. `regime_shift` fires an enforced `TAKE_PARTIAL` (an advisory "consider de-risking"
signal, nothing sold), the latch fired anyway, TRIM stuck permanently (`if (current === "TRIM")
return "TRIM"`), and the position's real premium hard stop could never fire again — no matter how
far the premium subsequently collapsed.

### Concrete failure scenario

Position opens. `regime_shift` graduates and fires an enforced `TAKE_PARTIAL` (broad regime flip,
no premium event at all). `latchSwingLiveStatus` sets `status = "TRIM"`. From that tick forward,
every future `scaledAlready` reads `true`, so `deriveScaleOutAction`'s pre-scale `STOP_OUT` branch
(`!scaledAlready`) is unreachable — a subsequent −60%+ premium collapse produces no `STOP_OUT`
verdict at all, silently leaving the position exposed with no capital-preservation backstop.

### Fix

Gate the TRIM latch on `verdict.rung === "profit_ladder"` in addition to `verdict.enforced` and the
action check — restoring the latch to only the one rung whose semantics ("a partial premium
scale-out happened") match what `scaledAlready` is supposed to encode. The other five edge rungs
firing `TAKE_PARTIAL`/`EXIT_RUNNER` now fall through to the existing "keep current status" branch,
same as any other advisory/evidence-only verdict.

### Blast radius

Verified independently before shipping (see PR #4076 comment 5682367688): `deriveScaleOutAction`'s
other three real callers (`banger/live-sync.ts`, `nighthawk/lib/legacy-live-sync.ts`, and 0DTE
itself, which has zero non-test callers) all derive `scaledAlready` from a single deterministic
rule engine with no equivalent multi-rung latch — none are affected by this bug or this fix. The
change is confined to `swing/manage-sync.ts`'s `latchSwingLiveStatus`; `zerodte/scale-out.ts` is
untouched.

### Test

`src/lib/swing/active-refresh.test.ts` — new test constructs an enforced `regime_shift`
`TAKE_PARTIAL` (graduated via `graduatedRungs: ["regime_shift"]`) and asserts (a) it does not latch
TRIM (status stays `OPEN`, not the pre-fix `TRIM`) and (b) a subsequent −60% mark on the next tick
still produces a `STOP_OUT`/`premium_stop` verdict. Confirmed RED (via `git stash` on the
source-only change) before the fix, GREEN after. Full `npm test` + `tsc --noEmit` also run.

### Provenance

Escalated on the standing Ask Largo × Night Hawk Swings collaboration thread, PR #4076 (comment
5677726561 — full chain traced independently, not fixed solo per the multi-file/shared-subsystem
CARVE-OUT discipline). Blast-radius verification and ownership hand-off in comments 5682367688 →
5682672044 (explicit sign-off: "please go ahead and take it").
