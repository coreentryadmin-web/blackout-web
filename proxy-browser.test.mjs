/**
 * Tests the pure `mobileUaWarning` guard: proxy-browser.cjs must warn when a desktop-width
 * viewport is requested without --desktop, since that combination silently renders with the
 * mobile UA (BlackOutiOSApp/1.0) and previously produced a false P0 in a live UI audit
 * (docs/audit/UI-UX-MAP.md's top-of-file correction, 2026-08-23). No browser/network needed.
 * Run: `node --test proxy-browser.test.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mobileUaWarning, scrollThrough } from "./proxy-browser.cjs";

/** A fake Playwright `page` recording every evaluate()/waitForTimeout() call, no browser needed. */
function fakePage(scrollHeight) {
  const evalCalls = [];
  const waits = [];
  let scrollY = 0;
  return {
    calls: { evalCalls, waits },
    async evaluate(fn, arg) {
      // scrollThrough calls evaluate three ways: reading scrollHeight, scrolling to y, resetting
      // to 0. Distinguish by arity/arg shape rather than by fn identity (fn is passed by value).
      if (arg === undefined && fn.toString().includes("scrollHeight")) return scrollHeight;
      if (arg === undefined) { scrollY = 0; evalCalls.push(0); return undefined; }
      scrollY = arg;
      evalCalls.push(arg);
      return undefined;
    },
    async waitForTimeout(ms) {
      waits.push(ms);
    },
    get scrollY() {
      return scrollY;
    },
  };
}

test("warns on a desktop-width viewport without --desktop", () => {
  assert.ok(mobileUaWarning("1440x900", false));
});

test("does not warn when --desktop is passed", () => {
  assert.equal(mobileUaWarning("1440x900", true), null);
});

test("does not warn on the mobile default viewport", () => {
  assert.equal(mobileUaWarning("430x932", false), null);
});

test("warns at the 1024px threshold, not below it", () => {
  assert.ok(mobileUaWarning("1024x768", false));
  assert.equal(mobileUaWarning("1023x768", false), null);
});

test("does not throw on a malformed viewport string", () => {
  assert.equal(mobileUaWarning("not-a-viewport", false), null);
});

test("scrollThrough steps from 0 to the bottom and returns to the top", async () => {
  // Measured live 2026-08-24: blackouttrades.com's homepage is 12822px tall. 900px steps cross it
  // in 15 steps (0, 900, ..., 12600), then one final reset-to-0 call.
  const page = fakePage(12822);
  await scrollThrough(page, { stepPx: 900, waitMs: 1, maxSteps: 40 });
  assert.deepEqual(page.calls.evalCalls.slice(0, -1), Array.from({ length: 15 }, (_, i) => i * 900));
  assert.equal(page.calls.evalCalls.at(-1), 0, "must end scrolled back to the top");
  assert.equal(page.scrollY, 0);
});

test("scrollThrough waits once per step, matching the step count", async () => {
  const page = fakePage(3000);
  await scrollThrough(page, { stepPx: 1000, waitMs: 250, maxSteps: 40 });
  // 0, 1000, 2000 cross a 3000px page in 3 steps.
  assert.equal(page.calls.waits.length, 3);
  assert.ok(page.calls.waits.every((w) => w === 250));
});

test("scrollThrough is bounded by maxSteps on an unexpectedly tall page", async () => {
  // A page this tall should never hang the caller waiting on hundreds of scroll steps -- bounded
  // coverage is strictly better than an unbounded wait, per this repo's own "no silent caps"
  // rule: the cap exists and is asserted here, not discovered by someone waiting on a hung run.
  const page = fakePage(1_000_000);
  await scrollThrough(page, { stepPx: 900, waitMs: 1, maxSteps: 5 });
  assert.equal(page.calls.evalCalls.length, 6, "5 steps plus the final reset-to-0");
  assert.equal(page.scrollY, 0);
});

test("scrollThrough still takes one step on a page shorter than one step", async () => {
  // total < stepPx still crosses the whole page in a single 0->0 step (y=0 < total is true once),
  // then the final reset -- two scrollTo(0) calls, not zero, but only one wait.
  const page = fakePage(200);
  await scrollThrough(page, { stepPx: 900, waitMs: 1, maxSteps: 40 });
  assert.deepEqual(page.calls.evalCalls, [0, 0]);
  assert.equal(page.calls.waits.length, 1);
});
