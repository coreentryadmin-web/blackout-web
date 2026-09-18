> **kind:** `FINDING`

## Ask Largo swing brief's CLOSED post-mortem "Lessons" section gave advice directly contradicting "Trade manager read" two blocks earlier — FIXED

| Field | Value |
|---|---|
| **Status** | FIXED |
| **Area** | Night Hawk Swings / Ask Largo play-brief (`src/lib/swing/play-brief-intel.ts`) — found via the Ask Largo standing mandate's continued swing deep-dive |
| **Severity** | P2 (not a restatement bug like the four sibling fixes shipped today — this one gives a member two *contradicting* pieces of advice in the same brief) |
| **PR** | fix/swing-lessons-roundtrip-advice-mismatch |

### Root cause

`closedCoaching`'s round_trip branch (`play-brief-narrative-coaching.ts`) renders the round-trip
fact and its advice clause as **one atomic sentence**, but the advice clause has two different
phrasings depending on `outcome.peakPct`:

```ts
const advice = outcome.peakPct > 20
  ? "tighten at first trim rail next time."
  : "barely cleared breakeven before reversing — a trim rail wouldn't have helped here; review entry timing or thesis strength instead.";
lines.push(`**Round-tripped past breakeven** — was up **${fmtPct(outcome.peakPct)}** at peak, closed at **${fmtPct(outcome.exitPnlPct)}**; ${advice}`);
```

`lessonsSection`'s call-site derivation of `adviceAlreadyNoted` (`buildIntelSections`,
`play-brief-intel.ts`) only string-matches the first phrasing:

```ts
const adviceAlreadyNoted = narrative?.body?.includes("tighten at first trim rail next time") ?? false;
```

So whenever a round-trip's peak was `<= 20%` (the second phrasing fires), `adviceAlreadyNoted` is
always `false`, and `lessonsSection`'s own round_trip branch unconditionally pushed its own,
different, generic advice — creating a genuine contradiction, not a mere restatement: one section
says a trim rail wouldn't have helped, the next says the lesson is to tighten at the trim rail.

Live repro (real production data via an authenticated Clerk session), AAPL position #38
(CLOSED/stopped today, peak only +10.2%):

> **Trade manager read:** "...a trim rail wouldn't have helped here; review entry timing or thesis strength instead."
>
> **Lessons:** "**Gave back the move** — next time tighten at first trim rail or thesis fade."

### Evidence

- `play-brief-narrative-coaching.ts` (current source, ~line 1083): confirmed the exact two-phrasing
  ternary and the shared sentence structure.
- `play-brief-intel.ts` (current source, pre-fix, ~line 1740): confirmed `adviceAlreadyNoted` only
  matched the first phrasing.
- `play-brief-narrative.ts` (~line 860): confirmed the sibling OPEN-flavored "Round-tripped past
  breakeven — consider protecting what's left" line (a *different* function, used for live/open
  round-trips) explicitly `return`s `null` for `bucket === "closed"` — so for a CLOSED play, the
  string `"Round-tripped past breakeven"` in `narrative` can only ever come from `closedCoaching`,
  which means it is *always* paired with one of the two advice phrasings. This is what makes
  `roundTripAlreadyNoted` alone a safe, complete proxy for "the advice was also stated" in the
  round_trip branch specifically.
- Live AAPL:38 repro as described above (`GET /api/market/swing/play-brief?ticker=AAPL&status=CLOSED&positionId=38`).

RED→GREEN proof:
- Added a new test (`lessonsSection: omits the round-trip advice line when roundTripAlreadyNoted is
  true, even for a peak<=20% round-trip whose Trade-manager-read advice used the 'wouldn't have
  helped' phrasing...`) reproducing AAPL:38's exact peak/exit values.
- Discovered while fixing that an EXISTING test (`lessonsSection: omits the round-trip sentence...`)
  encoded the buggy assumption as a requirement — it asserted `lessonsSection(play, true)` (only
  `roundTripAlreadyNoted=true`) must KEEP "gave back the move" in the output. Per the evidence
  above, that combination cannot actually arise in production for a real CLOSED play (the fact and
  advice are never independently present), so the test's premise was already wrong; corrected it
  alongside the fix rather than leaving a stale assertion pinning the bug in place.
- `git stash push -- src/lib/swing/play-brief-intel.ts` (source only, kept both test changes):
  `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts`:
  **2 failures** (both the new test and the corrected old test) — 166/168 pass.
- `git stash pop`: **168/168 pass**.
- Broader sweep (all `src/lib/swing/*.test.ts` files): **1338/1338 pass**.
- `npx tsc --noEmit -p .` on Node 20: clean.

### Blast radius

Single-file logic change (`lessonsSection`'s round_trip branch, `play-brief-intel.ts`) plus one
corrected pre-existing test whose assertion encoded the bug's premise. The `capture < 35` branch,
which reuses the same `adviceAlreadyNoted` flag for a *different* `closedCoaching` sentence, is
untouched — it still gates on `adviceAlreadyNoted` alone, correctly, since that branch's fact and
advice are a separate code path with only one phrasing.

### Fix rationale

Rather than widening the string match to also recognize the second phrasing (which would need
re-widening for any future third phrasing `closedCoaching` might add), gate on the structural fact
that `roundTripAlreadyNoted` being true already proves the advice was stated, whichever wording was
used — `!adviceAlreadyNoted && !roundTripAlreadyNoted`. This is robust to future phrasing changes
in `closedCoaching`'s round_trip branch without requiring a matching call-site update each time.

### Verification

Independently root-caused end-to-end in this session (not a re-verification of a sibling session's
PR): traced the live repro on AAPL:38 back through both `closedCoaching`'s two-phrasing branch and
`lessonsSection`'s single-phrasing dedup flag, confirmed the OPEN-flavored sibling line cannot leak
into a CLOSED narrative (so the fix's structural assumption holds), reproduced RED (166/168) →
GREEN (168/168) via `git stash`, ran the broader `swing/*.test.ts` sweep (1338/1338) and
`tsc --noEmit` clean.
