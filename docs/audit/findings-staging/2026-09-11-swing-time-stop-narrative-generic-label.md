> **kind:** FINDING

## Swing `time_stop` SELL reason renders as a bare "time stop hit" label — FIXED

| | |
|---|---|
| **Lane** | Night Hawk Swings — Ask Largo play-brief |
| **File** | `src/lib/swing/play-brief-narrative.ts` (`sellReasonClause`) |
| **Status** | FIXED (this PR) |

### Root cause

`sellReasonClause` maps each `manage.ts` exit rung to a human-readable clause for the "Trade
manager read" narrative. `expiry_risk` (the DTE/theta-cliff gate) was already fixed for exactly
this class of bug on 2026-09-10 (live NRG repro, `SWING:NRG:34`): a bare generic label ("thesis or
ladder fired") read as a broken thesis or a fired trim ladder when the real mechanism was neither.
That fix added a specific, disambiguating clause: `"— time-based: DTE nearing the lane's theta
cliff (thesis still intact)"`.

`time_stop` — manage.ts's *other* "force-manage with an intact thesis" rung — never got the same
treatment. It fires when a position has been held `≥ timeStopSessions` sessions with the
**underlying's** progress toward its price target stagnant (`thesisProgress01`,
`thesis-progress.ts` — computed from spot vs. entry/target, not from option P&L). Until this fix it
rendered as the bare, generic `" — time stop hit"`, with no indication of *why* or any reassurance
that the thesis itself hadn't broken.

### Evidence

Live repro, 2026-09-11 ~15:16 UTC cycle, `SWING:NRG:34` (the same position the original
`expiry_risk` finding used): NRG's manage engine returned `EXIT` / rung `time_stop` while the
position was sitting on a genuine **+15.3% premium gain** (peak +132.7%, mark $5.65 vs entry
$4.90). The brief's "Trade manager read" read:

> **Exit now** — time stop hit. Flatten per manage engine. Gave back 88% of peak — consider
> protecting runner.

A member reading "time stop hit" next to a still-green position has no way to tell this apart from
a ladder/thesis event, and no way to know the underlying (not the option) is the thing that
stalled. Confirmed via code that `time_stop`'s actual mechanism (`manage.ts` line ~358) is
unrelated to DTE and unrelated to a thesis break — it is scoped to `thesisProgress01` (underlying
spot vs. its pinned target), which can legitimately be stagnant even while the option premium is
up on IV/leverage.

### Fix

Extended the same disambiguation pattern `expiry_risk` already uses, scoped to `time_stop`'s real
mechanism:

```
" — time-based: held long enough that the underlying has stalled toward its target (thesis still intact)"
```

Pure narrative-text change — no logic, gating, or execution-path change. `catalyst_shift` /
`regime_shift` / `premium_stop` were checked and already carry adequately specific clauses; only
`time_stop` had the generic label.

### Blast radius

Single call site (`sellReasonClause`'s `time_stop` case), one consumer
(`tradeManagerNarrativeSection`'s SELL-recommendation clause). No other reader of `manageReason`
constructs its own competing text for this rung.

### Evidence of testing

New regression test `tradeManagerNarrativeSection: SELL from time_stop states the dead-money
reason, not a bare label` (`play-brief-narrative.test.ts`) — RED→GREEN proven via a standalone
`node --import tsx` repro script (the node test runner's `--experimental-test-module-mocks --test`
invocation hung intermittently in this sandbox for this large file, independent of the change —
confirmed by isolating to a plain script calling `tradeManagerNarrativeSection` directly, which ran
in ~1s both with and without the fix). Full `play-brief-narrative.test.ts` suite: 58/58 pass.
`tsc --noEmit`: clean.
