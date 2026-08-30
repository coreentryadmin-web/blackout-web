import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuditBase, safeArtifactSlug } from "./audit-base.mjs";

test("resolveAuditBase accepts production default", () => {
  assert.equal(resolveAuditBase(undefined), "https://blackouttrades.com");
});

test("resolveAuditBase rejects non-https origins", () => {
  assert.throws(() => resolveAuditBase("http://blackouttrades.com"), /https/);
});

test("resolveAuditBase rejects foreign hosts", () => {
  assert.throws(() => resolveAuditBase("https://evil.example.com"), /not allowed/);
});

test("safeArtifactSlug strips unsafe characters", () => {
  assert.equal(safeArtifactSlug("SPX embed"), "spx-embed");
  assert.equal(safeArtifactSlug("../../etc/passwd"), "etc-passwd");
});
