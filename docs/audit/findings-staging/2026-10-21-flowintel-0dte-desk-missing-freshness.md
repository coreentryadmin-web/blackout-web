## flowIntelSection's "0DTE desk" cross-reference line was the one sibling line in "Flow & positioning" with zero freshness/status disclosure — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive (live-fetched real
swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, adversarially verified before acting)
focused on "Flow & positioning"/"Catalysts", not yet audited this session.

**Root cause:** `flowIntelSection` (`src/lib/swing/play-brief-intel.ts`) renders a "0DTE desk"
cross-reference line (direction/conviction/alignment) off `zerodteLiveForSession(eco.zerodte_today,
sessionDate)` with no age or status attached. `EcosystemZeroDteTake` carries `first_flagged_at` (a
real provenance timestamp) and `status` (a real lifecycle column — the same OPEN/HOLD/TRIM/CLOSED
idiom `zerodte_setup_log`/`swing_positions` both use), both fetched in the same ecosystem-context
query, but neither was ever read in rendering (confirmed by grep across
`play-brief-intel.ts`/`play-brief-narrative-coaching.ts`/`play-brief.ts`/`play-brief-narrative.ts`
— `z.status` never appears, `first_flagged_at` doesn't reach this rendering path at all). Every
other line in the SAME "Flow & positioning" section already discloses its own freshness: the HELIX
tape line states its own window (`HELIX tape (${f.window_hours}h)`), and both "Flow anomalies" and
"Notable prints" attach a per-item `relativeAgeLabel` bracket — the 0DTE line was the one sibling
with none. `zerodteLiveForSession`'s own gate is whole-session-date granularity only, so a 0DTE
setup flagged minutes ago and one that already stopped out hours earlier in the SAME session
rendered identically, with no way for a reader to tell them apart.

**Evidence:** Live repro: CRWV CLOSED's "Flow & positioning" body read "_Current flow — not what
this trade traded under._\n\n0DTE desk: **long** · **aligned**" — no timestamp, no status. A
pre-existing test-file comment (`play-brief-intel.test.ts`, dated 2026-09-22) independently
documented the same gap from a live MSTR repro ("a 0DTE desk alignment line with zero indication
any of it postdates the trade by weeks") — the fix that shipped from that finding only added a
blanket, section-wide, static "_Current flow — not what this trade traded under._" prefix for
CLOSED plays (confirmed present at `play-brief-intel.ts`); it never added per-line age/status
disclosure to the 0DTE line itself, and OPEN/WATCH-bucket plays never get the CLOSED-only prefix at
all — so this is a real, narrower gap the earlier fix didn't close.

**Fix:** `src/lib/swing/play-brief-intel.ts` — added an age bracket via the already-imported
`relativeAgeLabel(z.first_flagged_at)` (matching the exact sibling pattern "Flow anomalies"/"Notable
prints" already use) and a `" _(already closed)_"` caveat when `z.status === "CLOSED"`, appended to
both the condor and non-condor branches of the 0DTE desk line.

**Tests:** `src/lib/swing/play-brief-intel.test.ts` — three new tests: a CLOSED setup shows both
the age bracket and the closed caveat; a still-live (non-CLOSED) setup shows the age bracket with
no closed caveat; a CLOSED condor row also carries the caveat. Full suite confirmed unaffected for
the existing fixtures (none use `status: "CLOSED"`, so no existing assertion's output changes).
297/297 pass (up from 294 baseline). RED→GREEN proven via `git stash` on the source file alone (3
fail / 294 pass without the fix, 297/297 with it). `tsc --noEmit` clean.

**Blast radius:** `flowIntelSection`'s 0DTE desk line only — purely additive text on both of its
existing branches (condor and non-condor). No gating/alignment logic touched.
