## 2026-09-22 — [FINDING, P3] Legacy banger risk_note claimed "cheap OTM weeklies" on a 25-DTE, non-cheap monthly — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Area** | Night Hawk Legacy — `bangerScaleOutNote` (`src/lib/zerodte/scale-out.ts`), wired from `buildDeterministicEditionPlays` (`src/features/nighthawk/lib/deterministic-edition.ts`) |
| **Severity** | P3 (narrative accuracy — member-facing text, not a selection/scoring/gating defect) |
| **Status** | FIXED |

### Root cause

Any Legacy play sourced from the whole-market breakout/banger discovery lane (`bangerTickers`) gets a scale-out `risk_note` via `bangerScaleOutNote()`. The function took no arguments and always appended the fixed sentence *"These cheap OTM weeklies spike then decay — the exit is the edge."* — regardless of the actual contract `pickChainContract` ultimately selected for that specific play. Banger-lane membership is a discovery-time classification, independent of contract selection, so nothing tied the wording to the real DTE/premium of the picked contract.

Found while pulling the live 2026-09-22 book to answer a separate, direct operator escalation about Legacy contract cost (see `2026-09-21-legacy-contract-cost-relaxed-oi-fallback.md`): ALAB's picked contract is the $340C, Oct-16 expiry (25 DTE), $30.23/share ($3,023/contract). The risk_note on that same play still said "cheap OTM weeklies" — false on both counts (25 DTE is a monthly, not a weekly; $30.23/share is exactly the too-expensive complaint already being tracked). A member reading the note would be told something untrue about the structure of their own position.

### Evidence

Live `GET /api/market/nighthawk/edition` (`edition_for: 2026-09-22`), ALAB play:
```
"dte": 25,
"options_play": "ALAB $340 CALL @ $30.23 — Oct 16, entry prem ~$30.23",
"entry_cost_per_contract": 3023,
"risk_note": "Banger exit — scale out, don't hold to expiry: realize 50% at 2×, trail the runner at 50% of its peak, hard stop −60%. These cheap OTM weeklies spike then decay — the exit is the edge."
```
`dte` (25) and `contract.premium` were both already in scope at the exact call site (`deterministic-edition.ts`, right after Workstream C's D1 DTE capture) — the mismatch was a missing wiring, not a missing data source.

### Fix

`bangerScaleOutNote()` now takes an optional `{ dte }` context:
- No context (every pre-existing caller — the whole-market weekly-banger board at `src/app/api/market/banger/board/route.ts`, where the descriptor genuinely is accurate by construction) → **byte-for-byte identical output** to before. Zero behavior change there.
- `dte <= 10` → same "weekly" framing (a near-term play genuinely reads as one).
- `dte > 10` → names the real DTE instead of claiming "weeklies": *"This 25-DTE contract can still spike and give the move back fast — the exit is the edge, not the target."*

The mechanical rule sentence (percentages/multiples from `SCALE_OUT_RULES`) is untouched in either branch — only the trailing descriptive sentence changes. `deterministic-edition.ts`'s single call site now passes `{ dte }` (the same `dte` already computed and attached to the play object).

### Blast radius

One other call site exists (`banger/board/route.ts`) — calls with no arguments, so it is provably unaffected (regression test asserts the no-context path is byte-for-byte identical to the original text). No selection, scoring, gating, or contract-choice logic is touched anywhere — this is prose-only.

### Tests

- `scale-out.test.ts`: 5 new cases — no-context byte-for-byte match, `dte<=10` keeps weekly framing, `dte>10` names the real DTE and never says "weeklies", `dte: null` falls back safely, and the mechanical-rule prefix is provably unchanged across both branches.
- `deterministic-edition.test.ts`: 1 new end-to-end case building real plays through `buildDeterministicEditionPlays` with a 4-DTE chain (stays "weekly") and a 25-DTE chain (names the real DTE, never says "weeklies").
- `banger/board/route.test.ts` (the other caller, mocks `bangerScaleOutNote`): passes unmodified.

Full suite: 15169/15172 pass (3 pre-existing skips), `tsc --noEmit` clean.
