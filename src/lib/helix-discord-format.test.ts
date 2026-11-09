import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildHelixDiscordEmbed,
  buildHelixStackedHitsDigestEmbed,
  buildHelixTopHitsDigestEmbed,
  classifyHelixDiscordKind,
  contractStackHitsFromFlows,
  formatHelixStackHitTimeline,
  helixDiscordWriteup,
  moneyShort,
  passesHelixDiscordFilters,
  selectHelixDiscordDigest,
  selectHelixDiscordStacks,
  HELIX_DISCORD_MIN_PREMIUM,
  buildHelixBurstEmbed,
  helixDiscordLiveRthOnly,
  resolveHelixDiscordDte,
} from "./helix-discord-format.ts";

const base = {
  ticker: "SPY",
  premium: 900_000,
  option_type: "PUT",
  expiry: "2026-08-21",
  strike: 735,
  direction: "bearish",
  route: "whale",
  fill_price: 8.5,
  dte: 23,
};

test("passesHelixDiscordFilters requires all three gates", () => {
  assert.equal(passesHelixDiscordFilters(base), true);
  assert.equal(passesHelixDiscordFilters({ ...base, premium: 499_999 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, fill_price: 10 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, fill_price: 0 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, fill_price: null }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, dte: 31 }), false);
  assert.equal(passesHelixDiscordFilters({ ...base, dte: -1 }), false);
  assert.equal(HELIX_DISCORD_MIN_PREMIUM, 500_000);
});

test("writeup weaves GEX when present and omits when absent", () => {
  const withWall = helixDiscordWriteup({ ...base, gex_proximity: "near_put_wall" });
  assert.match(withWall, /near the put wall/);
  assert.match(withWall, /\$900K/);
  const plain = helixDiscordWriteup(base);
  assert.doesNotMatch(plain, /wall|flip/i);
});

test("classify prefers whale-structure when whale + gex", () => {
  assert.equal(
    classifyHelixDiscordKind({ ...base, premium: 2_000_000, gex_proximity: "at_call_wall" }),
    "whale-structure"
  );
  assert.equal(
    classifyHelixDiscordKind({ ...base, alert_rule: "RepeatedHits", gex_proximity: null }),
    "stack"
  );
  assert.equal(classifyHelixDiscordKind({ ...base, dte: 1, route: "stock" }), "near");
});

test("buildHelixDiscordEmbed is a short write-up not field soup", () => {
  const emb = buildHelixDiscordEmbed({
    ...base,
    fill_price: 9.41,
    dte: 2,
    gex_proximity: "near_call_wall",
    premium: 1_500_000,
  });
  assert.match(emb.title, /HELIX/);
  assert.match(emb.description, /printing near the call wall/);
  assert.doesNotMatch(emb.description, /\*\*Premium\*\*/);
  assert.match(emb.description, /Open this print in HELIX/);
});

test("digest embed lists ranked rows", () => {
  const emb = buildHelixTopHitsDigestEmbed({
    windowMin: 15,
    inWindowCount: 2,
    sessionFallback: false,
    rows: [
      { ...base, ticker: "NVDA", premium: 1_200_000, fill_price: 6.35, dte: 12 },
      { ...base, ticker: "MSFT", premium: 800_000, fill_price: 8.8, dte: 2 },
    ],
  });
  assert.match(emb.title, /15m/);
  assert.match(emb.description, /NVDA/);
  assert.match(emb.description, /MSFT/);
  assert.match(emb.description, /Lead:/);
});

test("repeat hits writeup includes stack timeline when stack_hits provided", () => {
  const text = helixDiscordWriteup({
    ...base,
    alert_rule: "RepeatedHits",
    stack_hits: [
      { at: "2026-08-04T14:18:11.000Z", premium: 840_000, fill_price: 4.2 },
      { at: "2026-08-04T14:25:44.000Z", premium: 890_000, fill_price: 4.15 },
    ],
  });
  assert.match(text, /Stack timeline/);
  assert.match(text, /\$840K/);
  assert.match(text, /\$890K/);
  assert.match(text, /@ \$4\.2/);
});

test("stacked hits digest lists per-hit ET timestamps", () => {
  const emb = buildHelixStackedHitsDigestEmbed({
    windowMin: 15,
    stacks: [
      {
        ticker: "NVDA",
        strike: 140,
        option_type: "CALL",
        expiry: "2026-08-15",
        alert_count: 3,
        total_premium: 2_100_000,
        premiums: [700_000, 700_000, 700_000],
        trade_count: null,
        repeated_hits: true,
        same_strike_accumulation: true,
        alert_rules: ["RepeatedHits"],
        kind: "repeated_and_stacked",
        recent_hit_count: 3,
        recent_premium: 2_100_000,
        hits_window_min: 15,
        recent_hits: [
          { at: "2026-08-04T14:18:11.000Z", premium: 700_000, fill_price: 4.2 },
          { at: "2026-08-04T14:25:44.000Z", premium: 700_000, fill_price: 4.15 },
          { at: "2026-08-04T14:30:02.000Z", premium: 700_000, fill_price: 4.1 },
        ],
        avg_ask_pct: 68,
      },
    ],
    now: new Date("2026-08-04T14:32:00.000Z"),
  });
  assert.match(emb.title, /Stacked hits/);
  assert.match(emb.description, /NVDA 140C/);
  assert.match(emb.description, /3 hits/);
  assert.match(emb.description, /ET · \$700K/);
});

// BUG FIX (sibling of the repo's `dteFromExpiry` HELIX-MAP.md §9.2 fix, previously-unmigrated):
// resolveHelixDiscordDte's fallback (no `flow.dte`) used to re-derive DTE from the live clock
// (`Math.ceil((expiryT20:00Z - now) / 1 day)`) instead of the shared ET-calendar-date-anchored
// `dteFromExpiry` ingest already uses. A contract expiring TODAY, read at any point during RTH
// (well before 20:00 UTC), is a positive sub-1-day gap, and `Math.ceil` of that is always 1 — a
// genuine 0DTE read as 1DTE for the entire session.
test("resolveHelixDiscordDte: a same-ET-day expiry is 0DTE at any point during RTH, not 1DTE", () => {
  const rthNow = new Date("2026-08-04T14:32:00.000Z"); // 10:32am ET, same ET calendar day
  const flowNoDte = { ...base, expiry: "2026-08-04", dte: undefined as unknown as number };
  assert.equal(resolveHelixDiscordDte(flowNoDte, rthNow), 0);

  // Same check close to the old UTC-20:00 boundary this bug was anchored to — still same ET day.
  const lateRth = new Date("2026-08-04T19:55:00.000Z"); // 3:55pm ET
  assert.equal(resolveHelixDiscordDte(flowNoDte, lateRth), 0);
});

test("stacked hits digest headline reads 0DTE (not 1DTE) for a contract expiring today, during RTH", () => {
  const now = new Date("2026-08-04T14:32:00.000Z"); // 10:32am ET, same ET calendar day as expiry
  const emb = buildHelixStackedHitsDigestEmbed({
    windowMin: 15,
    stacks: [
      {
        ticker: "SPY",
        strike: 540,
        option_type: "CALL",
        expiry: "2026-08-04",
        alert_count: 2,
        total_premium: 1_400_000,
        premiums: [700_000, 700_000],
        trade_count: null,
        repeated_hits: true,
        same_strike_accumulation: true,
        alert_rules: ["RepeatedHits"],
        kind: "repeated_and_stacked",
        recent_hit_count: 2,
        recent_premium: 1_400_000,
        hits_window_min: 15,
        recent_hits: [
          { at: "2026-08-04T14:18:11.000Z", premium: 700_000, fill_price: 4.2 },
          { at: "2026-08-04T14:25:44.000Z", premium: 700_000, fill_price: 4.1 },
        ],
        avg_ask_pct: 68,
      },
    ],
    now,
  });
  assert.match(emb.description, /SPY 540C.*0DTE/);
  assert.doesNotMatch(emb.description, /1DTE/);
});

test("selectHelixDiscordStacks requires 2+ qualifying hits in window", () => {
  const now = new Date("2026-08-04T14:32:00.000Z");
  const recent = "2026-08-04T14:28:00.000Z";
  const flow = {
    ...base,
    fill_price: 6,
    dte: 10,
    event_at: recent,
    alerted_at: recent,
  };
  const stacks = selectHelixDiscordStacks(
    [
      flow,
      { ...flow, premium: 600_000, event_at: "2026-08-04T14:20:00.000Z", alerted_at: "2026-08-04T14:20:00.000Z" },
      { ...flow, ticker: "MSFT", event_at: "2026-08-04T14:22:00.000Z", alerted_at: "2026-08-04T14:22:00.000Z" },
    ],
    { now, limit: 5 }
  );
  assert.equal(stacks.length, 1);
  assert.equal(stacks[0]?.ticker, "SPY");
  assert.ok(stacks[0]!.recent_hits.length >= 2);
});

test("contractStackHitsFromFlows returns oldest-first timeline", () => {
  const now = new Date("2026-08-04T14:32:00.000Z");
  const target = {
    ...base,
    fill_price: 5,
    dte: 8,
    event_at: "2026-08-04T14:30:00.000Z",
  };
  const hits = contractStackHitsFromFlows(target, [
    target,
    { ...target, premium: 650_000, event_at: "2026-08-04T14:18:00.000Z", fill_price: 4.8 },
    { ...target, premium: 700_000, event_at: "2026-08-04T14:24:00.000Z", fill_price: 4.9 },
  ], { now });
  assert.equal(hits.length, 3);
  assert.ok(new Date(hits[0]!.at).getTime() < new Date(hits[1]!.at).getTime());
  const timeline = formatHelixStackHitTimeline(hits);
  assert.match(timeline, /ET ·/);
});

test("contractStackHitsFromFlows rejects a future-dated print instead of counting it as a fresh hit", () => {
  // Same future-print bug already fixed in detectVelocitySpikes/countMatchingContractHits: an
  // event_at ahead of `now` makes `nowMs - ms` negative, which trivially satisfies `<= windowMs`
  // under a naive check and gets counted as the freshest hit on the tape.
  const now = new Date("2026-08-04T14:32:00.000Z");
  const target = {
    ...base,
    fill_price: 5,
    dte: 8,
    event_at: "2026-08-04T14:30:00.000Z",
  };
  const future = { ...target, premium: 900_000, event_at: "2026-08-04T15:00:00.000Z", fill_price: 5.1 };
  const hits = contractStackHitsFromFlows(target, [target, future], { now });
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.at, target.event_at);
});

test("contractStackHitsFromFlows excludes the neighbouring half-dollar strike", () => {
  // Same root cause as the Top Prints hit count, but this timeline ALSO produces the hit count fed
  // to the milestone gate — so an inflated count here posts a Repeat Hits embed describing prints
  // on two different contracts.
  const now = new Date("2026-08-21T14:32:00.000Z");
  const target = {
    ...base,
    ticker: "INTC",
    option_type: "PUT",
    expiry: "2026-08-21",
    strike: 93,
    fill_price: 5,
    dte: 0,
    event_at: "2026-08-21T14:30:00.000Z",
  };
  const neighbour = { ...target, strike: 92.5, event_at: "2026-08-21T14:24:00.000Z" };
  const hits = contractStackHitsFromFlows(target, [target, neighbour], { now });
  assert.equal(hits.length, 1);
  assert.equal(contractStackHitsFromFlows(neighbour, [target, neighbour], { now }).length, 1);
});

test("selectHelixDiscordDigest prefers in-window score then premium", () => {
  const now = new Date("2026-07-29T15:00:00.000Z");
  const recent = now.toISOString();
  const stale = new Date(now.getTime() - 40 * 60_000).toISOString();
  const picked = selectHelixDiscordDigest(
    [
      {
        ...base,
        ticker: "OLD",
        premium: 3_000_000,
        score: 9,
        fill_price: 5,
        dte: 10,
        event_at: stale,
      },
      {
        ...base,
        ticker: "HOT",
        premium: 700_000,
        score: 6,
        fill_price: 4,
        dte: 5,
        event_at: recent,
      },
      {
        ...base,
        ticker: "SKIP",
        premium: 900_000,
        score: 8,
        fill_price: 12,
        dte: 5,
        event_at: recent,
      },
    ],
    { windowMin: 15, now, limit: 3 }
  );
  assert.equal(picked.sessionFallback, false);
  assert.equal(picked.inWindowCount, 1);
  assert.equal(picked.rows[0]?.ticker, "HOT");
});

test("selectHelixDiscordDigest rejects a future-dated print instead of picking it as freshest", () => {
  // Same future-print bug already fixed in contractStackHitsFromFlows: an event_at ahead of `now`
  // makes `nowMs - ms` negative, which trivially satisfies `<= windowMs` and would let a
  // clock-skewed print win the digest pick on score alone.
  const now = new Date("2026-08-04T14:32:00.000Z");
  const recent = now.toISOString();
  const future = new Date(now.getTime() + 10 * 60_000).toISOString();
  const picked = selectHelixDiscordDigest(
    [
      { ...base, ticker: "REAL", premium: 700_000, score: 6, fill_price: 4, dte: 5, event_at: recent },
      { ...base, ticker: "FUTURE", premium: 5_000_000, score: 9, fill_price: 5, dte: 5, event_at: future },
    ],
    { windowMin: 15, now, limit: 3 }
  );
  assert.equal(picked.inWindowCount, 1);
  assert.equal(picked.rows[0]?.ticker, "REAL");
});

test("buildHelixBurstEmbed collapses multiple prints on one ticker", () => {
  const emb = buildHelixBurstEmbed({
    ticker: "NVDA",
    windowMin: 4,
    flows: [
      base,
      { ...base, premium: 1_100_000, strike: 141 },
    ],
  });
  assert.match(emb.title, /burst \(2 prints\)/);
  assert.match(emb.description ?? "", /\$2\.00M.*total/);
});

test("helixDiscordLiveRthOnly defaults true", () => {
  assert.equal(helixDiscordLiveRthOnly(), true);
});

test("writeup includes gex_context_line when supplied", () => {
  const text = helixDiscordWriteup({
    ...base,
    gex_context_line: "Structure: strike 735 is 1.2% below call wall (742)",
  });
  assert.match(text, /Structure: strike 735/);
});

test("moneyShort promotes a value that rounds to 1000 of a unit into the next unit, never an overflowed label", () => {
  assert.equal(moneyShort(999_600), "$1.00M");
  assert.equal(moneyShort(999_999), "$1.00M");
  assert.equal(moneyShort(-999_600), "$-1.00M");
  assert.equal(moneyShort(999_400), "$999K");
  assert.equal(moneyShort(500_000), "$500K");
  assert.equal(moneyShort(1_000_000), "$1.00M");
});

test("moneyShort has a B tier — a billion-dollar session total renders as $X.XXB, never an overflowed M label", () => {
  // Before the fix, moneyShort had NO branch past "M" at all: any value >= $1B rendered as a
  // 4+ digit M label (e.g. "$1234.57M"), which is the exact figure a HELIX session recap or
  // dark-pool burst/digest embed produces routinely (discord-eod-recap.ts/
  // darkpool-discord-format.ts both feed this helper a SUM of many $500K+ qualifying prints).
  assert.equal(moneyShort(1_234_567_890), "$1.23B");
  assert.equal(moneyShort(5_000_000_000), "$5.00B");
  assert.equal(moneyShort(15_000_000_000), "$15.0B");
  assert.equal(moneyShort(-1_500_000_000), "$-1.50B");
});

test("moneyShort promotes an M-quotient that rounds to 1000 into the new B tier, never an overflowed 4-digit M label", () => {
  // Same round-first-then-promote guard as the already-fixed K->M boundary case, one tier up:
  // 999_950_000 / 1e6 = 999.95, which rounds to "1000.0" at the M branch's own 1-decimal
  // display precision — that must promote to B, not render the literal "$1000.0M".
  assert.equal(moneyShort(999_950_000), "$1.00B");
  assert.equal(moneyShort(999_000_000), "$999.0M");
});
