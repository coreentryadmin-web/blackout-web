## Ask Largo swing play-brief: a Meridian catalyst/peer-cohort read that times out collapses to the SAME `null` as a legitimate "no data" read — the outer race around two already-absence-aware fetches silently ate their own disclosure — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `fetchMeridianForTicker` (`src/lib/swing/play-brief-meridian.ts`) and
`fetchMeridianPeerForBrief` (`src/lib/swing/play-brief-meridian-peer.ts`) each already handle their
own failures honestly: both wrap their real upstream read in a `try/catch` and, on a thrown error,
return a typed sentinel (`{ unavailable: true, items: [], total_matched: 0 }` /
`{ available: false, error: "fetch_failed", ... }`) rather than `null` — exactly the shape
`collectBriefUnavailableSources` (`play-brief-absence.ts`) checks via `ctx.meridian?.unavailable` /
`ctx.meridianPeer?.available === false` to push a disclosed "Meridian catalysts ... timeline read
failed" / "Meridian peer cohort ... fetch_failed" chip into `envelope.unavailableSources` (the one
place the UI's `UnavailableChip` and Largo both read absence from).

But `play-brief-context.ts` wraps BOTH calls in a second, OUTER
`withBriefSourceTimeout(...).catch(() => null)` race (added 2026-09-22, PR performance fix, to bound
a read that had shown real p99 stalls to 90-104s — see that file's own header comment). That outer
race's `.catch()` collapsed ANY rejection reaching it — in practice, almost always its own 8s
timeout firing, since neither wrapped function itself ever rejects — to a bare `null`. For
`ctx.meridian`, `null` has no legitimate meaning at all: `fetchMeridianForTicker`'s own
implementation never returns it (every path returns a real slice, even its own internal-failure
path). For `ctx.meridianPeer`, `null` is ALSO the function's own, far more common, perfectly
legitimate "no nearby earnings catalyst to look peers up for" return — so the outer timeout's bare
`null` is not just undisclosed, it is indistinguishable from the single most common non-failure
state that field holds. `collectBriefUnavailableSources` has literally no branch for either case
(`null?.unavailable` / `null?.available` both evaluate to `undefined`, which is falsy) — a timed-out
Meridian read renders as a brief with no Meridian section and NOTHING in `unavailableSources`
explaining why, the exact Largo C3 ("never return `[]`/`null`/`{}` for unavailable... any fallback
that returns a degraded result the caller cannot distinguish from a real one is a defect even when
every test passes") violation this lane has already fixed for `ecosystemFetchFailed`/
`vectorFetchFailed` on the immediately adjacent lines of the SAME file — the 2026-09-22 performance
fix reopened the identical gap for Meridian specifically, one layer removed from where the original
fix pattern lives.

**Evidence.** Traced the full call graph in `play-brief-context.ts`:
`const meridianPromise = withBriefSourceTimeout(fetchMeridianForTicker(ticker)).catch(() => null);`
and `withBriefSourceTimeout(fetchMeridianPeerForBrief(meridian, ticker)).catch(() => null)` chained
off it. Confirmed `fetchMeridianForTicker`'s body has exactly two return paths (both real slices,
never `null`) and `fetchMeridianPeerForBrief`'s body has its own internal `try/catch` producing
`{available:false, error:"fetch_failed", ...}` on a real upstream throw — so the ONLY way either
promise given to `withBriefSourceTimeout` can reject is the wrapper's own 8s timer. Confirmed
`collectBriefUnavailableSources`'s meridian/meridianPeer checks read `ctx.meridian?.unavailable` /
`ctx.meridianPeer?.available === false` with no `null`-specific branch, and the existing unit test
(`play-brief-absence.test.ts`, "Meridian timeline failure surfaces in envelope") only ever
constructs the `unavailable:true` shape directly — never `meridian: null` — so the undisclosed path
had no coverage. A companion test in `play-brief-absence.test.ts`
("`meridianCatalystStale`: null slice is not stale (absence is a separate signal)") even names the
expectation that absence should be "a separate signal" while no code implemented one for this
specific path. Reproduced with a git-stash RED→GREEN pair of regression tests in
`play-brief-context.test.ts` (mocking `fetchMeridianForTicker`/`fetchMeridianPeerForBrief` to reject,
exercising the exact same `.catch()` chain a real 8s timeout drives) — both FAIL against the
pre-fix code (`ctx.meridian`/`ctx.meridianPeer` come back `null`) and PASS after the fix (both carry
the real disclosed-failure sentinel), isolated via
`git stash push -- src/lib/swing/play-brief-context.ts src/lib/swing/play-brief-meridian.ts src/lib/swing/play-brief-meridian-peer.ts`
/ `git stash pop` (never the test files).

**Blast radius.** Both call sites live in the same function (`loadSwingPlayBriefContext`,
`play-brief-context.ts`) and share the identical root cause (the 2026-09-22 perf-fix's outer
timeout race), so both are fixed together rather than fixing one and leaving the other — the exact
"duplicated logic in a second file/call site counts, fix and note all of them" blast-radius
discipline this repo's PR write-up policy calls for. No other call site in the repo wraps either
function in its own independent timeout race (confirmed via grep for both function names
repo-wide) — `play-brief-resolve.ts`/other swing files never call them directly, only
`play-brief-context.ts` does. The archetype-track-record/roll-history/ticker-track-record reads in
the SAME `Promise.all` are explicitly, correctly exempt from this fix: each carries its own doc
comment stating they are deliberately best-effort with "no dedicated `*FetchFailed` flag because a
miss here is never surfaced as an absence/error to the member" (an ungraduated/cold track record
omits its section the same as a position with no track record to cite at all, which is a different,
intentional design choice, not an oversight) — Meridian catalyst/peer data has no such exemption
documented anywhere, and already had the opposite design intent (its own internal catch disclosing
failure) before this outer race accidentally undid it.

**Fix rationale.** Extract the exact sentinel each function's own internal catch already produces
into a small exported helper (`meridianUnavailableSlice()` in `play-brief-meridian.ts`,
`meridianPeerUnavailableSlice()` in `play-brief-meridian-peer.ts`) and have `play-brief-context.ts`'s
outer `.catch()` call that helper instead of returning a bare `null`. This converges the OUTER
timeout failure path onto the exact SAME disclosed shape the INNER failure path already uses — no
new `ctx` flag, no change to `collectBriefUnavailableSources` (which already knows how to render
this shape correctly), and no risk of the two failure paths drifting into two different-looking
"Meridian is broken" messages. Deliberately did NOT add a parallel `meridianFetchFailed` boolean
(the pattern `ecosystemFetchFailed`/`vectorFetchFailed` use) — those two fields exist because
`ecosystem`/`vector` being `null` has no internal "I tried and failed" sentinel of their own to
converge on; Meridian already has one, so reusing it is more minimal and keeps exactly one source
of truth for "what does a Meridian failure look like" instead of introducing a second. Left
unchanged: `fetchMeridianPeerForBrief`'s own two legitimate `null` early-returns (no catalyst item /
no nearby earnings) — those are real, common, honest absences, not failures, and remain `null`
exactly as before; only the OUTER race's failure path changed.

**Evidence of no regression.** `npx tsc --noEmit` (Node 20): clean. Targeted tests —
`play-brief-context.test.ts` (13 pass, incl. 2 new), `play-brief-meridian.test.ts` (3 pass, incl. 1
new), `play-brief-meridian-peer.test.ts` (10 pass, unchanged), `play-brief-absence.test.ts` (102
pass, unchanged) — all green. Full swing play-brief suite
(`src/lib/swing/play-brief*.test.ts`, 15 suites / 939 tests): all pass. Full `npm test` (Node 20,
`scripts/run-tests.mjs`): see companion run-log entry for the exact count.
