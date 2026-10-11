import assert from "node:assert/strict";
import { test } from "node:test";
import { PRIMARY_NAV } from "./site-map.ts";
import { DESK_NAV_LINKS } from "@/lib/desk-nav-links.ts";
import { gettingStartedGuide } from "@/lib/learn/guides/getting-started.ts";

// Regression for a live content bug (2026-10-11): PRIMARY_NAV (rendered verbatim into the
// Getting Started guide's "Navigate the website" section) is a hand-maintained THIRD copy of
// the desk nav, independent of DESK_NAV_LINKS — the canonical source Nav.tsx/DeskSidebar.tsx
// both read from specifically to stop this exact drift (see desk-nav-links.ts's own doc
// comment). When Vector and Meridian shipped, DESK_NAV_LINKS was updated but PRIMARY_NAV (and
// the Getting Started guide's separate "Surfaces" pipeline list) were not — a guide member-
// facing orientation content was two products behind the live site nav. Asserting PRIMARY_NAV
// covers every DESK_NAV_LINKS label, rather than hardcoding "9" or similar, means this guard
// never goes stale itself and fires automatically the next time a product ships.

test("PRIMARY_NAV covers every desk in the canonical DESK_NAV_LINKS list", () => {
  const primaryLabels = new Set(PRIMARY_NAV.map((item) => item.label));
  for (const desk of DESK_NAV_LINKS) {
    assert.ok(primaryLabels.has(desk.label), `PRIMARY_NAV is missing "${desk.label}" (href ${desk.href})`);
  }
});

test("Getting Started guide's pipeline 'Surfaces' layer names every live desk, including ones launched after this list was first written", () => {
  const pipeline = gettingStartedGuide.sections.find((s) => s.type === "pipeline");
  assert.ok(pipeline && pipeline.type === "pipeline", "gettingStartedGuide must have a pipeline section");
  const surfaces = pipeline.layers.find((l) => l.layer === "Surfaces");
  assert.ok(surfaces, "pipeline must have a 'Surfaces' layer");
  // Checked directly against DESK_NAV_LINKS' own labels above (PRIMARY_NAV test); this layer
  // uses the shorter "Thermal" rather than "BlackOut Thermal" by pre-existing convention, so it
  // is checked by name here rather than against the canonical list verbatim.
  for (const label of ["SPX Slayer", "HELIX", "Thermal", "Night Hawk", "Largo", "Vector", "Meridian"]) {
    assert.ok(surfaces!.items.includes(label), `Surfaces layer is missing "${label}"`);
  }
});
