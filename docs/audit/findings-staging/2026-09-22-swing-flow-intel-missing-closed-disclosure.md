> **kind:** FINDING

## Swing play-brief: "Flow & positioning" was the one sibling section missing the CLOSED "not what this trade traded under" disclosure — FIXED

| **Status** | FIXED |
|---|---|

**File:** `src/lib/swing/play-brief-intel.ts` (`flowIntelSection`)

### Root cause

Four sibling sections in this file already carry an explicit disclosure on a CLOSED play, added
across separate earlier fixes: `chartTechnicalsSection` ("_Current chart read — not the technicals
this trade closed under._"), `chartLevelsSection` ("_Current levels — not what this trade traded
under._"), `gexPostureSection` ("_Current dealer posture — not what this trade traded under._"),
and the wall-dynamics section ("_Current wall activity — not what this trade traded under._"). Each
was added because these sections render **live, as-of-request-time** market data (current spot,
current GEX walls, current dealer posture) that has no relationship to the conditions the trade
actually closed under — potentially days or weeks earlier. `chartTechnicalsSection`'s own comment
cites the original live repro (AAPL:36) for exactly this failure mode: today's data "reading as if
it described the trade's own conditions."

`flowIntelSection` ("Flow & positioning" — HELIX tape aggregate, flow anomalies, notable prints,
0DTE desk alignment) carries the **identical** risk — every line it renders is a current read, not
a stored historical one — but never received the same disclosure. It was the one sibling section
missed when the pattern was established elsewhere in this file.

### Evidence (RED → GREEN)

Live repro: `GET /api/market/swing/play-brief?playId=SWING:MSTR&ticker=MSTR&positionId=33&status=CLOSED&expandIntel=1`
(MSTR:33, a real closed SHORT position, closed 2026-09-03). The live "Flow & positioning" section
rendered current HELIX tape/anomalies/notable-prints/0DTE-desk content — all dated relative to
"now" (`[3h ago]`, `[22h ago]`, etc., weeks after the trade closed) — with zero framing, directly
alongside sibling sections (Chart technicals, Levels on chart, GEX posture) that correctly disclosed
their own current-not-historical nature on the same brief.

Added a regression test mirroring the existing sibling tests exactly: a CLOSED play with real flow
content renders the disclosure; an OPEN play with the same content does not.

- **Before:** assertion failure — the CLOSED section body had no disclosure line.
- **After:** `flowIntelSection` unshifts "_Current flow — not what this trade traded under._" on
  the CLOSED bucket only.

`play-brief-intel.test.ts` 196/196. Collateral (`play-brief.test.ts`, `play-brief-intel-collapse.test.ts`,
`play-brief-narrative-coaching.test.ts`, `play-brief-narrative.test.ts`) — 354/354 total. `npx tsc
--noEmit` silent.

### Fix

```ts
if (!lines.length) return null;
if (statusBucket(play) === "closed") {
  lines.unshift("_Current flow — not what this trade traded under._");
}
return { title: "Flow & positioning", body: lines.join("\n\n") };
```

Same `statusBucket(play) === "closed"` guard and `lines.unshift(...)` shape as every sibling
section in this file — `flowIntelSection` already receives `play: TerminalPlay` as a direct
parameter, so no signature change was needed.

### Blast radius

Checked `play-brief-intel-collapse.ts` (which references "Flow & positioning" as a section
**title** in a collapse-set allowlist — unaffected, title unchanged) and
`play-brief-narrative-coaching.ts`/`ecosystem-context.ts` (comments referencing the function
conceptually, not parsing its body) — no consumer string-matches this section's body content, so
the new disclosure line is presentation-only and cannot break anything downstream. Only the CLOSED
bucket's output changed; OPEN/WATCH are unaffected (proven by the second half of the regression
test).

### Fix rationale

Mirrored the existing, already-reviewed pattern exactly rather than inventing new phrasing —
consistency across all five sections (four already fixed, this one now) is itself part of the
Largo C1 (time/freshness) discipline this repo already applies everywhere else.
