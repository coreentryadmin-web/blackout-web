import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { emailLayout } from "./layout.ts";
import { MEMBERSHIP_PRICING } from "@/lib/pricing";

/**
 * Guards on the two things an email can get wrong that cost real money:
 * the legally-required footer, and any statement about price.
 */

const TEMPLATE_DIR = "src/lib/email/templates";
const templateFiles = readdirSync(TEMPLATE_DIR).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

test("no template hardcodes a price — every figure comes from MEMBERSHIP_PRICING", () => {
  // A hardcoded price silently becomes a lie the day pricing changes, and a wrong number about
  // money is the worst category to be wrong about. /pricing and /vs/others already read the same
  // constant; the emails must not be a fourth source of truth.
  const prices = Object.values(MEMBERSHIP_PRICING).filter((v) => typeof v === "number") as number[];
  for (const file of templateFiles) {
    const src = readFileSync(`${TEMPLATE_DIR}/${file}`, "utf8");
    // Strip comments — a docblock may legitimately mention the tier's price as context.
    const code = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//") && !l.trim().startsWith("/*"))
      .join("\n");
    for (const price of prices) {
      const literal = new RegExp(`\\$${price.toLocaleString("en-US").replace(/,/g, ",?")}\\b`);
      assert.ok(
        !literal.test(code),
        `${file} hardcodes $${price} — import it from @/lib/pricing instead so emails can't drift from /pricing`
      );
    }
  }
});

test("marketing sends get a real unsubscribe link; transactional sends do not", () => {
  // Gmail/Yahoo require one-click unsubscribe of bulk senders. Transactional mail (payment failed,
  // access ended) must NOT offer to unsubscribe from mail the member cannot opt out of.
  const { html: marketing } = emailLayout({
    preheader: "x",
    bodyHtml: "<p>b</p>",
    unsubscribeUrl: "https://blackouttrades.com/api/public/email-unsubscribe?t=abc",
  });
  assert.match(marketing, />Unsubscribe</, "marketing footer carries a real unsubscribe link");

  const { html: transactional } = emailLayout({ preheader: "x", bodyHtml: "<p>b</p>" });
  assert.ok(!/>Unsubscribe</.test(transactional), "transactional footer must not offer an opt-out link");
  assert.match(transactional, /Reply to this email/, "transactional still gives a contact route");
});

test("every template still routes through the shared layout", () => {
  // A one-off inline template would bypass the footer entirely — disclaimer, address and all.
  for (const file of templateFiles) {
    const src = readFileSync(`${TEMPLATE_DIR}/${file}`, "utf8");
    assert.match(src, /emailLayout\(/, `${file} must render through emailLayout, not raw HTML`);
  }
});
