/**
 * GOOGLE ADS CONVERSION TRACKING.
 *
 * The account reads NOT_CONVERSION_TRACKED with 0 conversion actions because this file did not
 * exist. GA4 events are NOT Google Ads conversions: `pricing_view`, `sign_up` and `purchase` have
 * been firing to G-YLN4K37KYF for months, and Google Ads has received none of them. Smart Bidding
 * needs a conversion action in the Ads account, populated either by an `AW-` tag hit or by a GA4
 * import that somebody has to configure. This adds the tag hits.
 *
 * ── THE FAILURE THIS FILE IS BUILT AROUND ────────────────────────────────────────────────────
 *
 * "Optimizing toward an event Google never receives is dead on arrival." The way that actually
 * happens is not a missing call — it is a call that LOOKS fine. `gtag('event','conversion',{
 * send_to: 'AW-undefined/undefined' })` returns without error, appears in the console, appears in
 * the network tab, and is discarded server-side. Every local check passes and the account stays
 * at zero.
 *
 * So this module fails CLOSED and loudly:
 *  - No conversion id, or no label for that action → nothing is sent, and `conversionStatus()`
 *    reports exactly which piece is missing.
 *  - A conversion id that does not match the real `AW-<digits>` shape is REJECTED, so a
 *    copy-pasted `AW-XXXXXXXXX` placeholder cannot ship and pretend to work.
 *  - A label that still looks like a placeholder is rejected on the same grounds.
 *
 * ── WHY VALUE MATTERS MORE THAN THE EVENT ────────────────────────────────────────────────────
 *
 * A Purchase conversion with a flat value teaches Smart Bidding that a $49 community signup and a
 * $1,999 annual are worth the same, and it will happily buy ten of the former. The value passed
 * here is the plan the member actually clicked, recovered across the Whop round-trip.
 *
 * PURE: no IO. The gtag call is the only side effect and it is guarded on the browser.
 */

/** The three actions. Signup and Purchase are PRIMARY (biddable); pricing view is observation. */
export type GoogleAdsAction = "signup" | "purchase" | "pricing_view";

export const GOOGLE_ADS_PRIMARY_ACTIONS: readonly GoogleAdsAction[] = ["signup", "purchase"];

/**
 * A real conversion id is `AW-` plus 9–11 digits. The pattern exists to reject the placeholder,
 * which is the single most likely thing to be deployed by accident: it is what Google's own docs
 * show, it is what a half-finished .env carries, and it fails silently.
 */
const CONVERSION_ID_RE = /^AW-\d{9,11}$/;

/**
 * Labels are opaque Google-issued strings — roughly 11 characters of mixed-case alphanumerics,
 * sometimes with `-` or `_`. We cannot validate their content, only reject values that mean
 * "nobody filled this in".
 *
 * MATCHED WHOLE, NEVER AS A PREFIX. An earlier version of this pattern included `abc.*` and
 * `123.*`, which rejected any real label beginning with those characters — a legitimate,
 * Google-issued label would have been silently dropped and the conversion would never have fired.
 * That is precisely the failure this module exists to prevent, so the rule is now: reject only
 * values that are ENTIRELY a placeholder word, and accept anything else. A false accept costs a
 * confusing verifier line; a false reject costs every conversion for that action.
 */
const PLACEHOLDER_LABEL_RE =
  /^(?:x{2,}|placeholder|todo|tbd|label|changeme|change[_-]?me|your[_-]?label|none|null|undefined)$/i;

function envValue(raw: string | undefined): string | null {
  const v = raw?.trim();
  return v ? v : null;
}

export function googleAdsConversionId(): string | null {
  const id = envValue(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID);
  if (!id || !CONVERSION_ID_RE.test(id)) return null;
  return id;
}

export function googleAdsLabel(action: GoogleAdsAction): string | null {
  const raw =
    action === "signup"
      ? process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP
      : action === "purchase"
        ? process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE
        : process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PRICING_VIEW;
  const label = envValue(raw);
  if (!label || PLACEHOLDER_LABEL_RE.test(label)) return null;
  return label;
}

/**
 * Build the `send_to` target, or null when this action cannot be sent.
 *
 * Returning null rather than a partially-built string is the whole point — see the file header.
 */
export function googleAdsSendTo(action: GoogleAdsAction): string | null {
  const id = googleAdsConversionId();
  const label = googleAdsLabel(action);
  if (!id || !label) return null;
  return `${id}/${label}`;
}

export type ConversionStatus = {
  configured: boolean;
  conversionId: string | null;
  /** Per-action readiness, so a half-configured account is visible instead of silently partial. */
  actions: Record<GoogleAdsAction, boolean>;
  /** Human-readable reasons, for the pre-launch verifier. Empty when fully configured. */
  problems: string[];
};

/**
 * What is and is not wired, computed from the environment.
 *
 * The pre-launch verifier reads this. "Verify each fires a real event before launch" is only
 * meaningful if the thing being verified can report its own gaps rather than being inspected by
 * eye.
 */
export function conversionStatus(): ConversionStatus {
  const conversionId = googleAdsConversionId();
  const problems: string[] = [];
  if (!conversionId) {
    problems.push(
      envValue(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID)
        ? "NEXT_PUBLIC_GOOGLE_ADS_ID is set but is not a real AW-<9-11 digits> id (placeholder?)"
        : "NEXT_PUBLIC_GOOGLE_ADS_ID is not set — no conversion can be sent"
    );
  }
  const actions = { signup: false, purchase: false, pricing_view: false } as Record<
    GoogleAdsAction,
    boolean
  >;
  for (const action of ["signup", "purchase", "pricing_view"] as GoogleAdsAction[]) {
    const ok = googleAdsSendTo(action) != null;
    actions[action] = ok;
    if (!ok && conversionId) {
      problems.push(`no usable conversion label for "${action}"`);
    }
  }
  return { configured: problems.length === 0, conversionId, actions, problems };
}

type GtagFn = (...args: unknown[]) => void;

function gtag(): GtagFn | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { gtag?: GtagFn }).gtag;
  return typeof fn === "function" ? fn : null;
}

export type ConversionPayload = {
  send_to: string;
  value?: number;
  currency?: string;
  transaction_id?: string;
};

/**
 * Build the payload Google receives, or null if this conversion must not be sent.
 *
 * Split from the send so it can be asserted in tests and by the pre-launch verifier without a
 * browser — the payload is the thing that is either right or silently wrong.
 *
 * A monetary action with a non-finite or non-positive value is REFUSED rather than sent at 0.
 * A 0-value purchase is worse than a missing one: it is counted, it drags the reported
 * conversion value down, and Smart Bidding learns that purchases are worthless.
 */
export function buildConversionPayload(
  action: GoogleAdsAction,
  opts: { value?: number; currency?: string; transactionId?: string } = {}
): ConversionPayload | null {
  const send_to = googleAdsSendTo(action);
  if (!send_to) return null;

  const payload: ConversionPayload = { send_to };

  if (action === "purchase") {
    const value = opts.value;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
    payload.value = value;
    payload.currency = opts.currency ?? "USD";
    // Google dedupes on transaction_id. Without one, a page refresh or a re-mount double-counts
    // the sale; with a WRONG one (e.g. a value reused across purchases) a genuine second purchase
    // is deduped away and never counted. See purchaseTransactionId.
    if (opts.transactionId) payload.transaction_id = opts.transactionId;
  } else if (typeof opts.value === "number" && Number.isFinite(opts.value) && opts.value > 0) {
    payload.value = opts.value;
    payload.currency = opts.currency ?? "USD";
  }

  return payload;
}

/**
 * A transaction id that is unique per PURCHASE, not per member.
 *
 * The pre-existing GA4 tracker used the bare userId. That is stable across a member's lifetime, so
 * an upgrade (community → yearly) carries the same id as the original purchase and Google dedupes
 * the upgrade away — the highest-value conversions in the funnel are exactly the ones that would
 * go uncounted. Keying on the tier being entered makes each distinct purchase distinct, while
 * still deduping a refresh of the same one.
 */
export function purchaseTransactionId(userId: string, tier: string): string {
  return `${userId}:${tier}`;
}

/**
 * Send a conversion. Returns what was sent, or null if nothing was (unconfigured, no gtag on the
 * page yet, or a refused payload) — so callers and tests can assert the difference between "sent"
 * and "silently skipped" instead of inferring it.
 */
export function trackGoogleAdsConversion(
  action: GoogleAdsAction,
  opts: { value?: number; currency?: string; transactionId?: string } = {}
): ConversionPayload | null {
  const payload = buildConversionPayload(action, opts);
  if (!payload) return null;
  const fn = gtag();
  if (!fn) return null;
  fn("event", "conversion", payload);
  return payload;
}
