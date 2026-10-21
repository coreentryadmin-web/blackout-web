## Unconditional closedFallback silently substituted an UNRELATED closed position when a positionId couldn't resolve — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief-ladder.ts`/`play-brief-diff.ts`/`play-brief-resolve.ts`, batch 17).

**Root cause:** `resolveSwingPlayForBrief`'s final fallback in `src/lib/swing/play-brief-resolve.ts`
— `const closedFallback = await loadClosedPlay(ticker, null); if (closedFallback) return {...};` —
ran unconditionally, with no check on whether the caller actually supplied a specific `positionId`
that simply failed to resolve through every earlier, more targeted lookup (the direct
positionId-based closed check, its duplicate, and the chain-root retry). `loadClosedPlay(ticker,
null)` ignores positionId entirely and returns whichever graded row for the ticker has the most
recent `graded_at` — a completely different trade than the one asked about. This directly
contradicted the function's own doc comment ("Resolve the exact TerminalPlay the member selected")
and is explicitly named as a known wrong-play failure mode by this file's own `resolveChainRootId`
header comment: "...or a `closedFallback` for an UNRELATED chain on the same ticker — the exact
'silently returns the wrong play' failure mode." The 2026-09-11 fix that comment describes
(`resolveChainRootId`) only narrows how often this path is reached for the multi-roll-chain case —
it does not remove the unconditional fallback for any OTHER resolution failure, e.g. a positionId
outside `fetchSwingPositionsRange`'s shared 90-day fetch window. Elsewhere in this codebase
(`play-brief-context.ts`), `null` from this function is already the recognized, correctly-handled
"honestly not found" signal — there was a working honest-absence path this fallback bypassed.

**Evidence:** ticker ABC has two separate closed swing chains: position #501 (closed outside the
90-day window — every positionId-based lookup correctly returns no match) and position #777
(closed 2 days ago, the only graded row the fetch window covers). A caller requests
`?playId=SWING:ABC&ticker=ABC&positionId=501`. Every targeted lookup fails to find #501 (correctly
— it's genuinely outside the fetch window), control falls through to the unconditional
`closedFallback`, which finds #777 and returns it as the answer. The caller is told about #777's
direction/contract/P&L while believing it answered the question about #501 — a silent Largo
identity-contract violation with no absence/error signal. Confirmed via a 2-vote adversarial verify
pass that independently traced the exact control flow (open-ledger miss → chain-root retry
no-op → both positionId-based closed checks miss → unconditional fallback hit) against the real,
current source and its real callers (the Largo tool wrapper and the HTTP route).

**Fix:** guarded the final ticker-wide fallback to only run when `positionId == null` — i.e. the
caller never asked about a specific position in the first place. An explicit, unresolvable
positionId now surfaces as honest absence (`null`), which the existing caller
(`loadSwingPlayBriefContext`) already handles correctly, rather than a silent substitute for an
unrelated chain on the same ticker.

**Tests:** `src/lib/swing/play-brief-resolve.test.ts` — added 2 regression tests: a positionId
that fails to resolve anywhere must return `null` (not the only other closed row for the ticker),
and (unchanged-behavior guard) no positionId supplied at all must still hit the ticker-wide
fallback. Both fail/pass appropriately against pre-fix source (RED, confirmed via `git stash` on
the source file alone) vs post-fix (GREEN); full `play-brief-resolve.test.ts` suite 25/25 pass;
`play-brief-context.test.ts` (the consumer of this function's `null` absence signal) 14/14 pass
unaffected; `tsc --noEmit` clean.

**Blast radius:** `play-brief-resolve.ts` only. The existing "ticker-only + status=CLOSED (no
positionId)" and "chain rolled TWICE" behaviors are unchanged (verified by the existing, still-green
tests covering both) since this guard only narrows the ONE path where a positionId was supplied and
failed everywhere else.
