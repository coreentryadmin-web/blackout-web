> **kind:** FINDING

## `use-admin-flag.ts` — `typeof sessionStorage` check lived outside its own try block — FIXED

**Status:** FIXED (follow-up to PR #6848, same day)

### Root cause

PR #6848 (merged earlier this session) fixed `readSessionAdminFlag`/`writeSessionAdminFlag`
(`src/hooks/use-admin-flag.ts`) to wrap `sessionStorage.getItem`/`.setItem` calls in try/catch,
degrading to a safe default on a thrown `SecurityError` instead of crashing. But the guard was
incomplete: both functions still had `typeof sessionStorage === "undefined"` as a **bare
short-circuit outside the try block**.

A later DISCOVERY-lane pass (the same session, on `DeckPanel`/`src/components/admin/AdminUi.tsx`,
PR #6853) proved — with a RED test — that some sandboxed-iframe contexts throw a `SecurityError` on
merely accessing the `sessionStorage` global getter, not only on calling a method on it. A `typeof`
check against such a global still touches the getter, so it can throw too. An outer-only check
therefore does not fully guard the hook: the very first line could throw before the try block is
ever reached, propagating out of a `useEffect` (write path) or a plain function call during render
(`sessionHint = readSessionAdminFlag(userId)`), defeating the entire point of PR #6848's fix.

### Evidence

Added `withGetterThrowingSessionStorage` (same technique as `AdminUi.test.ts`'s
`withThrowingSessionStorage`: `Object.defineProperty(globalThis, "sessionStorage", { get() {
throw new DOMException(...) } })`) to `use-admin-flag.test.ts`. Against pre-fix code: 2 new tests
failed with an uncaught `DOMException` escaping both `readSessionAdminFlag` and
`writeSessionAdminFlag`. Against fixed code: 6/6 tests pass.

### Blast radius

Only this one file — `DeckPanel` (PR #6853) already used the correct inside-the-try pattern from
the start, and `JournalEditor.tsx` (PR #6850) guards on `typeof window === "undefined"`, which does
not touch the storage getter and was confirmed not to share this gap.

### Fix rationale

Move both `typeof sessionStorage === "undefined"` checks inside their respective try blocks,
matching the pattern `DeckPanel`'s fix already established and proved correct. No behavior change
for a working `sessionStorage` — only closes the gap for the sandboxed/blocked-storage path.
