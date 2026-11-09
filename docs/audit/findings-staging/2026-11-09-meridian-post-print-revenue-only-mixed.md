## Meridian `postPrintSurpriseLean` mislabels a clean revenue-only beat/miss as "Mixed print vs street" — FIXED

> **kind:** FINDING

| Field | Detail |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 (member-facing) |
| **Lane** | Meridian (Night Hawk — Earnings Intel) |
| **File** | `src/lib/meridian/meridian-benzinga-earnings-core.ts` — `postPrintSurpriseLean` |
| **PR** | fix/meridian-post-print-revenue-only-lean |

### Root cause

`postPrintSurpriseLean` derives a post-print "beat / miss / inline" verdict from two
independent surprise axes, `eps_surprise_pct` and `revenue_surprise_pct`. Both are
nullable, and the function's existing header comment already documents a real, standing
reason EPS specifically can be null on an otherwise-printed row: Benzinga sometimes
reports a quarter with `actual_revenue` populated and `actual_eps` still null (EPS
withheld/pending). `cal.is_printed` is true for exactly this row
(`benzingaToCalendarRow`: `actual_eps != null || actual_revenue != null`), and this exact
population already forced a fix one function away in the same file
(`buildEarningsWeekRows`'s `is_printed` check, and the sibling fix noted in that
function's own comment).

The pre-fix logic had exactly two branches:

```ts
if (epsBeat === true && (revBeat === true || revBeat === null)) return beat...
if (epsBeat === false && (revBeat === false || revBeat === null)) return miss...
return { lean: "inline", headline: "Mixed print vs street", score: 0 };
```

Both branches treat EPS as the sole primary signal and only ever ask "does revenue AGREE
with (or stay silent on) the EPS verdict". Neither branch — nor anything else in the
function — asks the mirror question: "EPS is absent, does revenue alone have a verdict?"
So a row with `eps_surprise_pct: null, revenue_surprise_pct: 5.2` (a clean, unambiguous
revenue beat, nothing contradicting it) falls straight through both guards into the
catch-all and is reported as `"Mixed print vs street"` — a specific, false claim that two
measured signals disagreed, when in reality there was only ever one axis of evidence and
it was favorable.

### Evidence

Added a RED test (`meridian-benzinga-earnings-core.test.ts`) reproducing the exact
scenario the file's own standing "EPS withheld" population describes:

```ts
postPrintSurpriseLean({ is_printed: true, eps_surprise_pct: null, revenue_surprise_pct: 5.2 })
// before fix: { lean: "inline", headline: "Mixed print vs street", score: 0 }
// after fix:  { lean: "beat",   headline: "Beat · EPS — · Rev +5.2%", score: 2 }

postPrintSurpriseLean({ is_printed: true, eps_surprise_pct: null, revenue_surprise_pct: -4.1 })
// before fix: { lean: "inline", headline: "Mixed print vs street", score: 0 }
// after fix:  { lean: "miss",   headline: "Miss · EPS — · Rev -4.1%", score: -2 }
```

Confirmed RED pre-fix (`git stash` reproduces the failure), GREEN post-fix. A genuine
disagreement case (both axes present, opposite signs, e.g. EPS +3% / Rev -2%) is kept as
a regression assertion in the same test and still correctly reports `"inline"` — the fix
adds the missing branch without weakening the real contradiction case.

### Blast radius

`postPrintSurpriseLean`'s output (`lean`/`headline`/`score`) feeds:
- `meridian-earnings-enrich.ts`'s `post_print` field on `MeridianEarningsEnrichment`
  (gated — only set when `headline` is non-null, so this fix changes what that headline
  *says*, not whether the field is populated).
- `meridian-earnings-report-core.ts`'s advisory read: `score` feeds the report's bullish/
  bearish tilt, `lean` decides `hasFreshPrint` (`lean === "beat" || lean === "miss"`) which
  gates the report's "beat/miss just landed" framing — a revenue-only beat previously
  never counted as a fresh beat/miss print there at all.
- `MeridianEarningsTabs.tsx`'s rendered badge: `icon={lean === "miss" ? "▼" : "▲"}` and the
  `headline` text shown verbatim to members on the Earnings Intel panel.
- `meridian-earnings-intel.ts` line 265, which checks
  `enrichment.post_print.lean !== "unknown"` as part of a larger availability gate.

Every one of these previously received a neutral "mixed signals" read for a revenue-only
print that had, in fact, cleanly beaten or missed on its one reported axis.

### Fix rationale

Added the two mirror branches (`epsBeat == null && revBeat === true` → beat,
`epsBeat == null && revBeat === false` → miss), using the exact same score (±2) and
headline template shape (`Beat · EPS — · Rev ±N%` / `Miss · EPS — · Rev N%`) the existing
branches already use for the "other axis absent" case, so the output shape is unchanged
and callers needed no changes. The true-disagreement case (`epsBeat === true` and
`revBeat === false`, or vice versa) is untouched and still falls through to `"inline"` —
this fix only closes the absent-EPS gap, it does not relax the real contradiction check.

Left unchanged: the symmetric case (`revBeat == null && epsBeat` has a verdict) was
already handled correctly by the two pre-existing branches' `|| revBeat === null` clause —
only the EPS-absent direction was missing a mirror.
