> **kind:** FINDING

## `docs/audit/QA-REGRESSION-LIBRARY.md` mobile-sticky-CTA entry read "no automated coverage, pending fix" for a bug fixed and tested since 2026-08-27 — FIXED

| | |
|---|---|
| **Area** | `docs/audit/QA-REGRESSION-LIBRARY.md`'s "Marketing/public site — mobile sticky CTA blocks a home-page FAQ tap" entry (P2, filed 2026-08-23, routed via #2799). Doc-staleness only — no application code changed. |
| **Status** | FIXED |

### Root cause

The entry's **Automated coverage** cell said `none yet — owning lane's call` and its **Verified
live** cell said `Confirmed live at time of finding ... Pending fix from the owning lane.` Both
statements were written at filing time and never revisited once the fix actually shipped — the
exact "status written mid-flight is not a status" failure mode `docs/audit/BACKLOG-2026-08-08.md`
(§0, §1.2) already documents for `FINDINGS.md` entries, here recurring in `QA-REGRESSION-LIBRARY.md`
instead, which this lane maintains by direct edit rather than through the staging/fold pipeline.

The fix landed 3 days after the entry was filed: PR **#3007**, `fix(marketing): suppress mobile
sticky CTA over FAQ taps (#2799)`, merged 2026-08-27 (commit `5ea5ef133`). It:
- extracted pure overlap logic into `src/lib/marketing/mobile-sticky-cta.ts`
  (`rectsOverlap`, `mobileStickyBlockedByContent`, `shouldShowMobileStickyCta`);
- added `src/lib/marketing/mobile-sticky-cta.test.ts` — 4 unit tests, including the exact measured
  FAQ-item-3-vs-sticky-bar overlap rectangles from the original repro;
- wired both helpers into `LandingRedesignFx.tsx`'s sticky-CTA `IntersectionObserver` handler
  (`syncSticky()`), which now reads live `.sec-faq .faq-item` and `.footer` rects every sync and
  suppresses the bar's `.visible` class on any overlap with the sticky bar's own rect — the
  in-code comment explicitly cites `FINDINGS P2 #2799`.

So by the time this round read the doc, the two stale cells had been wrong for roughly two and a
half months.

### Evidence

```
$ git log -1 --format='%H %ad %s' -- src/lib/marketing/mobile-sticky-cta.ts
5ea5ef13317a22ac70d24fa50c92af4706577f91 Thu Aug 27 21:13:18 2026 -0700 fix(marketing): suppress mobile sticky CTA over FAQ taps (#2799) (#3007)

$ npx tsx --experimental-test-module-mocks --test src/lib/marketing/mobile-sticky-cta.test.ts
# tests 4
# pass 4
# fail 0
```

`LandingRedesignFx.tsx` (current `main`) around the sticky-CTA block:

```ts
// ── Mobile sticky CTA — show when hero CTA scrolls out of view, but never
// over FAQ rows or the footer (expanded accordions push targets into the bar's
// fixed footprint — FINDINGS P2 #2799).
...
const syncSticky = () => {
  const { stickyRect, faqRects, footerRect } = readRects();
  const blocked = mobileStickyBlockedByContent(stickyRect, faqRects, footerRect);
  stickyCta.classList.toggle("visible", shouldShowMobileStickyCta(heroPast, blocked));
};
```

This directly contradicts the doc's "none yet" / "Pending fix" cells — the fix, its regression
test, and its explicit citation of this exact finding number (#2799) are all already on `main`.

### Blast radius

Doc-only. No other `QA-REGRESSION-LIBRARY.md` row references this same fix or test file, so no
other entry needed the same correction as part of this pass. The other entries in that file
(platform-auth REFUTED, SPX dual-GEX) already carry their own up-to-date status language and were
left untouched.

### Fix rationale

Updated the entry's heading to append `— FIXED` (matching the file's own convention, e.g. the
platform-auth entry's `— REFUTED, false positive` suffix), rewrote **Automated coverage** to name
the actual test file and what it covers, and rewrote **Verified live** to record the merged PR
number/date, summarize what the shipped fix does, and note explicitly that this row itself was the
stale-status instance being corrected — consistent with `BACKLOG-2026-08-08.md`'s existing
guidance ("a status written mid-flight is not a status"). Left open the suggestion that a future
live pass could still re-walk the FAQ-item-3 tap on `/` mobile, since this correction is based on
the shipped code + its test rather than a fresh live click-through.
