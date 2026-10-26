> **kind:** FINDING

## Welcome-sequence drip injects a Clerk first name unescaped into email HTML — FIXED

| | |
|---|---|
| **Area** | `src/lib/email/templates/welcome-sequence.ts` |
| **Severity** | P2 (self-XSS in an HTML email client; highest-volume template — fires on every signup) |
| **Status** | FIXED |
| **PR** | fix/welcome-sequence-firstname-xss |

### Root cause

`welcome-sequence.ts` defines its own local `personalize()` helper for the `{{firstName}}`
token used throughout its 5-step signup drip:

```ts
function personalize(text: string, ctx: WelcomeEmailContext): string {
  const name = ctx.firstName?.trim() || "Trader";
  return text.replace(/\{\{firstName\}\}/g, name);
}
```

This is a bare, unescaped string substitution. `ctx.firstName` is not arbitrary server data —
it comes straight off the Clerk `user.created` webhook's `data.first_name`
(`src/app/api/webhooks/clerk/route.ts:152,192`), i.e. a member's own self-settable Clerk profile
field, with no HTML-safety validation on Clerk's side. The substituted text is then interpolated
directly into raw HTML template strings (`h1()`, `p()`, `closing()`, the subject line) with no
further escaping. A member who sets their Clerk first name to `<script>alert(1)</script>` or
`"><img src=x onerror=alert(1)>` gets that markup rendered live, unescaped, into every one of
this drip's 5 emails — sent automatically, immediately on signup, to that same member's inbox.

This is the exact field and exact risk `src/lib/email/layout.ts`'s own `substituteTokens`/
`escapeHtml` were built to close (see that file's own comment: *"firstName is read from the
member's own self-settable Clerk profile... an unescaped value would let `<script>`/`onerror=`
markup in a display name reach rendered email HTML"*), and every OTHER billing-lifecycle template
in the same directory already routes `firstName` through that shared, escaped helper:

```
welcome-premium.ts, downgrade.ts, scheduled-cancel.ts, payment-failed.ts,
access-ended.ts, welcome-community.ts, cancel-reversed.ts, trial-ending-soon.ts
```

— all `import { substituteTokens } from "@/lib/email/layout"` and build a local `t = (s) =>
substituteTokens(s, tokens)`. `welcome-sequence.ts` alone reimplemented substitution by hand
and never got the escaping. Confirmed against a freshly-fetched `origin/main` before filing this
— the gap is real and current, not something an earlier round already closed.

### Why it wasn't caught earlier

The earlier XSS fix (PR #6844, referenced in `layout.ts`'s own comments) fixed
`substituteTokens` itself. That closed the gap for every template that *calls*
`substituteTokens` — but `welcome-sequence.ts` never called it; it had a parallel,
independently-written substitution function with the same token syntax (`{{firstName}}`) but
none of the escaping. A fix to the shared helper cannot cover a caller that bypasses the helper
entirely, and nothing in this repo's test suite exercised `welcome-sequence.ts`'s `personalize()`
with an HTML-significant name before this finding (`layout.test.ts` tests `substituteTokens`
directly, not this file's local reimplementation of the same idea).

### Blast radius

All 5 steps of `WELCOME_SEQUENCE` (`src/lib/email/templates/welcome-sequence.ts`) use
`personalize()` for both their HTML body and their subject line — every step was affected, not
just step 1. This is also the single highest-volume template in the directory: it fires
automatically for every new signup (`startWelcomeSequence`, wired off the Clerk `user.created`
webhook) and again for steps 2-5 via the `welcome-sequence` cron
(`src/app/api/cron/welcome-sequence/route.ts`), so every member who ever set an HTML-significant
Clerk display name would have received injected markup in their own inbox on every run.

### Fix

`personalize()` now delegates to `layout.ts`'s `substituteTokens` (the same shared, HTML-escaped
helper every sibling template already uses) instead of a bare `.replace()`. Behavior for an
ordinary plain-text name is byte-for-byte unchanged (`substituteTokens` is a drop-in `{{token}}`
substitution); an HTML-significant name is now escaped to display text instead of rendering as
markup, matching the established pattern.

### Evidence (RED → GREEN)

Added `src/lib/email/templates/welcome-sequence-firstname-xss.test.ts`:
- Before the fix: building any of the 5 steps with
  `firstName: "<script>alert('x')</script>"` produced HTML (and a subject, for the steps whose
  subject carries `{{firstName}}`) containing a literal, un-escaped `<script>` tag — 2 of 3 new
  tests failed (RED, confirmed via a real pre-fix run of the new test file).
- After the fix: the same payload comes back HTML-escaped (`&lt;script&gt;...`), an
  `onerror=` attribute-injection attempt is likewise neutralized, and a plain name (`"Alex"`)
  still renders exactly as before — all 3 new tests pass (GREEN).
- Full existing suite for the touched area re-run clean: `welcome-sequence.test.ts` (25/25),
  `welcome-sequence-day4-product-count.test.ts`, `welcome-sequence-day6-track-record-link.test.ts`,
  `layout.test.ts`, every `*.test.ts` under `src/lib/email/`, `src/app/api/cron/welcome-sequence/`,
  and `src/app/api/webhooks/clerk/` — 0 failures.
- `npx tsc --noEmit` clean; `npx eslint` clean on both changed files.

### Fix rationale

Reused the existing, already-tested `substituteTokens` rather than hand-rolling a second escape
routine inside this file — it is the exact helper every sibling template already relies on for
this same token, so this fix makes `welcome-sequence.ts` consistent with the rest of the
directory instead of introducing a third substitution implementation. No gate, schedule, or
copy/content changed — only how the one dynamic token in this file's copy gets substituted.
