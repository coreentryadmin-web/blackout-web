import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const auditPath = join(import.meta.dirname, "site-latency-audit.mjs");

test("dashboard ready probe passes minRows via waitForFunction arg, not OFF_HOURS closure", () => {
  const src = readFileSync(auditPath, "utf8");
  const dashboardReady = src.match(
    /ready: \(minRows\) =>[\s\S]*?document\.body\.innerText\.length > 800,/,
  )?.[0];
  assert.ok(dashboardReady, "expected parameterized dashboard ready function");
  assert.doesNotMatch(dashboardReady!, /OFF_HOURS/, "OFF_HOURS must not run in browser context");
  assert.match(src, /waitForFunction\(page\.ready, page\.readyMinRows/);
});

test("browser launch resolves chromium path for cloud agents without /opt/pw-browsers", () => {
  const src = readFileSync(auditPath, "utf8");
  assert.match(src, /import \{ resolveChromiumPath \} from "\.\/audit\/lib\/playwright-chromium-path\.mjs"/);
  assert.match(src, /resolveChromiumPath\(\)/);
  assert.match(src, /executablePath/);
});
