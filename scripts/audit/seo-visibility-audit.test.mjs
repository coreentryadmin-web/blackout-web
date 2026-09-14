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

// Live 2026-09-13/14: Deploy smoke went RED twice on a bare "Recv failure: Connection reset by
// peer" fetching robots.txt/sitemap.xml — isRetryableCurlResult already matches that error string,
// but fetchPublic() (all 9 public SEO checks, including those two) called plain curl(), not
// curlRetry(), so the retry it was already built for never ran on the path that actually failed.
test("seo-visibility-audit's fetchPublic retries through curlRetry, not a bare curl", () => {
  const src = readFileSync(join(process.cwd(), "scripts/audit/seo-visibility-audit.mjs"), "utf8");
  const fn = src.match(/async function fetchPublic\([\s\S]*?\n\}/)?.[0];
  assert.ok(fn, "fetchPublic() not found");
  assert.match(fn, /await curlRetry\(/);
  assert.doesNotMatch(fn, /(?<!curlRetry)\bcurl\(\{/);
});
