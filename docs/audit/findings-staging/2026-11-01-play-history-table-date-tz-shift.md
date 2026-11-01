> **kind:** FINDING

## PlayHistoryTable.tsx (admin "Per-play history" audit trail) displayed every date one day early — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 — display-only, admin-only surface, no scoring/trading-logic impact |
| **Area** | `src/components/track-record/PlayHistoryTable.tsx` (SPX Slayer / Night Hawk admin audit trail) |

### Root cause

`PlayHistoryTable.tsx`'s local `fmtDate(s)` parsed the row's `session_date`
(`spx_play_outcomes`) / `edition_for` (`nighthawk_play_outcomes`) field with
`new Date(s)`, where `s` is a bare `YYYY-MM-DD` string — both columns are
Postgres `DATE` and are serialized to the wire as a plain calendar-date
string by `isoDateString()` in `db.ts` (`mapPlayOutcomeRow` /
`mapNighthawkPlayOutcomeRow`), confirmed by reading those two row mappers.

Per the ECMA-262 "Date Time String Format" grammar, a date-ONLY ISO string
with no time component is parsed as **UTC midnight**. `fmtDate` then called
`Date.prototype.toLocaleDateString(...)`, which renders that instant in the
**viewer's local timezone**. For any timezone BEHIND UTC — every US
timezone, which is where this admin panel is always opened from, on a
product whose whole identity is ET-anchored (SPX Slayer / Night Hawk) — UTC
midnight is still the *previous* evening locally, so the rendered date rolls
back one calendar day. A play logged against trading day `2026-01-15` was
displayed as "Jan 14, '26" to every US-based viewer.

This is the exact bug class the codebase already guards against at ~25
other call sites (`features/nighthawk/lib/session.ts`,
`deterministic-edition.ts`, `VectorBoardCalendar.tsx`,
`VectorBoardDatePresetDropdown.tsx`, `meridian-timeline.ts`, etc.) by
anchoring a bare-date parse at local noon (`` `${ymd}T12:00:00` ``) before
formatting — `PlayHistoryTable.tsx` was the one remaining call site in this
component that still parsed the bare string directly.

### Evidence

Live Node repro (`TZ=America/New_York`, the product's own anchor timezone):

```
node -e '
process.env.TZ = "America/New_York";
console.log(new Date("2026-01-15").toLocaleDateString("en-US", {month:"short",day:"numeric",year:"2-digit"}));
console.log(new Date("2026-01-15T12:00:00").toLocaleDateString("en-US", {month:"short",day:"numeric",year:"2-digit"}));
'
# -> "Jan 14, 26"   (bare date, WRONG — the bug)
# -> "Jan 15, 26"   (noon-anchored, correct — the fix)
```

Regression test `src/components/track-record/play-history-date.test.ts`
proves RED→GREEN: with the OLD `new Date(raw)` implementation swapped back
in (confirmed via a temporary local revert, not committed), 2 of 5 cases
fail with exactly this off-by-one-day mismatch (`Jan 14, 26` actual vs
`Jul 15, 26` expected, etc.); with the fix, all 5 pass, including a case in
a timezone AHEAD of UTC (`Asia/Tokyo`) to confirm the fix doesn't just trade
one bug for its mirror image there.

### Blast radius

Both call sites inside `PlayHistoryTable.tsx` used the same local `fmtDate`
(the SPX "Date" column and the Night Hawk "Date" column) — both fixed by
routing through the new shared `formatPlayHistoryDate` helper. This
component renders inside `TrackRecordView.tsx` →
`AdminAnalyticsDashboard.tsx`'s "Per-play history" expandable panel
(`/admin` analytics), the only place it's mounted (checked: no other
importer). No other component shares this specific local `fmtDate`
(`DarkPoolPanel.tsx` has an unrelated, identically-named local function for
a different field and is out of scope here — Helix is a different lane's
owned territory). No server/API/scoring logic is touched; this is a pure
display-formatting fix on an admin-only read path.

### Fix rationale

Extracted the date formatter into a sibling pure `.ts` file
(`play-history-date.ts`, same convention already used across this repo for
pulling display logic out of a `.tsx` component so it's testable under
`node:test` without a render harness) and anchor the parse at **local noon**
(`` `${ymd}T12:00:00` ``, no `Z`) rather than parsing the bare date string
directly — identical pattern to every other fixed call site in this
codebase. Noon gives ±12h of slack on both sides of the clock, comfortably
covering every real UTC offset (−12‥+14), so the rendered calendar date
always matches the DB's calendar date regardless of the viewer's timezone.
Deliberately left unchanged: the "—" empty-state and "return input verbatim
on unparseable input" behaviors, which were already correct.
