import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRetryableCurlResult, seoAuditExitCode } from "./lib/curl-retry-result.mjs";

test("isRetryableCurlResult retries TLS reset and edge 5xx", () => {
  assert.equal(isRetryableCurlResult({ s: 0, err: "Recv failure: Connection reset by peer" }), true);
  assert.equal(isRetryableCurlResult({ s: 503, b: "" }), true);
  assert.equal(isRetryableCurlResult({ s: 200, b: "{}" }), false);
  assert.equal(isRetryableCurlResult({ s: 401, b: "" }), false);
});

test("seoAuditExitCode treats auth-only failure as non-blocking AMBER", () => {
  assert.equal(seoAuditExitCode([]), 0);
  assert.equal(seoAuditExitCode([{ name: "auth", status: "FAIL" }]), 0);
  assert.equal(seoAuditExitCode([{ name: "robots.txt", status: "FAIL" }]), 1);
});

test("seo-visibility-audit uses curlRetry on Clerk FAPI mint path", () => {
  const src = readFileSync(join(process.cwd(), "scripts/audit/seo-visibility-audit.mjs"), "utf8");
  assert.match(src, /async function curlRetry/);
  assert.match(src, /await curlRetry\([\s\S]*sign_ins/);
  assert.match(src, /await curlRetry\([\s\S]*sessions\/\$\{sid\}\/tokens/);
  assert.match(src, /process\.exit\(seoAuditExitCode\(fails\)\)/);
});
