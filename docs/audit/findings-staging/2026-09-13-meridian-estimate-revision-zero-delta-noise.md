## 2026-09-13 — [FINDING, P3 Meridian/data-quality] Estimate-revision timeline surfaces "revised +0%" entries — a real change that rounds to zero display still pollutes the feed — FIXED

> **kind:** `FINDING`

| | |
|---|---|
| **Status** | FIXED — merged same PR. |
| **Severity** | P3 — no wrong numbers shown, but the estimate-revision timeline (`GET /api/market/meridian/timeline`'s `estimate_revision_timeline`/`recent_earnings_revisions`) exists specifically to highlight material analyst re-estimates; an entry that reads "Rev est revised +0%" tells the member a revision happened while conveying zero information, which is noise in a feed whose entire value is signal-to-noise. |

### What was found

Live spot-check of `GET /api/market/meridian/timeline?days=14` through a temp premium Clerk session (Meridian hadn't been touched by any owning lane in 3 days — a reasonable DISCOVERY-cycle target) returned, in `estimate_revision_timeline`:

```json
{"ticker":"ZS","company_name":"Zscaler","date":"2027-02-25", ...,
 "change_kind":"revenue","revenue_delta_pct":0,
 "estimated_revenue":957933672,
 "headline":"ZS Rev est revised +0%"}
```

`revenue_delta_pct: 0` with a headline literally saying "revised +0%" — presented identically to every other, materially-meaningful entry in the same feed.

### Root cause

`diffEstimateRevisionTimeline` (`src/lib/meridian/meridian-benzinga-analytics.ts`) guards revenue-revision emission on the RAW values differing (`row.estimated_revenue !== prev.estimated_revenue`), then computes the DISPLAYED `revenue_delta_pct` by rounding to 1 decimal:

```js
const revenue_delta_pct = Number(
  (((row.estimated_revenue - prev.estimated_revenue) / Math.abs(prev.estimated_revenue)) * 100).toFixed(1)
);
```

On a large revenue base (Zscaler's estimate here is ~$958M), a real but tiny raw change — a few hundred thousand dollars, well under 0.05% of the base — passes the raw-inequality guard but rounds to `0.0` at display precision. The code pushed a visible timeline entry regardless of whether the ROUNDED (i.e. actually shown) value was zero, so "something changed internally" and "something worth telling a member about" were conflated. The `eps` branch doesn't share this defect: its headline shows the raw before/after values directly (`EPS est 0.95 → 0.97`), so even a change too small to matter still displays two genuinely different numbers rather than a literal "+0%".

### Fix

Gate the `out.push(...)` for the revenue branch on `revenue_delta_pct !== 0` (the same value already computed and displayed) — a change that would display as zero no longer emits a visible entry. The Redis snapshot write (`sharedCacheSet`) is left unconditional on `changed` as before, so the next diff still compares against the LATEST value rather than accumulating a string of unreported micro-drifts against a stale baseline.

### Evidence

RED→GREEN via controlled file-swap (not `git stash` — shared checkout): `git show HEAD:src/lib/meridian/meridian-benzinga-analytics.ts` restored the pre-fix source, new test file `meridian-estimate-revision-zero-delta.test.ts` run — 1/2 fail (`a revenue nudge that rounds to 0.0% emits no visible entry`, asserting `0` but getting `1` real entry). Restored the fix, re-ran both the new file and the existing `meridian-benzinga-analytics.test.ts` — 8/8 pass. `npx tsc --noEmit -p .` clean.

### Blast radius

Single function (`diffEstimateRevisionTimeline`), single call site. `mergeEstimateRevisionTimeline` (the downstream live+persisted merge) and the UI consuming `estimate_revision_timeline`/`recent_earnings_revisions` are unaffected in shape — they simply receive one fewer noise entry when a revenue nudge is display-immaterial. The `eps`/`date_status`/`print` branches are a different, non-buggy shape (headline shows raw values, not a rounded delta) and were left untouched.

### Why fixed directly, not written up

Small, self-contained, single-function fix in a file untouched by any of the 9 owning lanes' recent activity (last touch to Meridian was 3 days prior), with a controlled RED→GREEN test proving the exact live-observed symptom. Exactly the shape the standing issue-handling policy calls "fix directly."
