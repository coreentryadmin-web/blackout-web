import assert from "node:assert/strict";
import { mock, test } from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import path from "node:path";
(globalThis as unknown as { React: typeof React }).React = React;

// RedesignPricing's "Premium · Yearly" tile shows two derived amounts
// (yearlyEffectiveMonthly, yearlySavingsVsMonthly). Every OTHER price on this
// page — and the equivalent line in RedesignHome.tsx — goes through the
// single-source-of-truth `usd()` formatter (src/lib/pricing.ts), which adds
// thousands separators ("$1,999", not "$1999"). This one line used to bypass
// it with a raw `${MEMBERSHIP_PRICING.x}` template literal, so it would
// silently lose the comma the moment either value crossed $1,000 — a real
// price could ever grow into this range even though today's constants
// (167, 389) happen to stay under it.
mock.module(path.join(process.cwd(), "src/lib/pricing.ts"), {
  namedExports: {
    MEMBERSHIP_PRICING: {
      community: 49,
      monthly: 199,
      yearly: 1999,
      yearlySavingsVsMonthly: 5678,
      yearlyEffectiveMonthly: 1234,
    },
    usd(amount: number): string {
      if (!Number.isFinite(amount)) return "$—";
      return `$${amount.toLocaleString("en-US")}`;
    },
  },
});

test("RedesignPricing formats the yearly-tile derived amounts through usd(), not a raw template literal", async () => {
  const { RedesignPricing } = await import("./RedesignPricing");
  const html = renderToStaticMarkup(React.createElement(RedesignPricing));

  assert.match(html, /\$1,234\/mo/, "yearlyEffectiveMonthly must render with a thousands separator");
  assert.match(html, /save \$5,678 vs monthly/, "yearlySavingsVsMonthly must render with a thousands separator");
  assert.doesNotMatch(html, /\$1234/, "must not render the unformatted raw number");
  assert.doesNotMatch(html, /\$5678/, "must not render the unformatted raw number");
});
