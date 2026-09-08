#!/usr/bin/env node
// CI guard (CQ-152): baseCsp in next.config.mjs must stay a single exported constant and
// must be wired into securityHeaders — prevents silent CSP drift from ad-hoc edits.
// Live Cloudflare parity is validated separately via validate:csp-live when AUDIT_BASE_URL is set.

import { readFileSync } from "node:fs";

const config = readFileSync("next.config.mjs", "utf8");

if (!/const baseCsp\s*=/.test(config)) {
  console.error("FAIL: next.config.mjs must define const baseCsp");
  process.exit(1);
}

if (!/value:\s*baseCsp/.test(config)) {
  console.error("FAIL: securityHeaders must reference baseCsp (not a duplicated CSP string)");
  process.exit(1);
}

if ((config.match(/default-src 'self'/g) ?? []).length < 1) {
  console.error("FAIL: baseCsp appears missing or truncated");
  process.exit(1);
}

console.log("OK: next.config.mjs baseCsp wiring intact.");
