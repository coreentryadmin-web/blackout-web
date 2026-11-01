> **kind:** FINDING

## Night Hawk Legacy — explicit `?date=` lookup silently substitutes an unrelated edition, mislabeled `stale` — FIXED

| | |
|---|---|
| **Area** | Night Hawk Legacy edition resolution (`src/features/nighthawk/lib/resolve-edition.ts`) |
| **Severity** | P2 — member-facing, wrong-data-under-explicit-request, no error surfaced |
| **Status** | Fixed |
| **Found by** | Live audit (five-engine-largo-cycle-58, "check:legacy" agent), 2026-11-01 |

### Root cause

`resolveNighthawkEdition(editionFor, explicitDate)`'s "latest edition" fallback branch
(`resolve-edition.ts:187-227` before this fix) exists for the **default** ("what's live right
now") path: if tonight's own edition isn't published yet, serve the most recently published one,
stamped `stale: true` + `served_for` so the caller knows it isn't tonight's.

That branch had no guard against being reached by an **explicit** `?date=` lookup (the Legacy
calendar-strip's historical-day browsing). Two further problems compounded once an explicit
lookup did reach it:

1. The absence guard (`edAge > MAX_EDITION_AGE_DAYS`) only fires when `edAge` is a large
   **positive** number — i.e. when `latest` is *older* than the requested date by more than 4
   days. It is structurally blind to the opposite case: a requested date that is *earlier* than
   `latest.edition_for` (the ordinary shape of browsing back through history on a date that never
   got an edition stored) produces a **negative** `edAge`, which never trips the guard.
2. The only fields stamped are `stale: true` and `served_for = edition.edition_for` — `edition_for`
   itself is left as whatever `latest`'s own date is. Nothing in the response carries any trace of
   the date the caller actually asked for.

### Evidence (live reproduction, 4/4 consecutive)

```
GET /api/market/nighthawk/edition?date=2026-10-31
-> edition_for: "2026-11-02", stale: true, served_for: "2026-11-02",
   recap_only: true, recap_only_reason: "No scored dossiers after 2 dossier-fetch attempt(s) (20 candidate(s)).",
   plays: []
```

A request explicitly for **2026-10-31** (a real trading day, no stored row) returned
**2026-11-02**'s edition byte-for-byte (a date *later* than the one requested) with `edition_for`
left at `2026-11-02` — no field anywhere discloses that 2026-10-31 was the actual request, or that
it was never found. By contrast `?date=2026-10-30/-29/-28/-27` all resolved correctly (exact match
or honest recap-only content for that exact date), confirming this is specific to "no stored row
for the requested date" + "requested date precedes the latest published row."

**Member-facing impact:** `containers.tsx`'s stale banner (``Showing ${edition?.served_for ??
"prior"} edition — tonight's not published yet.``) would render "Showing 2026-11-02 edition —
tonight's not published yet" for a member who clicked 2026-10-31 — nonsensical (2026-11-02 is
*after* "now", not a "prior" edition) and gives no indication their actual request was never
found. `editionFor` also feeds the morning-confirm lookup
(`/api/nighthawk/play-status?date=${editionFor}`), so that too would silently query the wrong
date.

### Blast radius

Three call sites share `resolveNighthawkEdition`, all three benefit from the shared fix:
- `src/app/api/market/nighthawk/edition/route.ts` (the member route)
- `src/app/api/admin/nighthawk/command-center/route.ts` (admin dashboard)
- `src/lib/largo/run-tool.ts`'s `get_nighthawk_edition` case (Ask Largo tool)

### Fix

Guard the "latest edition" fallback — and the subsequent legacy-engine fallback, which only ever
answers for `nextTradingDayEt(todayEt())` and is equally wrong for a historical lookup — with
`!explicitDate`, mirroring the existing guard on the carry-forward branch two cases above it. An
explicit date lookup that misses the exact-match path now falls straight through to the honest
`emptyEdition(editionFor)` (consistent with the Largo product contract's "absence must be
disclosed, never silent" principle) instead of a substituted, mislabeled day.

```ts
const latest = explicitDate ? null : await fetchLatestNighthawkEdition();
if (latest) { /* unchanged */ }

if (!explicitDate) {
  const legacy = await fetchLegacyPlays();
  if (legacy) return legacy;
}

return emptyEdition(editionFor);
```

Deliberately left unchanged: the default (no explicit date) "latest" fallback's own behavior —
untouched by this guard, same `MAX_EDITION_AGE_DAYS` bound, same stale-stamping — and the
recap-only-before-close carve-out two lines above (2026-10-20 fix), neither of which this bug
touches.

### Tests

`src/features/nighthawk/lib/resolve-edition.test.ts` — 2 new cases:
- an explicit lookup with no stored row, where `latest` is a *later* date than requested (the live
  repro shape) — asserts honest `available:false` + `edition_for` matching the request, not the
  substituted date.
- the same shape with `latest` *older* than requested — a no-regression check (this one already
  passed pre-fix via the existing age-bound guard, confirming the fix doesn't disturb that path).

RED→GREEN verified: reverted `resolve-edition.ts` to its pre-fix `origin/main` content, ran both
new tests — 1 failed exactly as predicted (`true !== false` on `available`), 1 passed (pre-existing
age-bound guard). Restored the fix — 6/6 pass. Full file: 6/6. Related suites unaffected:
`route.test.ts` (12/12), `nighthawk-edition-for-model.test.ts` (15/15). `tsc --noEmit` clean.
