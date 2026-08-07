import "server-only";

/**
 * Whop native affiliate program — read + enrol.
 *
 * WHY THIS REPLACES A CUSTOM REFERRAL TABLE
 * -----------------------------------------
 * Whop runs a first-class affiliate program on every company, ON BY DEFAULT at 30%. It owns the
 * whole hard half of a referral system: the affiliate link, cookie attribution at ITS OWN checkout
 * (so nothing has to survive our off-site hop), commission calculation, holding the funds, fraud,
 * and the payout itself. We cannot beat that by writing a `referrals` table, and we should not try
 * to — paying referrers means moving real money, which stays with the payment partner.
 *
 * This was verified live against the production company (biz_wvKo8ZdB4n1GA5) on 2026-08-07: the
 * program is already running and already has affiliates, one of whom has driven 5 referrals, with
 * no surface anywhere in our product. This module exists to surface it.
 *
 * API SHAPE (verified live, not from docs alone):
 *   GET  /v1/affiliates?company_id=…   200 — list, rich per-affiliate stats
 *   GET  /v1/affiliates/{aff_id}       200 — single record
 *   POST /v1/affiliates                     — create-or-find by `user_identifier`
 * NOTE the version: affiliates live on **v1**. The `/api/v2/*` surface has no affiliate routes and
 * answers EVERY unrouted path with a blanket 401 ("does not have permission to access this route"),
 * which looks like a scope error but is not — an invented endpoint returns the identical message.
 * v1 by contrast returns an honest 404. Do not re-derive the affiliate API from a v2 probe.
 *
 * LIMITATION: Whop ships no affiliate.* webhook, so stats are pull-only. That is fine for an
 * /account panel rendered on demand; it rules out event-driven "you earned a commission" pushes.
 */

const WHOP_V1 = "https://api.whop.com/v1";

/** Per-affiliate stats as Whop returns them. Money/percent fields arrive PRE-FORMATTED as display
 *  strings ("$0.00", "0.0%") — they are not numbers, so never do arithmetic on them. */
export type WhopAffiliate = {
  id: string;
  status: string;
  created_at: string;
  total_referrals_count: number;
  total_referral_earnings_usd: string;
  customer_retention_rate: string;
  monthly_recurring_revenue_usd: string;
  total_revenue_usd: string;
  active_members_count: number;
  user?: { id?: string; name?: string | null; username?: string | null } | null;
};

function companyId(): string {
  const c = process.env.WHOP_COMPANY_ID;
  if (!c) throw new Error("WHOP_COMPANY_ID not configured");
  return c;
}

async function whopV1<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.WHOP_API_KEY;
  if (!key) throw new Error("WHOP_API_KEY not configured");
  const res = await fetch(`${WHOP_V1}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`whop v1 ${path} -> ${res.status} ${text.slice(0, 200)}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Every affiliate on the company. Paginated by Whop; we page through so a member low in the list
 *  still resolves (the list is company-wide, not per-user — there is no by-user filter). */
export async function listAffiliates(): Promise<WhopAffiliate[]> {
  const out: WhopAffiliate[] = [];
  let after: string | null = null;
  // Bounded: an affiliate roster large enough to exceed this needs a real index, not a bigger loop.
  for (let page = 0; page < 20; page++) {
    const qs = new URLSearchParams({ company_id: companyId(), first: "50" });
    if (after) qs.set("after", after);
    const body = await whopV1<{
      data?: WhopAffiliate[];
      page_info?: { end_cursor?: string | null; has_next_page?: boolean };
    }>(`/affiliates?${qs.toString()}`);
    out.push(...(body?.data ?? []));
    if (!body?.page_info?.has_next_page || !body.page_info.end_cursor) break;
    after = body.page_info.end_cursor;
  }
  return out;
}

/**
 * Find the affiliate record belonging to a Whop user id (`user_xxx`).
 *
 * `users.whop_user_id` is populated by the membership sync and is the SAME id space as the
 * affiliate record's `user.id`, so this resolves anyone who enrolled through Whop's own UI —
 * including the affiliates that already exist without us ever having built an enrol button.
 * Returns null (not an error) when the member simply is not an affiliate yet.
 */
export async function findAffiliateForWhopUser(whopUserId: string | null | undefined): Promise<WhopAffiliate | null> {
  if (!whopUserId) return null;
  const all = await listAffiliates();
  return all.find((a) => a.user?.id === whopUserId) ?? null;
}

/**
 * Enrol a member as an affiliate. Whop's create endpoint is CREATE-OR-FIND on `user_identifier`
 * (accepts an email), so calling it for someone already enrolled returns their existing record
 * rather than duplicating — which is what makes it safe to wire to a member-facing button.
 */
export async function enrolAffiliate(userIdentifier: string): Promise<WhopAffiliate> {
  return whopV1<WhopAffiliate>("/affiliates", {
    method: "POST",
    body: JSON.stringify({ company_id: companyId(), user_identifier: userIdentifier }),
  });
}

/**
 * Where a member goes to get their own affiliate link and assets.
 *
 * We deliberately do NOT synthesize the share link ourselves. The affiliate API returns no link
 * field (verified: the record exposes only id/status/stats/user/company), so any URL we built would
 * be an unverified guess at Whop's attribution format — and a referral link that looks right but
 * silently attributes nothing is worse than no link at all: the member shares it, earns nothing,
 * and blames us. Whop's own affiliate UI is the authoritative source for the link, so we send them
 * there and show their real earnings here.
 *
 * If the `?a=<username>` format is later confirmed against Whop's UI, rendering the link inline is
 * a safe follow-up — but confirm an actual attributed conversion first.
 */
export const WHOP_AFFILIATE_DASHBOARD_URL = "https://whop.com/dashboard/affiliate";
