import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Every hostname in next.config.mjs's `remotePatterns` widens Next's `/_next/image`
// optimizer endpoint to accept that host's URLs from any caller, regardless of whether
// the app's own <Image> components ever reference it — pure attack surface (most
// concretely for image-processing CVEs like the AVIF RCE fixed in #4804,
// GHSA-2xp9-vwfh-vxw4) for zero product benefit if nothing in the app actually uses it.
// `images.unsplash.com` sat unused since the very first commit (Next.js starter
// boilerplate) until removed here. This guard keeps that class of drift from returning
// silently: any listed hostname must be referenced somewhere in `src/`.

// `host.replace(/\./g, "\\.")` alone only escapes dots — CodeQL correctly flagged it as
// incomplete: any other regex metacharacter in a hostname (`+`, `*`, `(`, etc.) would build
// an unintended pattern instead of matching it literally. Escape every metacharacter.
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collectFiles(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry) && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("next.config.mjs: every remotePatterns hostname is actually referenced somewhere in src/", () => {
  const configSrc = readFileSync("next.config.mjs", "utf8");
  const block = configSrc.match(/const remotePatterns = \[([\s\S]*?)\];/)?.[1] ?? "";
  const hostnames = [...block.matchAll(/hostname:\s*"([^"]+)"/g)].map((m) => m[1]);

  if (hostnames.length === 0) {
    assert.ok(true, "remotePatterns is empty — nothing to check");
    return;
  }

  const files = collectFiles("src");
  const combined = files.map((f) => readFileSync(f, "utf8")).join("\n");

  for (const host of hostnames) {
    assert.match(
      combined,
      new RegExp(escapeRegExp(host)),
      `remotePatterns lists "${host}" but nothing in src/ references it — dead attack surface, remove it or use it`
    );
  }
});
