> **kind:** FINDING

## Admin Operations System Vitals: UW Socket row labels "Live" while its own dot reads "not ok" — FIXED

**Status:** Fixed, regression test added (`src/components/admin/admin-uw-socket-vital.test.ts`).

### Root cause

`AdminOperationsDashboard.tsx` renders the UW flow socket's health in **two** places:

1. The `DataPipelineHealthTile`'s "UW Multiplex" panel (its own "UW Socket" row, line 472 at
   `main`):
   ```ts
   {uw?.initialized ? (uw.auth_failed ? "Auth Failed" : "Live") : "Offline"}
   ```
   Correctly distinguishes three states: not initialized, initialized-but-auth-failed, and
   initialized-and-clean.

2. The "System Vitals" panel's own "UW Socket" `VitalRow` (lines 803-804 at `main`):
   ```ts
   value={h?.websockets.unusual_whales.initialized ? "Live" : "Offline"}
   ok={h != null ? (h.websockets.unusual_whales.initialized && !h.websockets.unusual_whales.auth_failed) : null}
   ```
   The **label** only checked `initialized` — it never looked at `auth_failed` at all. The **dot**
   (`ok`) correctly required `initialized && !auth_failed`. These two expressions disagree exactly
   when a channel is initialized (socket connected) but `auth_failed` is true (UW rejected the
   subscription — e.g. a bad or rotated `UW_API_KEY`, the same condition
   `src/lib/ws/uw-socket.ts`'s `getUwSocketHealth()` tracks per-channel and rolls up into
   `auth_failed`/`auth_failed_channels`). In that state the row reads the word **"Live"** right
   next to a **red, pulsing "not ok" dot** — a direct visual contradiction on the one panel meant
   to give an operator an at-a-glance correct read of system health, while the sibling tile three
   panels over already gets the exact same signal right.

This is the same shape of bug the task description named: a degraded/auth-failed state rendered
as "Live" with only the dot color hinting otherwise, which is easy to miss or misread as "healthy,
slightly flickering" rather than "the flow feed has stopped authenticating."

### Evidence

New test `src/components/admin/admin-uw-socket-vital.test.ts`, exercising the extracted pure
helper `uwSocketVitalDisplay`:

- **RED:** temporarily reproduced the old buggy logic in `admin-uw-socket-vital.ts`
  (`value: initialized ? "Live" : "Offline"`, `ok: initialized && !auth_failed`, matching the
  pre-fix component code byte-for-byte) — 2 of 4 tests failed: the `{initialized:true,
  auth_failed:true}` case asserted `{value:"Auth Failed", ok:false}` but got `{value:"Live",
  ok:false}` (the exact label/dot contradiction), and the null-handling case also diverged (the
  old logic has no neutral `"—"` state at all — `uw == null` fell through to `"Offline"` instead
  of the honest "unknown" state the sibling tile's `uw == null ? "—" : ...` already uses).
- **GREEN:** restored the fixed implementation — 4/4 pass, including initialized+auth_failed now
  correctly reading `{value: "Auth Failed", ok: false}`.
- `npx tsc --noEmit` clean on the whole project (Node 20) after the change.
- `eslint` on the three touched files: 0 errors/warnings.
- Re-ran the moved/renamed test under the `--experimental-test-module-mocks` flag `npm test`
  itself always passes, confirming it loads correctly as a standalone node:test file.

### Blast radius

Single call site changed: the "System Vitals" panel's "UW Socket" `VitalRow` in
`AdminOperationsDashboard.tsx`. The sibling `DataPipelineHealthTile`'s own "UW Socket" row
(line ~472) was already correct and is untouched — it was the reference implementation this fix
mirrors, not a second instance of the bug. No API route, data shape, or `AdminHealthPayload`
field changed; this is purely a display-derivation fix.

### Fix rationale

Extracted the label+dot derivation into a small, pure, React-free helper,
`uwSocketVitalDisplay(uw)`, in its own module (`admin-uw-socket-vital.ts`) — following the
existing pattern of `admin-store-age.ts`/`admin-time-ago.ts` sitting alongside
`AdminOperationsDashboard.tsx` and imported into it. This was deliberate over inlining the fixed
ternary directly in the JSX (as the sibling tile does): a same-shape inline fix was tried first,
but importing the fix's regression test directly from `AdminOperationsDashboard.tsx` pulled in
that file's full transitive import graph (`AdminLaunchStatusPanel` → ... → `src/components/marks/
geometry.tsx`, which uses bare JSX without importing `React` and is only safe under the Next.js
bundler's automatic JSX runtime, not a standalone `tsx --test` run) and crashed with `ReferenceError:
React is not defined` — a tooling artifact, not a real failure, but one that would have made this
specific regression untestable in isolation. Moving the pure logic to its own non-component module
sidesteps that entirely (mirrors why `admin-time-ago.ts`/`admin-store-age.ts` already live outside
the component file) and gives both the "System Vitals" row and any future consumer one correct,
directly-testable source of truth instead of two independently-hand-written ternaries that can
drift apart again. The one-line explicit null→"—" case mirrors the sibling tile's own `uw == null ?
"—" : ...` precedent rather than inventing a new convention.

### Deliberately left unchanged

- `DataPipelineHealthTile`'s "UW Socket" row — already correct, used as the reference, not touched.
- `getUwSocketHealth()` / `uw-socket.ts` — the underlying health computation is correct and
  unrelated; this is purely a display bug in how an already-correct `auth_failed` flag was (and
  now is) read.
- The `Options WS` / `Polygon WS` vital rows directly above/below — spot-checked while in the file;
  both already fold their degraded conditions into their label (`"Down"`, `wsState` string), so
  neither reproduces this bug shape.
