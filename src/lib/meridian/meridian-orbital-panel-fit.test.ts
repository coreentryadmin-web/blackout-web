import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MIN_ORBITAL_SIZE, orbitalGeometry } from "./meridian-spatial-core";

const root = process.cwd();
const CSS = readFileSync(join(root, "src/app/desk-app.css"), "utf8");
const PANEL = readFileSync(
  join(root, "src/features/meridian/components/MeridianEarningsReportPanel.tsx"),
  "utf8"
);

function rule(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} must exist`);
  return CSS.slice(at, CSS.indexOf("\n}", at));
}

/**
 * A GRID THAT COULD NOT HOLD ITS OWN DIAGRAM.
 *
 * MEASURED ON PROD 2026-08-21 at 1440x1000, Report tab, collapsed orbital. Every number below is
 * a getBoundingClientRect from that page:
 *
 *   .ms-orbital        755.52 → 1131.52   (376px — the MIN_ORBITAL_SIZE floor)
 *   .mr-panel          741.72 → 1070.27   (328.55px, padding 12.8px, content ≈ 302.9px)
 *   next .mr-panel     1079.86 → …
 *
 *   "Fundamentals"     1035.05 → 1102.89  → 32.62px past its panel, 23.03px INSIDE the next one
 *   "HELIX flow"       1038.19 → 1095.39  → 25.12px past, 15.53px inside
 *   "YoY trajectory"   1005.79 → 1084.27  → 14.00px past,  4.41px inside
 *
 * The interaction audit reported it as `"Fundamentals" ∩ "25-11-10" 2x12px` because it compares
 * TEXT-NODE boxes and only that one date sat at that y. The structural fact is larger: the
 * diagram is 61.25px wider than its panel and `.mr-panel` does not clip.
 *
 * The diagram is not at fault. It refuses to draw below MIN_ORBITAL_SIZE because below that its
 * own rim labels collide — "better a diagram that takes the room it needs than one that lies at
 * the size it was given". The track floor was simply never told.
 */
describe("the orbital's grid track can hold the box the orbital actually draws", () => {
  test("the track floor is DERIVED from the box, not a literal that can drift", () => {
    const g = rule(".mr-grid-orbital");
    assert.match(g, /var\(--mr-orbital-box/, "the floor must come from the shipping geometry");
    assert.equal(
      /minmax\(min\(100%,\s*\d/.test(g),
      false,
      "a hard-coded px/rem floor is exactly what went stale here"
    );
  });

  test("the floor reserves the panel's OWN padding and border — measured from .mr-panel", () => {
    // If someone changes .mr-panel's padding, the reservation is wrong and the diagram overflows
    // again. Read the real values rather than restating them.
    const panel = rule(".mr-panel");
    const pad = /padding:\s*([\d.]+)rem\s+([\d.]+)rem/.exec(panel);
    assert.ok(pad, ".mr-panel must still declare padding in rem");
    const sidePadRem = Number(pad![2]) * 2;
    const border = /border:\s*(\d+)px/.exec(panel);
    assert.ok(border, ".mr-panel must still declare a px border");
    const borderPx = Number(border![1]) * 2;

    const g = rule(".mr-grid-orbital");
    const calc = /calc\(var\(--mr-orbital-box[^)]*\)\s*\+\s*([\d.]+)rem\s*\+\s*(\d+)px\)/.exec(g);
    assert.ok(calc, "the floor must be box + horizontal chrome");
    assert.equal(Number(calc![1]), sidePadRem, "reserved padding must equal .mr-panel's");
    assert.equal(Number(calc![2]), borderPx, "reserved border must equal .mr-panel's");
  });

  test("the component feeds the SHIPPING geometry, not the size it asked for", () => {
    // `size` is a request; `orbitalGeometry` clamps it. Passing the prop would reserve 310px for a
    // box that draws at 376 — the original defect, restated one layer up.
    assert.match(PANEL, /--mr-orbital-box[\s\S]{0,120}orbitalGeometry\(/);
    assert.match(PANEL, /orbitalGeometry\(showOrbital \? 400 : 310\)\.size/);
    assert.match(PANEL, /className="mr-grid mr-grid-orbital"/);
  });

  test("both orbital states clamp to a box the reservation covers", () => {
    // Collapsed is clamped UP by the floor; expanded is already above it. Both must be reserved
    // for, because the grid re-lays out when the member hits expand.
    assert.equal(orbitalGeometry(310).size, MIN_ORBITAL_SIZE, "310 is below the floor");
    assert.equal(orbitalGeometry(400).size, 400, "400 is above it and must not be shrunk");
    assert.ok(orbitalGeometry(400).size > orbitalGeometry(310).size);
  });

  test("the reserved width really does clear the live measurement", () => {
    // 302.9px of content was measured on prod against a 376px box. The reservation is the box
    // itself, so the shortfall is closed by construction — this pins the size of what was wrong.
    const MEASURED_CONTENT_PX = 302.9;
    const box = orbitalGeometry(310).size;
    assert.ok(box > MEASURED_CONTENT_PX, "precondition: the old track really was too small");
    assert.ok(
      box - MEASURED_CONTENT_PX > 70,
      `the overflow was ${(box - MEASURED_CONTENT_PX).toFixed(2)}px — not a rounding error`
    );
  });

  test("the plain .mr-grid is untouched — Estimates and History keep their density", () => {
    // Only the grid that CONTAINS an orbital pays for one. A blanket change would have widened
    // every panel grid on the desk for a diagram most of them do not render.
    const base = rule(".mr-grid");
    assert.match(base, /minmax\(min\(100%, 20rem\), 1fr\)/, "the base floor is unchanged");
    assert.equal(base.includes("--mr-orbital-box"), false);
  });
});
