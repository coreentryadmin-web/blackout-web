## catalystsSection's Earnings bullet collapsed 'today' to an undifferentiated landed/pending state, disagreeing within the same brief with catalystCoaching's already-fixed framing — FIXED

> **kind:** `FINDING`

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-21, Ask Largo standing mandate — a Workflow-based deep-dive (live-fetched real
swing play-brief envelopes across WATCH/OPEN/CLOSED buckets, adversarially verified before acting)
focused on "Flow & positioning"/"Catalysts", not yet audited this session.

**Root cause:** `catalystsSection` (`src/lib/swing/play-brief-intel.ts`) renders the Earnings
bullet via `const when = d != null && d <= 0 ? "**today**" : ...`, collapsing every `days_until<=0`
state into a bare "today (afterhours|premarket)" with no distinction between "prints later today"
and "already printed hours ago." `parseNextEarnings`
(`src/lib/providers/unusual-whales.ts`/`uw-earnings.ts`) guarantees `days_until` reaches exactly 0
on the report date and never goes negative, so this ambiguous state is a normal, reachable data
shape on every real report day — not an edge case.

This repo already identified and fixed the identical ambiguity once, in a sibling function reading
the SAME `arsenal.earnings` field: `catalystCoaching` (`play-brief-narrative-coaching.ts`, folded
into the same brief's "Trade manager read") derives `printAlreadyLandedThresholdMs` — a bell-
relative threshold (16:00 ET for afterhours, 09:30 ET for premarket) on the report date — against
`ctx.asOf`, and renders "Earnings already printed today ... thesis now carries a realized print
gap" once the print has landed, instead of the forward-looking "size down or exit before report."
That fix's own comment cites a live repro (2026-09-14) of exactly this failure mode. `catalystsSection`
was never given the equivalent treatment, so the SAME print could read as "already printed" in one
section of a brief and a bare, forward-looking "today (afterhours)" in another — a real, within-
brief contradiction about whether the catalyst is resolved. `formatMeridianItem` (the Meridian
catalyst renderer in the same file) independently confirms the pattern: it already discloses an
analogous printed/pending distinction (`is_printed → "**printed**"`) for a related field, making
catalystsSection's omission anomalous rather than a deliberate, consistent design choice.

**Fix:**
- `src/lib/swing/play-brief-narrative-coaching.ts` — exported `printAlreadyLandedThresholdMs`
  (was private) so a second renderer of the same field can reuse it instead of reimplementing it.
- `src/lib/swing/play-brief-intel.ts` — `catalystsSection` now computes `alreadyPrinted` via the
  same bell-relative threshold + `ctx.asOf` (parsed with `parseEtStamp`, falling back to
  `Date.parse` — the real production `asOf` shape is `"YYYY-MM-DD HH:mm ET"`, not ISO), and renders
  "**already printed**" instead of "**today**" once the print has landed. `ctx` remains optional
  (unchanged signature) — with no `ctx`/`asOf` available, the section falls back to the pre-existing
  bare "today" behavior rather than fabricating a landed/pending verdict without a real clock.

**Tests:** `src/lib/swing/play-brief-intel.test.ts` — five new tests mirroring `catalystCoaching`'s
own regression fixtures (afterhours landed/pending, premarket landed, no-ctx fallback, future-dated
earnings unaffected), deliberately using the real production `asOf` shape (`"YYYY-MM-DD HH:mm ET"`)
rather than an ISO literal, since this exact repo already shipped a bug once where an ISO-shaped
test fixture passed while the real `Date.parse(ctx.asOf)` path silently returned NaN in production.
Full suite: 299/299 pass (up from 294 baseline); `play-brief-narrative-coaching.test.ts`: 187/187
pass (export-only change, no behavior change to `catalystCoaching` itself). RED→GREEN proven via
`git stash` on both source files (2 fail / 297 pass without the fix, 299/299 with it). `tsc --noEmit`
clean.

**Blast radius:** `catalystsSection`'s Earnings bullet only, plus the one export in
`play-brief-narrative-coaching.ts` (no behavior change to `catalystCoaching`, which already used
this function internally). No other call site of `printAlreadyLandedThresholdMs` exists.
