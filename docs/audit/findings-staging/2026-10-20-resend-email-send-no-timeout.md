> **kind:** FINDING

## `resend.emails.send()` had no timeout — could stall an unauthenticated HTTP response indefinitely — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane error-handling/retry-logic sweep, via a background
Explore-agent audit of non-owned-lane API routes and provider modules.

**Root cause:** `src/lib/email/resend-client.ts`'s `sendEmail()` called `resend.emails.send(...)`
with no second `options` argument. Traced into the installed SDK
(`node_modules/resend/dist/index.cjs`): `Emails.send` → `Resend.post` → `Resend.fetchRequest` is a
plain `fetch(url, options)` with whatever `options` the caller passed — the SDK has no built-in
timeout of its own. Every other external call in this codebase (Polygon, UW) goes through a
governed wrapper (`trackedFetch`/`polygonTrackedFetch`) that applies `AbortSignal.timeout(...)` by
default; Resend calls had no equivalent, so a hung upstream connection (slow TLS handshake, dead
socket) left the call pending indefinitely.

**Live impact:** `src/app/api/public/email-capture/route.ts` `await`s `sendEmail()` before
responding to an **unauthenticated** caller — a hung Resend call would stall that live HTTP
response with no timeout anywhere in the chain, and no auth gate limits who can trigger it. Every
other `sendEmail()` caller (Whop webhook nudges, billing-lifecycle emails) is fire-and-forget
(`void sendEmail(...).catch(...)`), where the same hang would "only" leak a pending async call
rather than block a response — but the fix applies uniformly since it's set once in the shared
client.

**Fix:** added `AbortSignal.timeout(SEND_TIMEOUT_MS)` (10s, matching the order of magnitude of
this codebase's other external-API timeouts, e.g. `polygon-news.ts`'s `NEWS_TIMEOUT_MS=8000`, with
a little extra margin for attachment payloads) as the `send()` call's second argument. The SDK's
own TypeScript type (`CreateEmailRequestOptions extends PostOptions`) only declares
`query`/`headers` and doesn't know about `signal`, even though the runtime `Resend.post()` spreads
the whole options object into `fetch()` and honors it — a type-definition gap, not a real runtime
restriction. Cast past it with `as Parameters<typeof resend.emails.send>[1]` rather than widening
the SDK's own types.

**Blast radius:** single shared client (`resend-client.ts`), used by every `sendEmail()` caller in
the codebase. A timeout firing surfaces through the existing `catch (err)` block exactly like any
other send failure (`{ ok: false, error: ... }`) — no new error path, no behavior change for the
success case.

**Test:** `src/lib/email/resend-client.test.ts` (new file) — mocks the `resend` package and
asserts `sendEmail()` passes a real `AbortSignal` as the `send()` call's second argument.
RED→GREEN proven via `git stash` on `resend-client.ts` alone (fails without the fix, passes with
it). Repo-wide `npx tsc --noEmit` clean.
