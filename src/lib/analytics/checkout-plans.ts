import type { Tier } from "@/lib/tiers";

/**
 * The three checkout plans a member can click, and the single source of truth for what each
 * one is worth in USD.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The X/GA4 `begin_checkout` value is keyed by the PLAN the member clicked
 * (yearly $1999 / monthly $199 / community $49). The `purchase` value, fired later from
 * `Ga4ConversionTracker` after the Whop round-trip, only has the member's resulting TIER — and
 * both the monthly and the yearly plan resolve to the same `premium` tier (see @/lib/tiers).
 * So a tier-derived purchase value cannot tell a $1999 yearly buyer from a $199 monthly one, and
 * every yearly purchase was being booked as $199 — the begin_checkout and purchase totals could
 * never reconcile in the ad platform.
 *
 * The fix: remember the clicked plan at checkout time and recover it at purchase time, so both
 * events value the sale from the same `CHECKOUT_PLAN_VALUE_USD` map. When no fresh plan is stored
 * (upgraded through a path that never rendered a CheckoutLink, or storage disabled), fall back to
 * the tier estimate — same behaviour as before, just no longer the ONLY path.
 */
export type CheckoutPlan = "community" | "monthly" | "yearly";

export const CHECKOUT_PLAN_VALUE_USD: Record<CheckoutPlan, number> = {
  community: 49,
  monthly: 199,
  yearly: 1999,
};

const LAST_PLAN_KEY = "bo_checkout_plan";

/**
 * A checkout that actually results in a purchase completes in minutes (click → Whop → return).
 * A stored plan older than this is from an abandoned attempt and must NOT be trusted to value a
 * later, unrelated purchase — better to fall back to the tier estimate than to mis-book it.
 */
const PLAN_TTL_MS = 24 * 60 * 60 * 1000;

function isCheckoutPlan(value: unknown): value is CheckoutPlan {
  return value === "community" || value === "monthly" || value === "yearly";
}

/** Persist the plan the member just clicked so the eventual `purchase` event can value it exactly. */
export function rememberCheckoutPlan(plan: CheckoutPlan, now: number = Date.now()): void {
  try {
    localStorage.setItem(LAST_PLAN_KEY, JSON.stringify({ plan, at: now }));
  } catch {
    /* private mode / storage disabled — purchase falls back to the tier estimate */
  }
}

/**
 * Pure parser split out from {@link readRememberedPlan} so the freshness/validation logic is unit
 * testable without a DOM. Returns the stored plan only if it is well-formed AND within the TTL.
 */
export function parseRememberedPlan(raw: string | null, now: number): CheckoutPlan | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { plan?: unknown; at?: unknown };
    if (typeof parsed?.at !== "number" || now - parsed.at > PLAN_TTL_MS || now - parsed.at < 0) {
      return null;
    }
    return isCheckoutPlan(parsed.plan) ? parsed.plan : null;
  } catch {
    return null;
  }
}

/** Read the remembered plan from storage, or null when absent, stale, malformed, or unavailable. */
export function readRememberedPlan(now: number = Date.now()): CheckoutPlan | null {
  try {
    return parseRememberedPlan(localStorage.getItem(LAST_PLAN_KEY), now);
  } catch {
    return null;
  }
}

/** Clear the remembered plan once a purchase has been valued from it (hygiene against re-use). */
export function clearRememberedPlan(): void {
  try {
    localStorage.removeItem(LAST_PLAN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * The USD value to attribute to a completed purchase. Prefer the exact plan the member clicked
 * (recovered across the Whop round-trip) so a yearly buyer is booked at $1999, not $199; fall back
 * to a tier-derived estimate when no fresh plan is available. `premium` maps to the monthly price
 * as the conservative default (understates rather than overstates a yearly sale); anything below
 * premium is the community price. `purchase` only fires at community+ tier, so `free` never reaches
 * here, but it is handled for totality.
 */
export function purchaseValueUsd(tier: Tier, plan: CheckoutPlan | null): number {
  if (plan) return CHECKOUT_PLAN_VALUE_USD[plan];
  return tier === "premium" ? CHECKOUT_PLAN_VALUE_USD.monthly : CHECKOUT_PLAN_VALUE_USD.community;
}
