## The welcome-drip's day-6 trust claim linked to an admin-gated page it claimed was public

> **kind:** `FINDING`

### Root cause

`src/lib/email/templates/welcome-sequence.ts`'s Day 6 ("Graded blind. Logged forever.") step
builds its entire argument around one claim: every setup is graded before the outcome, win or
loss, and the full record of both is public. The screenshot caption backing that claim read:

```ts
`Recent closed plays. The <a href="${SITE.url}/track-record" ...>full record</a> — every win and
every loss, with the grade each play was given before the outcome — is public.`
```

`/track-record` is not public. `src/app/(site)/track-record/page.tsx` is a bare
`redirect("/admin?tab=track-record")`, and `src/app/(site)/admin/layout.tsx` guards every admin
route with `await requireAdmin()`. A non-admin member — i.e. every recipient of this email —
clicking the single link backing the sequence's strongest trust claim lands on a page they are
immediately redirected away from, never seeing any track record at all.

The genuinely public win/loss record lives at `/methodology` (`buildPublicTrackRecord` /
`buildTrackRecordPagePayload`, rendered under the `(marketing)` route group with no admin gate),
confirmed to expose both `wins` and `losses` (`src/lib/track-record-public.ts`). `RedesignHome.tsx`
already links this same route under the label "Public track record" — this email was the one
place still pointing at the old, now admin-only URL.

### Evidence

Added `src/lib/email/templates/welcome-sequence-day6-track-record-link.test.ts`: builds the real
Day 6 (`step: 4`) email via `WELCOME_SEQUENCE[...].build(...)` and asserts the rendered HTML links
to `/methodology`, never to `/track-record`. Confirmed RED against the pre-fix source (`git stash`
isolating `welcome-sequence.ts`) — both assertions failed (2/2), the HTML contained
`href="https://blackouttrades.com/track-record"` — then GREEN (4/4, including the pre-existing
Day 4 product-count regression test) after the fix. `tsc --noEmit` and `eslint` both clean.

### Blast radius

Single call site: this is the only email template (of the full welcome/billing/lifecycle set
already swept this session) that references `/track-record` directly — every other transparency
reference in the codebase (`RedesignHome.tsx`'s hero-creds link) already points at `/methodology`.
The stale, now-misleading code comment above this step (claiming the email "deliberately does NOT
link to a public track-record page" — written before the link was added, never updated after) is
also corrected to describe the current, verified state.

### Fix rationale

Point the caption's link at `/methodology`, matching the already-correct reference elsewhere in
the codebase and the component that actually proves the claim. No change to the trust claim's
wording itself (it remains accurate — both wins and losses are genuinely public at that URL) or
to any other step in the sequence.

| **Status** | Fixed in PR #TBD (branch `fix/welcome-sequence-stale-track-record-link`) |
|---|---|
