> **kind:** FINDING

## `JournalEditor` tracked a `dirty` draft flag but never read it — an admin could silently lose an unsaved note on tab-close or navigation — FIXED

**Status:** FIXED (PR, this branch)

### Root cause

`JournalEditor.tsx`'s `dirty` ref (`useRef(false)`) is set to `true` on every edit to the note
textarea or tags input, and reset to `false` on save and on re-seed — but nothing in the file ever
*read* `dirty.current`. Confirmed via `git log -p --follow`: the ref was introduced in the
component's original feature commit and has never had a consumer since (not a removed consumer —
it was simply never wired up). The practical effect: an admin types a trade-journal note, closes
the tab or navigates away before clicking "Save note," and the in-progress edit is lost with zero
warning, despite the code having tracked exactly the state needed to warn about it.

### Evidence

RED→GREEN (temp-file copy, not `git stash`, per this session's documented stash-collision hazard
on the shared sandbox working directory):
- Pre-fix: `createJournalBeforeUnloadHandler` doesn't exist — 2/6 tests in
  `JournalEditor.test.ts` fail (`TypeError: createJournalBeforeUnloadHandler is not a function`).
- Post-fix: 6/6 pass. Lint (`npx eslint`) and `tsc --noEmit` clean.

Confirmed via `grep -n "dirty" src/components/admin/JournalEditor.tsx` pre-fix: `dirty.current` is
assigned in 4 places, read in 0.

### Blast radius

Single file, single component (`JournalEditor`, rendered inside an expanded admin Outcomes row —
annotation-only, explicitly documented as "no money-path"). No other component reads or shares
this `dirty` ref.

### Fix rationale

Extracted the warn/don't-warn decision into a standalone, exported, directly-unit-tested
`createJournalBeforeUnloadHandler(dirty)` (mirroring this session's established pattern of testing
pure gate logic without needing a full component-render harness, since this repo has no React
Testing Library dependency), then wired it into a new `useEffect` that adds/removes a
`beforeunload` listener. Left `save()`'s own localStorage-fallback behavior (fixed by this
session's prior `JournalEditor` storage-guard PR) untouched — this fix only adds a warning on the
already-possible loss path, it doesn't change how saving or local caching works.
