import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const KEYS = [
  "NEXT_PUBLIC_GOOGLE_ADS_ID",
  "NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP",
  "NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE",
  "NEXT_PUBLIC_GOOGLE_ADS_LABEL_PRICING_VIEW",
] as const;

const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// Imported lazily inside each test: the module reads process.env at call time, so a top-level
// import is fine, but keeping it here documents that these are env-driven pure functions.
const mod = () => import("./google-ads");

function configure(overrides: Partial<Record<(typeof KEYS)[number], string>> = {}) {
  process.env.NEXT_PUBLIC_GOOGLE_ADS_ID = "AW-123456789";
  process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP = "sIgNuP_LaBeL";
  process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE = "pUrChAsE_LaBeL";
  process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PRICING_VIEW = "pRiCiNg_LaBeL";
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
}

test("a fully configured account builds the exact send_to Google expects", async () => {
  const { googleAdsSendTo, conversionStatus } = await mod();
  configure();
  assert.equal(googleAdsSendTo("signup"), "AW-123456789/sIgNuP_LaBeL");
  assert.equal(googleAdsSendTo("purchase"), "AW-123456789/pUrChAsE_LaBeL");
  assert.equal(googleAdsSendTo("pricing_view"), "AW-123456789/pRiCiNg_LaBeL");
  const status = conversionStatus();
  assert.equal(status.configured, true);
  assert.deepEqual(status.problems, []);
});

test("NOTHING is sent when the conversion id is absent", async () => {
  // The state the account is in today. The important property is that this is a hard null rather
  // than a partially-built string — see the next test for why.
  const { googleAdsSendTo, buildConversionPayload, conversionStatus } = await mod();
  for (const action of ["signup", "purchase", "pricing_view"] as const) {
    assert.equal(googleAdsSendTo(action), null, action);
    assert.equal(buildConversionPayload(action, { value: 199 }), null, action);
  }
  const status = conversionStatus();
  assert.equal(status.configured, false);
  assert.match(status.problems[0]!, /is not set/);
});

test("a PLACEHOLDER conversion id is rejected, not shipped", async () => {
  // The single most likely thing to be deployed by accident: it is what Google's docs show, it is
  // what a half-finished .env carries, and `send_to: "AW-XXXXXXXXX/label"` returns without error,
  // appears in the console, appears in the network tab, and is discarded server-side. Every local
  // check passes and the account stays at zero — "optimizing toward an event Google never
  // receives".
  const { googleAdsConversionId, conversionStatus } = await mod();
  for (const bogus of ["AW-XXXXXXXXX", "AW-", "AW-123", "G-YLN4K37KYF", "123456789", "AW-12345678901234"]) {
    configure({ NEXT_PUBLIC_GOOGLE_ADS_ID: bogus });
    assert.equal(googleAdsConversionId(), null, bogus);
  }
  configure({ NEXT_PUBLIC_GOOGLE_ADS_ID: "AW-XXXXXXXXX" });
  assert.match(conversionStatus().problems[0]!, /placeholder/i);
});

test("a placeholder LABEL is rejected the same way", async () => {
  const { googleAdsLabel } = await mod();
  for (const bogus of ["xxxxx", "PLACEHOLDER", "todo", "label", "CHANGEME", "your-label", "  "]) {
    configure({ NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE: bogus });
    assert.equal(googleAdsLabel("purchase"), null, bogus);
  }
});

test("a REAL label is never mistaken for a placeholder", async () => {
  // Caught live: the first version of the placeholder pattern matched `abc.*` and `123.*` as
  // PREFIXES, so a genuine Google-issued label beginning with those characters was silently
  // dropped and the conversion never fired — the exact failure this module exists to prevent.
  // A false accept costs one confusing verifier line; a false reject costs every conversion for
  // that action, invisibly.
  const { googleAdsLabel } = await mod();
  for (const real of [
    "abcDEF_purchase",
    "123abc456",
    "7vJ2CKG3sPQZEP7A9J4o",
    "xY-1_bQ",
    "todoList99",
    "labelled",
    "noneSuch",
  ]) {
    configure({ NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE: real });
    assert.equal(googleAdsLabel("purchase"), real, real);
  }
});

test("a HALF-configured account reports which action is broken", async () => {
  // A partially-wired account is the worst state: some conversions arrive, the account looks
  // tracked, and the missing one is invisible until someone asks why a campaign will not optimise.
  const { conversionStatus } = await mod();
  configure();
  delete process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_PURCHASE;
  const status = conversionStatus();
  assert.equal(status.configured, false);
  assert.equal(status.actions.signup, true);
  assert.equal(status.actions.purchase, false);
  assert.equal(status.actions.pricing_view, true);
  assert.ok(status.problems.some((p) => p.includes("purchase")));
});

test("Purchase carries a real dynamic value and a currency", async () => {
  const { buildConversionPayload } = await mod();
  configure();
  const yearly = buildConversionPayload("purchase", { value: 1999, transactionId: "u_1:premium" });
  assert.deepEqual(yearly, {
    send_to: "AW-123456789/pUrChAsE_LaBeL",
    value: 1999,
    currency: "USD",
    transaction_id: "u_1:premium",
  });
  const community = buildConversionPayload("purchase", { value: 49, transactionId: "u_2:community" });
  assert.equal(community!.value, 49, "a $49 and a $1999 sale must not be booked identically");
});

test("a Purchase with no usable value is REFUSED, not booked at zero", async () => {
  // A 0-value purchase is worse than a missing one: it is counted, it drags reported conversion
  // value down, and Smart Bidding learns that purchases are worthless.
  const { buildConversionPayload } = await mod();
  configure();
  for (const bad of [undefined, 0, -49, NaN, Infinity]) {
    assert.equal(
      buildConversionPayload("purchase", { value: bad as number }),
      null,
      String(bad)
    );
  }
});

test("the pricing-page view is observation only — it carries NO value", async () => {
  // Giving a page view a monetary value lets Smart Bidding buy pricing views instead of customers.
  const { buildConversionPayload } = await mod();
  configure();
  const payload = buildConversionPayload("pricing_view");
  assert.deepEqual(payload, { send_to: "AW-123456789/pRiCiNg_LaBeL" });
  assert.equal(payload!.value, undefined);
  assert.equal(payload!.transaction_id, undefined);
});

test("signup is primary and value-free; purchase and signup are the biddable pair", async () => {
  const { buildConversionPayload, GOOGLE_ADS_PRIMARY_ACTIONS } = await mod();
  configure();
  assert.deepEqual([...GOOGLE_ADS_PRIMARY_ACTIONS], ["signup", "purchase"]);
  assert.ok(!GOOGLE_ADS_PRIMARY_ACTIONS.includes("pricing_view" as never));
  assert.equal(buildConversionPayload("signup")!.value, undefined);
});

test("transaction_id is unique per PURCHASE, not per member", async () => {
  // Google dedupes on transaction_id. The pre-existing GA4 tracker used the bare userId, which is
  // stable for a member's lifetime — so an upgrade carries the same id as the original purchase
  // and is deduped away, dropping exactly the highest-value conversions in the funnel.
  const { purchaseTransactionId } = await mod();
  const first = purchaseTransactionId("user_abc", "community");
  const upgrade = purchaseTransactionId("user_abc", "premium");
  assert.notEqual(first, upgrade, "an upgrade must not be deduped into the original purchase");
  assert.equal(
    purchaseTransactionId("user_abc", "community"),
    first,
    "the SAME purchase must dedupe — a refresh cannot double-count the sale"
  );
});

test("nothing is sent when gtag is absent from the page", async () => {
  // SSR, an ad blocker, or a conversion fired before the tag script loaded. Returning null rather
  // than throwing keeps a missing tag from taking down the page that was about to convert.
  const { trackGoogleAdsConversion } = await mod();
  configure();
  assert.equal(trackGoogleAdsConversion("signup"), null);
});

test("a configured conversion reaches gtag with the exact payload", async () => {
  const { trackGoogleAdsConversion } = await mod();
  configure();
  const calls: unknown[][] = [];
  (globalThis as { window?: unknown }).window = {
    gtag: (...args: unknown[]) => calls.push(args),
  };
  try {
    const sent = trackGoogleAdsConversion("purchase", { value: 1999, transactionId: "u:premium" });
    assert.ok(sent, "a fully configured purchase must actually send");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]![0], "event");
    assert.equal(calls[0]![1], "conversion", "Google Ads listens for the 'conversion' event name");
    assert.deepEqual(calls[0]![2], {
      send_to: "AW-123456789/pUrChAsE_LaBeL",
      value: 1999,
      currency: "USD",
      transaction_id: "u:premium",
    });

    // ...and an unconfigured action never reaches gtag at all.
    delete process.env.NEXT_PUBLIC_GOOGLE_ADS_LABEL_SIGNUP;
    assert.equal(trackGoogleAdsConversion("signup"), null);
    assert.equal(calls.length, 1, "a skipped conversion must not reach gtag");
  } finally {
    delete (globalThis as { window?: unknown }).window;
  }
});
