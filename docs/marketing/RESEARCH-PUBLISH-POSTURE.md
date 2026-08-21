# Research publish posture — what may go on a public page

**Standing decision (2026-08-21).** This governs every public, unauthenticated surface that
carries market data: the programmatic research pages, the free tools, and anything added later.

## The premise this corrects

"We pay for the API, so we can publish the data" is not how market-data licensing works. Paying
for API access buys the right to **use** the data. **Redistribution** is a separate grant, and
vendor agreements normally withhold it by default.

The part that catches people: options and index data reach us *through* Polygon but are owned
upstream by **OPRA** (options) and the index licensors (S&P for SPX, Nasdaq for NDX). Polygon
cannot grant us a right its own supplier retained. So a page's exposure is not determined by
which API call produced the number — it is determined by where the number is shown and how old
it is.

## The four axes

| Axis | Low risk | High risk |
|---|---|---|
| **Audience** | Behind auth (members) | Public / unauthenticated |
| **Timeliness** | Delayed, prior sessions | Real-time or near-real-time |
| **Derivation** | Derived, aggregated, scored | Raw vendor values reproduced |
| **Source layer** | Our own computed fields | Exchange-owned (OPRA quotes, index levels) |

A surface is judged on all four together. Behind-auth + real-time is what members pay for and is
covered. Public + prior-session + derived + aggregate is research. The combinations in between
need a decision, not an assumption.

## The rule for public pages

Publish **derived, delayed, aggregate, editorial** content. Do not republish live raw vendor
values on a public URL.

This is not a compromise on reach. Most of the SEO value is in the proprietary framing, not the
live number — nobody links to a page mirroring a quote available anywhere. They link to *"here is
why SPX pinned 7,700 three Fridays running."* The moat and the low-risk path are the same path.

## How it is enforced

Not by convention. `src/lib/research/publishable-session.ts` defines a **branded**
`PublishableSession` type, constructible only through functions that apply the cutoff. Every
public research loader accepts that type rather than `string`, so `todayEt()` will not type-check
as a substitute — tsc rejects it at the call site.

The cutoff is the most recent trading day **strictly before** the current ET date. Deliberately a
whole day, not "today once the close has passed":

- A clock comparison is one timezone bug away from publishing an open session. A date comparison
  has no such failure mode.
- A same-day page would re-render through the session as data arrived, which is behaviourally a
  live feed regardless of the cache header. A day boundary makes the page a genuine archive —
  written once, from a session that can no longer change.

`retainPublishable()` re-asserts the boundary where rows become a page, so widening a query
cannot leak a live session without also editing that call.

## Open item — `/tools/gamma-snapshot`

The free gamma snapshot is **public, unauthenticated, and refreshes every 5 seconds**. It is
derived rather than raw (gamma flip, call/put wall, regime — no chain, no strike matrix, and
`public-gex-snapshot.ts` is explicit that it must not substitute for the paid product), which puts
it in a better position than a raw quote feed. But it sits on the real-time side of the
timeliness axis, which is the one axis this posture treats as load-bearing.

It predates this decision and is **not** changed by it. Flagged here so the review is deliberate
rather than accidental: the options are to leave it as an accepted risk, delay it, or move it
behind a light gate. That call needs the actual Polygon and UW terms in front of it, which is
tracked separately.
