import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE EARNINGS TABLIST OVERLAPS THE WRAPPED TITLE ON TABLET AND MOBILE.
 *
 * `.meridian-detail-head-v2` is the flex row that pairs the event title
 * (`.meridian-detail-head-main` > `.meridian-detail-title-v2`) with the
 * SUMMARY/REPORT/ESTIMATES/POSITIONING/HISTORY tab strip (`.meridian-earnings-tablist`,
 * rendered by `<MeridianEarningsTablist>` inside the same `<header>`, see
 * MeridianEventDetailPanel.tsx). `.meridian-detail-title-v2` is `flex-wrap: wrap` BY DESIGN so
 * the kicker ("EARNINGS · HIGH IMPACT") + ticker + meta can wrap on narrow screens — but the
 * PARENT row had no `flex-wrap`, so it stayed a single nowrap line. At >=1440px the title fits
 * on one line and nothing overlaps; at 1024px and 430px the title wraps to 2-3 lines, the row
 * grows tall, and `align-items: center` centers the still-single-line tablist vertically against
 * that tall block — landing it mid-way down the wrapped title text. Measured live: the tail of
 * the h2 ("earnings") renders directly on top of the SUMMARY pill's left half, identically on
 * every one of the desk's ~131 earnings events, regardless of which tab is active.
 *
 * Asserted from the CSS, same technique as `meridian-banner-css.test.ts`'s `declaredValue`
 * helper: `.meridian-detail-head-v2` has TWO separate rule blocks (the original at ~line 808,
 * a "compact header" override at ~line 2815) and only the LAST cascade declaration of a
 * property is what the browser actually applies — reading the wrong block would report
 * `flex-wrap` as absent even after the fix landed in the override.
 */
const css = readFileSync(join(process.cwd(), "src/app/desk-app.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  ""
);

function declaredValue(selector: string, prop: string): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [...css.matchAll(new RegExp(`(^|[,\\s}])${esc}\\s*\\{([^}]*)\\}`, "g"))].map((m) => m[2]!);
  assert.ok(rules.length, `no rule found for ${selector}`);
  let found: string | null = null;
  for (const body of rules) {
    const m = [...body.matchAll(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "g"))].pop();
    if (m) found = m[1]!.trim();
  }
  return found;
}

test("REGRESSION: the header row can wrap so the tablist drops below a multi-line title", () => {
  assert.equal(
    declaredValue(".meridian-detail-head-v2", "flex-wrap"),
    "wrap",
    "without flex-wrap: wrap, the tablist never drops to its own row and align-items: center " +
      "lands it mid-way down the wrapped title on tablet/mobile"
  );
  // Precondition the fix depends on: if the row wraps but the title itself is no longer allowed
  // to wrap, this becomes a no-op (the row would just get narrower, not taller) and the overlap
  // would look different but the panel would still misrender.
  assert.equal(
    declaredValue(".meridian-detail-title-v2", "flex-wrap"),
    "wrap",
    "precondition: the title must still be allowed to wrap onto multiple lines"
  );
  assert.equal(
    declaredValue(".meridian-detail-head-v2", "display"),
    "flex",
    "precondition: the header must still be a flex row for flex-wrap to have any effect"
  );
});

test("the tablist keeps its own single-line pill layout once it drops to its own row", () => {
  // Unrelated axis: `.meridian-earnings-tablist`'s OWN children (the five tab pills) must stay
  // on one row so SUMMARY/REPORT/ESTIMATES/POSITIONING/HISTORY read as a tab strip, not a
  // wrapped paragraph of buttons. This must hold regardless of the header-row fix above.
  assert.equal(declaredValue(".meridian-earnings-tablist", "flex-wrap"), "nowrap");
});
