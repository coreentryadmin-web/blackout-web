import { test } from "node:test";
import assert from "node:assert/strict";

import {
  conversationTitle,
  upsertConversation,
  removeConversation,
  MAX_CONVERSATIONS,
  type LargoConversation,
} from "./conversation-history";

test("conversationTitle collapses whitespace and truncates long questions", () => {
  assert.equal(conversationTitle("  SPX   trend?  "), "SPX trend?");
  assert.equal(conversationTitle(""), "New conversation");
  const long = "is 7500 0DTE good today given the gamma flip and the call wall overhead right now";
  const out = conversationTitle(long);
  assert.ok(out.length <= 60, `title should be <=60 chars, got ${out.length}`);
  assert.ok(out.endsWith("…"), "truncated title should end with an ellipsis");
});

test("conversationTitle strips trailing punctuation before the ellipsis (round 436 regression)", () => {
  // 69 chars; the old `clean.slice(0, 59)` cut lands immediately after the comma in
  // "...right now,", so the old code appended "…" straight onto it, producing the
  // doubled-punctuation artifact truncate-text.ts's own header documents ("flow, …").
  const q = "Why is the gamma flip holding as resistance here right now, exactly";
  const out = conversationTitle(q);
  assert.ok(out.length <= 60, `title should be <=60 chars, got ${out.length}`);
  assert.ok(out.endsWith("…"), "truncated title should end with an ellipsis");
  assert.ok(
    !/[\s,;:.–—-]…$/.test(out),
    `title must not leave trailing punctuation dangling right before the ellipsis, got ${JSON.stringify(out)}`
  );
  assert.equal(
    out,
    "Why is the gamma flip holding as resistance here right…",
    "should back up to the word boundary and drop the dangling comma, not cut mid-clause onto it"
  );
});

test("upsertConversation inserts newest-first and dedupes by id", () => {
  let list: LargoConversation[] = [];
  list = upsertConversation(list, { id: "a", title: "SPX?", updatedAt: 100 });
  list = upsertConversation(list, { id: "b", title: "NVDA?", updatedAt: 200 });
  assert.deepEqual(
    list.map((c) => c.id),
    ["b", "a"],
    "newest updatedAt should sort first"
  );

  // Re-activity on 'a' bumps it to the top but keeps its original title.
  list = upsertConversation(list, { id: "a", title: "different label", updatedAt: 300 });
  assert.deepEqual(list.map((c) => c.id), ["a", "b"]);
  assert.equal(list[0].title, "SPX?", "existing title is preserved, not overwritten");
  assert.equal(list.length, 2, "no duplicate entry for the same id");
});

test("upsertConversation caps the index at MAX_CONVERSATIONS", () => {
  let list: LargoConversation[] = [];
  for (let i = 0; i < MAX_CONVERSATIONS + 5; i++) {
    list = upsertConversation(list, { id: `id-${i}`, title: `q${i}`, updatedAt: i });
  }
  assert.equal(list.length, MAX_CONVERSATIONS);
  // Newest (highest updatedAt) survive; oldest are dropped.
  assert.equal(list[0].id, `id-${MAX_CONVERSATIONS + 4}`);
});

test("removeConversation drops only the targeted id", () => {
  const list: LargoConversation[] = [
    { id: "a", title: "A", updatedAt: 2 },
    { id: "b", title: "B", updatedAt: 1 },
  ];
  assert.deepEqual(removeConversation(list, "a").map((c) => c.id), ["b"]);
  assert.deepEqual(removeConversation(list, "missing").map((c) => c.id), ["a", "b"]);
});
