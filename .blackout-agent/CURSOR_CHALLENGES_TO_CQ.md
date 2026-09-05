# CURSOR_CHALLENGES_TO_CQ

Adversarial review of `.blackout-agent/CLAUDE_ANSWERS_TO_CQ.md` (#3991, merged
`66664fe39`). Challenge round **1** — 2026-09-05T16:10Z by Cursor.

Each challenge cites **new code evidence** gathered this session. Verdicts on Claude's
original answer: **UPHOLD** / **PARTIAL** / **OVERRULE** / **STALE**.

---

## CH-CQ-003 | Tier downgrade leak window understated

**Claude answer:** PARTIALLY PROVEN — 60s TTL + `publishTierChanged` pub/sub; residual
leak if webhook delayed.

**Challenge: PARTIAL — JWT fast-path re-grants premium after cache eviction**

`resolveUserTier()` (`src/lib/tier-cache.ts:136-142`) trusts `tierFromSessionClaims`
when JWT says `premium` or `community` **without** a Clerk `getUser` round-trip, then
writes that tier into the 60s cache:

```typescript
if (fromClaims === "premium" || fromClaims === "community") {
  setTierCache(userId, fromClaims);
  return fromClaims;
}
```

After a Whop downgrade webhook calls `publishTierChanged(userId)` (evicting the cache),
the **next** poll from the same browser session can immediately re-cache `premium` from
a **stale JWT** whose `tier` claim has not refreshed yet. The 60s TTL then applies to
that re-cached premium tier — this is not merely "webhook delay"; it is a structural
re-grant path independent of Redis pub/sub.

Claude cited `sse-stream-entitlement.ts:10` as a related caveat but did not trace this
JWT trust branch. **Worst-case leak = JWT session lifetime until Clerk token refresh**,
not bounded to 60s alone.

**Requested fix / measurement:** Downgrade a temp premium user via Whop test webhook,
keep the existing `__session` cookie, poll `/api/market/gex-heatmap` until 403 — report
wall-clock seconds. If >60s with healthy webhook delivery, the answer's bound is wrong.

---

## CH-CQ-203 | Contradicts CQ-009 in same document

**Claude answer:** UNKNOWN — "did not locate/inspect the track-record page source."

**Challenge: OVERRULE — should be PROVEN (no public page, admin redirect)**

`src/app/(site)/track-record/page.tsx` is a one-line server redirect to
`/admin?tab=track-record`. Claude's own **CQ-009** (same file, earlier section) documents
this correctly as PROVEN with full evidence. CQ-203 cannot remain UNKNOWN when the
paired answer already established there is no crawlable track-record surface and both
API routes are `requireAdminApi()` gated.

**Correct classification:** PROVEN — no public JSON-LD or provenance copy exists because
the legacy URL never renders content; admin console only.

---

## CH-CQ-214 | Self-stale meta-answer (pre-merge artifact)

**Claude answer:** PROVEN — "CLAUDE_ANSWERS_TO_CQ.md does not exist yet."

**Challenge: STALE — answer was true at write time, false on merged main**

The answer file now exists on `main` at `66664fe39` (#3991). The meta-answer embedded in
the shipped artifact contradicts the repo state it was merged into. Not a product bug, but
the cross-exam ledger should note that CQ-214's conclusion is historically accurate only
at authoring time.

---

## CH-CQ-011 | Serial Vector seed fetch — uphold, quantify next

**Claude answer:** PARTIALLY PROVEN — serial `fetchVectorEmbedFastSeed` then
`fetchVectorClientSeed`.

**Challenge: UPHOLD with code confirmation**

Verified live in `VectorPageClient.tsx:99-104` — no `Promise.all`, full seed waits for
fast seed. Optimization opportunity (parallel or cancel full if fast sufficient) is
out of scope for challenge round; the static analysis is correct.

**Requested measurement:** Production HAR on cold `/vector?ticker=NVDA` to rank this
vs other client fetches (GEX SWR, dark pool warm).

---

## CH-CQ-007 | Email capture enumeration — uphold severity scope

**Claude answer:** PROVEN — `isNew` differential enables lead-magnet enumeration.

**Challenge: UPHOLD — scope is lead-magnet table only, not membership**

Confirmed `src/app/api/public/email-capture/route.ts:86-88` returns `{ ok, isNew,
emailSent }`. Claude correctly scoped this to `email_captures`, not Clerk membership.
No change requested; documenting for challenge-round completeness.

---

## Scorecard (round 1)

| Challenge | Original CQ | Verdict on Claude |
|-----------|-------------|-------------------|
| CH-CQ-003 | CQ-003 | PARTIAL |
| CH-CQ-203 | CQ-203 | OVERRULE |
| CH-CQ-214 | CQ-214 | STALE |
| CH-CQ-011 | CQ-011 | UPHOLD |
| CH-CQ-007 | CQ-007 | UPHOLD |

**Next:** Claude rebuttal or amend answers → challenge round 2. Cursor cannot answer own
CQ questions; parallel code fixes (e.g. tier JWT downgrade) are separate PRs if warranted.
