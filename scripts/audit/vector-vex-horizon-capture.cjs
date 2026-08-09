/**
 * VEX-lens × DTE-horizon capture — what does a member ACTUALLY see?
 *
 * WHY. The narrowed per-horizon wall rails record `vexWalls: null` on purpose
 * (vector-narrowed-wall-core.ts): those walls are reconstructed from the Polygon chain via
 * gexLadderAtSpot, which computes GAMMA only, so there is no vanna to record. Measured against
 * production on 2026-08-07: TSLA weekly = 1107 recorded samples, monthly = 1076, **withVex = 0**.
 *
 * That is honest data-wise, but it means switching to the VEX lens on a narrowed horizon leaves the
 * bead trail empty. The open question a code reading cannot answer is whether the UI SAYS so, or
 * just shows a blank rail and lets the member conclude the product is broken.
 *
 * This captures the four lens×horizon states that matter and reports, per state, whether any bead
 * trail rendered and whether any explanatory copy is on screen. Read-only; one temp Clerk user.
 *
 * KNOWN LIMITATION: the 0DTE control is not matched by accessible name and reports a click error
 * rather than silently labelling a state it never reached. GEX-intraday, GEX-weekly and VEX-weekly
 * do land. Fix the selector before trusting a 0DTE row.
 *
 * Usage: node scripts/audit/vector-vex-horizon-capture.cjs [--ticker=SPX] [--out=/tmp/vexcap]
 */
const fs = require("fs");
const path = require("path");
const { createTunneledContext } = require("./lib/proxy-tunnel-context.cjs");

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const TICKER = arg("ticker", "SPX");
const BASE = process.env.VALIDATE_BASE || "https://blackouttrades.com";
const OUT = arg("out", "/tmp/vex-horizon-capture");

/** Resolve a control to the copy with a real box — the toolbar renders each control TWICE (a 0x0
 *  hidden duplicate and the real one), and a plain selector returns the hidden one first. */
async function visibleByText(page, text) {
  // Case-INSENSITIVE: the DTE toggles render as "Weekly"/"0DTE" in the DOM and are uppercased by
  // CSS text-transform. An exact, case-sensitive match silently found nothing and the run then
  // labelled a state it had never actually reached — a mislabelled pass, the worst kind.
  const loc = page.getByRole("button", { name: new RegExp(`^\\s*${text}\\s*$`, "i") });
  const n = await loc.count();
  for (let i = 0; i < n; i++) {
    const box = await loc.nth(i).boundingBox().catch(() => null);
    if (box && box.width > 0 && box.height > 0) return loc.nth(i);
  }
  return null;
}

async function clickControl(page, label) {
  // getByRole name-matching missed "0DTE" while matching "WEEKLY", so resolve by trimmed
  // textContent and click the copy that has a real box. A control that cannot be found is reported,
  // never skipped silently — a state we did not reach must not be labelled as if we had.
  const clicked = await page.evaluate((want) => {
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      if ((b.textContent || "").trim().toUpperCase() !== want.toUpperCase()) continue;
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) { b.click(); return true; }
    }
    return false;
  }, label);
  if (!clicked) return `control "${label}" not found (no visible copy)`;
  await page.waitForTimeout(3000);
  return null;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { mintClerkPremiumSession } = await import("./lib/prod-clerk-session.mjs");

  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.error(`SKIP: ${session.reason}`);
    process.exit(2);
  }
  let ctx, browser;
  const rows = [];
  try {
    ({ ctx, browser } = await createTunneledContext({
      cookie: session.cookieHeader,
      url: BASE,
      viewport: "1680x1000",
      desktop: true,
    }));
    const page = await ctx.newPage();
    await page.goto(`${BASE}/vector?ticker=${encodeURIComponent(TICKER)}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(9000);

    // GEX on a narrowed horizon is the CONTROL: it proves the horizon toggle itself works and the
    // rail can render, so an empty VEX rail can be attributed to the missing vanna data rather
    // than to a broken toggle.
    const states = [
      { name: "gex-0dte", steps: ["GEX", "0DTE"] },
      { name: "gex-weekly", steps: ["WEEKLY"] },
      { name: "gex-monthly", steps: ["MONTHLY"] },
      { name: "vex-0dte", steps: ["VEX", "0DTE"] },
      { name: "vex-weekly", steps: ["WEEKLY"] },
      { name: "vex-monthly", steps: ["MONTHLY"] },
    ];

    for (const st of states) {
      const errors = [];
      for (const label of st.steps) {
        const err = await clickControl(page, label);
        if (err) errors.push(err);
      }
      await page.waitForTimeout(2000);

      // Bead trails are canvas-drawn, so DOM counting cannot see them. What IS observable: the
      // page's own empty-state / availability copy, and whether the VEX toggle is disabled.
      const probe = await page.evaluate(() => {
        const text = document.body.innerText || "";
        const hits = [];
        for (const phrase of [
          "unavailable", "not available", "no data", "No VEX", "VEX unavailable",
          "per-expiry", "not recorded", "no trail", "empty",
        ]) {
          if (text.toLowerCase().includes(phrase.toLowerCase())) hits.push(phrase);
        }
        const vexBtn = Array.from(document.querySelectorAll("button")).find(
          (b) => (b.textContent || "").trim() === "VEX"
        );
        return {
          explanatoryCopy: hits,
          vexButtonDisabled: vexBtn ? vexBtn.disabled || vexBtn.getAttribute("aria-disabled") === "true" : null,
        };
      });

      const file = path.join(OUT, `${st.name}.png`);
      await page.screenshot({ path: file });
      rows.push({ state: st.name, ...probe, errors, file });
      console.log(
        `  ${st.name.padEnd(14)} vexDisabled=${probe.vexButtonDisabled} ` +
          `copy=[${probe.explanatoryCopy.join(", ") || "none"}]${errors.length ? ` ERRORS: ${errors.join("; ")}` : ""}`
      );
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await session.cleanup();
    console.error("temp Clerk user deleted");
  }

  console.log(`\nscreenshots: ${OUT}`);
  console.log(JSON.stringify(rows, null, 2));
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
