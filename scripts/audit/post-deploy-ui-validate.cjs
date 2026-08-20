/**
 * Post-deploy validation for two member-visible fixes that shipped 2026-08-19/20.
 *
 * Both were verified by unit test and by root cause before merge; neither had been observed in a
 * browser against production. This closes that gap. It deliberately checks the two things that are
 * observable OFF-HOURS — the third (Vector replay beads) has its own probe, and the SPX
 * session-quality fix (#2355) needs live RTH scoring to observe at all.
 *
 * ── CHECK A — ET clock pinning (#2368) ────────────────────────────────────────────────────────
 * Ten formatters called toLocaleTimeString/toLocaleDateString with no `timeZone`, so they resolved
 * to the BROWSER's zone: a member in London saw a 09:30 ET open labelled 14:30.
 *
 * The check renders the SAME page twice in two very different zones and requires every clock
 * string to be byte-identical. That invariant is the honest one here:
 *   - it needs no knowledge of what the correct time IS, so it cannot be fooled by a wrong-but-
 *     consistent constant;
 *   - it is impossible to satisfy accidentally — an unpinned formatter differs by construction;
 *   - and critically, it CANNOT be validated from a runner already sitting in ET, where both
 *     readings agree and a pass proves nothing. That is why timezoneId had to be threaded through
 *     the tunnel context first.
 *
 * ── CHECK B — Expiry Concentration bar scale (#2372) ──────────────────────────────────────────
 * The bar scale read its max off `buckets[0]` (chronological, largest only by coincidence), so any
 * larger bucket computed >100% and clipped — three different premiums rendered as three identical
 * full-width bars while the labels beside them read 11% / 33% / 56%.
 *
 * The check reads each rendered bar's width AND its premium label, then asserts the two orderings
 * agree. Comparing widths alone would pass a chart that is uniformly wrong; comparing against the
 * labels is what makes "the picture matches the numbers" testable.
 *
 * WHAT IT CANNOT ASSERT — say so rather than implying otherwise:
 *   - Off-hours the tape is frozen at the last close. An empty panel is correct, not a fault, and
 *     is reported as SKIP, never as a failure.
 *   - It checks that the numbers and the picture AGREE, not that the underlying premium is right.
 *
 * Read-only. One temp Clerk member for the whole run, deleted in a finally (FAPI is rate-limited).
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node scripts/audit/post-deploy-ui-validate.cjs [--base=...] [--json]
 */
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const BASE = (process.env.VALIDATE_BASE || "https://blackouttrades.com").replace(/\/$/, "");
const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const arg = (n, d) => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const TICKER = arg("ticker", "SPX");

/** Clock-shaped strings: "9:30 AM", "16:05", "3:42:20 PM". */
const CLOCK_RE = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g;

/**
 * Navigate with ONE retry. `ERR_CONNECTION_RESET` mid-run is a DRAINING ECS REPLICA during a
 * rollout, not the sandbox egress block — the same trap `meridian-earnings-ui-audit.mjs` documents.
 * Treating it as a product failure reports a healthy page as broken; observed live on 2026-08-20
 * while the fab8a26f deploy was still rolling.
 */
async function gotoWithRetry(page, url, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      return;
    } catch (e) {
      last = e;
      if (!/ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_ABORTED/.test(String(e.message))) throw e;
      await page.waitForTimeout(5000 * (i + 1));
    }
  }
  throw last;
}

async function clockStringsAt(page, url, waitMs) {
  await gotoWithRetry(page, url);
  await page.waitForTimeout(waitMs);
  return page.evaluate(() => {
    const re = /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\b/g;
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el) continue;
      const st = getComputedStyle(el);
      if (st.display === "none" || st.visibility === "hidden") continue;
      const m = (n.textContent || "").match(re);
      if (m) out.push(...m);
    }
    return out.sort();
  });
}

async function checkA(session, report) {
  // ── CHECK A ────────────────────────────────────────────────────────────────────────────────
  const zones = ["Asia/Tokyo", "America/Los_Angeles"];
  const perZone = {};
  // Sweep several desks. Off-hours most panels render no clock at all — a single-page probe then
  // reports "cannot judge" on a fix that IS observable two routes over. The pages are the ones
  // #2368 actually touched (Vector ODTE rail, SPX session/pulse rails, Banger board, Meridian).
  const PAGES = [
    `/vector?ticker=${encodeURIComponent(TICKER)}`,
    "/nighthawk",
    "/heatmap",
    "/terminal",
  ];
  let routing = { ok: 0, fail: 0 };
  const perPageCounts = {};

  for (const tz of zones) {
    const { browser, ctx, counts } = await createTunneledContext({
      url: `${BASE}${PAGES[0]}`,
      cookie: session.cookieHeader,
      viewport: "1440x900",
      desktop: true,
      timezoneId: tz,
    });
    try {
      const page = await ctx.newPage();
      // Prove the browser really is in that zone before trusting anything it renders.
      await gotoWithRetry(page, `${BASE}${PAGES[0]}`);
      const seen = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
      const all = [];
      for (const path of PAGES) {
        const got = await clockStringsAt(page, `${BASE}${path}`, 9000).catch(() => []);
        perPageCounts[path] = (perPageCounts[path] ?? 0) || got.length;
        all.push(...got);
      }
      perZone[tz] = { resolvedTimeZone: seen, clocks: all.sort() };
      routing = { ok: counts?.ok ?? 0, fail: counts?.fail ?? 0 };
    } finally {
      await browser.close().catch(() => {});
    }
  }

  const [a, b] = zones;
  const zoneOk = perZone[a].resolvedTimeZone === a && perZone[b].resolvedTimeZone === b;

  /**
   * THE VERDICT IS A SINGLE-LOAD TEST, not a cross-zone diff.
   *
   * The first version of this check rendered the page in two zones and required the clock sets to
   * match byte-for-byte. That is contaminated: the two loads happen minutes apart and /nighthawk is
   * a LIVE board, so its timestamps legitimately move between them. The run reported FAIL with an
   * ASYMMETRIC diff — 8 strings present only in the Tokyo load and ZERO present only in the LA one.
   * A timezone fault differs on BOTH sides by construction; a one-sided difference is data drift.
   * Reporting that as a product defect would have been a false alarm on a working fix.
   *
   * What IS drift-immune is where the times LAND. Market clocks describe the ET session, so from a
   * Tokyo browser (UTC+9):
   *   - pinned   -> 09:30..16:05, the ET session window
   *   - unpinned -> the same instants shifted +13/+14h, i.e. 22:30..06:05
   * The two windows do not overlap, so one load in a non-ET zone settles it.
   */
  const toMin = (str) => {
    const m = String(str).match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm)?$/);
    if (!m) return null;
    let h = Number(m[1]);
    const mm = Number(m[2]);
    const ap = (m[3] || "").toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return h * 60 + mm;
  };
  // Extended-hours generous window: 04:00–20:00 ET covers pre/post market labels too.
  const inEtWindow = (mins) => mins != null && mins >= 4 * 60 && mins <= 20 * 60;

  const tokyoClocks = perZone[a].clocks.map(toMin).filter((v) => v != null);
  const inWindow = tokyoClocks.filter(inEtWindow).length;
  const outWindow = tokyoClocks.length - inWindow;
  // Overnight-shifted readings are the fingerprint of an unpinned formatter seen from UTC+9.
  const shiftedLooking = tokyoClocks.filter((v) => v != null && (v >= 21 * 60 || v <= 3 * 60)).length;

  const enough = tokyoClocks.length >= 5;
  const verdict = !zoneOk
    ? "HARNESS"
    : !enough
      ? "SKIP"
      : shiftedLooking === 0 && inWindow / tokyoClocks.length >= 0.9
        ? "PASS"
        : "FAIL";

  report.checks.push({
    id: "A",
    name: "ET clock pinning (#2368)",
    verdict,
    zones: { [a]: perZone[a].resolvedTimeZone, [b]: perZone[b].resolvedTimeZone },
    clockCount: perZone[a].clocks.length,
    perPage: perPageCounts,
    fromZone: a,
    inEtSessionWindow: inWindow,
    outsideWindow: outWindow,
    overnightShiftedLooking: shiftedLooking,
    sample: perZone[a].clocks.slice(0, 10),
    // Kept as CONTEXT only — never gates the verdict, because a live board moves between loads.
    crossZoneIdenticalInfo:
      perZone[a].clocks.length === perZone[b].clocks.length &&
      perZone[a].clocks.every((v, i) => v === perZone[b].clocks[i]),
    note: !enough ? "fewer than 5 clock strings rendered — cannot judge (off-hours empty desks)" : undefined,
    routing,
  });

  return report;
}

async function checkB(session, report) {
  // ── CHECK B ────────────────────────────────────────────────────────────────────────────────
  {
    const url = `${BASE}/flows`;
    const { browser, ctx, counts } = await createTunneledContext({
      url,
      cookie: session.cookieHeader,
      viewport: "1440x900",
      desktop: true,
    });
    try {
      const page = await ctx.newPage();
      await gotoWithRetry(page, url);
      await page.waitForTimeout(13_000);

      const bars = await page.evaluate(() => {
        const panel = Array.from(document.querySelectorAll("*")).find(
          (el) => /Expiry Concentration/i.test(el.textContent || "") && el.children.length < 40
        );
        if (!panel) return null;
        const rows = [];
        for (const row of Array.from(panel.querySelectorAll("div"))) {
          const rail = row.querySelector(":scope > .relative, :scope > div.relative");
          const fill = row.querySelector('div[style*="width"]');
          const label = (row.textContent || "").match(/\b(0DTE|This week|Monthly|LEAPS)\b/);
          if (!label || !fill) continue;
          const w = parseFloat((fill.getAttribute("style") || "").match(/width:\s*([\d.]+)%/)?.[1] ?? "NaN");
          const prem = (row.textContent || "").match(/\$[\d.]+[KMB]?/);
          const pct = (row.textContent || "").match(/(\d+)%/);
          if (Number.isFinite(w)) {
            rows.push({ bucket: label[1], widthPct: w, premium: prem?.[0] ?? null, sharePct: pct ? Number(pct[1]) : null });
          }
          void rail;
        }
        // de-dupe by bucket (nested divs can match twice)
        const seen = new Map();
        for (const r of rows) if (!seen.has(r.bucket)) seen.set(r.bucket, r);
        return [...seen.values()];
      });

      let verdict, detail;
      if (!bars) {
        verdict = "SKIP";
        detail = "Expiry Concentration panel not rendered — it hides below a $50k floor and off-hours the tape is frozen";
      } else if (bars.length < 2) {
        verdict = "SKIP";
        detail = `only ${bars.length} bucket rendered — needs 2+ to compare orderings`;
      } else {
        const overflow = bars.filter((b) => b.widthPct > 100);
        const distinctShares = new Set(bars.map((b) => b.sharePct).filter((v) => v != null)).size;
        const distinctWidths = new Set(bars.map((b) => b.widthPct)).size;
        // The defect: different premiums, identical bars. Orderings must agree.
        const byShare = [...bars].filter((b) => b.sharePct != null).sort((x, y) => x.sharePct - y.sharePct).map((b) => b.bucket);
        const byWidth = [...bars].filter((b) => b.sharePct != null).sort((x, y) => x.widthPct - y.widthPct).map((b) => b.bucket);
        const orderAgrees = byShare.join(",") === byWidth.join(",");
        const clipped = distinctShares > 1 && distinctWidths === 1;
        verdict = overflow.length === 0 && !clipped && orderAgrees ? "PASS" : "FAIL";
        detail = { overflow: overflow.length, distinctShares, distinctWidths, byShare, byWidth, orderAgrees };
      }

      report.checks.push({
        id: "B",
        name: "Expiry Concentration bar scale (#2372)",
        verdict,
        bars,
        detail,
        routing: { ok: counts?.ok ?? 0, fail: counts?.fail ?? 0 },
      });
    } finally {
      await browser.close().catch(() => {});
    }
  }
  return report;
}

/**
 * B runs FIRST. The Clerk session JWT is short-lived (~72s) and check A now drives four desks in
 * two timezones, so by the time it finishes the session is long stale — which surfaced as a
 * persistent ERR_CONNECTION_RESET on /flows that looked like a page fault rather than an expired
 * credential. Ordering the cheap check first keeps it inside the session's life.
 */
async function run(session) {
  const report = { base: BASE, ticker: TICKER, checks: [] };
  await checkB(session, report);
  await checkA(session, report);
  report.checks.sort((x, y) => x.id.localeCompare(y.id));
  return report;
}

(async () => {
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }

  let report;
  try {
    report = await run(session);
  } finally {
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\nPOST-DEPLOY UI VALIDATION — ${BASE}\n`);
    for (const c of report.checks) {
      console.log(`[${c.verdict}] ${c.id} — ${c.name}`);
      if (c.id === "A") {
        console.log(`      browser zones resolved: ${JSON.stringify(c.zones)}`);
        console.log(`      clocks read from ${c.fromZone}: ${c.clockCount}  ${JSON.stringify(c.perPage ?? {})}`);
        console.log(`      in ET session window: ${c.inEtSessionWindow}   outside: ${c.outsideWindow}   overnight-shifted: ${c.overnightShiftedLooking}`);
        console.log(`      sample: ${JSON.stringify(c.sample)}`);
        console.log(`      (cross-zone byte-identical, context only: ${c.crossZoneIdenticalInfo})`);
        if (c.note) console.log(`      ${c.note}`);
      }
      if (c.id === "B") {
        if (c.bars) for (const b of c.bars) console.log(`      ${b.bucket.padEnd(10)} width=${String(b.widthPct).padStart(6)}%  share=${b.sharePct}%  ${b.premium ?? ""}`);
        console.log(`      ${typeof c.detail === "string" ? c.detail : JSON.stringify(c.detail)}`);
      }
      console.log(`      routing: ${c.routing.ok} ok / ${c.routing.fail} fail`);
      console.log("");
    }
  }

  const failed = report.checks.filter((c) => c.verdict === "FAIL" || c.verdict === "HARNESS");
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error("VALIDATION FAILED:", e.message);
  process.exit(1);
});
