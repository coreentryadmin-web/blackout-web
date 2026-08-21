import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HawkRecordStrip } from "./HawkRecordStrip";
import type { NightHawkRecordResponse, NightHawkRecordSegmentWire } from "@/features/nighthawk/lib/types";

(globalThis as unknown as { React: typeof React }).React = React;

/**
 * The strip is the only client that renders the headline record, and `win_rate_pct` is the one
 * headline field the API can legitimately serve as `null`. Its type comment says so in as many
 * words — *"null when the window produced no DECIDED outcome — clients must render '—', never
 * 0%"* — but a template literal stringifies `null` without complaint and TypeScript permits it,
 * so the pill printed the literal characters `null%`.
 *
 * That is worse than the 0% the null exists to avoid: 0% is at least a number, and a member can
 * only read `null%` as the product being broken.
 *
 * The window that produces it is ordinary, not pathological. `scoreable` counts wins + losses +
 * OPENS, and opens dominate this lane by a wide margin — analytics.ts records a live sample of
 * 0 targets / 2 stops / 20 opens. Thirty scoreable rows with zero decided outcomes clears the
 * strip's `scoreable >= TRACK_RECORD_MIN_SAMPLE` gate and lands on a null rate.
 */

const SEGMENT: NightHawkRecordSegmentWire = {
  methodology: "v2_fillability",
  label: "current",
  resolved: 34,
  scoreable: 31,
  wins: 0,
  losses: 0,
  opens: 31,
  ambiguous: 0,
  unfilled: 3,
  pulled: 0,
  stop_data_unavailable: 0,
  excluded_total: 3,
  unfilled_not_pulled: 3,
  decided: 0,
  win_rate_pct: null,
  win_rate_ci_low_pct: null,
  win_rate_ci_high_pct: null,
  avg_return_pct: 1.4,
  low_n: true,
};

function recordWith(over: Partial<NightHawkRecordResponse> = {}): NightHawkRecordResponse {
  return {
    available: true,
    window_days: 30,
    total_resolved: 34,
    pending_count: 0,
    win_rate_pct: null,
    decided_count: 0,
    opens_count: 31,
    low_n: true,
    profitable_rate_pct: 61.3,
    avg_return_pct: 1.4,
    avg_return_pct_edge: 0.3,
    profitable_rate_edge_pct: 54.8,
    methodology: "v2_fillability",
    segments: { current: SEGMENT, legacy: { ...SEGMENT, label: "legacy", resolved: 0, scoreable: 0, opens: 0 } },
    by_conviction: [],
    ...over,
  };
}

const render = (record: NightHawkRecordResponse) =>
  renderToStaticMarkup(React.createElement(HawkRecordStrip, { record }));

test("REGRESSION: a null win rate renders an em-dash, never the string 'null%'", () => {
  const html = render(recordWith());

  assert.doesNotMatch(html, /null%/, "the literal text `null%` reached the member surface");
  assert.doesNotMatch(html, /undefined/, "an undefined leaked into rendered text");
  assert.match(html, /—/, "an unknown rate must render as an em-dash");
});

test("a null win rate does NOT become 0% — the distinction the API serves is preserved", () => {
  // 0% and "unknown" are opposite claims: one says every play missed its target, the other says
  // no play resolved either way. The route goes out of its way to send null rather than 0; the
  // client must not undo that by coercing.
  const html = render(recordWith());
  assert.doesNotMatch(html, />0%|\s0%/, "an unknown rate was flattened into a hard 0%");
});

test("a real win rate still renders as a percentage", () => {
  const cur = { ...SEGMENT, wins: 12, losses: 8, opens: 11, decided: 20, low_n: false };
  const html = render(
    recordWith({
      win_rate_pct: 60,
      decided_count: 20,
      low_n: false,
      segments: { current: cur, legacy: SEGMENT },
    }),
  );
  assert.match(html, /60%/);
  assert.match(html, /12W \/ 8L \/ 11 open/, "the composition that explains the denominator");
});

test("a negative average return keeps its sign, and a missing one blanks rather than reading as +0", () => {
  const negative = render(recordWith({ win_rate_pct: 40, avg_return_pct: -3.2, avg_return_pct_edge: -4.1 }));
  assert.match(negative, /-4\.1%/, "the fill-edge basis is primary and keeps its minus sign");

  // `null >= 0` evaluates true, so the pre-fix formatter would have emitted "+null%" here —
  // a fabricated GAIN out of a missing value, which is the worst direction to fail in.
  const missing = render(
    recordWith({
      win_rate_pct: 40,
      avg_return_pct: null as unknown as number,
      avg_return_pct_edge: undefined,
    }),
  );
  assert.doesNotMatch(missing, /\+null%/);
  assert.doesNotMatch(missing, /null/);
});

test("below the sample gate the strip stays on its building-record copy", () => {
  // The gate is `scoreable`, not `decided` — a thin window must not reach the metric pills at all.
  const thin = { ...SEGMENT, scoreable: 4, opens: 4, resolved: 4 };
  const html = render(recordWith({ segments: { current: thin, legacy: SEGMENT }, total_resolved: 4 }));
  assert.match(html, /Building track record/);
  assert.match(html, /4\/30 scoreable/);
  assert.doesNotMatch(html, /null/);
});
