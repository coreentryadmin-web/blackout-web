import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MV_LADDER_MIN_GAP,
  pctAlong,
  priceDomain,
  resolveCollisions,
  structureLadder,
  wallInversionNote,
} from "./meridian-viz-core";
import { coerceMeridianWallLevels } from "./meridian-earnings-intel-core";

const root = process.cwd();
const CSS = readFileSync(join(root, "src/app/desk-app.css"), "utf8");
const VIZ = readFileSync(join(root, "src/features/meridian/components/meridian-viz.tsx"), "utf8");

/**
 * A COERCED ORDER PRESENTED AS A MEASURED ONE.
 *
 * `coerceMeridianWallLevels` defines the walls as argmax/argmin of net GEX and remaps them to
 * [min, max] when they invert, so the panel can render a "support – resistance" band. It records
 * that it did so in `walls_inverted`, preserves the raw strikes in `gamma_call_wall` /
 * `gamma_put_wall` — and until now NO component read any of the three.
 *
 * MEASURED ON PROD 2026-08-21, BNS (+4d), from /api/market/meridian/event:
 *   raw gamma call wall 85 · raw gamma put wall 87.5 · spot 87.57
 *   displayed as  put 85 … call 87.5
 * So the most-NEGATIVE-gamma strike sat within 0.08 of spot and was rendered as resistance,
 * which inverts the trading implication. 1 of 14 high-impact names inverted in that sweep.
 */
const BNS = { gamma_call_wall: 85, gamma_put_wall: 87.5, spot: 87.57 };

describe("the live BNS case", () => {
  test("the coercion still happens and still reports itself — precondition", () => {
    const w = coerceMeridianWallLevels({ call_wall: 85, put_wall: 87.5, spot: 87.57 });
    assert.equal(w.walls_inverted, true);
    assert.equal(w.call_wall, 87.5, "display resistance is the HIGHER strike");
    assert.equal(w.put_wall, 85, "…which is not what the gamma argmax said");
    assert.equal(w.gamma_call_wall, 85, "the raw argmax survives the coercion");
    assert.equal(w.gamma_put_wall, 87.5);
  });

  test("only the two wall rows are marked — every other level is its own measured strike", () => {
    const levels = structureLadder({
      spot: 87.57, call_wall: 87.5, put_wall: 85, flip: 86, gex_king_strike: 88, max_pain: 86.5,
      walls_inverted: true, ...BNS,
    });
    const marked = levels.filter((l) => l.inverted).map((l) => l.key).sort();
    assert.deepEqual(marked, ["call_wall", "put_wall"]);
    for (const l of levels) {
      if (l.key !== "call_wall" && l.key !== "put_wall") {
        assert.equal(l.inverted, false, `${l.key} must not be marked — its position is its value`);
      }
    }
  });

  test("nothing is marked when the walls are in their measured order", () => {
    const levels = structureLadder({
      spot: 96.42, call_wall: 95, put_wall: 90, flip: 92, gex_king_strike: 95, max_pain: 93,
      walls_inverted: false, gamma_call_wall: 95, gamma_put_wall: 90,
    });
    assert.equal(levels.some((l) => l.inverted), false);
    assert.equal(wallInversionNote({ walls_inverted: false, gamma_call_wall: 95, gamma_put_wall: 90 }), null);
  });

  test("a caller that says nothing about inversion gets no claim either way", () => {
    // Silence must not read as "not inverted, we checked". It reads as unmarked, same as before.
    const levels = structureLadder({ spot: 10, call_wall: 12, put_wall: 8, flip: 9, gex_king_strike: 11, max_pain: 10.5 });
    assert.equal(levels.some((l) => l.inverted), false);
    assert.equal(wallInversionNote(null), null);
    assert.equal(wallInversionNote(undefined), null);
    assert.equal(wallInversionNote({}), null);
  });
});

describe("the note names the real structure, or says nothing", () => {
  test("it quotes both raw gamma strikes", () => {
    const note = wallInversionNote({ walls_inverted: true, ...BNS });
    assert.ok(note, "an inverted ladder must carry a note");
    assert.match(note!, /most positive net GEX at 85/);
    assert.match(note!, /most negative at 87\.5/);
    assert.match(note!, /ordered for display/);
  });

  test("no raw strikes, no note — a warning that cannot say what is true is noise", () => {
    assert.equal(wallInversionNote({ walls_inverted: true, gamma_call_wall: null, gamma_put_wall: 87.5 }), null);
    assert.equal(wallInversionNote({ walls_inverted: true, gamma_call_wall: 85, gamma_put_wall: null }), null);
    assert.equal(wallInversionNote({ walls_inverted: true }), null);
  });
});

describe("the note clears the ladder's own overflow", () => {
  test("the bottom row really does escape .mv-ladder — computed, not assumed", () => {
    // Recomputed from the SHIPPING layout functions, so a change to MV_LADDER_MIN_GAP or to the
    // row height is caught here rather than on a member's screen.
    const levels = structureLadder({
      spot: 87.57, call_wall: 87.5, put_wall: 85, flip: 86, gex_king_strike: 88, max_pain: 86.5,
      walls_inverted: true, ...BNS,
    });
    const domain = priceDomain(levels.map((l) => l.value));
    assert.ok(domain);
    const placed = resolveCollisions(
      levels.map((l) => 1 - (pctAlong(l.value, domain!) ?? 0)),
      MV_LADDER_MIN_GAP
    );
    const boxPx = Number(/\.mv-ladder \{[^}]*min-height:\s*(\d+)px/.exec(CSS)?.[1]);
    const rowPx = Number(/--mv-ladder-row-h:\s*(\d+)px/.exec(CSS)?.[1]);
    assert.ok(boxPx > 0 && rowPx > 0, "the ladder's box and row height must still be declared in px");
    const overflowPx = Math.max(...placed) * boxPx + rowPx - boxPx;
    assert.ok(overflowPx > 0, "precondition: the lowest row does overflow the box");

    const marginRem = Number(/\.mv-note-inverted \{[^}]*margin-top:\s*([\d.]+)rem/.exec(CSS)?.[1]);
    assert.ok(marginRem > 0, ".mv-note-inverted must declare its own clearance");
    assert.ok(
      marginRem * 16 > overflowPx,
      `note margin ${marginRem * 16}px must clear the ${overflowPx.toFixed(1)}px overflow`
    );
  });
});

describe("the marker is actually rendered, and reaches a screen reader", () => {
  test("the row carries a visible mark and the note is rendered", () => {
    assert.match(VIZ, /wallInversionNote\(thermal\)/);
    assert.match(VIZ, /l\.inverted && \(/, "the row mark is conditional on the level, not the panel");
    assert.match(VIZ, /className="mv-ladder-inverted"/);
    assert.match(VIZ, /className="mv-note mv-note-inverted"/);
  });

  test("the mark is not sighted-only — the aria-label says it too", () => {
    // An `abbr` with a title is invisible to a screen reader reading the button's aria-label,
    // which REPLACES the content. Without this the caveat would reach only a mouse user.
    assert.match(VIZ, /l\.inverted \? ", display order coerced because the gamma walls are inverted" : ""/);
  });
});
