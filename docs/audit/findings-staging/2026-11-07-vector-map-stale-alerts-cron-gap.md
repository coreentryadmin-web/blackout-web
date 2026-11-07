> **kind:** FINDING

## 2026-11-07 — `docs/audit/VECTOR-MAP.md` §7/§10 described the `vector-alerts` cron as an open, unexplained scheduling gap that PR #2651 already closed on 2026-08-22 — FIXED (docs)

| **Status** | FIXED on `fix/vector-map-alerts-doc` (docs-only) |
| --- | --- |

**Symptom:** `docs/audit/VECTOR-MAP.md` §7 ("Crons — declared six, deployed four") described
`vector-alerts` as:

- a row verdict of **"Unscheduled and unexplained"**;
- prose stating *"`vector-alerts` is a real gap, and it is this lane's. `cron-schedule-coverage.mjs`
  lists it under 'UNSCHEDULED AND UNEXPLAINED — a feature may be silently dark'"*;
- a quoted in-code comment on `VectorPageShell.persistRules` — *"The mirrored copy is what
  `/api/cron/vector-alerts` reads to fire push alerts to a closed tab."* — presented as the current
  live comment;
- a stated remedy: *"Correct fix is one of: list it in `INTENTIONALLY_UNSCHEDULED` with the flag as
  the reason, or deploy + enable it deliberately. Leaving it unlisted is exactly what that tool's
  own message warns about."*

§10 (the ranked UNKNOWNs queue) item 3 repeated this as still open: *"`vector-alerts`: list as
intentional, or deploy and enable. §7."*

**All of this was already fixed before the map's own last line was ever committed.** PR #2651
("fix(vector/ops): say out loud that vector-alerts is dormant — in the coverage audit, and in the
comment that promised closed-tab push") merged **2026-08-22 17:39:04 -0700**. It (a) added a
`vector-alerts` entry to `scripts/audit/cron-schedule-coverage.mjs`'s `INTENTIONALLY_UNSCHEDULED`
map, with the exact reasoning the map's own remedy paragraph asks for, and a backlink to
`docs/audit/VECTOR-MAP.md` section 7; and (b) rewrote the `VectorPageShell.persistRules` comment
the map quotes, because that comment stated the closed-tab delivery as a live guarantee it never
was.

The map's own commit history makes the staleness window exact: `VECTOR-MAP.md`'s most recent
revision before this fix, PR #2658 ("the full-state transport fit is FIXED, and the RTH
confirmation is still owed"), merged **2026-08-22 17:52:44 -0700** — **thirteen minutes after**
#2651 landed — and touched sections 6 and 10 (correcting the `get_vector_analytics` size estimate
and marking the transport-fit item fixed) but never came back to section 7's `vector-alerts`
paragraph, which has read "unexplained" ever since, now for over ten weeks, despite the map's own
charter: *"when this file and the code disagree, the code wins and this file is a bug."*

**Verification against current `main` (post-#2651, re-checked 2026-11-07):**

```
scripts/audit/cron-schedule-coverage.mjs:53:  "vector-alerts":
scripts/audit/cron-schedule-coverage.mjs:54:    "Inert without VECTOR_ALERTS_PUSH, which is NOT set in blackout-production/app/env
       (verified 2026-08-22 by key name) — the route returns {ok:true,inert:true} even when called,
       so scheduling it would change nothing. ... See docs/audit/VECTOR-MAP.md section 7."
```

```
src/features/vector/components/VectorPageShell.tsx:556-564 (current persistRules comment):
  "WHAT THE MIRROR IS FOR, AND WHAT IT IS NOT DOING TODAY. `/api/cron/vector-alerts` reads
  this copy to push alerts to a CLOSED tab. That cron is dormant on two independent counts,
  both verified 2026-08-22: it has no deployed EventBridge rule, and `VECTOR_ALERTS_PUSH` is
  not set in production... this comment used to state the closed-tab behaviour as a live
  guarantee, which it is not."
```

`git log --follow -p -- scripts/audit/cron-schedule-coverage.mjs` confirms the `vector-alerts`
entry was added in the #2651 commit on 2026-08-22, and it is still present on `main` today — it was
never reverted. `git log -1 --format=%ad b7fe4848b` (VECTOR-MAP.md's last touching commit, #2658)
confirms the 17:52:44 timestamp, thirteen minutes after #2651's 17:39:04.

**Fix (docs-only):** `docs/audit/VECTOR-MAP.md` §7's `vector-alerts` row verdict is now
"Unscheduled, deliberately — see below", and the paragraph is rewritten with a dated
`**CORRECTION (2026-11-07)**` lead explaining what was stale and why (naming #2651 and the exact
13-minute gap against #2658), then restating the still-true underlying facts (no deployed
EventBridge rule, `VECTOR_ALERTS_PUSH` unset, VAPID otherwise live, the rules mirror still being
written) without the "unexplained"/"this lane's gap" framing. The stale quoted in-code comment is
removed in favor of describing what the current comment actually says. §10 item 3 is struck through
with a `— DONE (listed), #2651` note, while flagging that actually *deploying* the feature
(`VECTOR_ALERTS_PUSH` + an EventBridge rule) remains a genuine open infra/product decision, not a
doc defect — so the correction does not overstate what was fixed.

**Blast radius:** `docs/audit/VECTOR-MAP.md` only — no source files changed. No code behavior is
affected; `vector-alerts` remains exactly as dormant as before (that part of the map was accurate).

**Evidence:**
- `git log --follow -p -- scripts/audit/cron-schedule-coverage.mjs` — shows the `vector-alerts`
  entry added by the #2651 commit (2026-08-22 17:39:04 -0700) and still present on `main`.
- `git log -1 --format="%H %ad" b7fe4848b` — confirms VECTOR-MAP.md's own last revision (#2658)
  landed 2026-08-22 17:52:44 -0700, after #2651, without touching §7.
- Direct read of `scripts/audit/cron-schedule-coverage.mjs`'s `INTENTIONALLY_UNSCHEDULED` map and
  `src/features/vector/components/VectorPageShell.tsx`'s current `persistRules` comment, both on
  `main` as of this pass.
- This is a documentation-only change; no test file applies. `npx tsc --noEmit` run to confirm no
  incidental breakage (docs change touches no `.ts`/`.tsx`).

Found via lead #1 in the round-376 prompt ("read the REST of VECTOR-MAP.md... same 'present-tense
claim vs current source' staleness check" — the methodology that has now found a real stale-docs
hit on HELIX-MAP.md, THERMAL-MAP.md, MERIDIAN-MAP.md, and now VECTOR-MAP.md, four lanes running).
