import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

/**
 * Keeps the day-6 board screenshot and the alt text that describes it from drifting apart.
 *
 * They already had: the alt text read "wins and losses both" while the asset showed two red rows
 * and no winner at all — simultaneously overclaiming (no wins present) and describing a picture
 * nobody had looked at in a while. Alt text is the one part of an image a reviewer never sees
 * rendered and a screen-reader user hears verbatim, so it silently stays wrong.
 *
 * The asset is now an all-winners board (product decision, 2026-08-08). That makes any alt text
 * asserting the image contains losses false, so this pins the two together: change the picture,
 * change the words.
 */

const TEMPLATE = "src/lib/email/templates/welcome-sequence.ts";
const PANEL_SOURCE = "docs/assets/email/nighthawk-plays.source.html";

function nightHawkAltText(): string {
  const src = readFileSync(TEMPLATE, "utf8");
  const m = src.match(/emailScreenshot\(nightHawkShot,\s*"([^"]+)"\)/);
  assert.ok(m, "could not find the nightHawkShot emailScreenshot() call — did the variable rename?");
  return m![1];
}

test("the board screenshot's alt text does not claim the image shows losses", () => {
  const alt = nightHawkAltText();
  assert.ok(
    !/\bloss(es)?\b|\blosers?\b|\bred\b/i.test(alt),
    `alt text claims the image contains losses, but the committed asset is winners-only: "${alt}"`
  );
});

test("the board screenshot's alt text still describes the board", () => {
  // Guard against the fix above being satisfied by gutting the alt text to something useless.
  const alt = nightHawkAltText();
  assert.ok(alt.length >= 30, `alt text is too short to describe the image: "${alt}"`);
  assert.match(alt, /0DTE|Night Hawk|board/i, "alt text should still say what the screenshot is of");
});

test("the screenshot's source markup is committed alongside the rendered asset", () => {
  // The JPEG is a build artifact of this HTML. Without the source committed, the next person who
  // needs to change one row has to redraw the whole panel by hand or edit a JPEG.
  assert.ok(existsSync(PANEL_SOURCE), `${PANEL_SOURCE} must be committed so the asset can be re-rendered`);
  assert.ok(existsSync("public/images/email/nighthawk-plays.jpg"), "rendered asset must exist");
});

test("the committed panel source contains no negative result rows", () => {
  // Pins the actual decision. If someone adds a red row to the source, they must also revisit the
  // alt text — this test and the first one cannot both pass otherwise.
  const html = readFileSync(PANEL_SOURCE, "utf8");
  const stats = [...html.matchAll(/class="stat">\s*([+-][\d.]+)%/g)].map((m) => Number(m[1]));
  assert.ok(stats.length > 0, "expected to find result percentages in the panel source");
  const negatives = stats.filter((n) => n < 0);
  assert.deepEqual(negatives, [], `panel source shows negative rows ${negatives.join(", ")} — update the alt text too`);
});
