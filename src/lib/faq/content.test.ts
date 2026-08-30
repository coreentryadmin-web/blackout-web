import assert from "node:assert/strict";
import { test } from "node:test";
import { FAQ_ITEMS, HOME_FAQ_IDS, PRICING_FAQ_IDS, selectFaqItems } from "./content.ts";

test("every FAQ_ITEMS id is unique", () => {
  const ids = FAQ_ITEMS.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("selectFaqItems returns items in the requested order", () => {
  const ids = ["platform-1", "start-2"];
  const items = selectFaqItems(ids);
  assert.deepEqual(items.map((i) => i.id), ids);
  assert.equal(items[0]?.q, "What exactly is BlackOut?");
});

test("selectFaqItems throws on an unknown id", () => {
  assert.throws(() => selectFaqItems(["not-a-real-id"]), /unknown FAQ id/);
});

test("HOME_FAQ_IDS and PRICING_FAQ_IDS resolve without throwing — guards against a future RAW edit silently breaking a live surface", () => {
  assert.equal(selectFaqItems(HOME_FAQ_IDS).length, HOME_FAQ_IDS.length);
  assert.equal(selectFaqItems(PRICING_FAQ_IDS).length, PRICING_FAQ_IDS.length);
});

test("the SPX Slayer vs Premium price tokens resolve to real prices, never leak a raw {{token}}", () => {
  const item = FAQ_ITEMS.find((i) => i.id === "member-2");
  assert.ok(item, "member-2 (SPX Slayer vs Premium) must exist");
  assert.ok(!/\{\{/.test(item!.a), "answer must not contain an unresolved {{token}}");
  assert.match(item!.a, /\$49\/mo/);
  assert.match(item!.a, /\$199\/mo/);
  assert.match(item!.a, /\$1,999\/yr/);
});

test("home accordion and its JSON-LD share one id list — the exact drift this refactor fixes", () => {
  // RedesignHome.tsx and (marketing)/page.tsx both call selectFaqItems(HOME_FAQ_IDS)
  // directly, so there is no second copy of the wording left to go stale.
  assert.deepEqual([...HOME_FAQ_IDS], ["member-5", "platform-4", "member-2", "platform-5", "start-1"]);
  const items = selectFaqItems(HOME_FAQ_IDS);
  assert.deepEqual(items.map((i) => i.q), [
    "Can I cancel anytime?",
    "Do I need to connect a broker?",
    "What's the difference between SPX Slayer and Premium?",
    "Is any of this financial advice?",
    "How do I get started in 5 minutes?",
  ]);
});
