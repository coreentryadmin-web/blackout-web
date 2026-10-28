import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const modalSrc = readFileSync(join(process.cwd(), "src/components/ui/Modal.tsx"), "utf8");
const globalsCss = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function extractModalZIndex(src: string): number {
  const match = src.match(/fixed inset-0 z-\[(\d+)\] flex/);
  assert.ok(match, "Modal.tsx: expected to find its root panel's z-[N] utility class");
  return Number(match![1]);
}

function extractNavBarZIndex(css: string): number {
  // `.nav-bar { @apply fixed top-0 inset-x-0 z-[N]; ... }` in globals.css.
  const match = css.match(/\.nav-bar\s*\{\s*@apply[^}]*z-\[(\d+)\]/);
  assert.ok(match, "globals.css: expected to find .nav-bar's z-[N] utility class");
  return Number(match![1]);
}

test("Modal portals strictly above .nav-bar, not merely tied with it", () => {
  const modalZ = extractModalZIndex(modalSrc);
  const navZ = extractNavBarZIndex(globalsCss);
  assert.ok(
    modalZ > navZ,
    `Modal (z-${modalZ}) must render strictly above .nav-bar (z-${navZ}) — an equal value ` +
      "relies on DOM append order (this portal mounting to document.body after the already-" +
      "hydrated nav) rather than an explicit stacking guarantee, and would silently invert if " +
      "the nav were ever restructured to mount/portal later."
  );
});

test("Modal's root portal mounts to document.body (the DOM-order premise the z-index margin assumes)", () => {
  const portalCallIdx = modalSrc.indexOf("createPortal(");
  const targetIdx = modalSrc.indexOf("document.body", portalCallIdx);
  const drawerExportIdx = modalSrc.indexOf("export function Drawer");
  assert.ok(portalCallIdx >= 0, "expected a createPortal( call in Modal.tsx");
  assert.ok(
    targetIdx > portalCallIdx && targetIdx < drawerExportIdx,
    "expected createPortal's target argument to be document.body, inside the Modal component"
  );
});
