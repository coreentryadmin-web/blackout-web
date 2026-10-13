import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

// Regression for a live admin-UI bug (2026-10-12): the Operations → "Tool launch" grid picks
// its icon via `SIGIL_BY_KEY[tool.key]`, rendering nothing (`sigil ? <ProductMark/> : null`)
// when a tool's key is absent from the map — a silent blank slot, not a crash. Vector shipped
// with a complete, real sigil everywhere else in the app (ToolSigil/MarkProduct/MARK_ACCENT/
// MARK_GEOMETRY all already include "vector"), but this one admin lookup map was never
// extended when Vector launched, so it rendered with no icon in this specific panel. Source-
// text assertion (this repo's convention for "use client" components — no React Testing
// Library) rather than a render test.
//
// Meridian is deliberately NOT asserted here: unlike Vector, Meridian has no real sigil
// anywhere in the system yet (ToolSigil/MarkProduct/MARK_GEOMETRY were never extended with a
// "meridian" case at all, and tool-access.ts's TOOLS entry stubs `product: "largo"` to satisfy
// the type checker) — see the companion finding for that larger, design-decision-sized gap.
// Adding `meridian` to this map today would just swap a blank slot for the wrong icon.
test("AdminLaunchStatusPanel's icon map includes every tool that already has a real sigil", () => {
  const src = readFileSync(join(root, "src/components/admin/AdminLaunchStatusPanel.tsx"), "utf8");
  const match = src.match(/const SIGIL_BY_KEY: Record<string, ToolSigil> = \{([^}]*)\}/);
  assert.ok(match, "expected a SIGIL_BY_KEY map in AdminLaunchStatusPanel.tsx");
  for (const key of ["spx", "flows", "heatmap", "largo", "nighthawk", "vector"]) {
    assert.match(
      match![1],
      new RegExp(`\\b${key}\\s*:`),
      `SIGIL_BY_KEY is missing an entry for "${key}" — its tool-launch row will render no icon`
    );
  }
});
