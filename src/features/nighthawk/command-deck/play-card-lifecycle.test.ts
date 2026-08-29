import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FRESHNESS_JUST_FIRED_MS,
  closedRealizedPct,
  formatRelativeAge,
  formatCompactAge,
  ageDecayToneFromAge,
  freshnessBadgeLabel,
  freshnessTierFromAge,
  playFreshnessDisplay,
  playLifecyclePhase,
  playLifecycleTimestamps,
  playPrimaryEvent,
  playStatusLabel,
  playStatusDisplay,
  playSymbolLine,
  playTimeRangeCompact,
  playListReturnPct,
  playTriggeredAtMs,
  zeroDteActionDisplay,
} from "./play-card-lifecycle.ts";
import type { TerminalPlay } from "./types.ts";

const NOW = Date.parse("2026-08-03T12:00:00-04:00");

function base(overrides: Partial<TerminalPlay> = {}): TerminalPlay {
  return {
    id: "0DTE:META",
    ticker: "META",
    direction: "LONG",
    contract: "592.5C · 0DTE",
    score: 94,
    status: "OPEN",
    horizon: "ZERO_DTE",
    exitModel: "RATCHET",
    factors: [],
    gates: [],
    recommendation: "HOLD",
    tierLabel: "A+",
    discoveryOrigin: ["BREAKOUT"],
    firstFlaggedAt: "2026-08-03T11:46:00-04:00",
    pnlPct: 42,
    peak: 87,
    ...overrides,
  };
}

describe("play-card-lifecycle", () => {
  it("playLifecyclePhase maps status buckets", () => {
    assert.equal(playLifecyclePhase("OPEN"), "open");
    assert.equal(playLifecyclePhase("WATCH"), "watch");
    assert.equal(playLifecyclePhase("CLOSED"), "closed");
  });

  it("formatRelativeAge returns human relative strings", () => {
    assert.equal(formatRelativeAge("2026-08-03T11:46:00-04:00", NOW), "14m ago");
    assert.equal(formatRelativeAge("2026-08-03T11:59:30-04:00", NOW), "30s ago");
  });

  it("freshness tier escalates with age on open trades", () => {
    assert.equal(freshnessTierFromAge(2 * 60_000, "open"), "just_fired");
    assert.equal(freshnessTierFromAge(10 * 60_000, "open"), "fresh");
    assert.equal(freshnessTierFromAge(22 * 60_000, "open"), "aging");
    assert.equal(freshnessTierFromAge(47 * 60_000, "open"), "late");
    assert.equal(freshnessTierFromAge(null, "closed"), "closed");
  });

  it("freshnessBadgeLabel matches urgency tiers", () => {
    assert.equal(freshnessBadgeLabel("just_fired", FRESHNESS_JUST_FIRED_MS - 1000), "JUST FIRED");
    assert.equal(freshnessBadgeLabel("fresh", 8 * 60_000), "8 MIN AGO");
    assert.equal(freshnessBadgeLabel("aging", 28 * 60_000), "28 MIN OLD");
    assert.equal(freshnessBadgeLabel("closed", null), "CLOSED");
  });

  it("playPrimaryEvent uses swing Discovered and Entered labels", () => {
    assert.deepEqual(
      playPrimaryEvent(base({ horizon: "SWING", status: "WATCH", detectedAt: "2026-08-01T10:00:00-04:00" })),
      { label: "Discovered", iso: "2026-08-01T10:00:00-04:00" },
    );
    assert.deepEqual(
      playPrimaryEvent(
        base({
          horizon: "SWING",
          status: "OPEN",
          firstFlaggedAt: "2026-08-02T10:00:00-04:00",
        }),
      ),
      { label: "Entered", iso: "2026-08-02T10:00:00-04:00" },
    );
  });

  it("playPrimaryEvent uses legacy Published and Confirmed labels", () => {
    assert.deepEqual(
      playPrimaryEvent(
        base({
          horizon: "LEGACY",
          status: "WATCH",
          detectedAt: "2026-08-02T17:30:00-04:00",
        }),
      ),
      { label: "Published", iso: "2026-08-02T17:30:00-04:00" },
    );
    assert.deepEqual(
      playPrimaryEvent(
        base({
          horizon: "LEGACY",
          status: "OPEN",
          morningStatus: "CONFIRMED",
          firstFlaggedAt: "2026-08-03T09:05:00-04:00",
        }),
      ),
      { label: "Confirmed", iso: "2026-08-03T09:05:00-04:00" },
    );
  });

  it("playFreshnessDisplay pulses just-fired open trades", () => {
    const fresh = playFreshnessDisplay(
      base({ firstFlaggedAt: "2026-08-03T11:58:00-04:00" }),
      NOW,
      "2026-08-03T11:58:00-04:00",
    );
    assert.equal(fresh.tier, "just_fired");
    assert.equal(fresh.pulse, true);
    assert.equal(fresh.lateEntry, false);

    const late = playFreshnessDisplay(
      base({ firstFlaggedAt: "2026-08-03T11:10:00-04:00" }),
      NOW,
      "2026-08-03T11:10:00-04:00",
    );
    assert.equal(late.tier, "late");
    assert.equal(late.lateEntry, true);
  });

  it("playLifecycleTimestamps only returns grounded clocks", () => {
    const rows = playLifecycleTimestamps(
      base({
        detectedAt: "2026-08-03T10:58:00-04:00",
        thesisHealth: { health: 80, rungLabel: "HOLD", committedAtEt: "11:00 ET" } as TerminalPlay["thesisHealth"],
        exitAt: "2026-08-03T12:06:00-04:00",
        status: "CLOSED",
      }),
    );
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Detected", "Committed", "Triggered", "Closed"],
    );
  });

  it("formatCompactAge returns short decay labels", () => {
    assert.equal(formatCompactAge("2026-08-03T11:56:00-04:00", NOW), "4m");
    assert.equal(formatCompactAge("2026-08-03T11:32:00-04:00", NOW), "28m");
    assert.equal(formatCompactAge("2026-08-03T10:00:00-04:00", NOW), "2h");
  });

  it("ageDecayTone escalates through fresh → aging → stale → late", () => {
    assert.equal(ageDecayToneFromAge(4 * 60_000, "open"), "fresh");
    assert.equal(ageDecayToneFromAge(28 * 60_000, "open"), "aging");
    assert.equal(ageDecayToneFromAge(63 * 60_000, "open"), "stale");
    assert.equal(ageDecayToneFromAge(130 * 60_000, "open"), "late");
  });

  it("playStatusDisplay maps scannable tones", () => {
    assert.deepEqual(playStatusDisplay("OPEN"), { label: "ACTIVE", tone: "active" });
    assert.deepEqual(playStatusDisplay("WATCH"), { label: "WATCH", tone: "watch" });
    // SKIP is the desk DECLINING a setup (premium ran, market too wide, past cutoff) — never a
    // loss, because nothing was bought. "FAILED" in bear-red put a red pill on 61 of 67 live rows
    // and contradicted the same card's "thesis intact" monitor.
    assert.deepEqual(playStatusDisplay("SKIP"), { label: "PASSED", tone: "passed" });
    assert.deepEqual(playStatusDisplay("CLOSED"), { label: "CLOSED", tone: "closed" });
  });

  it("playStatusLabel mirrors playStatusDisplay labels", () => {
    assert.equal(playStatusLabel("OPEN"), "ACTIVE");
    assert.equal(playStatusLabel("WATCH"), "WATCH");
    assert.equal(playStatusLabel("CLOSED"), "CLOSED");
    assert.equal(playStatusLabel("SKIP"), "PASSED");
  });

  it("closedRealizedPct prefers exit stamp", () => {
    assert.equal(closedRealizedPct(base({ status: "CLOSED", exitPnlPct: 42, pnlPct: -50 })), 42);
  });

  it("closedRealizedPct: trim-scale as-managed when peak armed tranches before runner stop", () => {
    assert.equal(
      closedRealizedPct(
        base({ status: "CLOSED", closedReason: "stopped", peak: 87.3, pnlPct: -50 }),
      ),
      6.67,
    );
  });

  it("playSymbolLine surfaces ticker + strike + DTE on the list rail", () => {
    assert.equal(playSymbolLine(base({ ticker: "SPXW", contract: "7595C · 0DTE" })), "SPXW 7595C 0DTE");
    assert.equal(playSymbolLine(base({ contract: "592.5C · 0DTE" })), "META 592.5C 0DTE");
  });

  it("playTimeRangeCompact shows triggered→closed for closed rows", () => {
    assert.equal(
      playTimeRangeCompact(
        base({
          status: "CLOSED",
          firstFlaggedAt: "2026-08-03T13:03:00-04:00",
          exitAt: "2026-08-03T13:28:00-04:00",
        }),
      ),
      "13:03→13:28",
    );
  });

  it("playListReturnPct prefers peak on closed rows", () => {
    assert.equal(
      playListReturnPct(base({ status: "CLOSED", peak: 6, exitPnlPct: 5, pnlPct: 5 })),
      6,
    );
    assert.equal(
      playListReturnPct(base({ status: "WATCH", trackPct: 18, pnlPct: null })),
      18,
    );
  });

  it("playTriggeredAtMs prefers watch detectedAt then open firstFlaggedAt", () => {
    assert.equal(
      playTriggeredAtMs(
        base({
          status: "WATCH",
          detectedAt: "2026-08-03T11:54:00-04:00",
          firstFlaggedAt: "2026-08-03T09:00:00-04:00",
        }),
      ),
      Date.parse("2026-08-03T11:54:00-04:00"),
    );
    assert.equal(
      playTriggeredAtMs(base({ status: "OPEN", firstFlaggedAt: "2026-08-03T13:03:00-04:00" })),
      Date.parse("2026-08-03T13:03:00-04:00"),
    );
  });
});


// ── LIST "PNL" COLUMN: CURRENT, NOT PEAK (2026-08-07) ────────────────────────────────────────
// Live: KRE rendered +73% in the list while the position was -34.1%; SPCX 0% at -51%; FHN +6% at
// -38.3%. The column preferred peakPct, so it showed the best the trade ever looked. Shared with
// the 0DTE deck, so both boards were affected.
describe("list PNL column — current, not peak", () => {
  const lcPlay = (over: Partial<TerminalPlay>): TerminalPlay =>
    ({ status: "OPEN", ticker: "KRE", contract: "60C", ...over }) as TerminalPlay;

  it("open row shows CURRENT return, never the peak high-water mark", () => {
    const shown = playListReturnPct(lcPlay({ status: "OPEN", pnlPct: -34.1, peak: 73 }));
    assert.equal(shown, -34.1, "a position down 34% must not render as +73%");
    assert.ok(shown != null && shown < 0, "sign must match reality — this is what members read");
  });

  it("open row falls back to peak ONLY when there is no live mark at all", () => {
    assert.equal(playListReturnPct(lcPlay({ status: "OPEN", pnlPct: null, peak: 42 })), 42);
  });

  it("closed row keeps peak-first — deliberately UNCHANGED by this fix", () => {
    // Boundary of this change: the live evidence was OPEN rows only, and an existing test states
    // closed-row peak preference as intent. Revisiting it is a product decision, not an inference.
    assert.equal(playListReturnPct(lcPlay({ status: "CLOSED", exitPnlPct: -50, peak: 88 })), 88);
  });

  it("WATCH rows keep trackPct — they hold no position, so there is no P&L", () => {
    assert.equal(playListReturnPct(lcPlay({ status: "WATCH", trackPct: 56, pnlPct: null, peak: null })), 56);
  });
});

describe("zeroDteActionDisplay — grounded ACTION vocabulary (2026-08-29)", () => {
  it("non-0DTE horizons never get the ACTION vocabulary", () => {
    assert.equal(zeroDteActionDisplay(base({ horizon: "SWING", status: "OPEN" })), null);
    assert.equal(zeroDteActionDisplay(base({ horizon: "LEGACY", status: "OPEN" })), null);
  });

  it("WATCH/SKIP stay null — no real data path for readiness state (deliberate, see roadmap doc)", () => {
    assert.equal(zeroDteActionDisplay(base({ status: "WATCH" })), null);
    assert.equal(zeroDteActionDisplay(base({ status: "SKIP" })), null);
  });

  it("OPEN + recommendation HOLD, no trims fired yet → HOLD", () => {
    assert.deepEqual(zeroDteActionDisplay(base({ status: "OPEN", recommendation: "HOLD" })), {
      label: "HOLD",
      tone: "active",
    });
  });

  it("recommendation SELL → EXIT regardless of trim state", () => {
    assert.deepEqual(zeroDteActionDisplay(base({ status: "HOLD", recommendation: "SELL" })), {
      label: "EXIT",
      tone: "active",
    });
  });

  it("recommendation TRIM reads the real next-unfired tranche's trigger_pct — never a hardcoded 25/50", () => {
    const play = base({
      status: "TRIM",
      recommendation: "TRIM",
      exitPolicy: {
        policy: "trim_scale",
        trim_levels: [
          { trigger_pct: 60, fraction: 0.5, premium: null, fired: true },
          { trigger_pct: 120, fraction: 0.5, premium: null, fired: false },
        ],
      } as TerminalPlay["exitPolicy"],
    });
    assert.deepEqual(zeroDteActionDisplay(play), { label: "TRIM 120%", tone: "active" });
  });

  it("any tranche fired + recommendation HOLD → RUNNER (matches trimLadderVisual's own semantics)", () => {
    const play = base({
      status: "HOLD",
      recommendation: "HOLD",
      exitPolicy: {
        policy: "trim_scale",
        trim_levels: [{ trigger_pct: 60, fraction: 1, premium: null, fired: true }],
      } as TerminalPlay["exitPolicy"],
    });
    assert.deepEqual(zeroDteActionDisplay(play), { label: "RUNNER", tone: "active" });
  });

  it("condor rows never get the directional ACTION vocabulary — coarse pill stays honest", () => {
    assert.equal(zeroDteActionDisplay(base({ status: "OPEN", recommendation: "HOLD", isCondor: true })), null);
  });

  it("CLOSED: real exit_reason values map to real labels", () => {
    assert.deepEqual(zeroDteActionDisplay(base({ status: "CLOSED", closedReason: "doubled" })), {
      label: "TARGET",
      tone: "closed",
    });
    assert.deepEqual(zeroDteActionDisplay(base({ status: "CLOSED", closedReason: "stopped" })), {
      label: "STOPPED",
      tone: "closed",
    });
    assert.deepEqual(zeroDteActionDisplay(base({ status: "CLOSED", closedReason: "time_stop" })), {
      label: "EOD EXIT",
      tone: "closed",
    });
  });

  it("CLOSED: an unrecognized/missing closedReason never fabricates a label — falls back to null", () => {
    assert.equal(zeroDteActionDisplay(base({ status: "CLOSED", closedReason: null })), null);
    assert.equal(zeroDteActionDisplay(base({ status: "CLOSED", closedReason: "trim_scale_first" })), null);
  });
});
