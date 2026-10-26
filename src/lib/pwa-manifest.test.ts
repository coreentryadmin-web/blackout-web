import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..", "..");
const MANIFEST_PATH = join(REPO, "public", "manifest.webmanifest");

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

function loadManifest(): { icons: ManifestIcon[] } {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
}

test("every manifest icon file actually exists under public/", () => {
  const { icons } = loadManifest();
  for (const icon of icons) {
    const abs = join(REPO, "public", icon.src.replace(/^\//, ""));
    assert.ok(existsSync(abs), `manifest icon ${icon.src} does not exist at ${abs}`);
  }
});

test("the maskable icon is a distinct file from the 'any' icon", () => {
  // A maskable icon must leave a safe-zone margin (content within the inner ~80%)
  // since the OS may crop it to a circle/squircle. Reusing an edge-to-edge "any"
  // icon as "maskable" gets its content clipped on platforms that apply that mask.
  const { icons } = loadManifest();
  const anyIcon = icons.find((i) => i.purpose === "any");
  const maskableIcon = icons.find((i) => i.purpose === "maskable");
  assert.ok(anyIcon, "manifest must declare an 'any' purpose icon");
  assert.ok(maskableIcon, "manifest must declare a 'maskable' purpose icon");
  assert.notEqual(
    maskableIcon!.src,
    anyIcon!.src,
    "the maskable icon must be a separately-padded file, not the same bitmap as the 'any' icon"
  );
});
