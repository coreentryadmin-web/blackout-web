> **kind:** FINDING

## meridianCatalystSection missing the CLOSED-bucket 'current read, not what this trade traded under' disclosure its 6 sibling live-read sections already carry — FIXED

| **Status** | Fixed |
|---|---|

**Where:** `src/lib/swing/play-brief-intel.ts`, `meridianCatalystSection()` (~line 2749-2805).

**Root cause:** Every other "live read" section in this file that renders `ctx` data re-fetched
fresh at request time (not pinned to the trade's own era) unshifts a
`"_Current ... — not what this trade traded under._"` disclaimer when
`statusBucket(ctx.play) === "closed"`: `chartLevelsSection` ("_Current levels_"),
`flowIntelSection` ("_Current flow_"), `catalystsSection` ("_Current catalysts_"),
`gexPostureSection` ("_Current dealer posture_"), `wallDynamicsSection` ("_Current wall
activity_"), and `meridianPeerSection` itself ("_Current earnings peer lens_", fixed 2026-10-24
for the live repro SWING:GOOGL:58 CLOSED brief — that fix's own in-code comment explicitly
enumerates the 5 siblings it was matching).

`meridianCatalystSection` reads `ctx.meridian`, populated every request by
`fetchMeridianForTicker` in `play-brief-context.ts` regardless of the play's bucket
(OPEN/WATCH/CLOSED) — structurally identical to its 6 fixed siblings — but never checked
`statusBucket(ctx.play)` and never prepended the disclaimer, at any of its 4 return sites
(unavailable, no-items/"quiet calendar", dedup-emptied/"already covered above", normal-items). A
member reading a CLOSED play's brief could easily mistake a currently-quiet or currently-active
Meridian catalyst calendar read for the conditions the trade actually traded under — the exact
same misreading risk every one of the 6 sibling fixes above was written to close.

**Evidence:** confirmed by reading the current `main` source directly (no live repro needed — the
absence is structural: `statusBucket` is never referenced anywhere in the function body, vs. every
sibling function which references it at least once). Verified no existing test in
`play-brief-intel.test.ts` covered this path — the function's existing tests cover readMs-anchor
staleness, quiet-calendar wording, stale/future-skewed `as_of`, and the earnings-date dedup (audit
#16), but none test the CLOSED-bucket disclosure.

**Blast radius:** exactly one function, one file — `meridianCatalystSection` has no other callers
duplicating its logic (grepped the repo; `meridianPeerSection`, its sibling, is a structurally
separate function already fixed 2026-10-24).

**Fix rationale:** mirrored the established pattern exactly, same wording family as the other 6
sections ("_Current catalysts — not what this trade traded under._", matching `catalystsSection`'s
own wording since both surface catalyst-shaped content). Computed `closedPrefix` once near the top
of the function (`statusBucket(ctx.play) === "closed"` — both already in scope, same one-line check
every sibling fix used) and prepended it to `body` at all 4 return sites. No other field, gating
logic, dedup behavior, or staleness caveat changed — `closedPrefix` is additive and composes with
the existing `staleLead` (both can render together: closed + stale is a real, meaningful
combination, not mutually exclusive).

**Test:** `play-brief-intel.test.ts` — one new regression test
(`meridianCatalystSection: CLOSED bucket prefixes a current-not-as-traded disclosure (all 4 return
sites)`) covering all 4 return sites for CLOSED, plus an OPEN control at the unavailable and
normal-items sites proving the fix is a no-op for non-closed plays. Modeled directly on
`meridianPeerSection`'s own 2026-10-24 regression test. Verified RED→GREEN by `git stash`-ing the
source fix alone (fails with the exact pre-fix body text without it, passes with it restored).
Full `play-brief-intel.test.ts` file: 345/345 pass, 0 fail. `tsc --noEmit`: clean.
