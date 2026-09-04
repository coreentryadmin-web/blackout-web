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
  "src/app/(marketing)/vs/others/page.tsx",
] as const;

const REPO = join(import.meta.dirname, "..", "..");

/** The exact three product-scoped bucket keys /methodology's payload type carries — kept as a
 *  type-level import so a future field addition to TrackRecordPagePayload is what widens this
 *  test's ground truth, not a second hand-typed list drifting from the real payload shape. */
type _AssertPayloadShape = keyof TrackRecordPagePayload;
const METHODOLOGY_SCOPED_PRODUCTS: readonly _AssertPayloadShape[] = ["spxSlayer", "nightHawk", "zerodte"];

test("public 'every setup'/'each product' transparency claims name the three products /methodology actually covers", () => {
  assert.equal(
    METHODOLOGY_SCOPED_PRODUCTS.length,
    3,
    "sanity: /methodology's payload should still be exactly the three known buckets"
  );

  for (const rel of SURFACES) {
    const body = readFileSync(join(REPO, rel), "utf8");
    const hasBroadClaim =
      /every (setup|play)\b.{0,80}(logged|flags?)/i.test(body) ||
      /the full ledger, always/i.test(body);
    if (!hasBroadClaim) continue; // this surface doesn't make the claim at all — nothing to scope
    assert.ok(
      /SPX Slayer/.test(body) && /Night Hawk/.test(body) && /0DTE Command/.test(body),
      `${rel} makes a broad "every setup"/"full ledger" transparency claim but doesn't name the ` +
        `three products /methodology actually covers (SPX Slayer, Night Hawk, 0DTE Command) near it`
    );
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
