> **kind:** FINDING

## Ask Largo — `crossDeskCoaching`'s "Cross-desk friction" line mislabels a committed CONDOR's nominal direction as a real directional 0DTE call — FIXED

| **Status** | FIXED |
|---|---|
| **Severity** | P3 (latent until a condor commits on the same ticker/day as a live swing — condor-record.ts measured near-zero condor commits historically, but a live correctness bug the moment one does, same class as the sibling below) |
| **Surface** | Night Hawk Swings — Ask Largo play-brief "Trade manager read" narrative, `crossDeskCoaching` |
| **Files** | `src/lib/swing/play-brief-narrative-coaching.ts` |

### Root cause
`crossDeskCoaching` (`src/lib/swing/play-brief-narrative-coaching.ts`) reads
`z.direction` off the same `zerodte_today` ecosystem row `flowIntelSection` reads, and compares it
against the swing play's own `direction` to produce the "Cross-desk friction" / "Desk alignment"
narrative bullet ("0DTE short (score 78)... hours-long 0DTE clock..."). Exactly like
`flowIntelSection`, it never checked `is_condor` before treating `direction` as a real directional
call — for a committed iron CONDOR, `direction` is NOMINAL provenance only (the fade side of the
pin it came from; `board.ts`'s own `ZeroDteSetup.direction` doc comment says the structure is
delta-neutral and the directional gates/grader do not apply to it), so comparing it against the
swing's real direction fabricates a "conflict" or "alignment" signal the 0DTE desk never actually
took.

### Why this wasn't already caught
#4788 (2026-09-11, same day) fixed the byte-identical defect in `flowIntelSection`
(`play-brief-intel.ts`)'s own "0DTE desk: aligned/conflict" line, and added the `is_condor` field
to `EcosystemZeroDteTake` for exactly that purpose. But that PR's blast-radius check stopped at
the one call site it started from — `crossDeskCoaching` reads the identical
`zerodte_today.direction` field through the identical `zerodteLiveForSession()` helper and carries
the identical bug, untouched by that fix. `is_condor` was already threaded through the type and
the ecosystem query by #4788, so this fix only needed to read a field that was already there.

### Blast radius
Two places inside `crossDeskCoaching` read `z.direction` without a condor guard: the CONFLICT
detection (`play.direction === "LONG" && zShort` / `"SHORT" && zLong`) and the ALIGNMENT fallback
(`z && ((play.direction === "LONG" && zLong) || ...)`, which appends `0DTE score N` to a "Desk
alignment" line). Both were fixed by the same guard, since both derive from the same `zLong`/
`zShort` booleans.

### Fix
Gate `zLong`/`zShort` on `z?.is_condor !== true`, the same rule #4788 applied in `flowIntelSection`
— a condor row now contributes to neither cross-desk conflict nor alignment narration, leaving the
"sold iron condor, structure-neutral" framing (already correct in `flowIntelSection`) as the only
place a condor's presence is disclosed, rather than being silently mislabeled directional in a
second narrative surface.

### Evidence
RED→GREEN via a new test asserting `crossDeskCoaching` returns `null` for a `LONG` swing with a
`zerodte_today` row carrying `direction: "short", is_condor: true` — pre-fix this fabricated a
"Cross-desk friction — 0DTE short (score 78)..." bullet; post-fix it correctly renders nothing.
Full existing `crossDeskCoaching`/`play-brief-narrative-coaching` suite stays green (66/66).
`npm test` (Node 20): 13755 pass / 0 fail / 3 skipped. `tsc --noEmit` clean.

### What was deliberately left unchanged
`flowIntelSection`'s own condor handling (already correct, shipped by #4788) is untouched. No
schema/query change needed — `is_condor` was already selected end-to-end by #4788.
