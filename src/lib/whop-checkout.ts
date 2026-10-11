const legacyCheckout = process.env.NEXT_PUBLIC_WHOP_CHECKOUT_PRO ?? "";

// Only `monthly` and `store` actually fall back to the legacy NEXT_PUBLIC_WHOP_CHECKOUT_PRO
// var below (see WHOP_CHECKOUT) — `yearly`/`community` have no legacy equivalent and fall
// back to "" unconditionally. The missing-var check below must mirror that exactly: treating
// "legacyCheckout is set" as covering ALL four vars silenced the warning even when
// yearly/community were genuinely empty (found live 2026-10-11 — a partial legacy-var
// migration, legacyCheckout set but yearly/community unset, silently dropped the Yearly and
// SPX Slayer checkout options from the upgrade page with zero log signal).
const CHECKOUT_VAR_HAS_LEGACY_FALLBACK: Record<string, boolean> = {
  NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: true,
  NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY: false,
  NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY: false,
  NEXT_PUBLIC_WHOP_STORE_URL: true,
};

/** Pure + testable: which checkout vars are genuinely unconfigured given env + legacy fallback. */
export function missingWhopCheckoutVars(env: NodeJS.ProcessEnv): string[] {
  const legacy = env.NEXT_PUBLIC_WHOP_CHECKOUT_PRO ?? "";
  const requiredVars: Record<string, string | undefined> = {
    NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY: env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY,
    NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY: env.NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY,
    NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY: env.NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY,
    NEXT_PUBLIC_WHOP_STORE_URL: env.NEXT_PUBLIC_WHOP_STORE_URL,
  };
  return Object.entries(requiredVars)
    .filter(([k, v]) => !v && !(CHECKOUT_VAR_HAS_LEGACY_FALLBACK[k] && legacy))
    .map(([k]) => k);
}

// Runtime guard: warn loudly when checkout env vars are missing so the
// missing-config issue is visible in logs rather than silently producing an
// empty upgrade page.
const missingVars = missingWhopCheckoutVars(process.env);
if (missingVars.length > 0) {
  console.warn(
    "[whop-checkout] Missing required env vars — upgrade page will show fallback message. " +
      "Set the following variables: " +
      missingVars.join(", ")
  );
}

export const WHOP_CHECKOUT = {
  community: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_COMMUNITY ?? "",
  monthly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY ?? legacyCheckout,
  yearly: process.env.NEXT_PUBLIC_WHOP_CHECKOUT_YEARLY ?? "",
  store: process.env.NEXT_PUBLIC_WHOP_STORE_URL ?? legacyCheckout,
};

/**
 * User-facing fallback shown on the upgrade page when no checkout URLs are
 * configured. Prevents the page from rendering an empty options list.
 */
export const WHOP_CHECKOUT_UNAVAILABLE_MESSAGE =
  "Checkout offline — stand by, or reach billing@blackouttrades.com.";

// Displayed prices. NOTE: these are UI labels only — the amount actually charged is
// configured on the Whop product behind each checkout URL. Keep these in sync with the
// Whop product prices so customers never see one price and get charged another.
export const WHOP_COMMUNITY_CHECKOUT_OPTION = WHOP_CHECKOUT.community
  ? { label: "SPX Slayer — $49", href: WHOP_CHECKOUT.community }
  : null;

export const WHOP_PREMIUM_CHECKOUT_OPTIONS = [
  { label: "Monthly — $199", href: WHOP_CHECKOUT.monthly },
  { label: "Yearly — $1,999", href: WHOP_CHECKOUT.yearly },
].filter((option) => option.href);
