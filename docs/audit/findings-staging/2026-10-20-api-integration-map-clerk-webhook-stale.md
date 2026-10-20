> **kind:** FINDING

## `docs/API_INTEGRATION_MAP.md` listed the Clerk `user.*` webhook as a missing P1 gap it already shipped — FIXED

| **Status** | Fixed |
|---|---|

**Found:** 2026-10-20, DISCOVERY-lane stale-docs sweep (`docs/audit/FULL-LIFECYCLE SCOPE EXPANSION`
mandate), via a background Explore-agent cross-check of doc claims against current code.

**Root cause:** `docs/API_INTEGRATION_MAP.md` (last full pass dated 2026-06-26) listed the Clerk
`user.created`/`user.updated`/`user.deleted` webhook as `🟡 UNUSED-valuable... still missing` (line
130) and `🔴 GAPS: no user.deleted cleanup → ... GDPR gap` (line 134), with a matching P1 row (#1) on
the open-gap scoreboard. But `src/app/api/webhooks/clerk/route.ts` already implements all three event
types: `user.created`/`user.updated` sync into `upsertAdminUserRow` + `syncWhopMembershipForEmail`
(lines 108-201), and `user.deleted` calls `deleteUserDataForClerkId(clerkId)` with fail-closed
500-on-error handling (so Clerk retries) — explicitly the GDPR cleanup the doc said was missing. `git
log` traces this to `fix(admin): accurate user filters, larger pages, global stats (#815)`, merged
2026-07-19 — three weeks after the doc's own stated last-pass date. The doc's own header already
flags a different section (Infra, lines 162-170) as stale, showing the maintenance discipline exists;
this particular item was simply missed in that pass.

**Live impact:** low-severity (documentation only, no runtime effect) but this is an active,
consulted "open gap scoreboard" — exactly the kind of doc an engineer or future audit pass might
prioritize work against. Carrying a closed P1 as open risks real wasted effort re-investigating or
re-implementing something that already shipped three months ago.

**Fix:** moved the webhook's actual behavior into the `✅ USED` line (naming the file and the
closing PR), trimmed it out of `🟡 UNUSED-valuable` and `🔴 GAPS` (both still correctly flag their
other, genuinely-still-open items — session-token custom claims and uncached admin `getUser()`),
removed scoreboard row #1, and added a "Closed since this pass" note explaining when/why it closed
and that the doc hadn't caught up until now. Updated the header's `TaskList #1–#9` reference to
`#2–#9` with a pointer to the scoreboard note.

**Blast radius:** doc-only; no code touched. Grepped repo-wide for other references to this doc's
claim — none found; this was the only stale copy.

**Test:** none applicable — docs-only change, no runtime behavior. Verified by reading
`src/app/api/webhooks/clerk/route.ts` directly (lines 108, 115, 202-213) and `git log` for PR #815's
merge date, rather than trusting the doc's own prior claim.
