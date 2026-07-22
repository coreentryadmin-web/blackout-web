// Canonical membership pricing — the SINGLE source of truth for every marketing
// surface (homepage tiers, /pricing page, /upgrade). Previously each surface
// hard-coded its own copy, so the three pricing displays could silently drift
// apart. Import these everywhere a price is shown so they can never disagree.
export const MEMBERSHIP_PRICING = {
  /** Community (Discord) — $/mo */
  community: 75,
  /** Premium, billed monthly — $/mo */
  monthly: 199,
  /** Premium, billed yearly — $/yr */
  yearly: 1999,
  /** Yearly savings vs paying monthly for a year — $ */
  yearlySavingsVsMonthly: 389,
  /** Yearly price expressed as an effective monthly rate — $/mo */
  yearlyEffectiveMonthly: 167,
} as const;

/** Format a whole-dollar amount with thousands separators, e.g. 1999 → "$1,999". */
export function usd(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}
