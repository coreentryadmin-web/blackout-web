import test from "node:test";
import assert from "node:assert/strict";
import { seoAuditExitCode } from "./seo-visibility-audit.mjs";

test("seoAuditExitCode: GREEN when no failures", () => {
  assert.equal(seoAuditExitCode([{ name: "robots.txt", status: "PASS" }]), 0);
});

test("seoAuditExitCode: AMBER (exit 0) when only auth failed — Clerk flake, not product SEO", () => {
  assert.equal(
    seoAuditExitCode([
      { name: "robots.txt", status: "PASS" },
      { name: "auth", status: "FAIL" },
    ]),
    0,
  );
});

test("seoAuditExitCode: RED (exit 1) when a product SEO check failed", () => {
  assert.equal(
    seoAuditExitCode([
      { name: "auth", status: "FAIL" },
      { name: "llms.txt", status: "FAIL" },
    ]),
    1,
  );
  assert.equal(seoAuditExitCode([{ name: "sitemap.xml", status: "FAIL" }]), 1);
});
