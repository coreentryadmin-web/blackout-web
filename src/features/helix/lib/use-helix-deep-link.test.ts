import test from "node:test";
import assert from "node:assert/strict";
import { darkpoolRowHighlighted } from "./use-helix-deep-link";

const highlight = { executed_at: "2026-08-21T23:59:52", premium: 500_000 };

test("an undated print is never the target of a time-keyed deep link", () => {
  assert.equal(darkpoolRowHighlighted({ executed_at: null, premium: 500_000 }, highlight), false);
});

test("...including when the LINK itself carries the stringified absence", () => {
  // This is the case the guard actually exists for, and the only one that discriminates. A deep
  // link built from an undated print carries `at=null` — `String(null).slice(0, 19)` — so without
  // the guard the comparison is "null" === "null" and EVERY undated print on the panel highlights
  // at once. A guard tested only against a well-formed link passes with or without itself.
  const nullLink = { executed_at: "null", premium: 500_000 };
  assert.equal(darkpoolRowHighlighted({ executed_at: null, premium: 500_000 }, nullLink), false);
});

test("a dated print still matches on time-to-the-second and premium-to-the-dollar", () => {
  assert.equal(
    darkpoolRowHighlighted({ executed_at: "2026-08-21T23:59:52.482Z", premium: 500_000 }, highlight),
    true
  );
  assert.equal(
    darkpoolRowHighlighted({ executed_at: "2026-08-21T23:59:53.482Z", premium: 500_000 }, highlight),
    false
  );
  assert.equal(
    darkpoolRowHighlighted({ executed_at: "2026-08-21T23:59:52.482Z", premium: 400_000 }, highlight),
    false
  );
});

test("no highlight means no row is highlighted", () => {
  assert.equal(darkpoolRowHighlighted({ executed_at: "2026-08-21T23:59:52Z", premium: 500_000 }, null), false);
});
