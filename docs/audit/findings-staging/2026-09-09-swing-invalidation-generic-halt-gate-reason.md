> **kind:** `FINDING`

## Swing play-brief `invalidation` showed the same generic system-wide gate reason for every gate-blocked ticker — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Ask Largo play-brief (`src/lib/swing/play-brief.ts`'s `invalidation` field, wired into the UI's labeled "Invalidation" callout — `BieAnswer.tsx` / `LargoDeskRead.tsx`) |
| **PR** | (pending — `fix/swing-invalidation-generic-halt-gate-reason`) |

### Symptom

Standing Ask Largo ownership-mandate cycle, live check against `GET /api/market/swing/play-brief`
for three gate-blocked WATCH/pending setups the board was carrying at the time (`SWING:NBIS`,
`SWING:CRCL`, `SWING:MU` — three different tickers, three different archetypes
PULLBACK_CONTINUATION/SECTOR_ROTATION/PULLBACK_CONTINUATION): all three returned the **literal
same string** in `envelope.invalidation` —

```
"Trading-halt feed unavailable — desk will not open until halt/LULD data recovers."
```

That field is rendered as a labeled **"Invalidation"** callout in the Largo UI
(`BieAnswer.tsx:125-128`, `LargoDeskRead.tsx:191-195`) — the one place a trader is told what
would invalidate THIS setup. Identical text across three unrelated tickers means the field
carried zero per-ticker information at exactly the moment it matters (a setup at trigger, waiting
on gates), even though each of the three responses already computed and displayed real per-ticker
technical levels elsewhere in the same brief (gamma flip, put wall, structural support — visible
in `envelope.levels` and in the "Watch levels"/"Trade manager read" narrative sections).

### Root cause

`play-brief.ts`'s `invalidation` fallback chain was:

```ts
const invalidation =
  play.thesisBreak?.level === "break"
    ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
    : play.gateBlocks?.[0]?.reason ??
      (bucket === "open" && play.exitPolicy?.stop_premium != null
        ? `Premium stop at ${fmtUsd(play.exitPolicy.stop_premium)}`
        : null);
```

For a WATCH/pending play (no thesis-break event has fired yet — it hasn't been entered), this
fell straight to `play.gateBlocks?.[0]?.reason`. The swing commit-gate evaluation order in
`src/lib/swing/v2/gates.ts` checks G-S3 (earnings) then **G-S12 (halt/LULD feed)** before G-S4
(regime) and G-S6 (confluence). G-S12 is a **system-wide operational gate** — when the halt/LULD
feed is cold, EVERY candidate on the board fails it identically, regardless of ticker. Because
`gateBlocks[0]` is whichever gate failed first in evaluation order, any board-wide G-S12 outage
put the exact same operational caveat in first position for every gate-blocked ticker at once —
which is exactly what was observed live.

Meanwhile a real, per-ticker technical break level was already being computed elsewhere in the
same module tree: `play-brief-narrative.ts`'s `tradeManagerNarrativeSection` builds a "Break
watch — lose $X" bullet via its internal `breakTrigger()` helper, reading the same
staleness-guarded spot/gamma-flip/put-wall/call-wall levels that also populate `envelope.levels`.
That computation was never wired into the `invalidation` fallback — a second real gap of the
"shared helper never forwarded the field" shape (`docs/audit/FINDINGS.md`'s #4101/`buildRichEnvelope`
precedent), not a duplicated-logic bug.

### Evidence

Live, 2026-09-09, three real board rows:

| PlayId | `envelope.invalidation` (before fix) |
|---|---|
| `SWING:NBIS` | `Trading-halt feed unavailable — desk will not open until halt/LULD data recovers.` |
| `SWING:CRCL` | `Trading-halt feed unavailable — desk will not open until halt/LULD data recovers.` |
| `SWING:MU` | `Trading-halt feed unavailable — desk will not open until halt/LULD data recovers.` |

All three already carried a real, differentiating technical level elsewhere in the very same
response (e.g. NBIS: gamma flip 248.53 / put wall 210.00 both present in `envelope.levels` and in
the "Watch levels" section text "Lose gamma flip **248.53** — dealer posture turns against
longs").

Regression test added to `src/lib/swing/play-brief.test.ts` (RED confirmed pre-fix via a manual
revert of the fix under test — the assertion fails with the exact gate-reason string returned
instead of the expected break-level string — then restored to GREEN): builds a WATCH/LONG play
with a `G-S12` gate block plus a live GEX put wall/flip, and asserts `envelope.invalidation`
equals the real "Break watch — lose 22.00 on a closing basis..." line, not the gate reason.

### Fix

Exported a new pure function, `resolveBreakInvalidation(ctx)`, from `play-brief-narrative.ts` —
the same staleness-guarded spot/flip/focal-level computation `tradeManagerNarrativeSection`
already used internally for its "Break watch" bullet (`breakTrigger()`), now reusable standalone.
Wired it into `play-brief.ts`'s `invalidation` fallback chain **before** the raw gate reason:

```ts
const invalidation =
  play.thesisBreak?.level === "break"
    ? play.thesisBreak.note ?? "Thesis break — structural invalidation fired."
    : resolveBreakInvalidation(ctx) ??
      play.gateBlocks?.[0]?.reason ??
      (bucket === "open" && play.exitPolicy?.stop_premium != null
        ? `Premium stop at ${fmtUsd(play.exitPolicy.stop_premium)}`
        : null);
```

The gate reason and premium-stop fallbacks are unchanged and still fire when no real level is
computable at all (no live spot, no walls/flip anywhere) — this only reorders precedence in favor
of a real level when one exists, it does not remove either fallback.

### Blast radius

Single call site — `play-brief.ts` is the only composer of the swing play-brief envelope, and
`resolveBreakInvalidation` is purely additive (a new export, no existing signature changed). No
other consumer of `breakTrigger()`/`tradeManagerNarrativeSection` is affected.

### Fix rationale

Reusing the already-tested `breakTrigger()` logic (guarded against exactly the staleness traps
`play-brief-narrative.test.ts` already covers — stale GEX-only walls/flip must not drive "Break
watch") was preferred over writing a second, parallel computation, per the same
duplicated-logic-is-blast-radius discipline as the rest of this audit toolkit. Left the gate
reason and premium-stop fallbacks in place rather than removing them — they are still the right
answer when literally no technical level is computable (e.g. brand-new watch candidate with no
spot at all), and the Largo product contract's absence principle says omission over fabrication,
not silence.

### Verification

`npx tsc --noEmit` clean. New test RED confirmed pre-fix (manual temporary revert), GREEN post-fix.
Full suite: `npm test` on Node 20 (`/opt/node20/bin`) — 13329 pass / 0 fail / 3 pre-existing skips.
