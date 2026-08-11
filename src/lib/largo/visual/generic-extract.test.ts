import test from "node:test";
import assert from "node:assert/strict";
import {
  eventsFromArray,
  formatByKey,
  genericBlocksFrom,
  humaniseKey,
  rankedFromArray,
  statsFromRecord,
} from "./generic-extract";

/**
 * GENERIC EXTRACTION — tested adversarially, because this is the one module that reads payloads it
 * does not understand.
 *
 * Every other extractor knows its input. This one infers from structure, which is exactly the
 * machinery by which a card could invent something. So the tests are written to BREAK it: hostile
 * keys, wrong units, nested meaning, non-finite numbers, empty arrays, prose in a number slot.
 *
 * The bar is not "it extracts a lot". The bar is: **it may produce a thin block or no block; it may
 * never produce a wrong one.**
 */

// ── Rule 1: primitives only, top level only ─────────────────────────────────────────────────

test("nested objects are NEVER flattened — their meaning lives in the path", () => {
  // `{greeks: {delta: 0.5}}` flattened to "Delta 0.5" silently drops which leg it belonged to.
  const s = statsFromRecord({ greeks: { delta: 0.5, gamma: 0.01 }, iv_rank: 38 });
  assert.deepEqual(s.map((x) => x.key), ["iv_rank"]);
});

test("arrays are not lifted as stats", () => {
  const s = statsFromRecord({ strikes: [1, 2, 3], net_premium: 41_200_000 });
  assert.deepEqual(s.map((x) => x.key), ["net_premium"]);
});

// ── Rule 2: never invent a label ────────────────────────────────────────────────────────────

test("an unreadable key is DROPPED, not guessed at", () => {
  assert.equal(humaniseKey("___"), null);
  assert.equal(humaniseKey("123"), null);
  assert.equal(humaniseKey("a_very_long_nested_path_that_cannot_fit_in_a_tile_at_all"), null);
  const s = statsFromRecord({ "___": 5, iv_rank: 38 });
  assert.deepEqual(s.map((x) => x.key), ["iv_rank"]);
});

test("labels come from the key, humanised", () => {
  assert.equal(humaniseKey("net_premium"), "Net premium");
  assert.equal(humaniseKey("ivRank"), "Iv rank");
  assert.equal(humaniseKey("win_rate"), "Win rate");
});

// ── Rule 3: units come from the key or not at all ───────────────────────────────────────────

test("an UNRECOGNISED key gets a plain number — no invented unit", () => {
  // Rendering a bare 0.62 as "62%" is a fabricated claim about magnitude; rendering 41200000 as
  // "$41.2M" when the key never said dollars is a fabricated claim about units.
  assert.equal(formatByKey("nope_index", 0.62), "0.62");
  assert.equal(formatByKey("widgets", 41_200_000), "41.2M");
  assert.equal(formatByKey("count", 1234), "1,234");
});

test("dollars only when the key says so", () => {
  assert.equal(formatByKey("net_premium", 41_200_000), "$41.2M");
  assert.equal(formatByKey("market_cap", 3.2e12), "$3200.0B");
  assert.equal(formatByKey("mark", 4.25), "$4.25");
});

test("percent only when the key says so, and a 0-1 ratio is scaled ONCE", () => {
  assert.equal(formatByKey("win_rate", 63.4), "63.4%");
  assert.equal(formatByKey("call_share", 0.71), "71.0%");
  // The trap: a `_pct` key already in 0-100 must not be multiplied again.
  assert.equal(formatByKey("change_pct", 42), "42.0%");
});

test("a true minus sign is used, matching the desk's own formatter", () => {
  assert.ok(formatByKey("change_pct", -12.5).startsWith("−"));
  assert.ok(formatByKey("net_premium", -1e6).startsWith("−$"));
});

// ── Rule 4: plumbing excluded, WITHOUT eating real numbers ──────────────────────────────────

test("identifiers and plumbing never reach a card", () => {
  const s = statsFromRecord({
    id: 42, request_id: "abc", cursor: "x", url: "http://x", schema: "v1", meta: "y",
    page: 1, limit: 50, iv_rank: 38,
  });
  assert.deepEqual(s.map((x) => x.key), ["iv_rank"]);
});

test("the plumbing filter does NOT eat numbers whose names merely contain `id`", () => {
  // Matching `id` as a substring would eat bid, mid, avoided and confidence — exactly the numbers
  // a member came for. This is the regression that filter is most likely to cause.
  const s = statsFromRecord({ bid: 4.2, mid: 4.35, avoided: 5, confidence: 72 }, 20);
  assert.deepEqual(s.map((x) => x.key).sort(), ["avoided", "bid", "confidence", "mid"]);
});

test("timestamps are chrome, not stat tiles", () => {
  const s = statsFromRecord({ as_of: "2026-08-11T15:42:00Z", updated_at: "x", iv_rank: 38 });
  assert.deepEqual(s.map((x) => x.key), ["iv_rank"]);
});

// ── Rule 5: a boolean is not a measurement unless it is a STATE ─────────────────────────────

test("internal flags are dropped; actionable states are kept", () => {
  const s = statsFromRecord({ available: true, ok: true, is_stale: true, breached: false, iv_rank: 38 }, 20);
  const keys = s.map((x) => x.key).sort();
  assert.deepEqual(keys, ["breached", "is_stale", "iv_rank"]);
  assert.equal(s.find((x) => x.key === "is_stale")!.value, "YES");
  assert.equal(s.find((x) => x.key === "breached")!.value, "NO");
});

// ── Rule 6: nothing is coerced ──────────────────────────────────────────────────────────────

test("NaN and Infinity are DROPPED, never rendered", () => {
  const s = statsFromRecord({ a: NaN, b: Infinity, c: -Infinity, iv_rank: 38 }, 20);
  assert.deepEqual(s.map((x) => x.key), ["iv_rank"]);
});

test("prose in a value slot is not a stat", () => {
  const s = statsFromRecord({
    thesis: "Dealers flipped short gamma into the close and the tape followed through",
    posture: "SHORT",
    iv_rank: 38,
  }, 20);
  assert.deepEqual(s.map((x) => x.key).sort(), ["iv_rank", "posture"]);
});

// ── Ranked rows ─────────────────────────────────────────────────────────────────────────────

test("a ranked row needs BOTH a name and a finite number", () => {
  const rows = rankedFromArray([
    { ticker: "NVDA", premium: 18_400_000 },
    { ticker: "TSLA" },                        // no number — not rankable
    { premium: 5_000_000 },                    // no name
    { ticker: "AMD", premium: NaN },           // not finite
    { ticker: "QQQ", premium: 9_000_000 },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["NVDA", "QQQ"]);
});

test("the array's OWN ORDER is preserved — never re-sorted", () => {
  // A "top movers" response is already ranked; re-sorting on a guessed field would silently
  // replace the tool's ranking with this module's.
  const rows = rankedFromArray([
    { ticker: "A", score: 1 },
    { ticker: "B", score: 99 },
    { ticker: "C", score: 50 },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["A", "B", "C"]);
});

test("ranked rows are capped, so an unknown 500-row payload cannot flood a card", () => {
  const big = Array.from({ length: 500 }, (_, i) => ({ ticker: `T${i}`, volume: i }));
  assert.equal(rankedFromArray(big).length, 8);
  assert.equal(rankedFromArray(big, 3).length, 3);
});

// ── Events ──────────────────────────────────────────────────────────────────────────────────

test("an UNDATED event is dropped — a calendar cannot honestly show one", () => {
  // "NVDA earnings" with no date implies the nearest one.
  const rows = eventsFromArray([
    { ticker: "NVDA", date: "2026-08-27" },
    { ticker: "AMD" },
    { ticker: "CRM", date: "not a date" },
  ]);
  assert.deepEqual(rows.map((r) => r.label), ["NVDA"]);
});

test("dates render as MM/DD from ISO without a timezone shift", () => {
  // Parsing "2026-08-27" through Date and reading local parts can roll to the 26th west of UTC.
  const rows = eventsFromArray([{ ticker: "NVDA", date: "2026-08-27" }]);
  assert.equal(rows[0]!.when, "08/27");
});

// ── Whole-payload scan ──────────────────────────────────────────────────────────────────────

test("an earnings calendar payload produces an EVENTS block", () => {
  const g = genericBlocksFrom(
    [{ earnings: [
      { ticker: "NVDA", date: "2026-08-27", session: "AMC" },
      { ticker: "CRM", date: "2026-08-28", session: "AMC" },
      { ticker: "AVGO", date: "2026-09-04", session: "AMC" },
    ] }],
    new Set(),
  );
  assert.equal(g.events?.rows.length, 3);
  assert.equal(g.events?.title, "Earnings");
  assert.equal(g.events?.rows[0]!.detail, "AMC");
});

test("a market-movers payload produces a RANKED block", () => {
  const g = genericBlocksFrom(
    [{ movers: [
      { ticker: "NVDA", change_pct: 4.2 },
      { ticker: "TSLA", change_pct: 3.8 },
      { ticker: "AMD", change_pct: 3.1 },
    ] }],
    new Set(),
  );
  assert.equal(g.ranked?.title, "Movers");
  assert.equal(g.ranked?.rows[0]!.value, "4.2%");
});

test("an IV-stats payload produces a STATS block", () => {
  const g = genericBlocksFrom([{ iv_rank: 38, iv_percentile: 42, realized_vol: 18.4, implied_vol: 24.1 }], new Set());
  assert.equal(g.stats?.rows.length, 4);
});

test("an ALREADY-CLAIMED payload is not rendered twice", () => {
  // Re-rendering a flow tape as a generic ranked list would put the same numbers on the card twice
  // under two headings, reading as two independent measurements.
  const payload = { movers: [{ ticker: "A", volume: 1 }, { ticker: "B", volume: 2 }, { ticker: "C", volume: 3 }] };
  const claimed = new Set<unknown>([payload]);
  assert.equal(genericBlocksFrom([payload], claimed).ranked, null);
  assert.ok(genericBlocksFrom([payload], new Set()).ranked);
});

test("thin payloads produce NOTHING rather than a near-empty block", () => {
  // Two ranked names is a comparison, not a ranking; one stat is not a readings grid.
  const g = genericBlocksFrom(
    [{ movers: [{ ticker: "A", volume: 1 }, { ticker: "B", volume: 2 }] }, { only: 1 }],
    new Set(),
  );
  assert.equal(g.ranked, null);
  assert.equal(g.stats, null);
});

test("a hostile payload of pure plumbing yields NO blocks at all", () => {
  const g = genericBlocksFrom(
    [{ id: 1, request_id: "x", cursor: "y", ok: true, meta: {}, errors: [] }],
    new Set(),
  );
  assert.deepEqual([g.stats, g.ranked, g.events], [null, null, null]);
});

test("extraction never throws on garbage", () => {
  for (const junk of [null, undefined, 42, "string", [], {}, [null], [{}], { a: undefined }]) {
    assert.doesNotThrow(() => genericBlocksFrom([junk], new Set()));
    assert.doesNotThrow(() => statsFromRecord(junk));
    assert.doesNotThrow(() => rankedFromArray(junk));
    assert.doesNotThrow(() => eventsFromArray(junk));
  }
});

// ── Three bugs found by RENDERING, not by the tests above ───────────────────────────────────

test("an IDENTIFIER never occupies a stat tile", () => {
  // Rendered live: a quote payload produced a "Readings" grid whose first tile read
  // "TICKER · NVDA" — the card's own subject restated as a finding, beside a headline and a hero
  // that already name it. Not wrong; noise in a tile a real reading could have used.
  const s = statsFromRecord({ ticker: "NVDA", name: "NVIDIA", price: 217.42, volume: 1e8, change_pct: 1.8 }, 20);
  assert.ok(!s.some((x) => x.key === "ticker"), "ticker is not a measurement");
  assert.ok(!s.some((x) => x.key === "name"));
  assert.deepEqual(s.map((x) => x.key).sort(), ["change_pct", "price", "volume"]);
});

test("identifiers are still legal as ROW NAMES", () => {
  // The exclusion is specific to the stat grid. A ranked list has nothing to label rows with
  // otherwise, and removing it there would empty every movers card.
  assert.equal(rankedFromArray([{ ticker: "NVDA", volume: 1 }, { ticker: "A", volume: 2 }, { ticker: "B", volume: 3 }])[0]!.label, "NVDA");
});

test("the RICHEST payload wins the stats block, not the first enumerated", () => {
  // Rendered live: a turn carrying a quote (4 fields) then an IV payload (6) drew the QUOTE,
  // because it came first — and three of its fields duplicated the headline and hero already on
  // the card. Tool-call order is an accident of how Largo sequenced its reasoning; it carries no
  // information about which payload is worth drawing.
  const quote = { price: 217.42, change_pct: 1.8, volume: 1e8 };
  const iv = { iv_rank: 38, iv_percentile: 42, realized_vol: 18.4, implied_vol: 24.1, skew_25d: -3.2, term_slope: 1.14 };
  const g = genericBlocksFrom([quote, iv], new Set());
  assert.equal(g.stats?.rows.length, 6, "the six-field payload must win over the three-field one");
  assert.ok(g.stats!.rows.some((r) => r.label === "Iv rank"));
});

/**
 * PRODUCTION SHAPES, not invented ones.
 *
 * Every fixture below is copied from the tool that actually produces it in `run-tool.ts`. That is
 * the point: this module's coverage promise was tested entirely against fixtures I wrote, and it
 * passed while returning NOTHING for one of the most-called tools in the product. A generic
 * extractor tested only on shapes its author imagined is a generic extractor in name.
 */

/** `toolNews` (run-tool.ts): `{ articles: [{ title, teaser, published, tickers, source }] }`. */
const NEWS_PAYLOAD = {
  articles: Array.from({ length: 12 }, (_, i) => ({
    title: `NVDA headline ${i + 1} on data centre demand`,
    teaser: "Analysts weigh in on the next print.",
    published: `2026-08-1${i % 2}T1${i % 10}:00:00Z`,
    tickers: ["NVDA"],
    source: i % 2 ? "benzinga" : "polygon",
    channels: ["earnings"],
  })),
  priority: "benzinga → polygon",
};

test("the REAL news payload yields events — it yielded nothing before", () => {
  // TWO independent misses, both silent. `published` was absent from DATE_KEYS (which had
  // `published_at`), so every article failed the date test; and `articles` was absent from
  // EVENT_FIELDS, so the array was never even offered to the row validator. Measured live: a
  // 6-tool NVDA turn drew ONE metric and no news at all.
  const out = genericBlocksFrom([NEWS_PAYLOAD], new Set());
  assert.ok(out.events, "twelve dated headlines must produce an events block");
  assert.ok(out.events!.rows.length >= 2);
  assert.ok(out.events!.rows.every((r) => r.when && r.label), "every row keeps a date and a name");
});

test("`published` alone is not enough — the CONTAINER key mattered too", () => {
  // Guards the half-fix. With the date key added but the allowlist still gating on the container
  // name, this stays empty — which is exactly where the first attempt stopped.
  assert.ok(eventsFromArray(NEWS_PAYLOAD.articles).length >= 2, "rows parse once the date key is right");
  assert.ok(genericBlocksFrom([NEWS_PAYLOAD], new Set()).events, "and the array must be reachable");
});

test("an array under an UNANTICIPATED key still composes", () => {
  // The property that makes this generic rather than a longer allowlist.
  const payload = {
    whatever_we_call_it_next: [
      { name: "NVDA", date: "2026-08-12", session: "AMC" },
      { name: "AMD", date: "2026-08-13", session: "AMC" },
      { name: "CRM", date: "2026-08-14", session: "BMO" },
    ],
  };
  const out = genericBlocksFrom([payload], new Set());
  assert.ok(out.events, "a novel container key must not block extraction");
  assert.equal(out.events!.title, "Whatever we call it next");
});

test("a junk array still yields NOTHING — the row rules are the real guard", () => {
  // Scanning every array must not lower the bar. Undated, unnamed rows produce no events however
  // the array is keyed, which is why dropping the container allowlist is safe.
  const junk = { rows: [{ foo: 1 }, { foo: 2 }, { foo: 3 }], other: ["a", "b", "c"] };
  assert.equal(genericBlocksFrom([junk], new Set()).events, null);
});

test("a key with no letters gets no block rather than a numeric heading", () => {
  const payload = { "123": [{ name: "NVDA", date: "2026-08-12" }, { name: "AMD", date: "2026-08-13" }] };
  assert.equal(genericBlocksFrom([payload], new Set()).events, null);
});
