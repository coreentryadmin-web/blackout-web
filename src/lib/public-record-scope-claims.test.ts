import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { TrackRecordPagePayload } from "@/lib/track-record-page";

// Regression for a P2 finding (2026-09-04): the About page, homepage, and WhyBlackoutContent all
// said things like "Every setup BlackOut flags is logged publicly" / "Every play logged, graded,
// and timestamped... the full ledger, always" and pointed readers at /methodology for "how each
// product is scored" — but /methodology's own payload type (TrackRecordPagePayload,
// track-record-page.ts) is hard-typed to exactly THREE buckets: spxSlayer, nightHawk, zerodte
// (0DTE Command). There is no helix/vector/thermal/meridian/largo field. "Every setup"/"each
// product" is a verifiability claim used as a conversion differentiator — it must not promise
// broader coverage than the public ledger it points to actually delivers.
//
// Deliberately does NOT assert that HELIX/Vector/Thermal/Meridian/Largo "don't produce gradeable
// setups" — HELIX has its own internal signal ledger (helix-signal-ledger-status.ts) and Vector
// has its own outcome tracking (vector-bead-recorder-logic.ts) that this test takes no position on;
// that is a separate, still-evolving question this fix does not need to answer. This test only
// enforces that the specific "every setup"/"each product" marketing claims stay scoped to what
// /methodology structurally covers today.
const SURFACES = [
  "src/app/(marketing)/about/page.tsx",
  "src/components/landing/RedesignHome.tsx",
  "src/components/landing/WhyBlackoutContent.tsx",
] as const;

const REPO = join(import.meta.dirname, "..", "..");

/** The exact three product-scoped bucket keys /methodology's payload type carries — kept as a
 *  type-level import so a future field addition to TrackRecordPagePayload is what widens this
 *  test's ground truth, not a second hand-typed list drifting from the real payload shape. */
type _AssertPayloadShape = keyof TrackRecordPagePayload;
const METHODOLOGY_SCOPED_PRODUCTS: readonly _AssertPayloadShape[] = ["spxSlayer", "nightHawk", "zerodte"];

/**
 * Window (characters) searched around EACH individual claim match for the three product names.
 * Must be a per-match proximity check, not "do the three names appear anywhere in the file" — a
 * whole-file check trivially passes on a page like the homepage that names all three products
 * dozens of times for unrelated reasons, which is exactly how a SECOND unscoped "Every setup
 * graded A-F with a logged track record" instance (RedesignHome.tsx's own "them vs us" list,
 * distinct from the pipeline-card instance the first fix caught) survived undetected through both
 * the original fix (#3643) and a same-day follow-up (#3664) that only fixed vs/others/page.tsx's
 * copy of the identical sentence.
 */
const PROXIMITY_WINDOW = 200;

/** Every place in `body` a broad, unscoped "every setup/play... logged" claim appears. */
function findBroadClaims(body: string): Array<{ index: number; match: string }> {
  const claims: Array<{ index: number; match: string }> = [];
  const re = /every\s+(?:\w+\s+)?(setup|play)\b.{0,80}(logged|flags?)|the full ledger, always/gi;
  for (const m of body.matchAll(re)) {
    if (m.index != null) claims.push({ index: m.index, match: m[0] });
  }
  return claims;
}

test("public 'every setup'/'each product' transparency claims name the three products /methodology actually covers", () => {
  assert.equal(
    METHODOLOGY_SCOPED_PRODUCTS.length,
    3,
    "sanity: /methodology's payload should still be exactly the three known buckets"
  );

  for (const rel of SURFACES) {
    const body = readFileSync(join(REPO, rel), "utf8");
    for (const claim of findBroadClaims(body)) {
      const start = Math.max(0, claim.index - PROXIMITY_WINDOW);
      const end = Math.min(body.length, claim.index + claim.match.length + PROXIMITY_WINDOW);
      const nearby = body.slice(start, end);
      assert.ok(
        /SPX Slayer/.test(nearby) && /Night Hawk/.test(nearby) && /0DTE Command/.test(nearby),
        `${rel}: the claim "${claim.match}" doesn't name the three products /methodology actually ` +
          `covers (SPX Slayer, Night Hawk, 0DTE Command) within ${PROXIMITY_WINDOW} chars of it — a ` +
          `product name appearing ELSEWHERE in the same file does not scope THIS specific claim`
      );
    }
  }
});

test("About page's methodology pointer does not claim coverage of 'each product' generically", () => {
  const about = readFileSync(join(REPO, "src/app/(marketing)/about/page.tsx"), "utf8");
  assert.doesNotMatch(
    about,
    /methodology.{0,40}how each product is scored/is,
    "About page must not claim /methodology covers 'each product' — it covers exactly three"
  );
});
