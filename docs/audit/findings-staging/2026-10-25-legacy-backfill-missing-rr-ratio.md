## 2026-10-25 — [FINDING, P3 Night Hawk Legacy] BACKFILL-tier Legacy edition plays never got a structured `rr_ratio` field, even though the same function already computed it for their thesis prose — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Severity** | P3 — member-visible presentation gap, not a data-correctness or financial-math error. A BACKFILL-tier play's R:R is real and correctly computed (it's in the thesis text); it just never reached the structured field a UI stat row reads. |
| **Component** | `src/features/nighthawk/lib/play-backfill.ts` — `selectBackfillPlays`'s per-candidate play construction |
| **Trigger** | Standing Ask Largo × Night Hawk Swings/Legacy ownership mandate (CLAUDE.md), 5-engine live monitor cycle — live check of `GET /api/market/nighthawk/edition` for 2026-10-26. |

### Root cause

Two call sites build a `PlaybookPlay` for a Legacy edition: `buildPlay` and `buildRescuePlays`
(both `deterministic-edition.ts`) construct their own `base: PlaybookPlay` object directly and both
explicitly set `rr_ratio: computeRiskReward({direction, ...levels}) ?? undefined`. `play-backfill.ts`'s
`selectBackfillPlays` instead routes BACKFILL-tier candidates through `mapClaudePlayToEdition`
(`claude-edition.ts`), whose own `base: PlaybookPlay` object literal never sets `rr_ratio` at all —
confirmed by reading its full body (`src/features/nighthawk/lib/claude-edition.ts:69-85`), which has no
`rr_ratio` key. `play-backfill.ts` never added it afterward either.

The gap is real but narrow: `buildDeterministicThesis` (used by ALL THREE paths, including
`play-backfill.ts`, with the identical `levels` object) already calls `computeRiskReward` internally
to embed the "R:R X:1" sentence in the thesis prose (`deterministic-edition.ts:700-711`) — so the
number exists and is correct, it simply never also lands on the structured field for this one path.

### Live evidence

`GET /api/market/nighthawk/edition` for `edition_for: 2026-10-26`, PLTR (`selection_tier: "BACKFILL"`,
`gate_promoted: true`):
- `thesis`: `"...R:R 0.9:1 (acceptable)...."` — a real, correctly-computed number.
- `rr_ratio` field: **absent from the JSON entirely** (present and correct on the SAME edition's CRWD
  and NET rows, both `selection_tier: "QUALIFIED"`).

Manually verified the embedded 0.9 is right using `computeRiskReward`'s own worst-case-fill-edge
convention: entry_range `$195.77-$197.73`, stop `181.01`, target `212.94` → fill edge (LONG, band top)
`197.73` → risk `197.73-181.01=16.72`, reward `212.94-197.73=15.21` → `15.21/16.72=0.910` → rounds to
`0.9`, matching the prose exactly.

### Blast radius

Two consumers read `play.rr_ratio` and silently degrade (not error) when it's absent:
- `PlaybookBriefingPanel.tsx:209-214` — the member-facing "R:R" stat `<li>` is gated on
  `play.rr_ratio != null` and simply does not render for a BACKFILL play, so the briefing panel for
  this play has one fewer stat row than an organic QUALIFIED pick, with no indication why.
- `play-explainer.ts:89` — the "Risk/reward ratio: X" line in the AI-explainer output is likewise
  dropped.

Neither call site errors or shows a placeholder — the field is just quietly thinner for this one
selection tier, which is exactly the "a section that could be richer" class of gap the standing Ask
Largo mandate asks to keep digging for, not a financial-correctness defect (the member isn't shown a
wrong number — they're shown no structured number, while the correct one sits right there in the
thesis paragraph above it).

### Fix

`play-backfill.ts` already imports `buildDirectionalStockLevels` from `./play-levels` (the same file
`computeRiskReward` lives in) and already has `levels`/`scored.direction` in scope at the exact point
it calls `buildDeterministicThesis`. Added one more named import (`computeRiskReward`) and one more
field on the play object — `rr_ratio: computeRiskReward({direction, entry_range, target, stop}) ?? undefined`
— using the identical call shape `buildRescuePlays` already uses, so the structured field and the
thesis prose's own "R:R X:1" sentence are now guaranteed to agree (same function, same inputs), never
just both-present-but-disagreeing.

### Fix rationale

No new derivation was invented — the real value was already being computed one line above (inside
`buildDeterministicThesis`) for the SAME `levels`; the gap was purely "the caller never also reads it
into the structured field for this one path," mirroring the BACKFILL play's existing pattern of
reusing `buildDeterministicThesis` for the thesis itself. Deliberately did not change
`mapClaudePlayToEdition` itself (it's shared by potential future raw-`ClaudePlayRaw` callers that may
not have a `levels` object in the same shape) — the fix lives at the one call site that actually has
the data, same discipline as every other additive fix in this codebase's history.

### Test

`src/features/nighthawk/lib/play-backfill.test.ts` — new regression test asserts a BACKFILL-tier
play's `rr_ratio` is non-null and matches `computeRiskReward` computed independently from the same
play's own `entry_range`/`target`/`stop`, with a sanity check that the thesis prose still carries its
own "R:R X:1" sentence (proving the two can never silently diverge in opposite directions).
RED confirmed pre-fix (`git stash` on `play-backfill.ts` only → 1 fail/30 pass); GREEN post-fix
(31/31 pass). Full suite + `tsc --noEmit` run before merge.
