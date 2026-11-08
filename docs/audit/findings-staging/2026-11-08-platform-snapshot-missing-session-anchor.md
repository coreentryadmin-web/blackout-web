> **kind:** FINDING

# `getPlatformSnapshot`'s top-level `as_of` wrapper stamp had no ET session anchor (Largo C1 known gap)

| | |
|---|---|
| **Status** | FIXED |
| **Area** | `src/lib/platform/index.ts` / `PlatformSnapshot` (cross-service snapshot, direct Largo tool `get_platform_snapshot`) |
| **Severity** | P3 (data-completeness / Largo contract gap, not a crash) |
| **Round** | 427 |

## Root cause

`getPlatformSnapshot()` is the shared cross-service snapshot builder behind the `get_platform_snapshot`
Largo tool (`src/lib/largo/run-tool.ts:1307`), the `GET /api/market/platform/snapshot` route, Night
Hawk's `hunt-builder.ts`, and BIE's `full-platform-snapshot.ts`/`platform-context.ts`. It stamped its
top-level wrapper with a bare UTC instant and nothing else:

```ts
const as_of = new Date().toISOString();
const snapshot: PlatformSnapshot = { as_of };
```

This file was already listed in the Largo C1 session-anchor ratchet's `KNOWN_GAPS`
(`src/lib/largo/contract/session-anchor.test.ts`) as an open gap. Per that contract's own docblock:
after ~20:00 ET the UTC *calendar date* is already tomorrow, so any consumer resolving "today's
session" purely from `as_of`'s own date reads a full session ahead for the last ~4 hours of RTH —
the same inversion class fixed in #2418/#2420/#2422 and, this session, in #7593/#7595/#7596/#7597.

Notably, the `flows` SUB-OBJECT one level down (`FlowTapeSummary.session_date`, CQ-083) already
carries exactly this anchor — so the wrapper that `get_platform_snapshot` returns was internally
inconsistent: a nested field disclosed its own ET session honestly while the wrapper stamp around
it did not.

## Evidence (RED → GREEN)

With the `KNOWN_GAPS` entry for `src/lib/platform/index.ts` removed but `index.ts` itself left
unanchored, the ratchet's own "no NEW Largo payload stamps a UTC instant without an ET session
anchor" test fails, naming `src/lib/platform/index.ts` as the offender (confirmed live by
reverting the code fix while keeping the allowlist deletion). Restoring the fix and re-running all
7 `session-anchor.test.ts` subtests plus the new `src/lib/platform/index.test.ts` regression test
passes clean (`9 pass / 0 fail`). `tsc --noEmit` is clean project-wide.

## Blast radius

- `src/lib/platform/types.ts` — `PlatformSnapshot.session_date: string | null` added (new,
  required field, additive).
- `src/lib/platform/index.ts` — `getPlatformSnapshot` now derives both `as_of` and `session_date`
  from the SAME `Date.now()` instant (`nowMs`), so the two fields can never describe different
  moments.
- `src/lib/bie/platform-context.ts` — the ONLY other literal `PlatformSnapshot` construction site
  (`emptySnapshot()`, a fast-path fallback used when the desk-only path skips the full snapshot).
  Making `session_date` required surfaced this via `tsc`. Fixed with `session_date: null` —
  **deliberately not** re-derived from this function's own `as_of` parameter, because this same
  file already carries ITS OWN separate, still-open `KNOWN_GAPS` entry (its own unrelated
  `const as_of = new Date().toISOString()` a few lines below, in `loadDeskPlatformContext`) and the
  C1 scanner matches on whole-file text, not per-function: calling the shared ET-session helper
  anywhere in the file would have satisfied the scanner's `HAS_ET_ANCHOR` regex and silently
  marked that OTHER, still-real gap as fixed without actually touching it. Verified this trap live
  while building the fix — an earlier draft that called the helper in `emptySnapshot()` caused the
  ratchet's "known-gap list SHRINKS" test to (wrongly) demand removing `platform-context.ts` from
  `KNOWN_GAPS` even though its real gap was untouched. `null` is the honest choice here per the
  Largo product contract's absence principle (an omitted field is honest; a borrowed/fabricated
  one is not).
- `src/lib/largo/contract/session-anchor.test.ts` — removed the now-closed
  `"src/lib/platform/index.ts": "coordinator"` entry.

**Separately noticed, not fixed here (one-issue-per-PR):** `src/lib/largo/platform-snapshot-fit.ts`
(`fitPlatformSnapshotForModel`, applied only on the `get_platform_snapshot` Largo tool path) copies
`nighthawk`/`largo`/`flows`/`spx` into its fitted result but never forwards `as_of` or the new
`session_date` at all — so even after this fix, the Largo-tool-facing response still omits both
top-level stamps (product consumers calling `getPlatformSnapshot()` directly, e.g. the
`/api/market/platform/snapshot` route and `hunt-builder.ts`, get the full unfitted object and do
see the new field). Flagging for a follow-up rather than fixing inline, since it's a distinct bug
(a dropped field in the Largo transport-fitting layer) from the one this PR closes (a missing
anchor on the field itself).

## Fix rationale

Additive per the contract's own rule: `as_of` is unchanged byte-for-byte, `session_date` is a new
field anchored to the identical instant via the shared `etSessionDate()` helper
(`@/lib/largo/temporal/bar-session-date`), and the now-closed `KNOWN_GAPS` entry is removed. No
alternative considered — this is the same mechanical pattern as the four prior C1 fixes this
session (#7593/#7595/#7596/#7597).
