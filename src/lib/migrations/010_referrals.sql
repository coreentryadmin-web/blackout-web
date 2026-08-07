-- Referral program MVP (2026-08-07) — see docs/marketing/SEO-GROWTH.md finding #3.
--
-- The referral "code" is just the referrer's Clerk user ID (?ref=<userId> on any
-- public URL) — no separate code-generation/lookup table needed for an MVP. A row
-- is written once, at signup, by src/app/api/referrals/attribute/route.ts; the
-- unique index on referred_user_id means the first ?ref= link that leads to a
-- signup wins and later attribution attempts for the same user are silent no-ops
-- (a user can't be double-attributed to two different referrers).
--
-- Status ladder: signed_up -> converted (Whop payment.success webhook matches a
-- pending row for that user) -> rewarded (a Whop promo code was successfully
-- minted for the referrer; reward_code holds it). converted rows without a
-- reward_code mean the WHOP_COMPANY_ID reward-mint step was unconfigured or
-- failed — see src/lib/referrals.ts.
--
-- NOTE: the authoritative copy of this DDL is inlined in src/lib/db.ts
-- runMigrations() (that inline version is what actually runs on ECS cold-start).
-- This file mirrors it for documentation/consistency with 004-009.
CREATE TABLE IF NOT EXISTS referrals (
  id BIGSERIAL PRIMARY KEY,
  referrer_user_id TEXT NOT NULL,
  referred_user_id TEXT NOT NULL,
  referred_email TEXT,
  status TEXT NOT NULL DEFAULT 'signed_up',
  reward_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  converted_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_referrals_referred_user ON referrals(referred_user_id);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id, created_at DESC);

DO $$ BEGIN
  ALTER TABLE referrals ADD CONSTRAINT referrals_status_ck
    CHECK (status IN ('signed_up', 'converted', 'rewarded'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
