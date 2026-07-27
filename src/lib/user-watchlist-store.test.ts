import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sanitize } from "./user-watchlist-store";
import { MAX_WATCHLIST } from "./watchlist-store";

// Pure-function coverage for the server sanitize step. The DB-touching
// getUserWatchlist / setUserWatchlist paths need a Postgres connection and
// live in the manual-integration bucket (same convention as other DB helpers
// in this codebase).

describe("sanitize", () => {
  it("normalizes case + strips non-letters + caps length", () => {
    // watchlist-store.normalizeTicker: upper, [^A-Z] stripped, first 6 chars.
    assert.deepEqual(sanitize(["spx", " spy ", "brk-b"]), ["SPX", "SPY", "BRKB"]);
  });

  it("dedupes while preserving insertion order", () => {
    assert.deepEqual(sanitize(["SPX", "spy", "SPY", "spx", "NVDA"]), ["SPX", "SPY", "NVDA"]);
  });

  it("drops non-strings and empty entries silently", () => {
    // Server takes untrusted input; a mixed array must not throw or leak
    // non-string values into the DB TEXT[] column.
    assert.deepEqual(
      sanitize(["SPX", 42, null, undefined, "", "   ", "SPY", { foo: 1 }] as unknown[]),
      ["SPX", "SPY"]
    );
  });

  it("returns [] for non-array input", () => {
    assert.deepEqual(sanitize(null as unknown as string[]), []);
    assert.deepEqual(sanitize(undefined as unknown as string[]), []);
    assert.deepEqual(sanitize("SPX" as unknown as string[]), []);
    assert.deepEqual(sanitize({ 0: "SPX" } as unknown as string[]), []);
  });

  it("caps at MAX_WATCHLIST", () => {
    // Fabricate MAX_WATCHLIST + 5 unique valid tickers to guarantee we hit the cap.
    const many: string[] = [];
    for (let i = 0; i < MAX_WATCHLIST + 5; i++) {
      // 6-char alphabetic tokens — must PASS normalizeTicker's [^A-Z] filter
      // (the previous version of this test used base-36 which included digits
      // that were stripped, producing empty strings and a size-0 result).
      const s = "AAAAAA".split("");
      let n = i;
      for (let j = s.length - 1; j >= 0 && n > 0; j--) {
        s[j] = String.fromCharCode("A".charCodeAt(0) + (n % 26));
        n = Math.floor(n / 26);
      }
      many.push(s.join(""));
    }
    assert.equal(sanitize(many).length, MAX_WATCHLIST);
  });
});
