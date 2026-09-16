## 2026-09-16 — [FINDING, P3 Night Hawk Legacy, live UI keyboard-nav bug — FIXED] `LegacyPickLogBoard`'s ArrowUp handler didn't re-clamp a stale selection index before stepping

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — both ArrowUp and ArrowDown now route through a shared `stepBoardSelectionIndex()` helper that re-clamps the current index into the list's present range before stepping. |
| **Severity** | P3 — real, reachable keyboard-navigation defect on the live board, not data-correctness. |

### What was broken

`LegacyPickLogBoard.tsx`'s keyboard-nav handler stepped `selectedIndex` differently per
direction:

```ts
if (e.key === "ArrowDown") {
  const next = Math.min(visibleRows.length - 1, selectedIndex + 1);
  ...
}
if (e.key === "ArrowUp") {
  const next = Math.max(0, selectedIndex - 1);
  ...
}
```

`ArrowDown` re-clamps against the list's *current* upper bound before stepping — `Math.min(visibleRows.length - 1, ...)` always lands in range no matter how stale `selectedIndex` is. `ArrowUp` only clamped the *lower* bound (0) — it decremented directly from whatever `selectedIndex` already held, with no re-sync to the list's current (possibly shrunk) upper bound.

Reachable sequence: select a row deep in a long filtered list (e.g. index 7), then change a filter/tab/search term that shrinks `visibleRows` to 3 rows. The existing selection-sync effect correctly clears `selectedRow` (the old key is no longer in `visibleRows`), but `selectedIndex` stays at 7. The next `ArrowDown` self-corrects immediately (`Math.min(2, 8) = 2`). The next `ArrowUp` does not: `Math.max(0, 7-1) = 6`, `visibleRows[6]` is `undefined`, so nothing gets selected and `selectedIndex` becomes 6 — still out of range. Each further `ArrowUp` press decrements by one more (6→5→4→3) with no row selected each time, until index 2 (the actual last valid index) is finally reached. A member pressing "up" after narrowing their filter sees several keypresses do nothing before the first row responds.

### Evidence

- Read the logic by hand and traced the exact keypress sequence above (index 7 → 3-row list → 5 wasted `ArrowUp` presses before a row selects).
- Checked the sibling `VectorPickLogBoard.tsx` (0DTE/Vector board) — it has the byte-for-byte identical unfixed handler. Not touched here (out of this lane's scope per CLAUDE.md's Legacy/0DTE/Swings lane boundaries) — flagging in the PR and journal for that lane's own audit to pick up the same fix.
- RED→GREEN proof: added `stepBoardSelectionIndex` to `vector-board-filters.ts` (a file already shared/imported by both Legacy's and Vector's board components) with a regression test asserting a stale index of 7 against a 3-item list steps to `1` on `ArrowUp` direction (not `6`). Temporarily reverted the function body to the pre-fix per-direction formula (`Math.min`/`Math.max` with no shared re-clamp) — confirmed 2 of 9 tests in the file fail (the stale-index-recovery case and an empty-list edge case), then restored the fix — all 9 pass.
- `npx tsc --noEmit` clean. Full `npm test` run (see PR).

### Fix rationale

Extracted the stepping logic into one pure, shared, unit-tested helper (`stepBoardSelectionIndex`) rather than patching the `ArrowUp` branch in place — the existing bug was exactly this kind of per-branch logic drifting out of sync, and a single shared function used by both directions structurally can't repeat that. Placed it in `vector-board-filters.ts` since that file is already imported by both `LegacyPickLogBoard.tsx` and (were that lane to adopt it) `VectorPickLogBoard.tsx` — no new file needed. Wired it into Legacy's own `ArrowDown`/`ArrowUp` branches only; `VectorPickLogBoard.tsx` is untouched (separate lane).

### Blast radius

Two files: the new pure helper (+test) in `vector-board-filters.ts`, and its two call sites in `LegacyPickLogBoard.tsx`. No data/business logic touched — pure UI keyboard-interaction robustness. `VectorPickLogBoard.tsx` (0DTE/Vector lane) carries the identical unfixed bug — flagged, not fixed here.
