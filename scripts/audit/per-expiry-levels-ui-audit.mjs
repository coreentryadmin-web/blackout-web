/**
 * PER-EXPIRY KEY LEVELS — live UI audit.
 *
 * The data validator (`per-expiry-levels-validate.mjs`) proves the SERVER's per-expiry numbers are
 * right. This proves the member actually SEES them: it drives the real expiry chips on prod
 * `/heatmap`, reads the Key Levels tiles after each click, and checks them against the payload THE
 * PAGE ITSELF received.
 *
 * WHY THE PAGE'S OWN PAYLOAD, not a fresh fetch. Spot moves. A second fetch a few seconds later is
 * a different book, so every disagreement would be ambiguous — a real scoping bug and ordinary
 * intraday drift would look identical. Capturing the response the client rendered from removes the
 * timing variable entirely, which is the only way this check can produce a verdict worth acting on
 * during RTH.
 *
 * What it can catch that a screenshot cannot:
 *   - a chip that changes the profile but leaves the tiles on the old aggregate (the exact bug the
 *     feature was built to fix, and the one a render test passes straight through);
 *   - tiles that move but to the WRONG expiry's numbers (off-by-one in the scope map);
 *   - the kicker/footnote claiming a scope the tiles did not take.
 *
 * WHY THE TUNNEL. Chromium in this sandbox has no network: direct, `proxy:{server}` and
 * `--proxy-server` all fail with ERR_CONNECTION_RESET while curl through the same proxy returns
 * 200. A plain-Playwright failure here proves nothing but the egress block — see
 * docs/audit/LIVE-UI-CONNECTION.md.
 *
 * Read-only. One temp Clerk user, always deleted in a finally.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/per-expiry-levels-ui-audit.mjs \
 *     [--tickers=SPY,NVDA] [--expiries=3] [--json]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import {
  gexWallsFromStrikeTotals,
  cumulativeGammaFlip,
} from "../../src/lib/providers/gex-cross-validation-core.ts";

const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const BASE = flag("base", "https://blackouttrades.com");
const TICKERS = flag("tickers", "SPY,NVDA").split(",").map((t) => t.trim()).filter(Boolean);
const MAX_EXPIRIES = Number(flag("expiries", "3")) || 3;
const OUT = flag("out", "/tmp/per-expiry-levels-ui");

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

/** "6,432.50" / "$1.2B" / "—" -> number | null. Tiles are formatted for humans, not parsers. */
function parseTile(text) {
  if (text == null) return null;
  const t = String(text).trim();
  if (!t || t === "—") return null;
  const m = t.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  if (!Number.isFinite(n)) return null;
  const mult = /B/i.test(t) ? 1e9 : /M/i.test(t) ? 1e6 : /K/i.test(t) ? 1e3 : 1;
  return (/^-|\(/.test(t) ? -Math.abs(n) : n) * mult;
}

/**
 * The chip label, derived exactly the way the component's own `fmtExpiry` does. Deriving it via
 * `toLocaleString` instead would make the mapping depend on the harness's ICU locale, so a chip
 * would silently stop matching on a machine with a different one and the run would report "does
 * not map to any served expiry" for a page that is fine.
 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtExpiry(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) return String(ymd);
  return `${MONTHS[m - 1]} ${d}`;
}

/** Per-expiry strike totals from the served cells — the same collapse the client does. */
function totalsForExpiry(cells, expiry) {
  const out = {};
  for (const [strike, byExp] of Object.entries(cells ?? {})) {
    const g = byExp?.[expiry];
    if (typeof g === "number" && Number.isFinite(g) && g !== 0) out[strike] = g;
  }
  return out;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP — ${session.reason}`);
    process.exit(0);
  }

  try {
    for (const ticker of TICKERS) {
      if (!asJson) console.log(`\n═══ ${ticker}`);
      const TARGET = `${BASE}/heatmap?ticker=${ticker}`;
      const { browser, ctx, counts } = await createTunneledContext({
        url: TARGET,
        viewport: "1600x1200",
        desktop: true,
        cookie: session.cookieHeader,
      });
      try {
        const page = await ctx.newPage();

        // Capture the matrix payload the PAGE received. Keeping only the latest means a mid-run
        // 20s poll refresh is reflected rather than compared against a stale capture.
        let payload = null;
        page.on("response", async (r) => {
          if (!/\/api\/market\/gex-heatmap/.test(r.url()) || r.status() !== 200) return;
          try {
            const j = await r.json();
            payload = j?.heatmap ?? j;
          } catch {
            /* a body we cannot parse is not evidence either way */
          }
        });

        try {
          await page.goto(TARGET, { waitUntil: "domcontentloaded", timeout: 90_000 });
        } catch (e) {
          note("WARN", `${ticker}: navigation failed — ${String(e).slice(0, 120)}`);
          continue;
        }

        // Prove the DESK loaded before judging the FEATURE. Without this, a 404 / auth bounce /
        // cold cache all report "no expiry chips", which reads as a product defect when it is a
        // harness failure. Polled, not sampled: the matrix arrives on the client's own fetch.
        const matrixTab = page.locator('[role="tab"]', { hasText: /^Matrix$/i }).first();
        try {
          await matrixTab.waitFor({ state: "attached", timeout: 75_000 });
        } catch {
          const shell = await page.getByText(/No options chain/i).count();
          note(
            "WARN",
            shell > 0
              ? `${ticker}: desk rendered but the matrix stayed empty — a DATA state; nothing below is evidence`
              : `${ticker}: HARNESS — no desk after 75s; nothing below is evidence`,
            { routed: `${counts.ok} ok / ${counts.fail} fail` }
          );
          continue;
        }

        // The expiry chips live above the profile trio, so switch to that view first. The Key
        // Levels row renders above both views and stays put, which is what makes this comparable.
        const profileTab = page
          .locator('[role="tab"]', { hasText: /Profile|Curve/i })
          .first();
        if ((await profileTab.count()) > 0) await profileTab.click().catch(() => {});
        await page.waitForTimeout(3_000);

        const chips = page.locator('button[aria-pressed]', { hasText: /^[A-Z][a-z]{2} \d+$/ });
        const chipCount = await chips.count();
        if (chipCount === 0) {
          const all = await page.locator("button[aria-pressed]").allInnerTexts();
          note("WARN", `${ticker}: no per-expiry chips found`, {
            controlsPresent: all.map((t) => t.trim()).slice(0, 12),
          });
          continue;
        }
        note("INFO", `${ticker}: ${chipCount} expiry chips present`);

        for (let i = 0; i < Math.min(chipCount, MAX_EXPIRIES); i += 1) {
          const chip = chips.nth(i);
          const label = (await chip.innerText()).trim();
          await chip.click();
          // Let React commit and the tiles repaint before reading them.
          await page.waitForTimeout(1_200);

          const read = async (key) => {
            const el = page.locator(`[data-level-value="${key}"]`).first();
            return (await el.count()) > 0 ? (await el.innerText()).trim() : null;
          };
          const rendered = {
            flip: await read("flip"),
            callWall: await read("callWall"),
            putWall: await read("putWall"),
            maxPain: await read("maxPain"),
            netGex: await read("netGex"),
          };
          const kicker = await page
            .locator(".gex-key-levels")
            .first()
            .innerText()
            .catch(() => "");

          if (!payload?.gex?.cells) {
            note("WARN", `${ticker} ${label}: no captured payload — cannot check the tiles`);
            continue;
          }

          // Resolve the chip label back to the ISO expiry it selected, via the payload's own axis.
          // Matching on the RENDERED label rather than assuming chip order is what keeps this
          // honest if the bar ever reorders.
          const expiry = (payload.expiries ?? []).find((e) => fmtExpiry(e) === label);
          if (!expiry) {
            note("WARN", `${ticker} ${label}: chip label does not map to any served expiry — skipped`);
            continue;
          }

          const totals = totalsForExpiry(payload.gex.cells, expiry);
          if (Object.keys(totals).length === 0) {
            note("INFO", `${ticker} ${expiry}: empty expiry column — skipped`);
            continue;
          }
          const spot = Number(payload.spot);
          const { callWall, putWall } = gexWallsFromStrikeTotals(totals);
          const flip = spot > 0 ? cumulativeGammaFlip(totals, spot) : null;
          const netGex = Object.values(totals).reduce((a, b) => a + b, 0);
          const servedMaxPain = payload.max_pain_by_expiry?.[expiry] ?? null;

          // Strike tiles must be EXACT: both sides read the same cells, so any gap is a scoping
          // bug, not drift. Net GEX is formatted to 2 significant-ish digits ("$1.2B"), so it is
          // compared with a tolerance that reflects the rounding, not the value.
          const cmpStrike = (name, want, got) => {
            const g = parseTile(got);
            if (want == null && g == null) return true;
            if (want == null || g == null) return false;
            return Math.abs(want - g) <= Math.max(0.51, Math.abs(want) * 0.0005);
          };
          const checks = [
            ["Gamma Flip", flip, rendered.flip],
            ["Call Wall", callWall, rendered.callWall],
            ["Put Wall", putWall, rendered.putWall],
            ["Max Pain", servedMaxPain, rendered.maxPain],
          ];
          const bad = checks.filter(([n, w, g]) => !cmpStrike(n, w, g));
          const gotNet = parseTile(rendered.netGex);
          const netOk =
            gotNet != null && Math.abs(gotNet - netGex) <= Math.max(1e8, Math.abs(netGex) * 0.06);

          note(
            bad.length === 0 && netOk ? "PASS" : "FAIL",
            `${ticker} ${label} (${expiry}): tiles ${bad.length === 0 && netOk ? "match" : "DISAGREE with"} the expiry's own cells`,
            {
              expected: {
                flip: flip == null ? null : Number(flip.toFixed(2)),
                callWall,
                putWall,
                maxPain: servedMaxPain,
                netGex: Number((netGex / 1e9).toFixed(2)) + "B",
              },
              rendered,
              ...(bad.length ? { mismatched: bad.map(([n]) => n) } : {}),
              ...(netOk ? {} : { netGexMismatch: true }),
            }
          );

          // The copy has to name the scope the tiles took. A row showing one expiry's numbers
          // under a "near-term" kicker is the same defect as wrong numbers — the member cannot
          // tell which book they are reading.
          note(
            new RegExp(label.replace(/\s+/g, "\\s+"), "i").test(kicker) ? "PASS" : "FAIL",
            `${ticker} ${label}: key-levels copy ${/near-term \(/.test(kicker) ? "still claims a near-term blend" : "names the scoped expiry"}`,
            { kickerHead: kicker.split("\n").slice(0, 2).join(" | ").slice(0, 120) }
          );

          const shot = join(OUT, `${ticker}-${expiry}.png`);
          await page.screenshot({ path: shot, fullPage: false });
        }
      } finally {
        await browser.close().catch(() => {});
      }
    }
  } finally {
    await session.cleanup?.();
  }

  const fails = findings.filter((f) => f.level === "FAIL");
  // NO EVIDENCE GATHERED: a run where no chip was ever compared must not print a pass. An audit
  // that "passes" against nothing is worse than one that fails — it trains its reader to skip the
  // result.
  const checked = findings.some((f) => /tiles (match|DISAGREE)/.test(f.msg));
  const verdict =
    fails.length > 0
      ? `${fails.length} FAILURES`
      : checked
        ? "ALL CHECKS PASSED"
        : "NO EVIDENCE GATHERED — no expiry chip was ever compared; this run proves nothing";
  if (asJson) console.log(JSON.stringify({ verdict, fails: fails.length, findings }, null, 2));
  else console.log(`\n${"═".repeat(70)}\n${verdict}\nScreenshots: ${OUT}`);
  process.exit(fails.length > 0 || !checked ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL ${String(e)}`);
  process.exit(2);
});
