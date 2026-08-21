import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Placed under src/ deliberately: scripts/run-tests.mjs walks src/ ONLY, so a test living beside
// the audit lib it covers would never gate CI. Same reason meridian-audit-poll-count.test.ts is here.
import {
  NAV_ATTEMPTS,
  NAV_RETRY_WAITS_MS,
  VIEWPORT_COOLDOWN_MS,
  navRetryWaitMs,
  navTotalPatienceMs,
  viewportCooldownMs,
} from "../scripts/audit/lib/proxy-saturation.mjs";

const AUDIT = readFileSync(
  join(process.cwd(), "scripts/audit/meridian-interaction-audit.mjs"),
  "utf8"
);

/**
 * THE LAST VIEWPORT WAS NEVER AUDITED.
 *
 * MEASURED ON PROD 2026-08-21. Mobile run ALONE: `routed: 226 ok, 0 fail`, 0 HARNESS — and 430px
 * is the width the rail-overlap defects were actually found at. Mobile run THIRD, after desktop
 * (173 requests) and tablet (135): ERR_CONNECTION_RESET on the first navigation with 3 routed,
 * every time. Not the UA — the same page over the same tunnel with the iPhone UA returns 200 and
 * 58,201 bytes, byte-identical to desktop.
 */
describe("a full audit run must not starve its own last viewport", () => {
  test("the harness now outlasts the saturation window it was measured against", () => {
    // The old code waited 12s once. The proxy did not recover in 12s — three passes, three resets.
    assert.ok(
      navTotalPatienceMs() >= 60_000,
      `patience must be measured in minutes, not seconds (got ${navTotalPatienceMs()}ms)`
    );
    assert.equal(navTotalPatienceMs(), 68_000);
  });

  test("the waits BACK OFF — a run that recovers early must not pay the long wait", () => {
    // Flat retries either give up too early or make every recovery expensive. Escalating means the
    // cheap case stays cheap and the stubborn case still gets a real chance.
    for (let i = 1; i < NAV_RETRY_WAITS_MS.length; i += 1) {
      assert.ok(
        NAV_RETRY_WAITS_MS[i]! > NAV_RETRY_WAITS_MS[i - 1]!,
        `wait ${i} (${NAV_RETRY_WAITS_MS[i]}) must exceed wait ${i - 1} (${NAV_RETRY_WAITS_MS[i - 1]})`
      );
    }
    assert.ok(NAV_RETRY_WAITS_MS[0]! <= 10_000, "the first retry must still be prompt");
  });

  test("retrying is BOUNDED — the loop cannot spin forever against a dead proxy", () => {
    assert.equal(NAV_ATTEMPTS, NAV_RETRY_WAITS_MS.length + 1);
    assert.equal(navRetryWaitMs(NAV_ATTEMPTS - 1), null, "the final attempt has nothing left to wait for");
    for (let a = 0; a < NAV_ATTEMPTS - 1; a += 1) {
      assert.equal(typeof navRetryWaitMs(a), "number", `attempt ${a} must have a wait`);
    }
  });

  test("a nonsense attempt index gives up rather than waiting forever", () => {
    for (const bad of [-1, 1.5, NaN, undefined, null, "soon"]) {
      assert.equal(navRetryWaitMs(bad as never), null, `attempt=${String(bad)}`);
    }
  });

  test("the cooldown falls between viewports and is not charged to the first one", () => {
    // Three viewports pay it twice, not three times — the browser has opened nothing yet at idx 0.
    assert.equal(viewportCooldownMs(0), 0);
    assert.equal(viewportCooldownMs(1), VIEWPORT_COOLDOWN_MS);
    assert.equal(viewportCooldownMs(2), VIEWPORT_COOLDOWN_MS);
    assert.ok(VIEWPORT_COOLDOWN_MS >= 20_000, "a token pause does not drain a few hundred CONNECTs");
  });

  test("a nonsense index is treated as the first viewport, never as a reason to hang", () => {
    for (const bad of [-1, 1.5, NaN, undefined, null, "second"]) {
      assert.equal(viewportCooldownMs(bad as never), 0, `index=${String(bad)}`);
    }
  });
});

describe("the audit script is actually wired to those waits", () => {
  test("the single flat 12s retry is gone", () => {
    // The exact shape of the defect: one retry, one wait, then the viewport was abandoned.
    assert.equal(AUDIT.includes("waitForTimeout(12_000)"), false);
  });

  test("navigation is bounded by NAV_ATTEMPTS and waits come from the lib, not a local literal", () => {
    assert.match(AUDIT, /import \{[^}]*NAV_ATTEMPTS[^}]*\} from "\.\/lib\/proxy-saturation\.mjs"/);
    assert.match(AUDIT, /attempt < NAV_ATTEMPTS/, "the loop must be bounded by the shared constant");
    assert.match(AUDIT, /navRetryWaitMs\(attempt\)/);
    assert.equal(
      /VIEWPORT_COOLDOWN_MS\s*=/.test(AUDIT),
      false,
      "the cooldown must live in one place, not be re-declared here"
    );
    assert.match(AUDIT, /viewportCooldownMs\(idx\)/);
  });

  test("exhausting the retries still reports HARNESS — it must never read as 'audited, clean'", () => {
    // This is the whole point. A viewport that could not be reached is an UNKNOWN, and the run must
    // say so; silently returning would turn a starved pass into a passing one.
    const branch = AUDIT.slice(AUDIT.indexOf("if (wait == null)"), AUDIT.indexOf("await page.waitForTimeout(wait)"));
    assert.match(branch, /severity: "HARNESS"/);
    assert.match(branch, /navigation failed/);
    assert.match(branch, /return false/, "and it must abandon this viewport, not fall through");
  });
});
