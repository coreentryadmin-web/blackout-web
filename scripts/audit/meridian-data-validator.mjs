#!/usr/bin/env node
/**
 * Meridian data validator — checks the numbers a member SEES against the upstreams they come
 * from, and against each other.
 *
 * Two kinds of check, and the distinction matters:
 *
 *   GROUND TRUTH — refetch the same fact independently (Benzinga earnings via the Polygon
 *                  subscription, Polygon daily bars, Polygon chain) and compare. Catches a
 *                  wrong number.
 *   COHERENCE    — compare two things the app itself derives from the same facts. Catches a
 *                  number that is internally inconsistent, which is the failure mode that
 *                  survives every unit test: each half is individually plausible.
 *
 * The coherence checks exist because of what the first run found: on BIDU, `pack.history`
 * carried 4 prints and summarised "4/4 EPS beats over last 4 prints", while
 * `enrichment.print_history` on the SAME payload was empty and every beat rate was null. One
 * panel of the page contradicted another. No ground-truth check would have flagged that — both
 * numbers are individually defensible; it is their disagreement that is the defect.
 *
 * Read-only. One temp Clerk user, released in a finally. Never prints secrets.
 *
 * Run from the REPO ROOT:
 *   node scripts/audit/meridian-data-validator.mjs [--tickers=A,B] [--max=8] [--json]
 */
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const BASE = args.get("base") ?? "https://blackouttrades.com";
const MAX = Number(args.get("max") ?? 8);
const ONLY = args.get("tickers")?.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean) ?? null;
const JSON_OUT = args.has("json");

// Self-default the Polygon base the same way the rest of the toolkit does: Massive primary,
// polygon.io fallback, first 200 wins and sticks.
const POLY_KEY = process.env.POLYGON_API_KEY ?? "";
let POLY_BASE = /^https?:/.test(process.env.POLYGON_API_BASE ?? "") ? process.env.POLYGON_API_BASE : null;

async function polyGet(path, params = {}) {
  const bases = POLY_BASE ? [POLY_BASE] : ["https://api.massive.com", "https://api.polygon.io"];
  for (const base of bases) {
    const qs = new URLSearchParams({ ...params, apiKey: POLY_KEY });
    try {
      const r = await fetch(`${base}${path}?${qs}`);
      if (r.status === 200) {
        POLY_BASE = base;
        return await r.json();
      }
    } catch {
      /* try the next base */
    }
  }
  return null;
}

const findings = [];
/** severity: FAIL = a number is wrong or self-contradictory. WARN = missing where expected. */
const note = (severity, ticker, check, detail) => {
  findings.push({ severity, ticker, check, detail });
  if (!JSON_OUT) console.log(`  [${severity}] ${ticker} · ${check} — ${detail}`);
};

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** Today's ET calendar date. A session dated today has not closed and cannot be graded. */
const todayEtYmdLocal = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

const near = (a, b, tolPct) => {
  if (a == null || b == null) return null;
  if (a === 0 && b === 0) return true;
  return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) <= tolPct;
};

/**
 * Relative tolerance ALONE is wrong for a value the app has already rounded for display.
 *
 * A served YoY of `1.1%` against an exact 1.0684% is off by 2.96% relative — outside a 2%
 * relative tolerance — purely because one decimal place cannot express 1.0684. The comparison
 * was flagging the ROUNDING as a data defect, on names where the number was in fact correct
 * (HD and LOW, 2026-08-18). Allow half of the last displayed digit as an absolute floor: below
 * that, no disagreement is even representable.
 */
const nearRounded = (a, b, tolPct, decimals = 1) => {
  if (a == null || b == null) return null;
  const halfUlp = 0.5 * Math.pow(10, -decimals);
  if (Math.abs(a - b) <= halfUlp) return true;
  return near(a, b, tolPct);
};

/* ── ground truth ─────────────────────────────────────────────────────────────────── */

/**
 * Historical prints straight from Benzinga.
 *
 * `date.lt` is REQUIRED, not tidiness: an unbounded `sort=date.desc` returns PROJECTED FUTURE
 * rows first, and those carry no EPS fields at all — verified live, the first 6 rows for BIDU
 * were 2027/2026 projections with no financials. A validator that used the same unbounded query
 * would compare empty against empty and pass.
 */
async function truthPrints(ticker, beforeYmd) {
  const j = await polyGet("/benzinga/v1/earnings", {
    ticker,
    limit: "12",
    sort: "date.desc",
    "date.lt": beforeYmd,
  });
  const rows = j?.results ?? j?.data ?? [];
  return rows
    .filter((r) => r.actual_eps != null || r.actual_revenue != null)
    .map((r) => ({
      date: String(r.date).slice(0, 10),
      eps_actual: num(r.actual_eps),
      eps_estimate: num(r.estimated_eps),
      eps_surprise_pct: num(r.eps_surprise_percent),
      revenue_actual: num(r.actual_revenue),
      revenue_estimate: num(r.estimated_revenue),
    }));
}

/** Daily close-to-close percent change for a session, from Polygon daily bars. */
async function truthSessionMove(ticker, ymd) {
  const j = await polyGet(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${ymd}/${ymd}`, {
    adjusted: "true",
  });
  const bar = j?.results?.[0];
  if (!bar || !Number.isFinite(bar.o) || !Number.isFinite(bar.c) || bar.o === 0) return null;
  return ((bar.c - bar.o) / bar.o) * 100;
}

/* ── per-ticker validation ────────────────────────────────────────────────────────── */

async function validateEvent(fetchJson, item) {
  const ticker = item.ticker;
  // fetchAuditJson takes (base, path) and concatenates them. Passing ONE argument silently
  // appended the string "undefined" to every event id — which the route accepted, because the
  // id parser did not validate its date component. The result was a HTTP 200 carrying a
  // half-populated brief, and this validator reported it as a product P1 on every ticker on
  // every run for a day. Harness bugs that manufacture findings are worse than no harness.
  const ev = await fetchJson(BASE, `/api/market/meridian/event?id=${encodeURIComponent(item.id)}`);
  if (!ev.ok || !ev.json) {
    note("FAIL", ticker, "event:fetch", `HTTP ${ev.status}`);
    return;
  }
  const { pack, enrichment: en, intel } = ev.json;

  /* ── COHERENCE: the two history paths must agree ──────────────────────────────────
     pack.history and enrichment.print_history are built by different loaders from the same
     Benzinga calendar. One panel saying "4/4 EPS beats" while the tabs render nothing is a
     defect even if each half is individually defensible. */
  const packHist = pack?.history ?? [];
  const enHist = en?.print_history ?? [];
  if (packHist.length > 0 && enHist.length === 0) {
    note(
      "FAIL",
      ticker,
      "coherence:print_history",
      `pack.history has ${packHist.length} prints (${JSON.stringify(pack?.history_summary ?? "")}) but enrichment.print_history is EMPTY — the tabs render nothing while the pack claims history`
    );
  }
  if (packHist.length > 0 && en?.beat_rates?.eps_beat_rate == null) {
    note("FAIL", ticker, "coherence:beat_rates", `pack has ${packHist.length} prints but beat_rates.eps_beat_rate is null`);
  }

  /* ── GROUND TRUTH: print history vs Benzinga ──────────────────────────────────── */
  const truth = await truthPrints(ticker, item.date ?? pack?.earnings_date);
  if (truth.length === 0) {
    note("WARN", ticker, "truth:prints", "Benzinga returned no historical prints — nothing to compare");
  } else if (enHist.length === 0) {
    note(
      "FAIL",
      ticker,
      "truth:print_history",
      `Benzinga has ${truth.length} prints with actuals (latest ${truth[0].date} EPS ${truth[0].eps_actual}) but the app serves ZERO`
    );
  } else {
    // Only prints the app actually CLAIMS to cover. `loadBenzingaTickerEarnings` queries a
    // 420-day window ending at the event, so a 2024 print is outside the app's stated scope and
    // its absence is the window working, not data loss. Comparing against an unbounded ground
    // truth reported BHP's 2025-02-17 and 2024-08-26 prints as missing when neither was ever in
    // range — a harness assumption masquerading as a product defect.
    const oldestServed = enHist.map((p) => p.report_date).filter(Boolean).sort()[0] ?? null;
    for (const t of truth.slice(0, 4)) {
      if (oldestServed && t.date < oldestServed) continue;
      const got = enHist.find((p) => p.report_date === t.date);
      if (!got) {
        note("FAIL", ticker, "truth:print_missing", `Benzinga print ${t.date} absent from the app`);
        continue;
      }
      for (const [field, tv, gv] of [
        ["eps_actual", t.eps_actual, num(got.eps_actual)],
        ["eps_estimate", t.eps_estimate, num(got.eps_estimate)],
        ["revenue_actual", t.revenue_actual, num(got.revenue_actual)],
      ]) {
        if (tv == null || gv == null) continue;
        if (!near(tv, gv, 0.01)) {
          note("FAIL", ticker, `truth:${field}@${t.date}`, `app ${gv} vs Benzinga ${tv}`);
        }
      }
      /* COHERENCE: the beat flag must follow from the surprise the app itself carries. */
      const s = num(got.surprise_pct);
      if (s != null && got.beat != null && got.beat !== s >= 0) {
        note("FAIL", ticker, `coherence:beat@${t.date}`, `beat=${got.beat} contradicts surprise_pct=${s}`);
      }
    }
  }

  /* ── COHERENCE: beat_rates must equal the history the app is showing ───────────── */
  const graded = enHist.filter((p) => p.beat != null);
  if (graded.length > 0 && en?.beat_rates?.eps_beat_rate != null) {
    const expect = graded.filter((p) => p.beat).length / graded.length;
    if (!near(expect, num(en.beat_rates.eps_beat_rate), 0.02)) {
      note(
        "FAIL",
        ticker,
        "coherence:eps_beat_rate",
        `served ${en.beat_rates.eps_beat_rate} but its own print_history gives ${expect.toFixed(3)} (${graded.filter((p) => p.beat).length}/${graded.length})`
      );
    }
  }

  /* ── GROUND TRUTH: session reaction vs Polygon bars ────────────────────────────── */
  for (const p of enHist.slice(0, 3)) {
    const got = num(p.session_change_pct);
    if (got == null || !p.report_date) continue;
    // Only the BMO case can be checked against the report date's own session; an AMC print
    // reacts the NEXT session, and asserting on the wrong one would manufacture a failure.
    if (p.reaction_basis && p.reaction_basis !== "bmo_session") continue;
    // TODAY's session is still OPEN. The app reports a live session change while Polygon's daily
    // bar for the same date is a partial bar that keeps moving, so the two are sampled at
    // different instants by construction and any disagreement says nothing about correctness.
    // Measured 2026-08-18 mid-RTH: HD app 1.43% vs bar 1.60%, BHP app 0.21% vs bar 0.21% — the
    // second pair is IDENTICAL to displayed precision and still failed a relative-only tolerance.
    if (p.report_date >= todayEtYmdLocal()) continue;
    const truthMove = await truthSessionMove(ticker, p.report_date);
    if (truthMove == null) continue;
    // Rounding floor as well as a relative tolerance: session_change_pct is served to 2dp, and
    // below half of the last displayed digit no disagreement is even representable.
    if (!nearRounded(got, truthMove, 0.02, 2)) {
      note(
        "FAIL",
        ticker,
        `truth:session_change@${p.report_date}`,
        `app ${got.toFixed(2)}% vs Polygon bar ${truthMove.toFixed(2)}%`
      );
    }
  }

  /* ── COHERENCE: expected-move band must match its own percentage ───────────────── */
  const emPct = num(intel?.expected_move_pct);
  const band = intel?.expected_move_band;
  if (emPct != null && band && num(band.spot) != null) {
    const spot = num(band.spot);
    for (const [side, sign] of [["up", 1], ["down", -1]]) {
      const v = num(band[side]);
      if (v == null) continue;
      const expect = spot * (1 + (sign * emPct) / 100);
      if (!near(v, expect, 0.01)) {
        note("FAIL", ticker, `coherence:expected_move_${side}`, `band ${v} vs spot ${spot} ±${emPct}% = ${expect.toFixed(2)}`);
      }
    }
  }

  /* ── COHERENCE: spot must agree between the panels that each carry one ─────────── */
  const spots = [
    ["intel.expected_move_band.spot", num(band?.spot)],
    ["intel.thermal.spot", num(intel?.thermal?.spot)],
    ["pack.positioning.spot", num(pack?.positioning?.spot)],
  ].filter(([, v]) => v != null);
  for (let i = 1; i < spots.length; i++) {
    if (!near(spots[0][1], spots[i][1], 0.02)) {
      note("FAIL", ticker, "coherence:spot", `${spots[0][0]}=${spots[0][1]} vs ${spots[i][0]}=${spots[i][1]}`);
    }
  }

  /* ── GROUND TRUTH: spot vs Polygon last close ──────────────────────────────────── */
  const appSpot = spots[0]?.[1] ?? null;
  if (appSpot != null) {
    const prev = await polyGet(`/v2/aggs/ticker/${encodeURIComponent(ticker)}/prev`, { adjusted: "true" });
    const close = num(prev?.results?.[0]?.c);
    // 8% — this is a sanity bound on a stale or wrong-symbol quote, not a price check: the app
    // serves a LIVE spot and the comparison is a previous CLOSE, so they legitimately differ.
    if (close != null && !near(appSpot, close, 0.08)) {
      note("WARN", ticker, "truth:spot", `app ${appSpot} vs Polygon prev close ${close} (>8% apart)`);
    }
  }

  /* ── COHERENCE: walls must straddle sensibly ───────────────────────────────────── */
  const cw = num(intel?.thermal?.call_wall);
  const pw = num(intel?.thermal?.put_wall);
  if (cw != null && pw != null && cw <= pw) {
    note("FAIL", ticker, "coherence:walls", `call_wall ${cw} is not above put_wall ${pw}`);
  }

  /* ── COHERENCE: street_skew counts vs the price-target rows it summarises ──────── */
  const pts = en?.price_targets ?? [];
  const skew = en?.street_skew;
  if (skew && pts.length > 0) {
    const raised = pts.filter((p) => p.action === "raised").length;
    const lowered = pts.filter((p) => p.action === "lowered").length;
    if (num(skew.raised_count) === 0 && num(skew.lowered_count) === 0 && raised + lowered > 0) {
      note(
        "FAIL",
        ticker,
        "coherence:street_skew",
        `skew says 0 raised / 0 lowered but price_targets carry ${raised} raised and ${lowered} lowered`
      );
    }
  }

  /* ── COHERENCE: YoY must follow from the estimates the app carries ─────────────── */
  const yoy = en?.earnings_yoy;
  const cal = en?.earnings_calendar;
  if (yoy?.eps_yoy_pct != null && cal?.estimated_eps != null && cal?.previous_eps != null && num(cal.previous_eps) !== 0) {
    const expect = ((num(cal.estimated_eps) - num(cal.previous_eps)) / Math.abs(num(cal.previous_eps))) * 100;
    if (!nearRounded(num(yoy.eps_yoy_pct), expect, 0.02)) {
      note("FAIL", ticker, "coherence:eps_yoy", `served ${yoy.eps_yoy_pct}% vs est ${cal.estimated_eps} over prior ${cal.previous_eps} = ${expect.toFixed(1)}%`);
    }
  }

  /* ── EXPIRY SCOPE: are the levels describing the chain that prices THIS print? ───
     The defect this catches: walls/flip summed over the ~8 nearest expiries and a max pain
     scoped to the FRONT expiry, served for an event ten days out. Both numbers are individually
     valid and describe a chain that may die before the company reports. */
  const th = intel?.thermal;
  const eventYmd = item.date ?? pack?.earnings_date ?? null;
  if (th?.available && eventYmd) {
    if (!th.expiry_scope) {
      note("WARN", ticker, "scope:absent", "thermal carries no expiry_scope — levels are unlabelled as to which chain they describe");
    } else if (th.expiry_scope === "aggregate") {
      note(
        "WARN",
        ticker,
        "scope:aggregate",
        `levels are a whole-book aggregate (${th.aggregate_expiry_count ?? "?"} expiries), not scoped to the ${eventYmd} print`
      );
    } else if (th.expiry_used && th.expiry_used < eventYmd) {
      // A scoped expiry BEFORE the print is the original bug wearing a label.
      note("FAIL", ticker, "scope:expiry_before_event", `scoped to ${th.expiry_used}, which expires before the ${eventYmd} print`);
    }
    // Max pain has to be a real strike on the ladder, not an interpolation or a stale value.
    const strikes = (th.top_strikes ?? []).map((s) => num(s.strike)).filter((v) => v != null);
    if (num(th.max_pain) != null && strikes.length >= 3) {
      const lo = Math.min(...strikes);
      const hi = Math.max(...strikes);
      if (num(th.max_pain) < lo || num(th.max_pain) > hi) {
        note("WARN", ticker, "scope:max_pain_range", `max pain ${th.max_pain} sits outside the served strike band ${lo}-${hi}`);
      }
    }
  }

  /* ── FLOW WINDOW: must widen with distance to the print ─────────────────────────
     Flow measured over 24h means something different ten days out than it does on the
     morning of, so the window is expected to scale — and to be STATED. */
  const fw = num(intel?.flow_into_print?.window_hours);
  const dUntil = num(pack?.days_until);
  if (intel?.flow_into_print?.available && fw != null && dUntil != null) {
    if (dUntil <= 0 && fw > 48) {
      note("WARN", ticker, "flow:window_too_wide", `${fw}h window on a same-day print dilutes the signal`);
    }
    if (dUntil >= 7 && fw < 72) {
      note("WARN", ticker, "flow:window_too_narrow", `${fw}h window ${dUntil}d before the print sees almost nothing`);
    }
  }

  /* ── SUMMARY INPUTS: the tab computes from these, so they must cohere ───────────
     The Summary panel renders client-side and the validator cannot see it. What it CAN do is
     check that the inputs the panel derives from are internally consistent — which is where a
     wrong percentage would come from. */
  const emPctS = num(intel?.expected_move_pct);
  const spotS = num(intel?.thermal?.spot) ?? num(intel?.expected_move_band?.spot);
  if (emPctS != null && emPctS <= 0) {
    note("FAIL", ticker, "summary:move_non_positive", `expected_move_pct ${emPctS} cannot define a distribution`);
  }
  if (emPctS != null && emPctS > 60) {
    note("WARN", ticker, "summary:move_implausible", `expected_move_pct ${emPctS}% is implausibly large for an equity print`);
  }
  if (spotS != null && spotS <= 0) {
    note("FAIL", ticker, "summary:spot_non_positive", `spot ${spotS}`);
  }

  /* ── Unrounded floats — the desk's recurring systemic defect ───────────────────── */
  const scan = (obj, path = "") => {
    if (obj == null || typeof obj !== "object") return;
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "number" && Number.isFinite(v)) {
        const s = String(v);
        if (/\.\d{8,}/.test(s)) note("WARN", ticker, "format:unrounded", `${path}${k} = ${s}`);
      } else if (typeof v === "object") scan(v, `${path}${k}.`);
    }
  };
  scan(ev.json);
}

/* ── main ─────────────────────────────────────────────────────────────────────────── */

async function main() {
  const { fetchAuditJson, releaseAuditClerkSession } = await import("./lib/audit-auth-fetch.mjs");
  try {
    const tl = await fetchAuditJson(BASE, "/api/market/meridian/timeline?days=21");
    if (!tl.ok) {
      console.error(`HARNESS: timeline HTTP ${tl.status}`);
      process.exitCode = 1;
      return;
    }
    let items = (tl.json?.items ?? []).filter((i) => i.kind === "earnings");
    if (ONLY) items = items.filter((i) => ONLY.includes(String(i.ticker).toUpperCase()));
    // Prefer the names most likely to have full data — a micro-cap with no coverage produces
    // WARNs that say nothing about correctness.
    else items = items.sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0));
    items = items.slice(0, MAX);

    if (!JSON_OUT) console.log(`MERIDIAN DATA VALIDATOR — ${items.length} events\n`);
    for (const item of items) {
      if (!JSON_OUT) console.log(`── ${item.ticker} (${item.date}, importance ${item.importance ?? "—"})`);
      try {
        await validateEvent(fetchAuditJson, item);
      } catch (e) {
        note("WARN", item.ticker, "harness", String(e?.message ?? e).slice(0, 120));
      }
    }
  } finally {
    await releaseAuditClerkSession();
  }

  const fails = findings.filter((f) => f.severity === "FAIL");
  const warns = findings.filter((f) => f.severity === "WARN");
  if (JSON_OUT) {
    console.log(JSON.stringify({ findings, fail: fails.length, warn: warns.length }, null, 2));
  } else {
    console.log(`\n${fails.length} FAIL · ${warns.length} WARN`);
    const byCheck = {};
    for (const f of fails) byCheck[f.check.split("@")[0]] = (byCheck[f.check.split("@")[0]] ?? 0) + 1;
    for (const [k, v] of Object.entries(byCheck).sort((a, b) => b[1] - a[1])) console.log(`  ${v}× ${k}`);
  }
  process.exitCode = fails.length > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exitCode = 1;
});
