## Ask Largo swing play-brief: put/call wall narration says "holding" for a wall price has already broken through — FIXED

> **kind:** `FINDING`

| **Status** | FIXED |
|---|---|

**Root cause.** `narrateWall()` (`src/lib/swing/play-brief-narrative.ts`) renders the "Put wall
X.XX .../ Call wall X.XX ..." bullet inside the swing play-brief's "Trade manager read" section. It
picked its `action` text purely from `near = Math.abs(level.distancePct) < 1.5` — i.e. how CLOSE
the level is to spot — and never checked which SIDE of spot the level is actually on. A put wall's
canonical side is BELOW spot (real, current support); a call wall's canonical side is ABOVE spot
(real, current resistance). `distancePct` is signed (`(level - spot) / spot * 100`), so once price
has genuinely traded THROUGH a level — a put wall sitting ABOVE spot because price fell below what
used to be support, or a call wall sitting BELOW spot because price already cleared it — the level
is on the WRONG side of its canonical relationship, and picking on `near` alone produced text that
says the opposite of what is currently true: "support underfoot — hold while above" for a support
level that has already given way (and is now overhead), or "into strength — trim if rejected here"
for a resistance level price has already broken above.

**Evidence.** Live repro, 2026-10-14, `GET /api/market/swing/play-brief?playId=SWING:AMD&ticker=
AMD&status=WATCH` (prod, cron-bearer/Clerk auth): spot **558.15**, put wall **560.00** (`+0.3%`
from spot, so `near`), direction LONG. The brief's own "Trade manager read" section rendered, in
the SAME response:

> **Put wall 560.00** (+0.3% from spot) — dealer support / put wall. Support underfoot — hold
> while above.
>
> Vector desk: starred level **Lost the 560 put wall (0.33% overhead) — support gave way; dealers
> stop cushioning, watch for continuation lower.**

Two bullets in one section flatly contradicting each other about the same strike: one says the
support is holding and price is above it; the other (correctly) says the support already broke and
price fell below it. `+0.3%` on a put wall for a LONG means the put wall is ABOVE spot — i.e.
support already lost — confirmed against real Polygon daily bars for AMD (2026-10-13 close 605.53,
2026-10-14 close 570.82, after-hours spot lower still at the time of the read).

Root-caused to the `near`-only branch selection in `narrateWall`: for `isCall=false` (put wall) and
`near=true`, the function always returned `"support underfoot — hold while above"` regardless of
`level.distancePct`'s sign. The same structural gap exists in all four `isCall`×`direction`
combinations (LONG/SHORT × call/put), not just this one — confirmed with a dedicated regression
test per combination (`src/lib/swing/play-brief-narrative.test.ts`, 4 new tests), all 4 of which
failed RED pre-fix (`git stash` proof: 118 pass / 4 fail before the fix, 122 pass / 0 fail after,
full `src/lib/swing/*.test.ts` suite: 1742 pass / 0 fail).

**Blast radius.** `narrateWall` has exactly one call site family — the two `collectFocalLevels`
loop branches in `tradeManagerNarrativeSection` (play-brief-narrative.ts) that invoke it for
`put_wall` and `call_wall` kinds — covering every swing play-brief bucket (WATCH/OPEN/HOLD/TRIM/
CLOSED) that reaches this narration path, since the same function renders the bullet regardless of
bucket. No other file duplicates this logic (`git grep -n "support underfoot\|hold while above"` —
one hit, this file).

**Fix.** Added a `breached` check: `isCall ? level.distancePct <= 0 : level.distancePct >= 0` — true
exactly when the level sits on the wrong side of its canonical relationship to spot (a put wall
at/above spot, or a call wall at/below it). When `breached`, pick direction-aware text that states
the level has already been traded through, instead of falling into the `near`/`far` canonical-side
branches: for a LONG, a breached put wall reads "support broken — now overhead...", a breached call
wall reads "cleared — former resistance, now potential support if it holds"; for a SHORT, a breached
call wall reads "reclaimed — resistance broken; short thesis at risk", a breached put wall reads
"already broke — downside target cleared; watch for a bounce or continuation". The pre-existing
`near`/`far` branches are untouched and only run in the non-breached (canonical-side) case, so every
existing passing test (118 in this file, 1742 across `src/lib/swing/`) stayed green with no changes.

**Fix rationale.** The alternative — leaving `near`/`far` phrasing but adding a caveat clause — was
rejected because it would still assert the wrong primary claim ("holding... but also broken") in
the same sentence; a member reading quickly would anchor on the first clause. Stating the breach
plainly, with no `near`/`far` distinction inside the breached branch, matches how every other
already-shipped breach-aware line in this same brief is written (the "Vector desk: starred level"
line this bug directly contradicted, and the existing `breakTrigger`/"Break watch" bullet, which
already special-cases a breached level rather than describing it as still-pending).

**Why not caught earlier.** No existing test exercised a put/call wall on the "wrong" side of spot
— every prior fixture (including the dedicated MAX_BULLETS/PROF regression test) placed the put
wall below spot and the call wall above, which is the common case and never exercises the sign
check this bug is about. The defect only manifests once a real swing WATCH candidate's underlying
has moved far enough to trade through one of its own GEX walls — exactly what happened to AMD this
session day — which non-live unit fixtures had no reason to construct until this live repro.
