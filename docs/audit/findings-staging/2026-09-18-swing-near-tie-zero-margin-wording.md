> **kind:** `FINDING`

## Ask Largo swing brief's archetype near-tie line reads "beat X by only 0 pts" on an exact classifier tie — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) — found via the Ask Largo standing mandate's 5-engine health-check deep-dive |
| **Severity** | P3 (cosmetic wording only — no data-correctness or gating impact) |
| **PR** | fix/swing-near-tie-wording |

### Root cause

`whyThisSetupSection`'s archetype near-tie line (`play-brief-intel.ts`, in the `if (play.archetypeNearTie
&& whyArchetypeLabel)` block) always rendered `"**${whyArchetypeLabel}** beat **${secondaryLabel}** by
only ${marginPct} pts."` — but `marginPct` is `Math.round(margin * 100)` (`archetypeNearTieFromFeatureVector`,
`live-plays.ts:455`), and `margin` only has to clear `margin > ARCHETYPE_NEAR_TIE_MARGIN` (0.05) to be
excluded — a margin below 0.005 rounds to exactly 0, a real, reachable exact classifier tie broken by
priority order alone. "Beat X by only 0 pts" is self-contradictory at that value: a 0-point margin means
no beat occurred.

Live repro (real production data, authenticated Clerk session): CRWD OPEN position's live brief rendered
`"**Event-driven directional** beat **Sector rotation leadership** by only 0 pts."`

### Evidence

- `live-plays.ts:412` (`ARCHETYPE_NEAR_TIE_MARGIN = 0.05`) and `:448` (`margin > ARCHETYPE_NEAR_TIE_MARGIN`
  gate) — confirmed `margin` can be arbitrarily close to (including effectively) 0 while still passing the
  near-tie gate.
- `live-plays.ts:455` — confirmed `marginPct: Math.round(margin * 100)`, so `marginPct === 0` is reachable
  whenever `margin < 0.005`.
- Live CRWD repro as described above.
- RED→GREEN independently reproduced via `git stash` (fix isolated to `play-brief-intel.ts`): 168/169 fail
  pre-fix (the new assertion), 169/169 pass post-fix.
- `src/lib/swing/*.test.ts` full sweep: 1339/1339 pass.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single line, single section (`whyThisSetupSection`'s near-tie block). `archetypeNearTieFromFeatureVector`'s
underlying margin computation and gating are untouched — this only changes how the render layer phrases an
exact-tie result.

### Fix rationale

Special-cased `marginPct === 0` to render `"**${whyArchetypeLabel}** tied with **${secondaryLabel}**;
priority order broke the tie."` instead of the "beat by only 0 pts" wording, so the prose never claims a
"beat" with zero evidence of one, while every other near-tie margin (1-5 pts) keeps the existing wording
unchanged.

### Verification

Independently re-verified from scratch on a fresh branch off actual latest `origin/main` — RED/GREEN
independently reproduced via `git stash`; broader `swing/*.test.ts` sweep and `tsc --noEmit` both clean.
