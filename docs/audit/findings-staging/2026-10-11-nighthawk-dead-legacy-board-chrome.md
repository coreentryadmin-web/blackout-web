> **kind:** FINDING

## Night Hawk Legacy — whole orphaned `LegacyBoardChrome` component, superseded by `VectorBoardToolbar` — FIXED

**Symptom:** `LegacyBoardChrome.tsx` (a full toolbar/calendar-header component — edition
scope buttons, date picker, play-count meta, calendar strip) is fully unrendered. Zero
imports anywhere in `src/` outside its own definition, no test file.

**Root cause:** The component this was presumably built for, `LegacyPickLogBoard.tsx`,
imports and renders `VectorBoardToolbar` instead (`LegacyPickLogBoard.tsx:13,348`) — a
different toolbar component that does the same job. `LegacyBoardChrome` was added in
commit `7394c330c` ("feat(nighthawk): Legacy engine overhaul + Vector follow-ups #3286")
but never got wired into the board it shares a naming convention with, and was never
deleted once `VectorBoardToolbar` became the real one.

**Evidence:** `grep -rn "LegacyBoardChrome" src/` before the fix: only the component's own
definition. `grep -n "VectorBoardToolbar" src/features/nighthawk/components/LegacyPickLogBoard.tsx`
confirms the real toolbar in use.

**Fix:** Deleted `LegacyBoardChrome.tsx` entirely. Its only import,
`VectorBoardCalendar`/`VectorBoardCalendarBucket`, has other real callers elsewhere
(confirmed before deletion) — nothing orphaned by this removal.

**Fix rationale:** Pure deletion — a whole component with a confirmed, named replacement
already live in the one place that would have rendered it.

**Blast radius:** `src/features/nighthawk/components/LegacyBoardChrome.tsx` (deleted) only.

**Regression guard:** None needed — no removed component had production behavior to guard.
