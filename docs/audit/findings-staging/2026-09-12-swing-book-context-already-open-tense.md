> **kind:** FINDING

## "Book context" narrated an already-open, being-trimmed position as a pending "adding" decision — FIXED

| **Status** | FIXED |
|---|---|

### Root cause

`bookContextSection` (`play-brief-intel.ts`) was already fixed once this session (2026-09-12,
earlier finding) for the identical tense mismatch on CLOSED plays — its concentration copy is
written in the present/future tense of a *pending entry decision*: "Adding {ticker} stacks the
same wager rather than diversifying risk." That framing is correct for a WATCH candidate (there IS
a decision to make: enter or pass), and the CLOSED fix gated the whole section out for that bucket
since a closed trade has no decision left at all. But the same fix left OPEN/HOLD/TRIM untouched —
an already-committed, currently-managed position is not a pending entry decision either. The
position already exists; nobody is "adding" it.

### Live repro (2026-09-12, real TRIM position CRWD, positionId 19)

`GET /api/market/swing/play-brief?playId=SWING:CRWD:19&ticker=CRWD&positionId=19&status=COMMIT` —
this brief's own "Trade manager read" section reads **"Desk says TRIM"** with `manageAction:
EXIT_RUNNER` ("all trims banked — runner only"), i.e. the desk is actively telling members to
reduce/exit this position. A few sections later, "Book context" reads:

> **Concentration** — already holding 1 same-direction position in theme "software": ADBE LONG.
> **Adding CRWD stacks the same wager** rather than diversifying risk.

A member reading top-to-bottom sees the desk say "trim this down," then a few lines later sees
language framed as if they were about to newly enter CRWD — a real tense mismatch on an
already-open position with no "adding" decision on the table.

### Fix

`bookContextSection` now only uses the "Adding {ticker} stacks..." phrasing when
`play.status === "WATCH"` (the one bucket where entering is genuinely still a pending decision).
For every other rendered bucket (OPEN/HOLD/TRIM — CLOSED already returns `null` entirely per the
prior fix), the closing sentence drops "Adding" and reads as an existing-exposure state fact:
"{ticker} stacks the same wager rather than diversifying risk." The underlying overlap FACT is
unchanged and still correctly rendered (the position IS open, the book overlap IS real right now,
unlike the CLOSED case where the fact itself doesn't belong on the brief) — only the tense of the
one sentence that assumed a forward decision changed. The "Internal conflict" (opposed-direction)
sentence was already written in state/fact tense ("theme already has an OPPOSED position...") and
needed no change.

### Blast radius

Single function, single sentence. No other call site of `bookContextSection` exists
(`play-brief.ts`'s `buildIntelSections`, the only caller).

### Fix rationale

Rejected rewording to a single tense-neutral sentence that would read for both WATCH and
OPEN/HOLD/TRIM — "Adding" is the more natural, correct framing specifically for WATCH (a member
really is considering entering), so keeping the WATCH-specific phrasing intact and only changing
the already-open buckets preserves the strongest, most natural language for the more common case
(WATCH candidates) while fixing the mismatched one.

### Evidence of testing

- New test in `play-brief-intel.test.ts`: for `status` in `OPEN`/`HOLD`/`TRIM`, asserts the section
  renders (fact still shown) but does NOT use "Adding {ticker} stacks" phrasing; a sibling
  assertion confirms `WATCH` still uses it. RED pre-fix (`git stash` on `play-brief-intel.ts`
  alone — 1 failing test, 107 pass), GREEN post-fix (108/108 pass).
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): 13938 pass / 0 fail / 3 skipped.

Found during the Night Hawk Swings standing aggressive-mode improvement-hunt mandate, pulling
CRWD's full live play-brief envelope for a fresh Ask Largo deep-audit pass and noticing the same
tense-mismatch bug class the CLOSED fix (earlier the same day) had already diagnosed, recurring one
bucket over.
