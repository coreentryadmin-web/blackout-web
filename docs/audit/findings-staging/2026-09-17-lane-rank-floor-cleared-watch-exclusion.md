> **kind:** FINDING

## Ask Largo lane rank silently excluded every floor-cleared WATCH candidate from its own peer pool — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Ask Largo |
| **Severity** | P2 — the WATCH lane's real leader was invisible to every peer's rank narrative, and the excluded candidate's own brief rendered a confidently-wrong self-rank |
| **File** | `src/lib/swing/play-brief-lane-rank.ts` (`rowInBucket`) |
| **Found by** | Standing "Ask Largo × Night Hawk Swings" mandate, aggressive-mode improvement hunt |

### Root cause

`rowInBucket` distinguished "open position" vs "WATCH candidate" peers by reading
`HorizonPlay.status` (`"COMMIT" | "WATCH"`) directly:

```ts
if (bucket === "open") return row.status === "COMMIT";
return row.status === "WATCH";
```

But `status` is **not** a lifecycle/section field — `serving.ts`'s own
`observablesFromHorizonPlay` documents it plainly: `aboveFloor: play.status === "COMMIT"`, the
**mechanical floor-gate result** (has this candidate's score cleared `scoreFloor`?), orthogonal to
whether it is an actually-open position. `sectionForSwingPlay`'s own doc comment confirms the
design: a pre-entry candidate whose score clears the floor legitimately keeps `status: "COMMIT"`
while its **serving section** still reads `"WATCH"` (e.g. `FORMING`, or `TRIGGERED` that later
un-triggers back to `PRE_TRIGGER`) — floor-clearance and trigger-firing are two separate,
orthogonal gates, by design.

So any WATCH candidate whose score cleared the floor was invisible to **both** branches at once:
excluded from `"watch"` (its `status` isn't literally `"WATCH"`), and never actually counted in
`"open"` either, since real open positions are additionally distinguished by a genuine
`liveStatus`. This is exactly the trap this repo's own standing mandate warns about (CLAUDE.md's
"VERIFIED CORRECTIONS": *"Lifecycle field: `HorizonPlay.status` (COMMIT/WATCH) is likely the real
lifecycle stage... verify against a real API response before building logic on this distinction"*)
— `rowInBucket` fell into precisely the trap that warning exists to prevent.

### Evidence

Live repro, 2026-09-17, real WATCH lane (XOM 52.7 / TSM 49.6 / AAPL 25.5 / **LITE 71**, LITE the
real leader by a wide margin, `status: "COMMIT"` / `serving: "WATCH"` confirmed via direct API
field dump):

- XOM's own brief: *"**Lane leader** — **#1 of 3** on WATCH (score **52.7**)"* — despite LITE
  (71) genuinely outscoring it, XOM computed itself as the leader of a 3-peer pool that silently
  excluded LITE entirely.
- AAPL's own brief: *"**Below lane median** — **#3/3** (score **25.5**, -24.1 vs median). Leader:
  **XOM** @ **52.7**"* — same 3-peer pool, same blind spot.
- LITE's own brief: *"**Top-tier setup** — **#3/3** on WATCH · **+21.4** vs median."* — LITE's own
  row, excluded from `sorted` (`idx = -1`), fell back to `rank = sorted.length + 1` (4), then got
  silently clamped by `computeLaneRank`'s own `Math.min(rank, sorted.length)` down to 3 — so a play
  whose row couldn't even be **found** in its peer set rendered as a confident dead-last ranking,
  which still satisfied `laneRankCoaching`'s `rank <= 3` "Top-tier setup" condition despite the
  pool never actually including it.

Regression tests added to `src/lib/swing/play-brief-lane-rank.test.ts`: a fence-shaped repro
(`row("LITE", 71, "COMMIT", undefined, undefined, undefined, null)` — status COMMIT, no
liveStatus) confirmed RED pre-fix (`3 !== 4`, XOM's own peer-pool total), GREEN after (XOM ranks
#2 once LITE is correctly counted, LITE itself ranks #1); a companion test proves a genuinely open
position (`status COMMIT` **with** `liveStatus`) is still correctly excluded from WATCH-bucket
comparisons, so the fix doesn't let real positions leak into WATCH-lane rank math either.

### Blast radius

Both `laneRankSection` (`play-brief-intel.ts:1466`, standalone "Lane rank" section) and
`laneRankCoaching` (`play-brief-narrative-coaching.ts:852`, folded into "Trade manager read") call
`computeLaneRank`, so both were affected identically — every WATCH-lane rank line on every
current WATCH candidate was computed against an incomplete peer pool whenever *any* floor-cleared
candidate existed alongside them. The same shape applies symmetrically to the `"open"` bucket
(a real open position was never at risk of leaking into `"open"`, since `liveStatus` is only ever
set on genuine live positions — verified by the companion test above), but the WATCH side was
silently broken any time a floor-cleared, not-yet-triggered candidate coexisted with others.

Fixing `play-brief-narrative-coaching.test.ts`'s own local `laneRow()` fixture was required too —
its default `liveStatus: "OPEN"` was hardcoded regardless of `status`, which harmlessly matched
production shape before this fix (since `rowInBucket` never read `liveStatus`) but became a
fixture bug once the field started being used: every `status: "WATCH"` row from that helper
carried a phantom `liveStatus: "OPEN"`, silently misclassifying it out of the WATCH bucket in the
test's own peer computation. Now conditioned on the row's own `status`, matching the sibling
fixture in `play-brief-lane-rank.test.ts`.

### Fix rationale

Switched `rowInBucket` to read `HorizonPlay.liveStatus?: "OPEN" | "HOLD" | "TRIM"` instead —
`serving.ts`'s own authoritative live-vs-pre-entry signal, the exact field
`sectionForSwingPlay`/`observablesFromHorizonPlay` already use as the first, defining check for
"is this a live position." A row is `"open"` only when it actually **is** a live position
(`liveStatus != null`), `"watch"` whenever it is a pre-entry candidate regardless of floor state
(`liveStatus == null`) — no behavior change to rank/median/leader logic beyond which rows are
admitted as peers in the first place.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-lane-rank.test.ts` — 26/26 pass (Node 20); new test confirmed RED (`3 !== 4`) before the fix.
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/*.test.ts src/features/nighthawk/command-deck/*.test.ts` — 1648/1648 pass (Node 20) — this also caught and required fixing the `play-brief-narrative-coaching.test.ts` fixture bug described above.
- `npx tsc --noEmit` — clean.
- Checked the rest of the `.status === "COMMIT"|"WATCH"` call sites repo-wide (20 files) for the same misuse; the only other swing/play-brief hit (`play-brief-intel.ts:188`) reads `TerminalPlay.status` (the correctly-adapted DeckStatus lifecycle field), a genuinely different, correct usage — not in scope for this fix.
