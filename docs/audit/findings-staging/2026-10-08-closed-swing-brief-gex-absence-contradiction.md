## 2026-10-08 — [FINDING, largo-swing] A CLOSED play-brief claimed "no GEX read available" while a sibling section in the SAME envelope showed a stale-but-present one — FIXED

> **kind:** `FINDING`

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 (no wrong number served — the narrative wording overstated absence; no numeric level was fabricated or mis-shown) |
| **Component** | `src/lib/swing/play-brief-intel.ts` (`watchForSection`, the "Since it closed" section for a CLOSED swing play-brief) |
| **PR** | fix/closed-swing-gex-absence-wording |
| **Found via** | Ask Largo standing sub-mandate — this cycle's 5-engine live monitor, fetching fresh `GET /api/market/swing/play-brief` envelopes against `docs/audit/LARGO-PRODUCT-CONTRACT.md`'s ten points for NRG/ADSK/WING (OPEN/TRIM) and BE/NVDA (CLOSED), picking tickers not yet checked this session. |

### Root cause

`watchForSection`'s closed-bucket branch suppresses its gamma-flip/put-wall/call-wall lines
whenever the shared GEX matrix is stale (`flipFromStaleGex`/`putWallFromStaleGex`/
`callWallFromStaleGex`, each gated on `gexMatrixStale(...)`) — correct, since a stale "current"
read shouldn't be shown as current. But when every line is suppressed this way, the function fell
back to one fixed sentence regardless of WHY the lines were empty:

```
"No gamma flip / GEX wall read available for this name since the play closed."
```

That sentence claims outright absence. It does not distinguish the case this file already
distinguishes everywhere else in the Largo contract (C3): "we never computed this" vs. "we
computed it, but it's past our freshness cutoff and we're withholding it." `gexPostureSection` —
reading the exact same `ctx.ecosystem.gex_positioning` object, in the exact same request — already
has the honest version of this distinction: when the matrix is stale it renders `"**Last
snapshot** (~Ns old) — dealer posture may lag spot."`, explicitly saying a read exists. So the same
brief could (and, live, did) carry two sections that disagree about whether GEX data exists for the
ticker at all — one says "no read available," the other says "last snapshot ~163s old."

### Evidence

Live `GET /api/market/swing/play-brief?playId=SWING:NVDA:42&ticker=NVDA&positionId=42&status=CLOSED`
(2026-10-08, ~18:10 ET, post-close), a real closed position (stopped −55.9%, closed 2026-09-24):

- **"GEX posture" section:** `"_Current dealer posture — not what this trade traded under._\n**Last snapshot** (~163s old) — dealer posture may lag spot."` — discloses a read exists, just 43s past the 120s (`GEX_MATRIX_STALE_MS = VECTOR_STALE_MS = 120_000`) staleness cutoff.
- **"Since it closed" section, same envelope, same request:** `"No gamma flip / GEX wall read available for this name since the play closed."` — claims no read exists.

Both sentences are driven by the identical `ctx.ecosystem.gex_positioning` object and the identical
`gexMatrixStale` check — `gexPostureSection` returns early (`if (!gex) return null;`) when the
object is genuinely absent, so the fact that section rendered at all (with a concrete age) proves
the object was present, only stale. The "Since it closed" sentence was wrong specifically in the
"stale but present" case, which is the common one for any ticker whose GEX matrix isn't being
actively rebuilt every <2 minutes post-close (true of virtually every closed/inactive name).

### Fix rationale

Distinguished the two cases at the same point the lines are found empty: genuine absence
(`gexForLevels == null`) keeps the original "no read available" sentence; stale-and-withheld
(`gexForLevels != null && gexMatrixStale(gexForLevels, readMs)`) gets a new, honest sentence that
states the read exists and names its age, mirroring `gexPostureSection`'s own wording so the two
sections can no longer disagree about this fact:

```
"GEX read for this name is currently stale (~163s old) — today's dealer posture withheld, not absent."
```

Reused the already-imported `gexMatrixAgeMs`/`ageSecondsLabel`/`gexMatrixStale` helpers rather than
re-deriving the age — same helpers `gexPostureSection` itself uses, so the two sections can't drift
apart on the age computation either. Left the genuine-absence branch (no `gex_positioning` object
at all) untouched; left the "open"/"watch" bucket fallback untouched (that branch was never the
one disagreeing with anything — it says "no extra triggers wired," a different, already-accurate
claim).

**Blast radius:** `watchForSection` is the only place this specific fallback sentence is produced;
no other call site re-derives it. The fix is scoped to the `bucket === "closed"` branch only, so
OPEN/WATCH briefs are byte-identical to before.

### Evidence that the fix is real (RED → GREEN)

Added `watchForSection: closed-bucket fallback distinguishes stale-and-withheld GEX from genuine
absence (Largo C2/C3)` to `src/lib/swing/play-brief-intel.test.ts`, with two cases: (1) a present-
but-163s-stale `gex_positioning` object must NOT render "No gamma flip / GEX wall read available"
and must mention "stale" and the "163s" age; (2) an empty `ecosystem` object (no `gex_positioning`
at all) must still render the original "No gamma flip / GEX wall read available" sentence. Ran
against the pre-fix code via `git stash` on `play-brief-intel.ts` alone (test file kept): **210
pass / 1 fail**, the new test failing with `'No gamma flip / GEX wall read available for this name
since the play closed.'` unexpectedly matching the "must not claim absence" assertion — the exact
RED this fix closes. After restoring the fix: **211/211 pass**. Full `src/lib/swing/*.test.ts`
(1629 tests, 22 suites): 1629/1629 pass, no regressions. `npx tsc --noEmit` clean. Full `npm test`
run in progress at write time — recorded in the PR once green.
