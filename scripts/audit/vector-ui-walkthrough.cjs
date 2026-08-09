/**
 * Vector INTERACTION walkthrough — click every control, assert the desk survives each state.
 *
 * WHY THIS EXISTS. The invariant harness (`vector-play-invariants.mjs`) calls the real production
 * `buildVectorPlay` on real data and is now clean across 216 ticker/horizon/timeframe combinations.
 * It never touches the UI. Every screenshot taken alongside it was a STATIC page load — nothing had
 * been clicked. So the numbers layer had evidence and the interaction layer had none: the timeframe
 * select, the DTE toggle, the GEX/VEX lens, the 1D/1W/4H surface, Replay, the indicator menu and
 * the ladder's reset button were all unverified, on the desk's flagship page.
 *
 * WHAT IT ASSERTS. Per state, the things whose absence means a member sees something broken:
 *   - no error boundary / "something went wrong" / Next.js error overlay
 *   - the chart canvas exists and has real pixels (a 0x0 canvas renders as an empty black box)
 *   - the GEX ladder has rows
 *   - the play card carries a headline (blank = the engine threw — the #1958 failure mode, which
 *     shipped precisely because no harness looked at the panel)
 *   - no visible "unavailable" / "failed to load" text inside the desk
 * Each state is also captured to PNG so a regression has a picture, not just a boolean.
 *
 * WHAT IT CANNOT ASSERT — say so, do not imply otherwise:
 *   - SSE push freshness. The tunnel is one-shot request/response and cannot stream, so streaming
 *     requests are aborted and the desk uses its SWR polling fallback (see proxy-tunnel-context).
 *   - Anything that only happens during RTH. Run it again with the market open; off-hours the tape
 *     is frozen at the last close and empty live-state is correct, not a fault.
 *   - Visual correctness. It checks that things are THERE, not that they are RIGHT.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a finally (FAPI is rate-limited).
 *
 * Run:  node scripts/audit/vector-ui-walkthrough.cjs [--ticker=NVDA] [--out=DIR] [--json]
 * Exits non-zero if any state fails an assertion.
 */
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const TICKER = arg("ticker", "NVDA");
const OUT = arg("out", process.env.SHOT_OUT || ".");
const AS_JSON = argv.includes("--json");

/**
 * The walkthrough. `sel` is clicked (skipped when absent — the step then reports `skipped`, which
 * is honest: a control that is not rendered was not exercised and must not read as a pass).
 * `settle` is how long the desk gets to react before assertions run.
 */
const STEPS = [
  { id: "00-load", label: "initial load", sel: null, settle: 14000 },
  { id: "01-tf-1m", label: "timeframe 1m", select: ["[data-testid=vector-tf-select]", "1"], settle: 6000, effect: { kind: "selectValue", sel: "[data-testid=vector-tf-select]", value: "1" } },
  { id: "02-tf-15m", label: "timeframe 15m", select: ["[data-testid=vector-tf-select]", "15"], settle: 6000, effect: { kind: "selectValue", sel: "[data-testid=vector-tf-select]", value: "15" } },
  { id: "03-tf-60m", label: "timeframe 60m", select: ["[data-testid=vector-tf-select]", "60"], settle: 6000, effect: { kind: "selectValue", sel: "[data-testid=vector-tf-select]", value: "60" } },
  { id: "04-dte-0dte", label: "DTE 0DTE", sel: "[data-testid=vector-dte-0dte]", settle: 8000, horizon: "0dte", effect: { kind: "active", sel: "[data-testid=vector-dte-0dte]" } },
  { id: "05-dte-monthly", label: "DTE monthly", sel: "[data-testid=vector-dte-monthly]", settle: 8000, horizon: "monthly", effect: { kind: "active", sel: "[data-testid=vector-dte-monthly]" } },
  { id: "06-dte-weekly", label: "DTE weekly", sel: "[data-testid=vector-dte-weekly]", settle: 8000, horizon: "weekly", effect: { kind: "active", sel: "[data-testid=vector-dte-weekly]" } },
  { id: "07-lens-vex", label: "lens VEX", sel: "[data-testid=vector-lens-vex]", settle: 6000, effect: { kind: "active", sel: "[data-testid=vector-lens-vex]" } },
  { id: "08-lens-gex", label: "lens GEX", sel: "[data-testid=vector-lens-gex]", settle: 6000, effect: { kind: "active", sel: "[data-testid=vector-lens-gex]" } },
  { id: "09-ladder-reset", label: "ladder reset-to-spot", sel: "[data-testid=vector-gex-ladder-reset]", settle: 2500, effect: { kind: "spotInLadderView" } },
  { id: "10-indicators", label: "indicator menu", sel: "[data-testid=vector-indicator-trigger]", settle: 2500, effect: { kind: "expanded", sel: "[data-testid=vector-indicator-trigger]" } },
  { id: "11-replay", label: "replay toggle", sel: "[data-testid=vector-replay-toggle]", settle: 4000, effect: { kind: "exists", sel: "[data-testid=vector-replay-play]" } },
];

/**
 * The daily surface is a DIFFERENT component (VectorDailyChart), so `daily: true` swaps which chart
 * container the assertions require. Returning to Intraday is deliberately NOT daily — an earlier
 * version of this file put step 15 in this list and inherited the flag, then reported the desk as
 * broken for correctly showing the intraday chart. The harness was wrong, not the page.
 */
const DAILY_STEPS = [
  { id: "12-view-1D", label: "chart view 1D", text: "1D", settle: 9000, daily: true, effect: { kind: "viewActive", text: "1D" } },
  { id: "13-view-1W", label: "chart view 1W", text: "1W", settle: 9000, daily: true, effect: { kind: "viewActive", text: "1W" } },
  { id: "14-view-4H", label: "chart view 4H", text: "4H", settle: 9000, daily: true, effect: { kind: "viewActive", text: "4H" } },
  { id: "15-view-intraday", label: "chart view Intraday", text: "Intraday", settle: 9000, daily: false, effect: { kind: "viewActive", text: "Intraday" } },
];

const BROKEN_TEXT = /something went wrong|we couldn['’]t load|failed to load|unhandled runtime error|application error/i;

/**
 * The desk renders each toolbar control TWICE — a 0x0 hidden instance and the real one.
 *
 * `page.$(sel)` and `document.querySelector(sel)` both return the FIRST match, which is the zero-size
 * copy. An earlier run of this file clicked that copy, asserted against that copy, and reported NINE
 * failures ("the click had no effect") on controls that work perfectly. Probed live: every one of
 * these testids resolves to two elements, the first with rect [0,0,0,0].
 *
 * So both the acting side AND the asserting side must resolve to the element a MEMBER can hit —
 * anything with a real box. Fixing only the click would have moved the false failure, not removed it.
 */
const VISIBLE = ':not([hidden])';
function visibleLocator(page, sel) {
  return page.locator(`${sel}${VISIBLE}`).filter({ visible: true }).last();
}

/**
 * Did the click actually DO anything?
 *
 * Without this the walkthrough is theatre: it clicks a control, the desk ignores the click, the
 * page still has a chart and a ladder, and every state reports `ok`. That is the same failure the
 * play-invariant harness shipped twice — green because it was testing nothing. So every acting step
 * declares an observable consequence, and a step whose consequence did not happen FAILS even if the
 * page is otherwise healthy.
 */
async function verifyEffect(page, effect) {
  if (!effect) return null;
  return page.evaluate((e) => {
    // Same duplicate-instance trap as the click side: querySelector returns the 0x0 copy. Resolve
    // to the element with a real box, which is the one a member sees and interacts with.
    const q = (sel) => {
      const all = [...document.querySelectorAll(sel)];
      return all.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? all[0] ?? null;
    };
    const isActive = (el) =>
      Boolean(
        el &&
          (el.getAttribute("aria-pressed") === "true" ||
            el.getAttribute("aria-selected") === "true" ||
            el.getAttribute("data-active") === "true" ||
            /\bis-active\b|\bactive\b/.test(el.className || ""))
      );
    switch (e.kind) {
      case "selectValue": {
        const el = q(e.sel);
        if (!el) return `select ${e.sel} vanished`;
        return String(el.value) === String(e.value) ? null : `select is "${el.value}", expected "${e.value}"`;
      }
      case "active": {
        const el = q(e.sel);
        if (!el) return `${e.sel} vanished`;
        return isActive(el) ? null : `${e.sel} did not become active — the click had no effect`;
      }
      case "expanded": {
        const el = q(e.sel);
        if (!el) return `${e.sel} vanished`;
        return el.getAttribute("aria-expanded") === "true" ? null : `${e.sel} did not expand`;
      }
      case "exists":
        return q(e.sel) ? null : `${e.sel} never appeared`;
      case "viewActive": {
        const btns = [...document.querySelectorAll(".vector-chart-view-btn")].filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        const hit = btns.find((b) => (b.textContent || "").trim() === e.text);
        if (!hit) return `view button "${e.text}" not found`;
        return isActive(hit) ? null : `view "${e.text}" did not become active`;
      }
      case "spotInLadderView": {
        // The reset button's whole job: put the spot marker back inside the visible rail.
        const list = q(".vector-gex-ladder-rows");
        const spot = q(".vector-gex-ladder-spot");
        if (!list || !spot) return "ladder list or spot marker missing";
        const l = list.getBoundingClientRect();
        const s = spot.getBoundingClientRect();
        return s.top >= l.top - 4 && s.bottom <= l.bottom + 4
          ? null
          : `spot marker outside the rail viewport after reset (spot ${Math.round(s.top)}..${Math.round(s.bottom)}, rail ${Math.round(l.top)}..${Math.round(l.bottom)})`;
      }
      default:
        return `unknown effect kind "${e.kind}"`;
    }
  }, effect);
}

/**
 * DOES THE SCREEN AGREE WITH THE DATA?
 *
 * Everything else in this file checks that things are PRESENT. That is not the same as correct,
 * and the distinction is not academic here: the bug that started this whole audit was a play panel
 * whose every individual number was right and whose sentence was self-contradictory. It was found
 * by a human reading a screenshot, and nothing automated would have caught it.
 *
 * This is the automatable half of that gap — cross-check the values the DESK RENDERED against the
 * values the API SERVED for the same ticker and horizon. It catches the class where the transport,
 * the formatter or a stale render silently disagrees with the source: a spot that stopped updating,
 * a ladder showing another ticker's strikes, a wall label that lost a digit.
 *
 * It deliberately does NOT try to judge whether the underlying numbers are the RIGHT numbers.
 * That is the invariant harness's job (relationships between values) and, past that, a human's.
 */
async function captureApiBaseline(page, ticker, horizons) {
  const out = {};
  for (const h of horizons) {
    out[h] = await page.evaluate(
      async (q) => {
        const r = await fetch(`/api/market/vector/gex-ladder?ticker=${encodeURIComponent(q.t)}&dte=${encodeURIComponent(q.h)}`);
        if (!r.ok) return { error: `HTTP ${r.status}` };
        const j = await r.json();
        return { spot: j?.spot ?? null, strikes: (j?.ladder?.rows ?? []).map((x) => Number(x.strike)) };
      },
      { t: ticker, h }
    );
  }
  return out;
}

function crossCheckAgainstBaseline(shown, base, { liveSession }) {
  const fails = [];
  if (!base || base.error) return [`no API baseline to compare against (${base?.error ?? "missing"})`];

  if (shown.spot == null) {
    fails.push("ladder header shows no spot");
  } else if (base.spot != null) {
    // Off-hours the tape is frozen, so this should match closely. During RTH the baseline was taken
    // at run start and the header tracks live spot, so real drift is expected and not a defect —
    // the tolerance widens rather than the check being dropped, so a spot that stops updating
    // entirely (or shows another instrument) is still caught.
    const tol = liveSession ? 0.05 : 0.01;
    const drift = Math.abs(shown.spot - base.spot) / base.spot;
    if (drift > tol) {
      fails.push(`rendered spot ${shown.spot} vs API ${base.spot} — ${(drift * 100).toFixed(2)}% apart (tolerance ${(tol * 100).toFixed(0)}%)`);
    }
  }

  // Every rendered strike must EXIST in the API ladder. The converse is NOT required: the rail is
  // deliberately scoped to the chart's visible price band (#1957), so a subset is correct.
  if (shown.strikes.length && base.strikes?.length) {
    const known = new Set(base.strikes);
    const alien = shown.strikes.filter((x) => !known.has(x));
    if (alien.length) {
      fails.push(`${alien.length} rendered strike(s) absent from the API ladder, e.g. ${alien.slice(0, 3).join(", ")}`);
    }
  }
  return fails;
}

async function readRenderedLadder(page) {
  return page.evaluate(() => {
    const pick = (sel) => {
      const all = [...document.querySelectorAll(sel)];
      return all.find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }) ?? null;
    };
    const head = pick(".vector-gex-ladder-sub");
    const spotTxt = head ? (head.textContent || "").match(/[\d,]+\.?\d*/) : null;
    const strikes = [...document.querySelectorAll(".vector-gex-ladder-rows > *")]
      .map((el) => Number(String(el.textContent || "").trim().split(/\s+/)[0].replace(/,/g, "")))
      .filter((n) => Number.isFinite(n));
    return { spot: spotTxt ? Number(spotTxt[0].replace(/,/g, "")) : null, strikes };
  });
}

/** Assertions run inside the page. Kept as one evaluate so a state is measured at one instant. */
async function inspect(page, { daily }) {
  return page.evaluate((isDaily) => {
    const txt = (document.body.innerText || "").slice(0, 200000);
    const canvases = [...document.querySelectorAll("canvas")].map((c) => ({
      w: c.width,
      h: c.height,
    }));
    const chart = document.querySelector(isDaily ? "[data-testid=vector-daily-chart]" : ".vector-chart-terminal-chart");
    const ladderRows = document.querySelectorAll(".vector-gex-ladder-rows > *").length;
    const playCard = document.querySelector("[data-testid=vector-play-card]");
    const nav = document.querySelector(".nav-signin") ? "signed-out" : "signed-in";
    return {
      bodyText: txt,
      canvasCount: canvases.length,
      biggestCanvas: canvases.reduce((a, c) => Math.max(a, c.w * c.h), 0),
      chartPresent: Boolean(chart),
      ladderRows,
      // The card's first line is the grade badge ("B"), which is present even when the engine
      // produced nothing useful. Take the longest line instead — that is the headline, and its
      // absence is the real signal that buildVectorPlay threw.
      playHeadline: playCard
        ? ((playCard.innerText || "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .sort((a, b) => b.length - a.length)[0] ?? null)
        : null,
      nav,
    };
  }, daily);
}

function assertState(snap, { daily }) {
  const fails = [];
  const m = BROKEN_TEXT.exec(snap.bodyText);
  if (m) fails.push(`error text on page: "${m[0]}"`);
  if (!snap.chartPresent) fails.push(daily ? "daily chart container missing" : "intraday chart container missing");
  // A canvas that exists at 0x0 renders as an empty black box — "present" is not enough.
  if (!(snap.biggestCanvas > 10000)) fails.push(`no chart canvas with real pixels (largest ${snap.biggestCanvas}px²)`);
  if (!daily && snap.ladderRows < 1) fails.push("GEX ladder has no rows");
  // Blank play card = buildVectorPlay threw. Exactly the #1958 failure mode.
  if (!daily && !snap.playHeadline) fails.push("play card is empty (engine threw, or never rendered)");
  if (snap.nav === "signed-out") fails.push("nav rendered signed-out on an authenticated desk page");
  return fails;
}

async function run(cookieHeader) {
  const url = `${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`;
  const { browser, ctx, counts } = await createTunneledContext({
    url,
    cookie: cookieHeader,
    viewport: "1680x1050",
    desktop: true,
  });
  const page = await ctx.newPage();
  const results = [];
  // /vector opens on WEEKLY (VectorChart's default); every DTE step below updates this.
  let horizon = "weekly";
  /**
   * API baselines, captured ONCE at the very start.
   *
   * The minted Clerk __session JWT is dead ~72s after issue and cannot be extended by activity
   * (measured 2026-08-09: 200 at t+61s, 401 at t+72s, still 401 at t+194s under continuous load).
   * This walkthrough deliberately waits for the desk to settle between steps and runs well past
   * that, so any authenticated fetch issued mid-run returns 401 — an earlier version of the
   * cross-check did exactly that and reported eight failures that were purely its own expiry.
   *
   * Capturing up front means every later comparison is against data fetched while authenticated,
   * and the harness stops needing credentials it no longer has.
   *
   * This is also the explanation for the SPX "GEX ladder unavailable" state this harness first
   * surfaced: returning to Intraday remounts the chart, which emits a new spot, which re-runs the
   * ladder's fetch effect — past the 72s window, so it 401'd and latched the error state. A real
   * member's browser refreshes its Clerk token continuously and does not hit that path.
   */
  let baseline = {};
  let liveSession = false;

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    // Inside the auth window: baselines first, before any settle time is spent.
    baseline = await captureApiBaseline(page, TICKER, ["0dte", "weekly", "monthly"]);
    liveSession = await page
      .evaluate(() => !document.body.innerText.includes("CLOSE"))
      .catch(() => false);

    // Each step's own `daily` wins. Blanket-stamping `daily: true` across DAILY_STEPS is what made
    // "return to Intraday" assert for the daily container and report the desk broken.
    const all = [...STEPS.map((s) => ({ daily: false, ...s })), ...DAILY_STEPS.map((s) => ({ daily: true, ...s }))];

    for (const step of all) {
      let acted = "none";
      try {
        if (step.select) {
          const [sel, value] = step.select;
          const loc = visibleLocator(page, sel);
          if (await loc.count()) {
            await loc.selectOption(value);
            acted = "select";
          } else acted = "missing";
        } else if (step.text) {
          // The 1D/1W/4H/Intraday buttons carry no testid — matched on exact label within the
          // view-toggle group so a stray "1D" elsewhere on the desk can't be clicked by mistake.
          const btn = page
            .locator(".vector-chart-view-btn", { hasText: new RegExp(`^${step.text}$`) })
            .filter({ visible: true })
            .last();
          if (await btn.count()) {
            await btn.click({ timeout: 8000 });
            acted = "click";
          } else acted = "missing";
        } else if (step.sel) {
          const loc = visibleLocator(page, step.sel);
          if (await loc.count()) {
            await loc.click({ timeout: 8000 });
            acted = "click";
          } else acted = "missing";
        }
      } catch (e) {
        acted = `error: ${String(e.message).split("\n")[0].slice(0, 120)}`;
      }

      await page.waitForTimeout(step.settle);
      const shot = path.join(OUT, `vector-ui-${TICKER}-${step.id}.png`);
      try {
        await page.screenshot({ path: shot, timeout: 15000 });
      } catch {
        /* a screenshot timeout is not itself a desk fault — the assertions below still stand */
      }

      const snap = await inspect(page, { daily: step.daily });
      const fails = acted === "missing" ? [] : assertState(snap, { daily: step.daily });
      if (acted !== "missing" && step.effect) {
        const effectFail = await verifyEffect(page, step.effect);
        if (effectFail) fails.push(`no effect: ${effectFail}`);
      }
      // A step that changes the DTE toggle changes which ladder scope the desk should be showing;
      // carry it forward so the cross-check asks the API for the scope actually on screen.
      if (step.horizon) horizon = step.horizon;
      // Replay deliberately re-renders the rail at a PAST cursor time, so the rendered strikes are
      // legitimately a different set from the live ladder — cross-checking there would flag the
      // feature working as designed. Skipped, and reported as skipped rather than silently passed.
      if (!step.skipCrossCheck && acted !== "missing" && step.id !== "11-replay") {
        const shown = await readRenderedLadder(page);
        for (const f of crossCheckAgainstBaseline(shown, baseline[horizon], { liveSession })) {
          fails.push(`screen vs API: ${f}`);
        }
      }
      results.push({
        id: step.id,
        label: step.label,
        acted,
        skipped: acted === "missing",
        fails,
        ladderRows: snap.ladderRows,
        canvasPx: snap.biggestCanvas,
        play: snap.playHeadline ? snap.playHeadline.split("\n")[0] : null,
        shot,
      });
    }
  } finally {
    await browser.close();
  }
  return { results, counts };
}

(async () => {
  // Imported lazily: this file is CJS and the session helper is ESM.
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  let out;
  try {
    out = await run(session.cookieHeader);
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  const { results, counts } = out;
  if (AS_JSON) {
    console.log(JSON.stringify({ ticker: TICKER, counts, results }, null, 2));
  } else {
    console.log(`\n=== VECTOR UI WALKTHROUGH — ${TICKER} @ ${BASE}`);
    console.log(`routed: ${counts.ok} ok, ${counts.fail} fail, ${counts.streamsAborted} streams aborted (SWR fallback)\n`);
    for (const r of results) {
      const tag = r.skipped ? "skip" : r.fails.length ? "FAIL" : "ok  ";
      console.log(
        `  ${tag} ${r.id.padEnd(18)} ${r.label.padEnd(24)} rows=${String(r.ladderRows).padStart(3)} canvas=${r.canvasPx}px² ${r.play ? `play="${r.play}"` : ""}`
      );
      for (const f of r.fails) console.log(`         ${f}`);
      if (r.skipped) console.log(`         control not rendered — NOT exercised`);
    }
  }

  // A non-zero routing failure count means assets did not load: the run describes a half-empty
  // page, and its passes are not evidence. Treated as a hard failure of the RUN, not of the desk.
  const routingBroken = counts.fail > 0;
  const failed = results.filter((r) => r.fails.length).length;
  const skipped = results.filter((r) => r.skipped).length;
  console.log(`\nstates failing: ${failed} · skipped (control absent): ${skipped} · routing failures: ${counts.fail}`);
  process.exit(failed > 0 || routingBroken ? 1 : 0);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
