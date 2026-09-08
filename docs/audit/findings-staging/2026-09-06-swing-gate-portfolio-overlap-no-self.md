> **kind:** FINDING

## Swing gate: uncommitted candidate treated lone same-ticker row as self-match — FIXED

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing entry gate soft penalty (`gates-pr5.ts`) |
| **Follow-up to** | `2026-09-06-portfolio-overlap-self-match-swallows-real-concentration.md` |

### Symptom

`checkPortfolioOverlap`'s first-match self-exclusion is correct for Ask Largo (`play-brief-intel.ts`), where the reviewed play is always part of `openBook`. At the gate call site the candidate is an **uncommitted** dossier with no row in `existingPositions` — skipping the first ticker+direction match wrongly hid a lone pre-existing same-name/same-side position from the `portfolio_overlap` soft penalty.

### Fix

- `checkPortfolioOverlap` accepts optional `{ excludeSelfMatch?: boolean }` (default `true`).
- `gates-pr5.ts` passes `{ excludeSelfMatch: false }` so every matching row counts.

### Evidence

- `portfolio.test.ts`: lone EWZ LONG with `excludeSelfMatch: false` → `hasOverlap === true`.
- `gates-pr5.test.ts`: NVDA LONG candidate + lone NVDA LONG in book → `portfolio_overlap` penalty.
