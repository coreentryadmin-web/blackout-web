import { clerkClient } from "@clerk/nextjs/server";
import type { MembershipListResponse } from "@whop/sdk/resources/memberships.js";
import { parseTier, type Tier } from "@/lib/tiers";
import {
  getWhopClient,
  PREMIUM_MEMBERSHIP_STATUSES,
  resolveBillingKindFromMemberships,
  resolveTierFromMembership,
  resolveTierFromMemberships,
  type BillingKind,
} from "@/lib/whop";
import { isMembershipInDunningGrace } from "@/lib/whop-dunning";
import { isMembershipRevoked } from "@/lib/whop-revocation";
import { publishTierChanged } from "@/lib/tier-cache";
import { sortMemberships } from "@/lib/membership-sort";
import { upsertAdminUserRow } from "@/lib/admin-users";

export { sortMemberships } from "@/lib/membership-sort";

type MembershipMetadata = {
  tier?: Tier;
  whop_user_id?: string;
  whop_membership_id?: string;
  membership_kind?: BillingKind;
  /** Set by admin PATCH tier — blocks webhook Whop sync from overwriting manual tier. */
  tier_managed_by?: "admin" | null;
};

/** Admin-set tier via dashboard PATCH; webhook Whop sync must not overwrite until billing sync. */
export function isAdminManagedTier(meta: Record<string, unknown> | undefined): boolean {
  return meta?.tier_managed_by === "admin";
}

/**
 * True for any CURRENTLY-PAID tier that `reconcileAllMemberships`'s downgrade-direction sweep
 * (step 2) must re-check against Whop. Extracted to a pure predicate so the "which tiers get
 * self-healed on churn" question is unit-testable without standing up Clerk/Whop clients —
 * see the bug this fixes in the reconcile function's own comment.
 *
 * Normalizes through `parseTier` (not a raw literal comparison) so the legacy tier aliases
 * "pro"/"elite" are included too — `parseTier` has always coerced those to "premium" for every
 * OTHER consumer of `publicMetadata.tier` (tier-cache.ts's `resolveUserTier` grants real desk
 * access off them right now), but this predicate previously compared the raw string, so a Clerk
 * user whose metadata still carries the pre-"premium"-literal alias was invisible to this sweep —
 * the same shape as the "community" omission fixed below, just one alias layer earlier.
 */
export function isPaidTierForReconcileDowngradeCheck(tier: string): boolean {
  const normalized = parseTier(tier);
  return normalized === "premium" || normalized === "community";
}

/**
 * Which `reconcileAllMemberships` summary bucket a resolved tier belongs in — pure so the
 * three-way split is unit-testable without standing up Clerk/Whop clients, same reasoning as
 * `isPaidTierForReconcileDowngradeCheck` above.
 *
 * `community` (SPX Slayer, $49/mo, added by #1159) is a real, distinct resolved tier from
 * `syncWhopMembershipForEmail` — not a degenerate case of "not premium". A prior version of
 * `syncOne` (this function's only caller) collapsed it to "free" via a bare
 * `tier === "premium" ? "premium" : "free"`, so every reconciled community subscriber was
 * silently mislabeled in the function's own return stats (and therefore in the cron's logged
 * run + the `cron_job_runs.meta_json` row) — the member's real tier was written to Clerk
 * correctly (that write happens inside `syncWhopMembershipForEmail` itself and is unaffected by
 * this classification), but anyone reading the reconcile summary to answer "how many stayed
 * premium vs actually dropped to free this run" saw every community resolution counted as a
 * free-tier one, understating how many paid subscribers the sweep actually confirmed.
 */
export function reconcileStatsBucket(tier: Tier): "premium" | "community" | "free" {
  if (tier === "premium") return "premium";
  if (tier === "community") return "community";
  return "free";
}

/**
 * Pick which membership in `sorted` gets stamped as "the active one" for an email whose overall
 * tier has ALREADY been resolved (via `resolveTierFromMemberships` over the same list). Extracted
 * to a pure predicate — same reasoning as `isPaidTierForReconcileDowngradeCheck`/
 * `reconcileStatsBucket` above — so this is unit-testable without standing up Clerk/Whop clients.
 *
 * `sortMemberships` orders purely by Whop STATUS (active > trialing > completed > past_due >
 * canceling) and recency — it has no notion of premium vs community vs neither. So once an email
 * holds more than one membership (a real premium subscription AND the $49 community add-on is the
 * live case; `communityProducts.includes(productId)` in `resolveTierFromMembership` means these are
 * never the same row), the membership that sorts FIRST is not necessarily the one that actually
 * produced the resolved tier — e.g. a more-recently-created community row can sort ahead of an
 * older, still-active premium row. The previous unconditional
 * `sorted.find((m) => !revoked.has(m.id)) ?? sorted[0]` picked whichever one sorted first
 * regardless of `tier`, so a `tier: "premium"` result could still stamp a COMMUNITY membership's
 * id/plan as `activeMembership`.
 *
 * That desync isn't cosmetic: `activeMembership.plan.id` becomes `activeMembershipPlanId`, which
 * `billing-lifecycle-email.ts` passes straight to `resolveBillingInterval()` to pick monthly-vs-
 * annual copy for the welcome-premium transactional email — so a wrong pick can tell a real,
 * currently-upgrading premium subscriber the wrong billing interval, sourced from a plan id that
 * was never their premium plan. `activeMembership.id`/`activeMembership.user.id` also become the
 * `whop_membership_id`/`whop_user_id` written to Clerk metadata and shown on the admin user
 * dashboard (`/api/admin/users`), so a support lookup for a "premium" user could land on the
 * community membership row instead.
 *
 * Fix: when the resolved tier is paid, prefer the first non-revoked membership whose OWN
 * classification (`resolveTierFromMembership`) actually matches that tier. Falls back to the
 * original "first non-revoked, else first overall" behavior for `tier === "free"` (nothing
 * tier-specific to preserve) or if no membership happens to match (should not occur in practice,
 * since `tier` was derived from this same list, but never leaves `activeMembership` undefined for
 * a non-empty list).
 */
export function pickActiveMembershipForResolvedTier(
  sorted: MembershipListResponse[],
  revoked: ReadonlySet<string>,
  tier: Tier,
  dunningGraceIds?: ReadonlySet<string>
): MembershipListResponse | undefined {
  if (tier !== "free") {
    const matching = sorted.find(
      (m) =>
        !revoked.has(m.id) &&
        resolveTierFromMembership(m, { dunningGraceIds }) === tier
    );
    if (matching) return matching;
  }
  return sorted.find((m) => !revoked.has(m.id)) ?? sorted[0];
}

type EmailTierResolution = {
  tier: Tier;
  billingKind: BillingKind;
  activeMembership?: MembershipListResponse;
};

/**
 * Pure reducer for `syncWhopMembershipForEmail`'s per-email loop (below) — folds ONE email's
 * `resolveMembershipTierForEmail` resolution into the running best-tier/billingKind/
 * activeMembership state for a Clerk user who owns multiple emails. Extracted to a pure
 * function — same reasoning as `pickActiveMembershipForResolvedTier`/
 * `isPaidTierForReconcileDowngradeCheck` above — so this is unit-testable without standing up
 * Clerk/Whop clients.
 *
 * BUG this fixes: the loop used to set `activeMembership` unconditionally from the FIRST email
 * checked (`if (!activeMembership) activeMembership = r.activeMembership`), regardless of THAT
 * email's own resolved tier. `pickActiveMembershipForResolvedTier`'s own free-tier branch
 * deliberately returns an ARBITRARY non-revoked membership (`sorted[0]`) even when the email's
 * overall tier is "free" — correct for resolving a single email ("nothing tier-specific to
 * preserve", per that function's doc comment) — but across MULTIPLE emails for one Clerk user,
 * it meant a free email's throwaway membership could claim the `activeMembership` slot before a
 * LATER email's real community/premium membership was ever folded in (the later email's own
 * `if (!activeMembership)` guard then saw it already non-null and skipped). That reintroduces,
 * one loop level up, exactly the tier/activeMembership desync `pickActiveMembershipForResolvedTier`
 * was written to close for a single email's own list — see that function's doc comment for the
 * full blast radius (`whop_membership_id`/`whop_user_id` written to Clerk metadata, shown on the
 * admin user dashboard, and `activeMembership.plan.id` feeding billing-lifecycle-email's
 * monthly-vs-annual lookup), all of which could end up sourced from a membership that does not
 * match the user's actual resolved tier. Reachable any time a multi-email Clerk user's FIRST
 * checked email is free (owns only a lapsed/non-qualifying Whop row) and a LATER email is the one
 * that actually carries their real community/premium membership.
 *
 * Fix: only ever adopt `activeMembership` from a resolution whose OWN tier is paid (premium wins
 * outright and always re-adopts; the first community resolution is kept once no premium
 * resolution has been seen) — never from a free resolution's arbitrary pick.
 */
export function foldEmailTierResolution(
  state: EmailTierResolution,
  r: EmailTierResolution
): EmailTierResolution {
  let billingKind = state.billingKind;
  if (r.billingKind === "premium") billingKind = "premium";
  else if (r.billingKind === "community" && billingKind !== "premium") billingKind = "community";

  if (r.tier === "premium") {
    return { tier: "premium", billingKind: "premium", activeMembership: r.activeMembership };
  }
  if (r.tier === "community") {
    return {
      tier: "community",
      billingKind,
      activeMembership: state.activeMembership ?? r.activeMembership,
    };
  }
  return { tier: state.tier, billingKind, activeMembership: state.activeMembership };
}

export async function findClerkUsersByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return [];

  const client = await clerkClient();
  const { data } = await client.users.getUserList({
    emailAddress: [normalized],
    limit: 10,
  });

  return data;
}

export async function updateClerkMembershipMetadata(
  clerkUserId: string,
  metadata: MembershipMetadata
) {
  const client = await clerkClient();
  // Use updateUserMetadata (not updateUser) so Clerk performs a server-side
  // deep-merge of publicMetadata rather than a full overwrite. This eliminates
  // the read-modify-write race where two concurrent calls could each read stale
  // metadata and overwrite each other's changes.
  await client.users.updateUserMetadata(clerkUserId, {
    publicMetadata: metadata,
  });
}

async function findWhopUserIdsByEmail(
  email: string,
  companyId: string
): Promise<string[]> {
  const whop = getWhopClient();
  const normalized = email.trim().toLowerCase();
  const userIds = new Set<string>();

  for await (const member of whop.members.list({
    company_id: companyId,
    query: normalized,
  })) {
    const memberEmail = member.user?.email?.toLowerCase();
    if (memberEmail === normalized && member.user?.id) {
      userIds.add(member.user.id);
    }
  }

  return Array.from(userIds);
}

/**
 * Resolve premium/free for ONE email's Whop memberships (no Clerk write). Fail-CLOSED on a
 * member:email:read outage (throws, so the caller leaves the existing tier intact). Extracted so a
 * Clerk user can be resolved across ALL their emails (audit launch-path #2 + #7).
 */
async function resolveMembershipTierForEmail(
  normalized: string,
  companyId: string
): Promise<{ tier: Tier; billingKind: BillingKind; activeMembership?: MembershipListResponse }> {
  const whop = getWhopClient();
  const userIds = await findWhopUserIdsByEmail(normalized, companyId);

  const memberships: MembershipListResponse[] = [];
  // No server-side product_ids/plan_ids filter — resolveTierFromMembership classifies by product OR
  // plan; a product_ids-only filter silently drops plan-identified premium memberships (launch-path #1).
  const membershipParams = {
    company_id: companyId,
    ...(userIds.length ? { user_ids: userIds } : {}),
    statuses: PREMIUM_MEMBERSHIP_STATUSES,
  };

  let sawAnyMembershipRow = false;
  let sawReadableEmail = false;
  for await (const membership of whop.memberships.list(membershipParams)) {
    sawAnyMembershipRow = true;
    if (!userIds.length) {
      const memberEmail = membership.user?.email?.toLowerCase();
      if (memberEmail) sawReadableEmail = true;
      if (memberEmail !== normalized) continue;
    }
    memberships.push(membership);
  }

  if (!userIds.length && memberships.length === 0 && sawAnyMembershipRow && !sawReadableEmail) {
    throw new Error(
      `Cannot resolve membership for ${normalized}: rows returned but every user.email was null ` +
        "(Whop app likely lacks member:email:read). Refusing to downgrade to 'free'."
    );
  }

  const sorted = sortMemberships(memberships);
  // Exclude refunded / charged-back memberships (audit launch-path #6): a refund/dispute webhook adds
  // the membership id to the revocation denylist, so a still-'completed' refunded purchase no longer
  // grants premium.
  const revoked = new Set<string>();
  const dunningGrace = new Set<string>();
  for (const m of sorted) {
    if (m.id && (await isMembershipRevoked(m.id))) revoked.add(m.id);
    if (m.id && m.status === "past_due" && (await isMembershipInDunningGrace(m.id))) {
      dunningGrace.add(m.id);
    }
  }
  const tier = resolveTierFromMemberships(sorted, revoked, dunningGrace);
  const billingKind = resolveBillingKindFromMemberships(sorted, revoked, dunningGrace);
  const activeMembership = pickActiveMembershipForResolvedTier(sorted, revoked, tier, dunningGrace);
  return { tier, billingKind, activeMembership };
}

export async function syncWhopMembershipForEmail(
  email: string,
  opts?: { ignoreAdminTierLock?: boolean }
): Promise<{
  tier: Tier;
  billingKind: BillingKind;
  updatedUserIds: string[];
  /** Plan id backing the resolved tier, when there is one — same precedence as bestTier/
   *  bestBillingKind below. Additive field for billing-lifecycle-email.ts's interval lookup
   *  (monthly vs annual); existing callers destructuring {tier, billingKind, updatedUserIds}
   *  are unaffected. */
  activeMembershipPlanId?: string;
}> {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!companyId) {
    throw new Error("WHOP_COMPANY_ID is required for membership sync");
  }
  const normalized = email.trim().toLowerCase();

  const clerkUsers = await findClerkUsersByEmail(normalized);

  // No Clerk account yet (e.g. paid before signing up): resolve the triggering email so the caller
  // still gets a tier, but there's nothing to write.
  if (clerkUsers.length === 0) {
    const { tier, billingKind } = await resolveMembershipTierForEmail(normalized, companyId);
    return { tier, billingKind, updatedUserIds: [] };
  }

  // Resolve EACH matched Clerk user across ALL their verified emails — premium if ANY of them has a
  // premium membership — and write once. Making the result independent of WHICH email triggered the
  // sync is what stops a single non-purchase address from downgrading a multi-email payer
  // (audit launch-path #7). A member:email:read outage throws out of the inner resolve, aborting the
  // whole sync (caller keeps prior tiers) rather than writing 'free'.
  let bestTier: Tier = "free";
  let bestBillingKind: BillingKind = "free";
  let bestActiveMembershipPlanId: string | undefined;
  const updatedUserIds: string[] = [];
  for (const user of clerkUsers) {
    const existingMeta = (user.publicMetadata ?? {}) as Record<string, unknown>;
    if (!opts?.ignoreAdminTierLock && isAdminManagedTier(existingMeta)) {
      continue;
    }

    const emails = new Set<string>([normalized]);
    const primaryId = user.primaryEmailAddressId;
    for (const addr of user.emailAddresses ?? []) {
      if (addr.id === primaryId || addr.verification?.status === "verified") {
        const e = addr.emailAddress?.toLowerCase();
        if (e) emails.add(e);
      }
    }

    let foldState: EmailTierResolution = { tier: "free", billingKind: "free" };
    for (const e of emails) {
      const r = await resolveMembershipTierForEmail(e, companyId);
      foldState = foldEmailTierResolution(foldState, r);
      if (foldState.tier === "premium") break;
    }
    const { tier: userTier, billingKind: userBillingKind, activeMembership } = foldState;

    await updateClerkMembershipMetadata(user.id, {
      tier: userTier,
      membership_kind: userBillingKind,
      whop_user_id: activeMembership?.user?.id,
      whop_membership_id: activeMembership?.id,
      ...(opts?.ignoreAdminTierLock ? { tier_managed_by: null } : {}),
    });
    const primaryEmail =
      user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ?? normalized;
    await upsertAdminUserRow({
      clerkUserId: user.id,
      email: primaryEmail,
      firstName: user.firstName,
      lastName: user.lastName,
      tier: userTier,
      membershipKind: userBillingKind,
      role: existingMeta.role === "admin" ? "admin" : "member",
      whopUserId: activeMembership?.user?.id ?? null,
    });
    updatedUserIds.push(user.id);
    if (userTier === "premium") {
      bestTier = "premium";
      bestActiveMembershipPlanId = activeMembership?.plan?.id ?? bestActiveMembershipPlanId;
    } else if (userTier === "community" && bestTier !== "premium") {
      bestTier = "community";
      bestActiveMembershipPlanId = activeMembership?.plan?.id ?? bestActiveMembershipPlanId;
    }
    if (userBillingKind === "premium") bestBillingKind = "premium";
    else if (userBillingKind === "community" && bestBillingKind !== "premium") {
      bestBillingKind = "community";
    }
  }

  return { tier: bestTier, billingKind: bestBillingKind, updatedUserIds, activeMembershipPlanId: bestActiveMembershipPlanId };
}

/**
 * Reconcile Whop → Clerk for every relevant user, self-healing dropped/missed webhooks
 * in BOTH directions:
 *  - Emails with an active/grace Whop membership → ensures paid users are `premium`
 *    (fixes the missed-upgrade lockout where a subscriber is stuck on `free`).
 *  - Emails of Clerk users currently marked `premium` OR `community` → re-checks Whop and
 *    downgrades to `free` once the membership has actually lapsed (fixes the revenue leak
 *    where a churned/refunded user keeps a paid tier because no `deactivated` webhook arrived).
 *
 * Work is bounded to (active subscribers ∪ current premium users), not the full user base.
 * Each email is re-resolved via syncWhopMembershipForEmail, which writes the correct tier.
 */
export async function reconcileAllMemberships(opts?: {
  maxEmails?: number;
  concurrency?: number;
}): Promise<{
  checked: number;
  premium: number;
  community: number;
  free: number;
  errors: number;
  capped: boolean;
}> {
  const companyId = process.env.WHOP_COMPANY_ID?.trim();
  if (!companyId) {
    throw new Error("WHOP_COMPANY_ID is required for membership reconcile");
  }

  const emails = new Set<string>();

  // 1) Emails holding an active/grace Whop membership (catches missed upgrades).
  const whop = getWhopClient();
  // No product_ids/plan_ids server filter (see syncWhopMembershipForEmail): the discovery pass must
  // enumerate ALL active/grace memberships so plan-identified premium subscribers are also found;
  // step 3 re-resolves each (classifying by product OR plan).
  const params = {
    company_id: companyId,
    statuses: PREMIUM_MEMBERSHIP_STATUSES,
  };
  for await (const membership of whop.memberships.list(params)) {
    const email = membership.user?.email?.toLowerCase();
    if (email) emails.add(email);
  }

  // 2) Emails of Clerk users currently marked premium OR community (catches missed downgrades).
  // BUG FIXED HERE: this used to test `tier === "premium"` only. `community` (SPX Slayer, $49/mo,
  // added by #1159) was never added to this check, so a churned/refunded/deactivated community
  // subscriber whose `membership.deactivated` webhook is dropped (the exact failure mode this
  // whole sweep exists to self-heal — see the function's own doc-comment) keeps `community` tier,
  // and therefore /dashboard desk access, FOREVER: nothing else in the system ever re-resolves
  // them, because they're invisible to this loop and the webhook already failed once. Premium
  // members get the safety net every hour; community members got none — an asymmetry with no
  // stated rationale, not a deliberate policy (the community tier PR never touched this filter).
  const client = await clerkClient();
  const pageSize = 100;
  let offset = 0;
  for (;;) {
    const { data } = await client.users.getUserList({ limit: pageSize, offset });
    if (!data.length) break;
    for (const user of data) {
      const tier = String(
        (user.publicMetadata as { tier?: string } | undefined)?.tier ?? ""
      );
      if (isPaidTierForReconcileDowngradeCheck(tier)) {
        // Use the PRIMARY email, not emailAddresses[0] — Clerk does not guarantee [0] is primary,
        // and re-resolving a paying user against an arbitrary secondary address yields 'free' and
        // downgrades a paying multi-email customer (audit launch-path #7). (A fuller per-user
        // resolution — paid if ANY of the account's emails has a membership — is a tracked follow-up.)
        const primaryId = user.primaryEmailAddressId;
        const primary = user.emailAddresses?.find((e) => e.id === primaryId)?.emailAddress;
        const email = (primary ?? user.emailAddresses?.[0]?.emailAddress)?.toLowerCase();
        if (email) emails.add(email);
      }
    }
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  // 3) Re-resolve the truth for each email (in both directions).
  const maxEmails = opts?.maxEmails ?? 5000;
  const concurrency = Math.max(1, Math.min(10, opts?.concurrency ?? Number(process.env.MEMBERSHIP_RECONCILE_CONCURRENCY ?? "5")));
  const targets = Array.from(emails);
  const capped = targets.length > maxEmails;
  const slice = capped ? targets.slice(0, maxEmails) : targets;

  let premium = 0;
  let community = 0;
  let free = 0;
  let errors = 0;

  // Three-way (not two-way) resolution — see reconcileStatsBucket's own doc comment for why
  // `community` must not collapse into `free` here.
  async function syncOne(email: string): Promise<"premium" | "community" | "free" | "error"> {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { tier, updatedUserIds } = await syncWhopMembershipForEmail(email);
        for (const uid of updatedUserIds) publishTierChanged(uid);
        return reconcileStatsBucket(tier);
      } catch (err) {
        const status = (err as { status?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
        if (status === 429 && attempt < 3) {
          await new Promise((r) => setTimeout(r, attempt * 2000));
          continue;
        }
        console.warn(`[membership-reconcile] ${email} attempt ${attempt}:`, err);
        return "error";
      }
    }
    return "error";
  }

  let nextIdx = 0;
  async function worker(): Promise<Array<"premium" | "community" | "free" | "error">> {
    const out: Array<"premium" | "community" | "free" | "error"> = [];
    for (;;) {
      const i = nextIdx++;
      if (i >= slice.length) return out;
      out.push(await syncOne(slice[i]!));
    }
  }
  const batches = await Promise.all(
    Array.from({ length: Math.min(concurrency, slice.length) }, () => worker())
  );
  for (const batch of batches) {
    for (const o of batch) {
      if (o === "premium") premium++;
      else if (o === "community") community++;
      else if (o === "free") free++;
      else errors++;
    }
  }

  if (capped) {
    console.warn(
      `[membership-reconcile] capped at ${maxEmails} of ${targets.length} emails — raise maxEmails if the user base has grown`
    );
  }

  return { checked: slice.length, premium, community, free, errors, capped };
}
