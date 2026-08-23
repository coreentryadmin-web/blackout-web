/**
 * LIVE-UI INTERACTION AUDIT — click the product like a member does, and check what happened.
 *
 * The other two harnesses check progressively deeper but both stop short of USE:
 *   site-sweep.mjs          the SERVER returns a page
 *   live-ui-deep-audit.mjs  the BROWSER renders that page
 *   this                    the page's CONTROLS actually do something, and the layout survives it
 *
 * That last gap is where most of what a member would call "broken" lives. A tab that swaps nothing,
 * a filter that never reaches the network, a drawer that opens over clipped text, a modal that will
 * not close — every one of those renders a perfect first paint and passes every check above.
 *
 * WHAT IT ASSERTS, per control:
 *   - clicking it CHANGES something: DOM text, its own ARIA/class state, the URL, or the network.
 *     A control that moves none of those four is dead, and "dead" is the single most common
 *     complaint about a shipped UI.
 *   - the resulting state has no clipped text and nothing printing over a control (see
 *     lib/ui-geometry-probe.mjs). Post-interaction is where layout actually breaks — a drawer over
 *     a page, a modal pushing content, a tab swapping a panel — and it is invisible to any check
 *     that only looks at a freshly loaded page.
 *   - it raises no first-party console error and no failed first-party request.
 *   - anything that opened can be closed again with Escape (a trap is worse than a no-op).
 *
 * ═══ SAFETY: THIS DRIVES PRODUCTION AS AN ADMIN ═══
 * The audit session is admin+premium, so a naive "click everything" would delete real records,
 * change real settings, and send real mail. Clicking is therefore GATED, not filtered afterwards:
 *   - DESTRUCTIVE_TEXT below blocks anything whose label suggests a write, a purchase, a
 *     destructive action, or a session change, matched on the label AND the aria-label AND the
 *     enclosing form's action;
 *   - every `<form>` submit control is skipped outright;
 *   - `/admin*` is excluded from the sweep by default — its read-only value is low and its write
 *     surface is the highest-consequence in the app. `--include-admin` opts in for READ pages only;
 *   - links to another origin are never followed (an audit must not wander onto Clerk/Whop/Stripe);
 *   - method is `click`. Nothing types into a field except the ticker search, which is a read.
 * The gate is a denylist over labels, which cannot be exhaustive — so it is paired with the rule
 * that this harness only ever runs against surfaces whose write actions are known. When in doubt
 * the control is skipped: a missed check costs one finding, a wrong click costs real data.
 *
 * WHY THE TUNNEL. Chromium in this sandbox has no network — see docs/audit/LIVE-UI-CONNECTION.md.
 * A plain-Playwright failure here proves nothing but the egress block.
 *
 * ONE Clerk session for the whole run, released in a finally.
 *
 * Run from the REPO ROOT:
 *   NODE_USE_ENV_PROXY=1 node --import tsx scripts/audit/live-ui-interaction-audit.mjs \
 *     [--pages=/vector,/heatmap] [--max-controls=25] [--desktop-only] [--include-admin] [--json]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { mintClerkPremiumSession } from "./lib/prod-clerk-session.mjs";
import { probeGeometry } from "./lib/ui-geometry-probe.mjs";
import { shouldCheckEscape } from "./lib/dialog-escape-gate.mjs";
import { keepSessionAlive, isAuthExpiry } from "./lib/ui-session-keepalive.mjs";

const require_ = createRequire(import.meta.url);
const { createTunneledContext } = require_("./lib/proxy-tunnel-context.cjs");

const args = process.argv.slice(2);
const flag = (n, d) => {
  const hit = args.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.slice(n.length + 3) : d;
};
const asJson = args.includes("--json");
const desktopOnly = args.includes("--desktop-only");
const includeAdmin = args.includes("--include-admin");
const BASE = flag("base", "https://blackouttrades.com");
const OUT = flag("out", "/tmp/live-ui-interaction");
const MAX_CONTROLS = Number(flag("max-controls", "24"));
const PAGES = flag("pages", "/vector,/heatmap,/flows,/nighthawk,/terminal,/dashboard,/track-record,/account")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

/** How long a click may take to show its effect before "nothing happened" is the finding. */
const SETTLE_MS = 2_500;
/** How long a page may sit in a loading state before that IS the finding. */
const READY_TIMEOUT_MS = 45_000;

/**
 * Labels this harness must never click. Matched case-insensitively against the control's text, its
 * aria-label, and its enclosing form's action.
 *
 * Erring toward over-blocking is correct here and cheap: skipping a safe control loses one
 * potential finding, while clicking an unsafe one mutates production. Grouped by what the click
 * would cost.
 */
const DESTRUCTIVE_TEXT = new RegExp(
  [
    // session — would invalidate the run's own credential mid-sweep
    "sign\\s*out", "log\\s*out", "switch account", "manage account",
    // money
    "upgrade", "subscribe", "buy", "purchase", "checkout", "pay", "billing", "plan",
    "cancel subscription", "start trial", "claim",
    // destructive writes
    "delete", "remove", "revoke", "reset", "clear all", "archive", "ban", "suspend",
    "disable", "deactivate", "wipe", "purge", "drop",
    // writes / dispatch
    "save", "submit", "send", "publish", "create", "add ", "new ", "invite", "commit",
    "confirm", "apply changes", "update", "import", "export", "sync", "run ", "trigger",
    // notifications — real pushes to real members
    "notify", "subscribe to alerts", "enable notifications",
  ].join("|"),
  "i"
);

const findings = [];
const note = (level, msg, extra) => {
  findings.push({ level, msg, ...(extra ?? {}) });
  if (!asJson) console.log(`  [${level}] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ""}`);
};

/** Third-party noise the tunnel cannot faithfully replay. Collected, never scored. */
const THIRD_PARTY =
  /google-analytics|googletagmanager|doubleclick|clarity\.ms|cdn-cgi\/rum|facebook|hotjar|segment\.(io|com)|sentry|posthog|intercom|stripe|clerk/i;
/**
 * The URL-less resource error. It cannot be attributed, and the same failure is already measured
 * WITH its url by the response handler — scoring the duplicate only ever produced a FAIL on pages
 * that open a stream, which is a harness artifact wearing a bug's clothes.
 */
const URL_LESS_RESOURCE_ERROR = /^Failed to load resource/;

const LOADING = /Loading|Fetching|Please wait|Connecting|Warming/i;
const BROKEN = /Application error|client-side exception|Something went wrong|Failed to load|Unable to load/i;

/** A page's observable state, for "did anything change?". */
async function fingerprint(page) {
  return page
    .evaluate(() => ({
      url: location.pathname + location.search,
      text: (document.body?.innerText ?? "").replace(/\s+/g, " ").slice(0, 6000),
      controls: document.querySelectorAll("button, a, input, select, [role=button]").length,
      dialogs: document.querySelectorAll("[role=dialog], [aria-modal=true]").length,
    }))
    .catch(() => null);
}

/**
 * Wait for real content, by POLLING. Sampling at a fixed time measures the clock, not the page.
 *
 * READY means the page has substantial content — NOT that the word "Loading" is absent anywhere in
 * it. A desk renders twenty panels and there is almost always one lazily filling in; requiring the
 * whole body to be free of loading copy made a perfectly usable page read as "never left a loading
 * state" for its full 45s timeout. That produced the false "BACK left the page unusable" findings
 * on /heatmap and /nighthawk: Back worked fine, one panel was simply still fetching.
 *
 * A panel that never finishes is still worth reporting — but as its own finding, naming the panel,
 * which is actionable in a way that "the page is loading" is not. See stuckPanels().
 */
async function waitReady(page) {
  const t0 = Date.now();
  let text = "";
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    text = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    if (BROKEN.test(text)) return { state: "broken", text };
    if (text.length > 400) return { state: "ready", text };
    await page.waitForTimeout(1_200);
  }
  return { state: "loading", text };
}

/**
 * Panels still showing loading copy once the page itself is usable.
 *
 * Scans ELEMENTS, and skips `script`/`style`/`template`: Next.js streams its RSC payload inside
 * `<script>` tags, and that payload contains the word "Loading" as ordinary data. `innerText`
 * excludes script content but `textContent` on a per-element walk does not — so a naive scan
 * reports four permanently "stuck panels" on every Next.js page, none of which a member can see.
 */
async function stuckPanels(page) {
  return page
    .evaluate((src) => {
      const re = new RegExp(src, "i");
      const out = [];
      for (const el of document.querySelectorAll("body *")) {
        if (/^(script|style|template|noscript)$/i.test(el.tagName)) continue;
        if (el.children.length || !re.test(el.textContent || "")) continue;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none") continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        out.push(el.textContent.trim().slice(0, 44));
      }
      return [...new Set(out)];
    }, LOADING.source)
    .catch(() => []);
}

/**
 * The clickable controls on the page, already filtered by the safety gate.
 *
 * Returns plain data (not handles) with a stable index, because clicking mutates the DOM and a
 * handle collected before the click is frequently detached by the time the next one is used.
 */
async function safeControls(page, destructiveSource) {
  return page
    .evaluate((reSrc) => {
      const destructive = new RegExp(reSrc, "i");
      const out = [];
      const els = document.querySelectorAll("button, [role=button], [role=tab], select, a");
      for (const el of els) {
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none" || s.pointerEvents === "none") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") continue;

        const label = (el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
        const formAction = el.closest("form")?.getAttribute("action") ?? "";
        if (destructive.test(`${label} ${el.getAttribute("aria-label") ?? ""} ${formAction}`)) continue;
        // Every form submit, regardless of label — the label is the least reliable signal about
        // whether something writes.
        if (el.closest("form") && (el.type === "submit" || el.tagName === "BUTTON")) continue;

        if (el.tagName === "A") {
          const href = el.getAttribute("href") ?? "";
          // Off-origin is never followed: an audit must not wander onto Clerk/Whop/Stripe, where a
          // click is both unpredictable and outside the thing being tested.
          if (!href || /^(https?:)?\/\//.test(href) || href.startsWith("mailto:") || href.startsWith("tel:")) {
            if (!href.startsWith(location.origin)) continue;
          }
          if (el.getAttribute("target") === "_blank") continue;
        }

        // A stable-enough address to re-find this control after the DOM has moved under us.
        out.push({
          idx: out.length,
          tag: el.tagName.toLowerCase(),
          label: label.replace(/\s+/g, " ").slice(0, 40) || `<${el.tagName.toLowerCase()}>`,
          nav: el.tagName === "A",
        });
        el.setAttribute("data-audit-idx", String(out.length - 1));
      }
      return out;
    }, DESTRUCTIVE_TEXT.source)
    .catch(() => []);
}

async function auditPage(session, path, device) {
  const url = `${BASE}${path}`;
  const { browser, ctx } = await createTunneledContext({
    url,
    viewport: device.viewport,
    desktop: device.desktop,
    cookie: session.cookieHeader,
  });
  const tag = `${path} [${device.name}]`;
  // The minted __session JWT is dead ~72s after issue (measured — see lib/ui-session-keepalive.mjs)
  // and a click-through run is minutes long. Without this the sweep goes unauthenticated part-way
  // and reports every signed-out empty state as a product defect: the FIRST live run did exactly
  // that, producing 401s on /vector/universe, /spx/pin and /vector/daily-bars ~90s in, on endpoints
  // that had served 200 moments earlier.
  const stopKeepAlive = keepSessionAlive(ctx, session, new URL(BASE).hostname, (e) =>
    note("WARN", `${tag}: session keep-alive failed — ${e}`)
  );
  try {
    const page = await ctx.newPage();
    // ABORT EVERY SSE STREAM, not one hardcoded path.
    //
    // proxy-tunnel-context resolves a routed request on socket END, and an SSE stream never ends by
    // design, so its handler is held to STREAM_TIMEOUT_MS (180s) — and Playwright SERIALISES route
    // handling, so one open stream stalls every request behind it. Blocking only
    // `/api/market/vector/stream` left `/api/market/spx/pulse/stream` and `.../spot-stream` open,
    // which is why a multi-page sweep died: the first desk page worked and every page after it
    // failed with ERR_CONNECTION_RESET. Three stream-free pages in the same process sweep fine,
    // which is what isolated the cause.
    //
    // The desk treats SSE as optional and falls back to SWR polling (this sandbox blocks WebSockets
    // outright, so the polling path is the one that has to work here anyway). The honest cost: this
    // harness CANNOT validate push-freshness. It validates everything the polling path renders.
    await page.route(
      (u) => /(^|\/|-)(stream|sse|events)(\?|$)/.test(u.pathname + u.search),
      (r) => r.abort()
    );

    let consoleErrors = [];
    let failedRequests = [];
    let authExpired = [];
    let requestCount = 0;
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (URL_LESS_RESOURCE_ERROR.test(t) || THIRD_PARTY.test(t)) return;
      consoleErrors.push(t.slice(0, 160));
    });
    page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
    page.on("request", () => { requestCount += 1; });
    page.on("response", (r) => {
      if (r.status() < 400) return;
      if (THIRD_PARTY.test(r.url())) return;
      // 401/403 is the run's OWN credential dying, never the product. Kept out of failedRequests so
      // an expired token cannot masquerade as a page full of broken panels (#1961 chased exactly
      // that ghost once already).
      if (isAuthExpiry(r.status())) authExpired.push(r.url().replace(BASE, "").slice(0, 60));
      else failedRequests.push(`${r.status()} ${r.url().replace(BASE, "").slice(0, 80)}`);
    });

    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    } catch {
      // One retry — an in-flight ECS rollout is exactly the moment one connection dies and the next
      // succeeds. A nav failure is THIS page's problem, not the run's.
      await page.waitForTimeout(6_000);
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      } catch (e) {
        note("WARN", `${tag}: navigation failed twice — ${String(e).slice(0, 80)}`);
        return;
      }
    }

    const ready = await waitReady(page);
    if (ready.state !== "ready") {
      note("FAIL", `${tag}: page never became usable (${ready.state})`, {
        sample: (ready.text.match(ready.state === "broken" ? BROKEN : LOADING) ?? [""])[0],
      });
      return;
    }

    // A panel that is STILL fetching once the page is otherwise usable. Reported by name, and only
    // after a grace period, because a desk panel taking a few seconds is normal, not a defect.
    await page.waitForTimeout(6_000);
    const stuck = await stuckPanels(page);
    if (stuck.length) {
      note("FAIL", `${tag}: ${stuck.length} panel(s) still LOADING after the page was usable`, {
        panels: stuck.slice(0, 4),
      });
    }

    // Baseline geometry BEFORE any interaction, so a defect that already existed on load is not
    // blamed on the click that happened to be in front of it.
    const base = await probeGeometry(page);
    if (base.clipped.length) {
      note("FAIL", `${tag}: ${base.clipped.length} CLIPPED on load`, { clipped: base.clipped.slice(0, 3) });
    }
    if (base.collide.length) {
      note("FAIL", `${tag}: ${base.collide.length} COLLISION(s) on load`, { collisions: base.collide.slice(0, 3) });
    }
    const baseGeo = new Set([...base.clipped, ...base.collide]);

    // POLL for controls rather than enumerating once.
    //
    // Readiness is measured on body TEXT, and a desk paints its copy well before it mounts its
    // interactive chrome — so a single enumeration right after "ready" catches the page mid-mount.
    // Loosening the text check (a desk almost always has one panel still fetching, which used to
    // make the whole page read as "loading") moved readiness earlier and exposed this: /terminal
    // went from 7 controls to 0 between two runs of the same harness, with no product change. A
    // count of zero has to mean "this page has no controls", not "we asked too early".
    let controls = [];
    for (let i = 0; i < 8; i += 1) {
      const found = await safeControls(page, DESTRUCTIVE_TEXT.source);
      // Settled = the count stopped growing. Still-mounting pages grow between polls.
      if (found.length > 0 && found.length === controls.length) { controls = found; break; }
      controls = found;
      await page.waitForTimeout(2_500);
    }
    if (controls.length === 0) {
      note("WARN", `${tag}: no safely-clickable controls found after 20s — nothing was exercised here`);
      return;
    }
    // Re-stamp: the indices above came from the last poll, and the DOM may have moved since.
    await safeControls(page, DESTRUCTIVE_TEXT.source);
    note("INFO", `${tag}: exercising ${Math.min(controls.length, MAX_CONTROLS)} of ${controls.length} controls`);

    const dead = [];
    for (const ctl of controls.slice(0, MAX_CONTROLS)) {
      const before = await fingerprint(page);
      if (!before) break;
      consoleErrors = [];
      failedRequests = [];
      authExpired = [];
      const reqBefore = requestCount;

      const target = page.locator(`[data-audit-idx="${ctl.idx}"]`).first();
      let clicked = false;
      try {
        await target.scrollIntoViewIfNeeded({ timeout: 3_000 });
        await target.click({ timeout: 4_000, noWaitAfter: true });
        clicked = true;
      } catch {
        // Not a defect on its own: the control may have been re-rendered away by the PREVIOUS
        // click, which is normal in a live desk. Reported only in aggregate below.
      }
      if (!clicked) continue;

      await page.waitForTimeout(SETTLE_MS);
      const after = await fingerprint(page);
      if (!after) break;

      // DEAD: none of the four observable channels moved.
      const changed =
        after.url !== before.url ||
        after.text !== before.text ||
        after.controls !== before.controls ||
        after.dialogs !== before.dialogs ||
        requestCount > reqBefore;
      if (!changed) dead.push(ctl.label);

      if (consoleErrors.length) {
        note("FAIL", `${tag}: console error after clicking "${ctl.label}"`, {
          errors: [...new Set(consoleErrors)].slice(0, 2),
        });
      }
      if (failedRequests.length) {
        note("FAIL", `${tag}: failed request after clicking "${ctl.label}"`, {
          requests: [...new Set(failedRequests)].slice(0, 3),
        });
      }
      if (authExpired.length) {
        // WARN and STOP: once the credential is dead every later control is being measured on a
        // signed-out page, so continuing would manufacture findings rather than gather them.
        note("WARN", `${tag}: audit session expired mid-sweep (401/403) — stopping this page`, {
          sample: [...new Set(authExpired)].slice(0, 2),
        });
        break;
      }

      // Geometry of the NEW state, minus whatever was already wrong on load.
      //
      // Skipped entirely when the click NAVIGATED: the destination page has its own pre-existing
      // defects, and diffing them against THIS page's baseline attributes them to the link that
      // happened to be in front of them. The destination is audited on its own terms when it is in
      // PAGES. (The first live run blamed a /pricing FAQ collision on clicking "Pricing" from
      // /vector — a finding about the wrong page, produced by the wrong baseline.)
      const geo = after.url !== before.url ? { clipped: [], collide: [] } : await probeGeometry(page);
      const fresh = [...geo.clipped, ...geo.collide].filter((g) => !baseGeo.has(g));
      if (fresh.length) {
        note("FAIL", `${tag}: clicking "${ctl.label}" produced ${fresh.length} NEW geometry defect(s)`, {
          defects: fresh.slice(0, 3),
        });
        await page
          .screenshot({ path: join(OUT, `${path.replace(/\W+/g, "_")}-${device.name}-${ctl.idx}.png`) })
          .catch(() => {});
        fresh.forEach((g) => baseGeo.add(g)); // report each defect once, not once per later click
      }

      // A drawer/modal that opened must close again. A trap is worse than a no-op.
      //
      // ONLY WHEN THE CLICK STAYED ON THE PAGE. `dialogs` counts `[role=dialog],[aria-modal=true]`
      // in the CURRENT document, so across a navigation it compares two different pages and any
      // dialog-shaped furniture on the destination reads as "a dialog opened" — then Escape cannot
      // close it, because nothing opened. Measured on production 2026-08-23: `/dashboard`'s nav
      // links (BLACKOUT TRADING, FAQ, Pricing, Learn) each produced this FAIL, and `/`, `/faq`,
      // `/pricing` and `/learn` each ship exactly 2 such elements in their served HTML. Four
      // failures, one per nav link, none of them real.
      //
      // That is the failure mode this file's own geometry probe is documented against — a check
      // that fires on healthy pages teaches its reader to skip the report — so it is gated rather
      // than tolerated. A navigation is audited on its own next pass, where `before` is that
      // page's own baseline.
      if (shouldCheckEscape(before, after)) {
        await page.keyboard.press("Escape").catch(() => {});
        await page.waitForTimeout(800);
        const closed = await fingerprint(page);
        if (closed && closed.dialogs > before.dialogs) {
          note("FAIL", `${tag}: dialog opened by "${ctl.label}" does NOT close on Escape`);
        }
      }

      // If the click navigated, come back — otherwise every later control is measured on the wrong
      // page, and the run silently becomes an audit of one link's destination.
      if (after.url !== before.url) {
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
        const back = await waitReady(page);
        if (back.state !== "ready") {
          note("FAIL", `${tag}: BACK from "${ctl.label}" left the page unusable (${back.state})`, {
            chars: back.text.length,
          });
          break;
        }
        // The audit indices were stamped on the previous DOM; re-stamp for the restored one.
        await safeControls(page, DESTRUCTIVE_TEXT.source);
      }
    }

    if (dead.length) {
      note("FAIL", `${tag}: ${dead.length} DEAD control(s) — click changed nothing observable`, {
        dead: [...new Set(dead)].slice(0, 6),
      });
    } else {
      note("PASS", `${tag}: every exercised control did something`);
    }
  } finally {
    stopKeepAlive();
    await browser.close().catch(() => {});
  }
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const pages = PAGES.filter((p) => includeAdmin || !p.startsWith("/admin"));
  if (pages.length !== PAGES.length && !asJson) {
    console.log("NOTE: /admin* excluded — its write surface is the highest-consequence in the app.");
  }
  const session = await mintClerkPremiumSession({ appUrl: BASE });
  if (session.skip) {
    console.log(`SKIP — ${session.reason}`);
    process.exit(0);
  }
  const devices = desktopOnly
    ? [{ name: "desktop", viewport: "1440x1000", desktop: true }]
    : [
        { name: "desktop", viewport: "1440x1000", desktop: true },
        { name: "phone", viewport: "430x932", desktop: false },
      ];
  try {
    for (const p of pages) {
      if (!asJson) console.log(`\n═══ ${p}`);
      for (const d of devices) await auditPage(session, p, d);
    }
  } finally {
    // ALWAYS release. A run that leaves a live admin+premium user behind on prod Clerk is a
    // standing credential, which is precisely what this must never create.
    await session.cleanup?.();
  }

  const fails = findings.filter((f) => f.level === "FAIL");
  // Same guard as every harness here: a run that exercised nothing must not read as green.
  const exercised = findings.some((f) => /exercising \d+/.test(f.msg));
  const verdict = !exercised
    ? "NO EVIDENCE GATHERED — no control was exercised; this run proves nothing"
    : fails.length > 0
      ? `${fails.length} FAILURES across ${pages.length} pages`
      : `ALL ${pages.length} PAGES BEHAVED`;
  if (asJson) console.log(JSON.stringify({ verdict, fails: fails.length, findings }, null, 2));
  else console.log(`\n${"═".repeat(70)}\n${verdict}\nScreenshots: ${OUT}`);
  process.exit(fails.length > 0 || !exercised ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL ${String(e)}`);
  process.exit(2);
});
