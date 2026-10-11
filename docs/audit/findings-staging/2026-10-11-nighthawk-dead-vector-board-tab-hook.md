> **kind:** FINDING

## Night Hawk — dead `useVectorBoardDetailTab` convenience hook — FIXED

**Symptom:** `VectorBoardDetailTabs.tsx` exported `useVectorBoardDetailTab(defaultTab)` —
a one-line `useState<VectorBoardDetailTab>(defaultTab)` convenience wrapper — alongside the
actively-used `VectorBoardDetailTabs` component. Zero callers anywhere, including within
its own file, and no test file.

**Root cause:** The real consumer, `VectorPlayDetailPanel.tsx`, manages its own
`useState<VectorBoardDetailTab>` directly rather than using this hook (confirmed via
`grep` — the hook's name matches nothing but its own definition). A leftover convenience
export nobody ended up calling.

**Evidence:** `grep -rn "useVectorBoardDetailTab" src/` before the fix: only the
definition line.

**Fix:** Removed the hook and its now-unused `useState` import. Left
`VectorBoardDetailTabs` (the component) and the `VectorBoardDetailTab` type untouched —
both confirmed live.

**Fix rationale:** Pure deletion — no gap left, since the real consumer already manages
its own state inline.

**Blast radius:** `src/features/nighthawk/components/VectorBoardDetailTabs.tsx` (one
export + its now-unused import removed) only.

**Regression guard:** None needed — no removed export had production behavior to guard.
