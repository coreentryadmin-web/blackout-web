> **kind:** FINDING

## Whop cancellation ops-alert free text reached Discord unescaped — Markdown/masked-link injection into the internal ops channel

| | |
|---|---|
| **Area** | Ops alerting / Whop billing webhook |
| **Files** | `src/lib/whop-cancellation-notify.ts`, `src/lib/clerk-new-member-notify.ts` |
| **Status** | Fixed |

### Root cause

`buildCancellationNotificationBody` (`src/lib/whop-cancellation-notify.ts`) interpolates two
values straight into the ops Discord notification `content` string with no escaping:

- `cancellationReason` — Whop's own free-text cancellation-survey field. A cancelling member
  types this directly into Whop's cancel flow; it reaches our internal ops Discord channel
  (`#🌩️website-logs`-style) completely unreviewed, the moment the
  `membership.cancel_at_period_end_changed` webhook fires.
- `email` — the local-part of an email address may legally contain Markdown-special characters
  per RFC 5321 (`*_~|^` are all valid unquoted local-part chars), and is itself user-chosen at
  Whop account creation.

Discord renders Markdown (emphasis `*`/`_`, strikethrough/spoiler `~`/`|`, inline code/code
block `` ` ``, blockquote `>`) inside **plain message content**, not just inside embeds — only
the masked-link syntax `[label](url)` is embed-only. So a cancelling member could type a
cancellation reason like `**URGENT** click [here](https://evil.example/phish)` and have it
render with live Markdown formatting inside the internal ops channel the moment they cancel —
the same "unescaped user-controlled text reaching a rendered-as-markup surface" shape that
`src/lib/clerk-new-member-notify.ts` already fixed for the "new member signed up" notification
(its own header comment documents the exact threat model and introduces
`escapeDiscordMarkdown`), just never propagated to this second, independently-written Discord
notifier for the cancellation-reason-capture feature. This is the same "fix shipped for one
consumer, never propagated to a sibling consumer" bug shape this sweep has repeatedly found
across the codebase (`vector-wall-rail-primitive.ts` #7194, `unusual-whales.ts` #7195,
`meridian-earnings-intel.ts` #7197, `vector-wall-event-glyphs.ts` #7198,
`polygon-options-gex.ts` #7200).

### Evidence

`git grep -n notifyOpsDiscord` across the repo shows `whop-cancellation-notify.ts` and
`clerk-new-member-notify.ts` are the ONLY two call sites whose payload includes free-text a
member/sign-up can set (every other `notifyOpsDiscord` caller interpolates only
server-computed tickers, counts, or cron names). `clerk-new-member-notify.ts` escapes both
`firstName`/`lastName` and `email`; `whop-cancellation-notify.ts` escaped neither
`cancellationReason` nor `email`, confirmed by a RED→GREEN regression test:

```
# pre-fix (RED):
'trader@example.com cancels other — "**fake alert** _click here_ `code` > not a quote [link](https://evil.example)". ...'
# the raw, unescaped markdown survives verbatim into the body sent to notifyOpsDiscord
```

Post-fix (GREEN), every Markdown control character in both the free-text reason and an
attacker-shaped email local-part is backslash-escaped, so it renders as literal text.

### Blast radius

Only `whop-cancellation-notify.ts`'s `buildCancellationNotificationBody` was affected — it is
the sole consumer of these two untrusted fields outside `clerk-new-member-notify.ts`. Checked
every other `notifyOpsDiscord`/`postDiscordWebhook` call site in the repo
(`data-correctness`, `cron-staleness-watchdog`, `nighthawk-*` crons, `membership/sync`,
`admin-critical-alerts.ts`, `providers/anthropic.ts`, `cron-run.ts`, `ws/leader-lock-shared.ts`,
`polygon-rate-limiter.ts`, `uw-rate-limiter.ts`) — all of these interpolate only
server-computed values (tickers, counts, cron names, latency numbers), never member-supplied
free text, so none of them carry this gap.

### Fix rationale

Exported the existing `escapeDiscordMarkdown` helper from `clerk-new-member-notify.ts` (it was
previously private to that module, with a header comment explicitly noting "no shared helper
existed... so it is introduced here rather than reused" — now that a second genuine consumer
exists, reusing it is the right call rather than duplicating the regex) and applied it in
`whop-cancellation-notify.ts` to both the free-text cancellation reason and — only when `who`
resolves to the email, not the server-assigned `whopUserId` — the email fallback value.
`whopUserId` is deliberately left unescaped: it's a safe, server-assigned id (e.g.
`user_whop_123`), and blanket-escaping it would mangle its legitimate underscores for no
security benefit (this was caught by the pre-existing "falls back to whopUserId" test, which
regressed under a first, unconditional-escape draft of the fix and was then corrected to
escape only the email branch).

Updated both files' header comments to reflect the shared-helper reuse, so a future reader
doesn't re-read the stale "introduced here rather than reused" claim as still true.

### Regression test

`src/lib/whop-cancellation-notify.test.ts` — two new tests: one proving every Markdown control
character in a free-text cancellation reason (bold, italic, code, blockquote, masked link) is
escaped and the raw unescaped forms do not survive into the body; one proving a masked-link-
shaped email local-part is escaped the same way. Confirmed RED (both fail) against the
pre-fix implementation, GREEN (all 16 tests in the file, plus `clerk-new-member-notify.test.ts`)
against the fix. `tsc --noEmit` clean; `src/app/api/webhook/whop/route.test.ts` and
`src/app/api/webhooks/clerk/route.test.ts` unaffected.
