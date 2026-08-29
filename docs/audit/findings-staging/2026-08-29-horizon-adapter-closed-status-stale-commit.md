## A closed 0DTE play could be silently re-rendered COMMIT on the unified board — FIXED

> **kind:** `FINDING`

| **Status** | FIXED in `fix/horizon-adapter-closed-status-stale-commit` |
| **Severity** | P1 — real position status shown on the unified Night Hawk board |
| **Surface** | `src/lib/zerodte/horizon-adapter.ts` `zeroDteCommitStatus` |

### Root cause

`zeroDteCommitStatus` decides COMMIT vs WATCH in priority order: (1) a persisted live status of
OPEN/HOLD/TRIM, (2) else the fresh gate verdict, (3) else an ungated score-vs-floor fallback for
"an already-seen refresh ticker whose gate wasn't re-run" (per the function's own doc comment).

`CLOSED` is deliberately **not** a member of `COMMITTED_STATUSES` (`{OPEN, HOLD, TRIM}`), so a
`persistedStatus` of `"CLOSED"` fails step 1's check — but the code then fell straight through to
steps 2/3 exactly as if no persisted status existed at all, losing the fact that this ticker's
position is **already closed**. If a closed ticker got re-flagged by a later scan pass with no
fresh gate context (real: the exact case the fallback's own comment describes) and its raw score
happened to sit at or above the lane floor, step 3's ungated fallback had no way to know the
position was closed and rendered it `COMMIT` again — falsely showing a real, already-closed
position as freshly committed on the unified board.

The existing test suite never caught this because its one CLOSED-status test
(`horizon-adapter.test.ts`, "a persisted live status... reads as COMMIT even when the gate context
has aged out") used a score *below* the lane floor for the CLOSED case, so it passed by coincidence
of the score check rather than because CLOSED was actually handled.

### Evidence

New test: `setup({ score: 78, gate: null })` (score ≥ the 65 floor, no fresh gate context) with
`persistedStatus: "CLOSED"` returned `status: "COMMIT"` before the fix (confirmed by running the
old code against this exact input) — now correctly returns `"WATCH"`. 10/10 tests pass in
`horizon-adapter.test.ts`, `npx tsc --noEmit` clean.

### Blast radius

Single function, single call site chain: `zeroDteCommitStatus` is only called from
`zeroDteSetupToHorizonPlay` (same file), which is the sole path `zeroDteSetupsToHorizonPlays` and
`horizon-board-from-payload.ts` use to build the unified ZERO_DTE lane. `PlayStatus` only has two
values (`COMMIT` | `WATCH`), so `WATCH` is the correct terminal rendering for a closed position —
there is no third "closed/historical" state on this board today.

### Fix rationale

Added an explicit `if (upperStatus === "CLOSED") return "WATCH";` check between the committed-status
check and the gate/score fallback, so a closed position is never re-evaluated by gate or score —
it is terminal. No alternative considered: `CLOSED` carries strictly more information than "unknown
status" and must never be treated as equivalent to it.
