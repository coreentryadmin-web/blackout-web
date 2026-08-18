import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Guard for a CSS rule that is easy to write and silently catastrophic.
 *
 * `font-family: var(--font-inter), system-ui, sans-serif` LOOKS like it has fallbacks. It does
 * not. When `--font-inter` is undefined the whole DECLARATION is invalid at computed-value time,
 * and the comma-list that sits OUTSIDE the `var()` never gets a chance to apply — the element
 * falls back to the browser's initial font-family, which is a SERIF.
 *
 * That is exactly what shipped: `--font-inter` was never injected (layout.tsx supplies only
 * anton, syne and jetbrains), so `body` rendered the entire product in Times. Reported as
 * "everything looks like a book". The fix is to move the fallbacks INSIDE:
 * `var(--font-inter, system-ui, sans-serif)`.
 *
 * This test also catches the second half of the same bug — a custom property that no stylesheet
 * and no layout ever defines.
 */

const APP_DIR = path.join(process.cwd(), "src", "app");
const cssFiles = fs
  .readdirSync(APP_DIR)
  .filter((f) => f.endsWith(".css"))
  .map((f) => path.join(APP_DIR, f));

/** Comments describe the bug being guarded against; scanning them reports it as still present. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("css: no font-family puts its fallbacks OUTSIDE var()", () => {
  const offenders: string[] = [];
  for (const file of cssFiles) {
    const css = stripComments(fs.readFileSync(file, "utf8"));
    css.split("\n").forEach((line, i) => {
      // `var(--x)` with no comma inside, followed by a comma-list outside it.
      if (/font-family:\s*var\(--[a-z-]+\)\s*,/.test(line)) {
        offenders.push(`${path.basename(file)}:${i + 1} — ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `fallbacks must live INSIDE var(), or an undefined property drops the element to serif:\n${offenders.join("\n")}`
  );
});

test("css: every font custom property referenced is actually defined somewhere", () => {
  const layout = fs.readFileSync(path.join(APP_DIR, "layout.tsx"), "utf8");
  const allCss = cssFiles.map((f) => stripComments(fs.readFileSync(f, "utf8"))).join("\n");

  const referenced = new Set<string>();
  for (const m of allCss.matchAll(/var\((--font-[a-z-]+)/g)) referenced.add(m[1]!);

  const undefinedRefs: string[] = [];
  for (const name of referenced) {
    // Defined by next/font (`variable: "--font-x"`) or declared in CSS (`--font-x:`).
    const injected = layout.includes(`"${name}"`) || layout.includes(`'${name}'`);
    const declared = new RegExp(`${name}\\s*:`).test(allCss);
    if (!injected && !declared) undefinedRefs.push(name);
  }
  assert.deepEqual(
    undefinedRefs,
    [],
    `these font variables are referenced but never defined — each one renders as the browser default: ${undefinedRefs.join(", ")}`
  );
});
