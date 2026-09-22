> **kind:** FINDING

## Swing "Earnings peer lens" narrated peers' beat rates but never the subject ticker's own — FIXED

**Status:** FIXED (2026-09-22, Ask Largo × Night Hawk Swings standing mandate deep-dive)

### What was broken

`shapeMeridianPeerCohortForLargo` (`src/lib/largo/meridian-peer-cohort-for-largo-core.ts`) tags
the subject ticker's own historical print record onto `peer.members` as `is_subject: true`,
carrying its own `beat_rate` / `beat_rate_n` / `avg_reaction_pct` — computed by the exact same
engine as every peer row. `meridianPeerEarningsCoaching`
(`src/lib/swing/play-brief-meridian-peer-core.ts`) filtered that row OUT
(`.filter((m) => !m.is_subject && m.beat_rate_n >= 3)`) and narrated only OTHER tickers' beat
rates in the swing play brief's "Earnings peer lens" section. Live-verified: no other swing
brief section narrates it either (`grep -rn "is_subject" src/lib/swing/*.ts` outside this file
returned nothing) — this was a genuine, silent absence, not a duplicate of something already
shown elsewhere in the brief.

### Why this matters

A trader holding a swing position through its own earnings print is deciding whether to hold
through the print or trim/hedge before it. The single most decision-relevant historical number
for that call is "how has THIS ticker behaved on its own past prints" — not three unrelated
peers' beat rates. The brief showed the less-relevant number and silently dropped the
more-relevant one, even though both come from the identical, already-fetched data structure.

### Fix

`meridianPeerEarningsCoaching` now surfaces the subject's own line first — "this ticker's own
print history: N% beat (n=M), avg reaction ±X% (n=K)" — ahead of peer history, gated on the SAME
`beat_rate_n >= 3` sample-size floor peers already require (never fabricate a rate off a thin
sample, per the Largo product contract's absence principle) and independent of whether any peer
clears that bar, so a thin peer cohort no longer hides an otherwise well-sampled subject read.

### Evidence

- New regression tests in `play-brief-meridian-peer.test.ts`:
  - "surfaces the SUBJECT ticker's own beat rate/reaction, not just peers'" — RED→GREEN proven
    directly (git-stash the fix: 1/8 fails with the new test as the sole failure; restore: 8/8
    pass).
  - "omits the subject's own line when its sample is thin (never fabricates a rate)" — proves the
    omission-honesty floor holds.
- `npx tsc --noEmit` clean.
- Full suite run alongside this finding (see PR for exact pass count).

### Blast radius

Single function (`meridianPeerEarningsCoaching`), single file, additive only (new `parts.push`
line) — no existing behavior changed, no other call site renders `LargoPeerCohortMember` for a
swing brief.
