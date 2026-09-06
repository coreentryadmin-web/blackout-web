## 2026-09-06 — [FINDING, shared UI, P4] 4 unused motion components in `src/components/ui/motion/` — FIXED

> **kind:** `FINDING`

### Symptom

Found during a DISCOVERY-lane sweep of shared, non-desk-specific UI components (`src/components/**`,
excluding `admin/`, already swept) for dead code.

### Root cause

`src/components/ui/motion/` carried four fully-built, non-trivial components with zero real
consumers anywhere in the repo:

- `Marquee.tsx` — re-exported from `src/components/ui/index.ts`, but the only references
  repo-wide were the definition itself and that barrel re-export line.
- `NumberTicker.tsx` — same pattern (count-up animation component).
- `ProductGallery.tsx` — same pattern.
- `ProductScroller.tsx` — not even re-exported from the barrel; zero references anywhere outside
  its own file.

Verified via `grep -rln "<Component>" --include="*.ts" --include="*.tsx" --include="*.mdx" .`
(excluding `node_modules`) before removal: each matched only its own file plus (for three of the
four) the barrel export line. `BorderBeam` and `RetroGrid` from the same `ui/motion` folder are
actively consumed elsewhere (verified) — this is not a "whole folder is dead" situation, only
these four specific components.

### Fix

Deleted all four component files and their three barrel re-export lines from
`src/components/ui/index.ts`. No test files existed for any of them.

### Evidence

- `grep -rln` for each component name, repo-wide, before removal: definition + (for 3 of 4) barrel
  export only. Same grep after removal: 0 files.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

`src/components/ui/motion/{Marquee,NumberTicker,ProductGallery,ProductScroller}.tsx` (deleted) and
`src/components/ui/index.ts` (3 export lines removed). No other file imports any of the four.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
