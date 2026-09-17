> **kind:** FINDING

## Ask Largo WATCH brief duplicated "Entry geometry" across two sections — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Lane** | Night Hawk Swings / Ask Largo |
| **Severity** | P3 (narrative quality — no wrong numbers, just repeated/inconsistent text) |
| **File** | `src/lib/swing/play-brief-intel.ts` (`watchForSection`) |
| **Found by** | Standing "Ask Largo × Night Hawk Swings" mandate, aggressive-mode improvement hunt |

### Root cause

`composeSwingPlayBrief` (`src/lib/swing/play-brief.ts`) renders two sections for a WATCH play, in
this fixed order: `watchEntrySection` ("## Entry") first, then `buildIntelSections` → `watchForSection`
("## Watch levels") later. Both functions independently read `play.entryStatus` and both rendered
it as an `Entry geometry: **...**` bullet:

- `watchEntrySection` (play-brief.ts:314): `Entry geometry: **${play.entryStatus}**` — raw enum,
  e.g. `AT_TRIGGER`.
- `watchForSection` (play-brief-intel.ts:738, before this fix): `Entry geometry:
  **${play.entryStatus.replace(/_/g, " ")}**` — humanized, e.g. `AT TRIGGER`.

Same fact, printed twice in the same brief, three sections apart, with two different formattings
of the same enum value — a trader reading top-to-bottom sees the same claim stated slightly
differently and has no reason to believe they're the same fact.

This is the exact duplication shape already found and fixed in the same function for
`gateBlocks` on 2026-09-12 (see the `BUG FIX (2026-09-12)` comment directly above the removed
line) — the `entryStatus` line sitting one line below the gateBlocks line was never given the
same treatment, and no existing test exercised `play.entryStatus` in `watchForSection`'s fixtures
(`fixturePlay()` never set it), so nothing caught the gap.

### Evidence

Live repro, TSM WATCH brief (`GET /api/market/swing/play-brief?ticker=TSM`), 2026-09-17:

```
## Entry
...
Entry geometry: **AT_TRIGGER**
...

## Watch levels
**Before entry, clear:** 1 gate — see Entry section above.

Entry geometry: **AT TRIGGER**
...
```

Also reproduced in three separate scratch captures of the same TSM brief taken on different scan
passes (`brief-TSM.json`, `brief-TSM-watch.json`, `brief-WATCH-TSM_dump.txt`) — not a one-off
render glitch, present on every WATCH brief carrying a non-null `entryStatus`.

Regression test added: `src/lib/swing/play-brief-intel.test.ts` —
`"watchForSection: entry geometry is not duplicated — its one home is the Entry section above"`.
Confirmed RED before the fix (`doesNotMatch(/Entry geometry:/)` failed, actual: `'Entry geometry:
**AT TRIGGER**'`), GREEN after.

### Blast radius

Single call site — `watchForSection`'s `bucket === "watch"` branch is the only place
`play.entryStatus` was read in this file. `watchEntrySection` (play-brief.ts) is untouched and
remains the fact's one home, matching the same "one home" convention the 2026-09-12 gateBlocks fix
established in the same function.

### Fix rationale

Mirror the gateBlocks fix directly above it: drop the duplicate render. Unlike gateBlocks (a list,
where a count-plus-pointer is still useful information), `entryStatus` is a single scalar already
shown verbatim earlier in the same brief — there is nothing left to add by repeating it, so the
line is removed outright rather than replaced with a pointer sentence.

### Verification

- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief-intel.test.ts` — 142/142 pass (Node 20).
- `npx tsx --experimental-test-module-mocks --test src/lib/swing/play-brief*.test.ts` — 565/565 pass (Node 20).
- `npx tsc --noEmit` — clean.
