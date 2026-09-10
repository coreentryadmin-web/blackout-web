import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * next.config.mjs's redirects() — pinned so a legacy/removed URL keeps reclaiming its traffic
 * instead of silently going back to a 404 on a future refactor.
 *
 * /vs/spotgamma is the motivating case: it was live and sitemap-indexed (commit 611714f88) before
 * an explicit product steer ("don't name SpotGamma or any specific competitor", commit 99900c12d)
 * moved it to the generic /vs/others. The rename shipped without a redirect, so the old URL has
 * been 404ing live since — found via a sitemap-history sweep (docs/audit/findings-staging), not a
 * report, so anyone who bookmarked it or linked to it from that era has been getting a dead page.
 */

async function redirectFor(source: string): Promise<{ destination: string; permanent: boolean } | undefined> {
  const cfg = (await import("../next.config.mjs")).default as {
    redirects: () => Promise<Array<{ source: string; destination: string; permanent: boolean }>>;
  };
  const entries = await cfg.redirects();
  return entries.find((e) => e.source === source);
}

test("/vs/spotgamma permanently redirects to /vs/others — reclaims the pre-rename URL's traffic", async () => {
  const redirect = await redirectFor("/vs/spotgamma");
  assert.ok(redirect, "/vs/spotgamma has no redirect entry in next.config.mjs");
  assert.equal(redirect!.destination, "/vs/others");
  assert.equal(redirect!.permanent, true, "should be a 301 (permanent), not a 302 — search engines should transfer the URL's equity, not just bounce traffic");
});

test("existing legacy redirects still resolve (helix rename, favicon)", async () => {
  const helix = await redirectFor("/helix");
  assert.equal(helix?.destination, "/flows");

  const learnHelix = await redirectFor("/learn/helix");
  assert.equal(learnHelix?.destination, "/learn/helix-flows");
});
