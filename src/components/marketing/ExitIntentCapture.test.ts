import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Regression (2026-10-20, DISCOVERY-lane accessibility sweep): the site-wide exit-intent lead
// capture form's email input had no <label htmlFor>, aria-label, or aria-labelledby. The Modal
// it's mounted inside correctly labels the DIALOG itself ("Before you go") via aria-label on the
// panel, but that doesn't propagate to the input — a screen-reader user tabbing to the field
// heard only "edit text", with no indication it's an email address (placeholder text is not a
// reliable label substitute: it isn't consistently announced, and disappears once text is
// typed). This component mounts once in MarketingPageShell, so the defect was site-wide across
// every marketing page.
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ExitIntentCapture.tsx"),
  "utf8"
);

test("the exit-intent email input has an accessible name (aria-label)", () => {
  const inputBlock = src.slice(src.indexOf('type="email"'), src.indexOf('type="email"') + 300);
  assert.match(
    inputBlock,
    /aria-label=/,
    "the email input must carry an aria-label (or an equivalent label) so screen readers announce its purpose"
  );
});

// Regression (2026-10-26, DISCOVERY-lane sweep): MarketingPageShell mounts this on EVERY
// (marketing) route, including /pricing, /faq, /about — pages a signed-in member (paying or not)
// browses freely, not just signed-out landing pages. Nothing here checked auth state, so a member
// could get pitched a "free GEX cheat sheet" lead magnet they have no use for. Fixed by gating on
// `readClientSignedIn()` (the same `__client_uat`-cookie signal NavAuthLinks/useMarketingSignedIn
// already use) before the detector is ever armed.
test("readClientSignedIn is imported and checked before the exit-intent detector is armed", () => {
  assert.match(
    src,
    /import\s*\{\s*readClientSignedIn\s*\}\s*from\s*["']@\/lib\/client-signed-in["']/,
    "must import the shared signed-in signal rather than reinventing one"
  );
  const effectBody = src.slice(src.indexOf("useEffect(() => {"), src.indexOf("document.addEventListener"));
  assert.match(
    effectBody,
    /readClientSignedIn\(\)\s*===\s*true/,
    "the arming effect must bail out for an already-signed-in visitor before scheduling the arm timer"
  );
});
