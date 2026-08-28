> **kind:** `FINDING`

## Whop trial-ending-soon email — ADDED

| **Status** | Shipped in PR (cursor/whop-trial-ending-nudge-3d11) |
|---|---|

**Problem:** Whop emits `membership.trial_ending_soon` before the first charge, but the webhook ignored it — trialing members got no conversion nudge.

**Fix:** Handler in `app/api/webhook/whop/route.ts` + `trialEndingSoonEmail` template + Redis dedup (`whop-trial-nudge.ts`). Gated on `status === trialing` and resolved `billingKind` (premium/community).

**Evidence:** `whop-trial-nudge.test.ts`, `trial-ending-soon.test.ts`; template wired into `email-template-send.mjs`.
