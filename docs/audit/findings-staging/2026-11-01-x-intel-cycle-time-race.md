> **kind:** FINDING

# x-intel cron: `cycle_key` and attachment image path could disagree on the same queue row

| | |
|---|---|
| **Area** | X marketing — `src/app/api/cron/x-intel/route.ts` (desk-content queue cron) |
| **Severity** | P3 |
| **Status** | Fixed |

## Root cause

`src/app/api/cron/x-intel/route.ts` picks `postType` once at the top of the request from a
single `et = nowET()` read, but every downstream field that is supposed to describe that SAME
post slot — `cycle_key` (`cycleName(postType)`), `session_date` (`etDateString()`),
`created_at_et`/`captured_at_et` (`etTimeString()`), and the desk-card attachment path built
inside `captureAttachments()` — each called its own fresh, independent `nowET()` under the hood
instead of reusing `et`.

Real wall-clock time elapses between the top-of-request `et` read and these later call sites:
`fetchMarketSnapshot()`, `generateTweetContent()` (up to 3 sequential AI-generation attempts via
`anthropicText`, each a real network round-trip), and `captureAttachments()`'s PNG render are all
`await`ed in between — easily seconds, well inside this route's own 90s `maxDuration`. If the ET
clock ticks over an **hour** boundary (or, right at midnight, a **date** boundary) during that
window, the request persists ONE queue row whose `cycle_key` — the table's own unique key, see
`src/lib/x-intel/queue-store.ts`'s `ON CONFLICT (cycle_key) DO UPDATE` — carries a different hour
than the `postType` it was actually selected for, and whose `attachments[].image_url` path (from
a *third*, independently-timed `nowET()` call inside `captureAttachments`) can disagree with
`cycle_key`'s own date/hour.

A second, independent inconsistency compounded this, present even with the clock held perfectly
still: `cycleName()`'s hour segment was zero-padded (`"09"`) while `captureAttachments()`'s
inline image path used the raw `.getHours()` number (`"9"`) for what both call sites intend as
the same "hour bucket" label — so the two never shared a format even absent any real-time drift.

## Evidence

Reproduced the divergence with a scratch repro mirroring the exact old call shape (`etDateString()`
called fresh inside `cycleName()`, and again fresh inside the attachment-path builder, each via
its own `nowET()`), with "now" advancing past an hour boundary between the `cycle_key` build and
the attachment-path build (simulating the real awaits that happen in between in production):

```
cycle_key:       2026-06-01T09:desk_flow
image path:      /x-intel/2026-06-01T10/desk_flow-desk.png
MISMATCH: true
```

One persisted row, two fields, two different hours — exactly the bug this fix removes.

RED → GREEN: `src/app/api/cron/x-intel/x-intel-time.test.ts` is new — before this change there was
no importable, deterministic version of these helpers to test at all (`route.ts`'s versions are
inline, un-exported functions that each read the clock themselves, and Next.js's App Router
route-export validator rejects non-HTTP-method exports from a `route.ts` module, the same
constraint `thermal-discord-dedup.ts`/`thermal-discord-rth.ts` already work around). After
extracting pure, `et`-parameterized helpers into the new sibling file, all 5 new tests pass,
including the direct regression test asserting `cycleName(et, postType)` and
`attachmentImagePath(et, postType)` always embed the identical date+hour bucket for any `et`.

## Blast radius

Only `src/app/api/cron/x-intel/route.ts` calls these helpers (`cycleName`, `etDateString`,
`etTimeString`, and the attachment-path builder were all private to this one route file — no
other caller exists). The sibling `src/app/api/cron/x-autopost/route.ts` and
`src/app/api/cron/x-intel/route.ts` share market-content generation via `@/lib/x-content`, but
`x-autopost` never builds a `cycle_key`/attachment-path pair at all (it posts directly, with no
queue row), so it was never exposed to this specific bug.

## Fix rationale

Extracted `etDateString`, `etTimeString`, `cycleName`, and a new `attachmentImagePath` into
`src/app/api/cron/x-intel/x-intel-time.ts` as pure functions that take the already-captured
`et: Date` explicitly and never read the clock themselves. `route.ts` now computes `et` exactly
once (the same read it already used to select `postType`) and threads it through every
downstream call (`captureAttachments` now also takes `et` as a parameter), so every field on one
persisted queue row is derived from the same instant by construction, and the hour segment is
formatted identically (zero-padded) everywhere it appears — the fix is "stop deriving time
independently at each site," not a threshold/format tweak layered on top of the old shape.

Left unchanged: the route's overall control flow, its three separate draft-building call sites
(skip-on-incomplete-data, skip-on-invalid-content, and the real REVIEW draft), and every other
cron/route that does not touch this file.
