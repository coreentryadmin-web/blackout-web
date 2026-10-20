## chartTechnicalsSection's VWAP side defaulted to "below" when spot was unknown instead of omitting the directional claim — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, Ask Largo standing mandate static-code sweep (Workflow correctness audit of
`play-brief.ts`/`play-brief-narrative.ts`/`play-brief-intel.ts`).

**Root cause:** `chartTechnicalsSection`'s own entry guard (`if (!vec?.technicals && vec?.spot ==
null) return null;`) is an AND of two negated conditions, which only short-circuits when BOTH
technicals is missing AND spot is null — the function deliberately continues when `technicals`
exists even though `vec.spot` is null (otherwise the guard would just be `if (!vec?.technicals)
return null;`). `displaySpot` can likewise resolve to null in the non-closed-bucket path. The VWAP
line computed `const side = displaySpot != null && displaySpot >= t.vwap ? "above" : "below";` —
this evaluates to `"below"` whenever `displaySpot` is null, not just when spot is genuinely below
VWAP; the `&&` short-circuit silently folded "unknown" into the "below" branch instead of omitting
the directional claim. This is inconsistent with the file's own established defensive convention a
few functions away — `chartLevelsSection`'s wall/flip lines only append a spot-relative clause when
spot is known, never asserting a side otherwise — and the Largo C3 absence principle this file cites
repeatedly (omit when you cannot determine, never fabricate).

**Live impact:** a Vector snapshot with `technicals.vwap` set but `spot: null` (reachable via the
entry guard above, or via the CLOSED-bucket GEX-fallback path's own `preferredGexWalls(ctx).spot`
resolving to null) rendered "VWAP **150.00** — price below session VWAP", asserting the position is
below VWAP when the actual current spot is completely unresolved — a fabricated directional claim
with no supporting data.

**Fix:** Omit the side clause entirely when `displaySpot` is null, rendering just "VWAP **$X**" with
no directional assertion, matching the file's convention elsewhere.

**Fix rationale:** Minimal — no new mechanism, just removing the `&&`-short-circuit's silent default
and rendering the bare level when the side cannot be determined.

**Blast radius:** Single conditional inside `chartTechnicalsSection`. No other call site computes
this side clause.

**Tests:** 1 new regression test — a vec with `spot: null` and `technicals.vwap` set renders the
VWAP level with no "above"/"below" side clause. RED→GREEN proven via `git stash` on just the source
file (test failed pre-fix — rendered "price below session VWAP" — passes post-fix). Full
`play-brief-intel.test.ts` (287 tests) green on Node 20. `tsc --noEmit` clean.
