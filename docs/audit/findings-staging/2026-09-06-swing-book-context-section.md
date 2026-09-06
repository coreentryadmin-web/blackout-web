## 2026-09-06 — [P2, product] Ask Largo brief missing book-concentration context — FIXED

> **kind:** `FINDING`

| Field | Value |
|-------|-------|
| **Status** | FIXED |
| **Area** | Swing Play Intelligence — book context (`play-brief-intel.ts`) |

### Root cause

Ask Largo v4 (#4076) and the trade-manager narrative (#4084) never surfaced whether a candidate **stacks or fights** theme concentration already in the member's open swing book. `checkPortfolioOverlap` existed for the entry gate but was not wired into brief composition.

### Fix

- Load `openBook` via `fetchOpenSwingPositions()` in `loadSwingPlayBriefContext`.
- Add `bookContextSection` — renders concentration / internal-conflict when theme overlap exists.
- Skip section when book is empty or no overlap (honest absence).

### Evidence

- `npx tsx --test src/lib/swing/play-brief-intel.test.ts` — 5/5 pass (concentration, conflict, self-match exclusion).
- Full swing brief suite — 26/26 pass post-fix.
