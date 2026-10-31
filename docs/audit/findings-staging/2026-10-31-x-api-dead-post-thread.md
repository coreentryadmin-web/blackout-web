# 2026-10-31 x-api.ts: `postThread` dead-on-arrival thread-posting wrapper, zero callers ever

> **kind:** FINDING

| Field | Value |
| --- | --- |
| **Status** | FIXED |
| **Severity** | P3 code-quality / dead-code removal (confirmed zero behavior change) |

## Root cause

`src/lib/x-api.ts` is the raw X (Twitter) API client (OAuth 1.0a signing, tweet/media/follow/like
calls) used by the whole `x-*` marketing/growth lane. It exported `postThread(texts: string[])` —
post a sequence of tweets as a reply chain (first tweet via `postTweet`, each subsequent one via
`postReply(text, parentId)`, 1.2s between posts) — added in commit `01c71095a` ("growth engine —
engage cron, Whop footer, ECS secret sync", 2026-07-20), whose own commit message describes the
change as "Extend x-api with likes, RTs, follows, **threads**, user timeline reads."

That commit bundled several new capabilities together. Most were adopted into real call sites
over the following months: likes/RTs/follows → `src/lib/x-engage-engine.ts`; user timeline reads
(`fetchUserTweets`) → `scripts/x-cleanup-low-quality.mjs`/`scripts/x-cleanup-tag-spam.mjs`.
**`postThread` never was.** `git log --all --oneline -S"postThread("` returns only the three
commits from that single 2026-07-20 day that introduced and lightly touched it (`01c71095a`,
`6ee09cb68`, `d84f7e2ee`) — no later commit, in the history of either branch, ever adds a call
site. A repo-wide grep (`.ts`/`.tsx`/`.js`/`.mjs`/`.cjs`, including every test file and every
script) matches only its own `export async function postThread(...)` definition line — no import,
no call, no test reference anywhere.

It is referenced once outside its own file, in `docs/agents/briefs/x-content.md`'s "PUBLISHING
AUTHORITY" section, which lists it alongside `postTweet`/`tweetWithImage`/`postReply`/
`postQuoteTweet` as capabilities content-generation agents must never call directly. That doc does
not establish intent to wire it up — it is a blanket, deliberately over-inclusive safety list of
every tweet-producing primitive in `x-api.ts`, and three of its four siblings (`postTweet`,
`postReply`, `tweetWithImage`) genuinely are wired into `src/app/api/cron/x-autopost/route.ts` /
`scripts/x-live-autopost.mjs` / `scripts/x-showcase-post.mjs`, and the fourth (`postQuoteTweet`)
into `x-engage-engine.ts` — so the list's presence doesn't distinguish "live" from "never wired"
the way a feature-intent comment would. Checked for the usual markers of deliberate
pre-launch scaffolding (the pattern that correctly protected `tiktok-api.ts`'s `postPhoto`/
`fetchPublishStatus` and `x-intel`'s `viewsForSurface`/`scoreAttachmentPackage` from deletion in
earlier rounds of this sweep): no "dark-ship"/"not yet wired"/TODO comment anywhere in
`x-api.ts` near `postThread`, no sibling "almost wired" code suggesting a wiring gap (unlike e.g.
`VECTOR_VIEW_STORAGE_KEY`, deferred earlier because its two sibling storage-key constants in the
same file WERE wired, suggesting a missing-wiring bug rather than abandonment), and no dedicated
feature-build history in this repo's docs the way the X-intel queue/capture-harness scaffolding
has. The evidence here points the other way: a capability bundled into a larger commit alongside
siblings that did get adopted, while this one specifically never did, in over three months of the
same lane actively shipping features.

## Evidence

- `grep -rn "\bpostThread\b"` across `src/`, `scripts/`, `.github/` (`.ts`/`.tsx`/`.js`/`.mjs`/
  `.cjs`/`.yml`) before the fix: only `src/lib/x-api.ts:279`, its own definition.
- `git log --all --oneline -S"postThread("`: exactly three commits, all from 2026-07-20 (the
  introducing day) — no caller ever added, before or since.
- `docs/agents/briefs/x-content.md:99` was the only other repo reference, in a blanket
  don't-call-any-posting-primitive safety list — updated in this fix to note the removal rather
  than left pointing at a deleted symbol.
- Zero-reference proof stands in for a RED→GREEN stash proof (per the dead-code removal
  discipline — no caller-observable behavior to regress, because no caller exists). A fresh
  `git fetch origin main` immediately before staging reconfirmed `postThread` still present and
  untouched by any other open/mid-CI PR.

## Blast radius

None beyond the function itself. `postTweet` and `postReply` (the two helpers it called) remain
exported and are used by `x-autopost`, `x-live-autopost.mjs`, `x-showcase-post.mjs`,
`x-engage-engine.ts`, and `x-mention-replies.ts` — all unchanged, re-verified green post-fix
(`x-engage-engine.test.ts`, `x-post-guard.test.ts`, `admin-x-analytics.test.ts`). The "Threads /
replies" section comment in `x-api.ts` is left in place — it still correctly groups `postReply`
(a thread-reply primitive) and `postQuoteTweet`.

## Fix

Removed the unused `postThread` export (14 lines) from `src/lib/x-api.ts`. Updated the one stale
external reference in `docs/agents/briefs/x-content.md` so the publishing-authority prohibition
list no longer names a function that doesn't exist, with a one-line note on how trivial it would
be to rebuild if thread-posting is ever actually wanted (a `postTweet`/`postReply` loop, exactly
what this function was). Added a regression test to `src/lib/x-api.test.ts` asserting
`postThread` is not re-exported, importing the module's full namespace (`import * as xApi from
"./x-api"`) so a future thin re-export without a real caller fails loudly rather than silently
reintroducing dead code.

## Verify

- `npx tsx --experimental-test-module-mocks --test src/lib/x-api.test.ts` — RED pre-fix (the new
  test fails: `postThread` is still an `AsyncFunction`), GREEN post-fix (5/5), proven via
  `git stash` on `src/lib/x-api.ts` alone.
- `npx tsx --experimental-test-module-mocks --test src/lib/x-engage-engine.test.ts
  src/lib/x-post-guard.test.ts src/lib/admin-x-analytics.test.ts` — 6/6 green (unaffected
  callers of the surviving `x-api.ts` exports).
- `npx tsc --noEmit` — clean.
- `npx eslint src/lib/x-api.ts src/lib/x-api.test.ts` — clean.
