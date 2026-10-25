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

// BUG FIX (Largo C2, 2026-10-21, Ask Largo standing mandate — live 6-brief repro CRWV:61/CRWV:63/
// GOOG:59/NVDA:62/TSLA:60/AMZN:48): `freshness`/`age_seconds` used to be hardcoded ("cached"/null)
// on EVERY response, even when a per-source age was already known and already disclosed in the
// SAME response's own "Data freshness" prose (e.g. real TSLA:60 brief: "Vector data **8642s** old
// — levels may lag live spot"). This pins the live repro's exact number: a HOLD play (today's live
// desk state IS load-bearing — `isSwingPlayStaleCheckExempt` is false for HOLD) whose only known
// source is a Vector snapshot stamped `dataAgeMs: 8_642_000` must surface that same age through the
// structured contract field, not silently drop it.
test("adaptSwingBriefToLargo: surfaces a known stale Vector age as age_seconds/freshness instead of the hardcoded cached/null constant (Largo C2)", () => {
  const ctx = fixtureCtx({
    play: fixturePlay({ status: "HOLD", recommendation: "HOLD" }),
    sessionDate: "2026-10-21",
    ecosystem: null,
    vector: {
      asOf: "2026-10-21T16:30:00.000Z",
      asOfEt: "2026-10-21 12:30 ET",
      sessionDate: "2026-10-21",
      spot: 24.5,
      // The exact age the live TSLA:60 repro's own "Data freshness" prose disclosed.
      dataAgeMs: 8_642_000,
      freshness: "stale",
      regime: { posture: "long" },
      gexWalls: { callWalls: [{ strike: 26, pct: 8 }], putWalls: [{ strike: 22, pct: 7 }] },
      gammaFlip: 24,
      maxPain: 23.5,
      confluenceZones: [],
      magnet: null,
    } as SwingPlayBriefContext["vector"],
  });
  const brief = composeSwingPlayBrief(ctx);
  // Sanity: the brief's own prose must have actually flagged this as stale — otherwise this test
  // would pass for the wrong reason (no genuine known-stale source in play at all).
  const freshnessSection = brief.envelope.sections.find((s) => s.title === "Data freshness");
  assert.ok(freshnessSection, "expected a Data freshness section disclosing the stale Vector read");
  assert.match(freshnessSection!.body, /Vector data \*\*8642s\*\* old/);

  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.ok, true);
  if (!largoRead.ok) return;
  assert.equal(largoRead.age_seconds, 8642, "age_seconds must reflect the real known Vector age, not null");
  assert.equal(largoRead.freshness, "stale", "freshness must be derived from the real age, not hardcoded cached");
});

// BUG (found during the 2026-10-22 Ask Largo cycle): `extractEvidence` never read
// `envelope.evidence` — the REAL, sourced evidence array `evidenceFromContext` (play-brief.ts)
// builds (dealer-posture strike/γ reads, HELIX flow premiums, earnings dates, peer lists — the
// literal "specific numbers behind the claim" `ProductSignal.evidence`'s own doc comment names for
// Largo C7). Instead it manufactured a list out of restatements the SAME C7 doc comment explicitly
// disclaims (the headline+bias repeated verbatim, each section's bare bias word, confidence
// prose) — a model reading the structured `evidence` field saw zero of the brief's real sourced
// numbers, only a paraphrase of the claim those numbers are supposed to back up.
test("adaptSwingBriefToLargo: evidence[] surfaces the brief's REAL sourced evidence (Largo C7), not a bias/headline restatement", () => {
  // `arsenal.earnings.earnings_date` -> evidenceFromContext's unconditional "Next earnings ..."
  // fact (play-brief.ts) — deterministic regardless of wall-clock staleness, unlike the Vector/GEX
  // calc facts, which this fixture deliberately avoids depending on for that reason.
  const ctx = fixtureCtx({
    ecosystem: {
      gex_positioning: null,
      vector_full_state: null,
      arsenal: {
        scope: "single_name",
        earnings: { earnings_date: "2026-09-12", days_until: 7, report_time: "AMC", is_confirmed: true },
        fundamentals: { days_to_cover: 2.1, short_volume_ratio: 0.35, price_target: null, as_of: "2026-09-05" },
        related: ["AMD", "NVDA"],
        news: { count: 2, newest: "2026-09-05", headlines: ["INTC restructures fab unit"] },
        macro: null,
        breadth: null,
        unavailable_sources: [],
      },
    } as SwingPlayBriefContext["ecosystem"],
  });
  const brief = composeSwingPlayBrief(ctx);
  // Sanity: the brief's own real evidence[] must genuinely carry this fact — otherwise this test
  // would pass for the wrong reason (no real evidence in play at all).
  assert.ok(
    brief.envelope.evidence.some((e) => e.text.includes("Next earnings 2026-09-12")),
    "expected composeSwingPlayBrief's real evidence[] to carry the earnings-calendar fact"
  );

  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.ok, true);
  if (!largoRead.ok) return;
  assert.ok(
    largoRead.data.evidence.some((e) => e.includes("Next earnings 2026-09-12")),
    "Largo-facing evidence[] must carry the brief's real sourced fact, not just a headline/bias restatement"
  );
});

// BUG FIX (2026-10-24, Ask Largo fan-out audit, live repro SOXX): `extractEvidence`'s levels loop
// called `level.price.toFixed(2)` directly on the raw, pre-rounded float — the API route rounds
// that SAME field via `roundFloats`'s `Math.round(n*100)/100` elsewhere in the response
// (`envelope.levels[].price`), so a price sitting on a half-cent boundary can disagree between
// the two: `(479.205).toFixed(2)` => "479.20" while `Math.round(479.205*100)/100` => 479.21.
test("adaptSwingBriefToLargo: evidence_numbers' level prices use the same rounding as envelope.levels, not a raw toFixed (live repro SOXX)", () => {
  const ctx = fixtureCtx();
  const brief = composeSwingPlayBrief(ctx);
  // Inject a level sitting exactly on the toFixed-vs-round-first boundary this bug depends on —
  // deterministic regardless of what the real pipeline happens to compute this cycle.
  brief.envelope.levels = [{ label: "flag anchor", price: 479.205 }];

  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.ok, true);
  if (!largoRead.ok) return;
  assert.ok(
    largoRead.data.evidence.some((e) => e === "flag anchor: $479.21"),
    `expected "flag anchor: $479.21" (matching envelope.levels' own rounding), got: ${JSON.stringify(largoRead.data.evidence)}`
  );
  assert.ok(
    !largoRead.data.evidence.some((e) => e.includes("$479.20")),
    "must not disagree with envelope.levels[].price by using a raw toFixed(2)"
  );
});

// Sibling case: the pre-existing honest-omission behavior must survive this fix — a brief with
// genuinely NO knowable per-source age (a fresh WATCH candidate, no Vector/GEX/option-mark read at
// all this cycle) must still fall back to "cached"/null rather than fabricating an age of 0.
test("adaptSwingBriefToLargo: falls back to cached/null when no per-source age is genuinely knowable this cycle (Largo C6 applied to C2)", () => {
  const ctx = fixtureCtx(); // default fixture: vector/ecosystem both null, no markAsOf on the play
  const brief = composeSwingPlayBrief(ctx);
  assert.equal(brief.dataAgeMs, null, "sanity: nothing knowable this cycle in the default fixture");

  const largoRead = adaptSwingBriefToLargo(brief);
  assert.equal(largoRead.ok, true);
  if (!largoRead.ok) return;
  assert.equal(largoRead.age_seconds, null);
  assert.equal(largoRead.freshness, "cached");
});
