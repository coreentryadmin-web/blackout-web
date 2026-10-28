import assert from "node:assert/strict";
import { test } from "node:test";
import { substituteTokens } from "./layout.ts";

test("substituteTokens escapes HTML-significant characters in a token value", () => {
  const out = substituteTokens("Hi {{firstName}}, welcome.", {
    firstName: `<script>alert('x')</script>`,
  });
  assert.ok(!out.includes("<script>"), "raw <script> tag must not survive substitution");
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /&#39;x&#39;/);
});

test("substituteTokens escapes an onerror= attribute injection attempt", () => {
  const out = substituteTokens(`<p>{{firstName}}</p>`, {
    firstName: `"><img src=x onerror=alert(1)>`,
  });
  assert.ok(!out.includes('"><img'), "quote-breakout + raw <img> must not survive substitution");
  assert.match(out, /&quot;&gt;&lt;img/);
});

test("substituteTokens leaves plain display text unchanged in content", () => {
  const out = substituteTokens("Hi {{firstName}}, your trial ends {{trialEndsLabel}}.", {
    firstName: "Trader",
    trialEndsLabel: "Monday, Sep 1",
  });
  assert.equal(out, "Hi Trader, your trial ends Monday, Sep 1.");
});

test("substituteTokens substitutes every occurrence of a repeated token", () => {
  const out = substituteTokens("{{firstName}} and {{firstName}} again", { firstName: "A & B" });
  assert.equal(out, "A &amp; B and A &amp; B again");
});
