/**
 * Regression guard for the 2026-08-27 Alerts relocation (member: "I don't think anyone right now
 * is using Alerts on Vector — we might as well remove it and just add a clickable icon next to
 * LIVE SESSION on the top and it gives us options"). Two things must hold:
 *
 *  1. `VectorAlertsPanel` (all alert-creation/list/notify logic) is UNCHANGED — this is a
 *     presentation/layout move, not a logic rewrite. Asserted by re-running the pre-existing
 *     structural expectations of that component's props/JSX contract.
 *  2. The panel is no longer mounted as a persistent block in `VectorPageShell`'s action rail —
 *     it is mounted inside `VectorAlertsBell`'s popover instead, wired to the exact same
 *     `alertRules`/`handleAddRule`/`handleToggleRule`/`handleRemoveRule`/`notifyEnabled`/
 *     `notifyPerm`/`handleToggleNotify` state the standalone panel used to receive.
 *
 * Does not render either component (no local render harness for this family — see
 * VectorChart-footer-labels.test.ts's precedent); asserts on source so a future edit can't
 * silently regress either property.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const bellSrc = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorAlertsBell.tsx"),
  "utf8"
);
const panelSrc = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorAlertsPanel.tsx"),
  "utf8"
);
const shellSrc = readFileSync(
  join(process.cwd(), "src/features/vector/components/VectorPageShell.tsx"),
  "utf8"
);

test("VectorAlertsBell: renders the unmodified VectorAlertsPanel inside its popover", () => {
  assert.match(bellSrc, /import \{ VectorAlertsPanel \} from "@\/features\/vector\/components\/VectorAlertsPanel"/);
  assert.match(bellSrc, /<VectorAlertsPanel\b/, "the bell must render the real panel, not a reimplementation");
  // Every prop the standalone panel used to receive must still reach it, unchanged, through the bell.
  for (const prop of ["ticker", "rules", "recent", "onAdd", "onToggle", "onRemove", "notifyEnabled", "notifyPermission", "onToggleNotify"]) {
    assert.match(
      bellSrc,
      new RegExp(`${prop}=\\{${prop}\\}`),
      `expected VectorAlertsBell to forward ${prop} to VectorAlertsPanel unchanged`
    );
  }
});

test("VectorAlertsBell: click-outside-to-close and Escape-to-close (popover, not a fixed panel)", () => {
  assert.match(bellSrc, /mousedown/, "expected a click-outside listener, same pattern as Select.tsx");
  assert.match(bellSrc, /useFocusTrap\(/, "expected the shared focus-trap hook for Escape + focus management");
  assert.match(bellSrc, /onEscape:\s*\(\)\s*=>\s*setOpen\(false\)/);
  assert.match(bellSrc, /lockScroll:\s*false/, "a small anchored popover must not freeze page scroll like a modal");
});

test("VectorAlertsPanel: alert-creation/list/notify logic untouched (presentation-only move)", () => {
  // These are the exact behavioral surfaces the operator's ask must NOT touch: the add form, the
  // rule list with toggle/remove, and the notify control. If any of these disappear, someone
  // rewrote logic instead of just relocating the container.
  assert.match(panelSrc, /const add = \(\) => \{/);
  assert.match(panelSrc, /onAdd\(kind, pct\)/);
  assert.match(panelSrc, /onClick=\{\(\) => onToggle\(r\.id\)\}/);
  assert.match(panelSrc, /onClick=\{\(\) => onRemove\(r\.id\)\}/);
  assert.match(panelSrc, /notifyBlocked = notifyPermission === "denied"/);
});

test("VectorPageShell: the standalone action rail no longer mounts a persistent VectorAlertsPanel", () => {
  assert.doesNotMatch(
    shellSrc,
    /import \{ VectorAlertsPanel \} from/,
    "VectorAlertsPanel should only be imported by VectorAlertsBell now, not mounted directly on the page"
  );
  assert.match(shellSrc, /import \{ VectorAlertsBell \} from "@\/features\/vector\/components\/VectorAlertsBell"/);
});

test("VectorPageShell: the bell sits next to the freshness chip, wired to the same alert state the old panel used", () => {
  assert.match(
    shellSrc,
    /const chartFreshnessWithAlerts =[\s\S]{0,400}<VectorAlertsBell/,
    "expected the bell to be grouped with chartFreshness"
  );
  const group = shellSrc.slice(shellSrc.indexOf("const chartFreshnessWithAlerts ="), shellSrc.indexOf("const embedRegimeSlot ="));
  for (const wiring of [
    "rules={alertRules}",
    "recent={recentAlerts}",
    "onAdd={handleAddRule}",
    "onToggle={handleToggleRule}",
    "onRemove={handleRemoveRule}",
    "notifyEnabled={notifyEnabled}",
    "notifyPermission={notifyPerm}",
    "onToggleNotify={handleToggleNotify}",
  ]) {
    assert.ok(group.includes(wiring), `expected ${wiring} in the bell's wiring (same state the old standalone panel used)`);
  }
});

test("VectorPageShell: the chartOnly SPX Slayer embed still gets no alerts UI (unchanged embed behavior)", () => {
  // The embed path passes the plain `chartFreshness` (chip only) as its trailSlot, never the
  // bell-augmented variant — matching its pre-existing "no panel, no terminal" embed contract.
  const chartOnlyBlock = shellSrc.slice(shellSrc.indexOf("if (chartOnly) {"), shellSrc.indexOf("const helixRail ="));
  assert.match(chartOnlyBlock, /trailSlot=\{chartFreshness\}/);
  assert.doesNotMatch(chartOnlyBlock, /chartFreshnessWithAlerts/);
});
