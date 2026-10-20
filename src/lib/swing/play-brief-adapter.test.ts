import test from "node:test";
import assert from "node:assert/strict";
import type { TerminalPlay } from "@/features/nighthawk/command-deck/types";
import { composeSwingPlayBrief } from "./play-brief";
import { adaptSwingBriefToLargo } from "./play-brief-adapter";
import type { SwingPlayBriefContext } from "./play-brief-types";
import { contractViolations } from "@/lib/largo/contract/product-read";

function fixturePlay(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "SWING:INTC",
    ticker: "INTC",
    direction: "LONG",
    contract: "90C · 13DTE",
    score: 72,
    tierLabel: "B",
    status: "WATCH",
    horizon: "SWING",
    exitModel: "SCALE_OUT",
    recommendation: "BUY",
    recNote: "Pullback to entry zone — persistence confirmed.",
    factors: [
      { label: "Rel. strength", points: 18 },
      { label: "Regime", points: 12 },
    ],
    regime: "Sector rotation · regime 0.82",
    archetype: "BREAKOUT",
    servingSection: "WAITING_FOR_ENTRY",
    setupState: "FORMING",
    entryStatus: "PRE_TRIGGER",
    swingEntryAction: "buy",
    gateBlocks: [{ code: "G-S6", reason: "Bucket not graduated" }],
    thesisBreak: { level: "intact", note: "Structure holding" },
    ...overrides,
  };
}

function fixtureCtx(overrides: Partial<SwingPlayBriefContext> = {}): SwingPlayBriefContext {
  return {
    play: fixturePlay(),
    // Real shape, not a raw ISO instant: `loadSwingPlayBriefContext` always sets this via
    // `etStamp(nowMs)` (play-brief-context.ts), which is already "YYYY-MM-DD HH:mm ET" — the
    // prior ISO-string fixture here let adaptSwingBriefToLargo's now-removed re-parse-as-ISO
    // bug ship to production undetected (every real request threw `Invalid time value`).
    asOf: "2026-09-07 02:59 ET",
    sessionDate: "2026-09-07",
    scanAsOf: null,
    scanSessionDay: null,
    laneRows: [],
    meridian: null,
    ecosystem: null,
    vector: null,
    ...overrides,
  };
}

// BUG (found during the 2026-10-19 Ask Largo cycle, same live-repro ticker as play-brief.ts's own
// 2026-10-17 ticker_class fix): adaptSwingBriefToLargo reimplemented its OWN tiny, separately
// hardcoded ticker-class classifier (`tickerClassFromTicker`, a 6-ETF allowlist) instead of reusing
// `SwingPlayBriefResult.ticker_class` — the single, already-correct, already-tested source of truth
// `composeSwingPlayBrief` derives from the shared `canonicalTicker` (largo/core/entities.ts). SQQQ
// (a leveraged ETF, not in the adapter's own list) is misclassified "equity" by the adapter while
// the SAME response's native `brief.ticker_class` correctly says "etf" — a contract-required C4
// identity field disagreeing with itself inside one HTTP response.
test("adaptSwingBriefToLargo: ticker_class must match the brief's own classification (C4 identity), not a second independent guess", () => {
  const brief = composeSwingPlayBrief(fixtureCtx({ play: fixturePlay({ ticker: "SQQQ", id: "SWING:SQQQ" }) }));
  assert.equal(brief.ticker_class, "etf", "sanity: SQQQ must classify as etf via the native path");

  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.ok, true);
  if (!largoRead.ok) return;
  assert.equal(
    largoRead.data.ticker_class,
    "etf",
    "Largo-facing ticker_class must agree with the brief's own ticker_class for the same response"
  );
  assert.equal(
    largoRead.data.ticker_class,
    brief.ticker_class,
    "adapter must never compute a ticker_class independently of the already-classified brief"
  );
});

test("adaptSwingBriefToLargo: ticker_class still agrees with the brief for a plain equity", () => {
  const brief = composeSwingPlayBrief(fixtureCtx({ play: fixturePlay({ ticker: "NVDA", id: "SWING:NVDA" }) }));
  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.ok, true);
  if (!largoRead.ok) return;
  assert.equal(largoRead.data.ticker_class, "equity");
  assert.equal(largoRead.data.ticker_class, brief.ticker_class);
});

// BUG (production 2026-10-20): every swing play-brief 503'd with "Invalid time value" — the
// adapter re-parsed `asOf` with `new Date(asOf)` as if it were a raw ISO instant, but `asOf` is
// always already the Largo C1 "YYYY-MM-DD HH:mm ET" stamp (`etStamp(nowMs)` in
// play-brief-context.ts). `new Date("2026-10-20 00:41 ET")` is an Invalid Date, and
// `Intl.DateTimeFormat.formatToParts()` throws `RangeError: Invalid time value` on one — every
// ticker, every status, 100% of requests, since this runs on every single composed brief. The
// fixture above used to paper over this with a hand-written ISO string no real caller ever
// passes; it now matches production's actual shape.
test("adaptSwingBriefToLargo: does not throw on the real ET-stamp asOf shape, and passes it through as C1 as_of verbatim", () => {
  const ctx = fixtureCtx({ asOf: "2026-10-20 00:41 ET" });
  const brief = composeSwingPlayBrief(ctx);
  assert.doesNotThrow(() => adaptSwingBriefToLargo(brief));

  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.as_of, "2026-10-20 00:41 ET");
  assert.deepEqual(contractViolations(largoRead), [], "must be a fully C1-compliant as_of, not just non-throwing");
});
