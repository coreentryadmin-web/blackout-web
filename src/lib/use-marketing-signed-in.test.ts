import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("marketing signed-in hook verifies session via /api/auth/me", () => {
  const hook = readFileSync(join(root, "src/lib/use-marketing-signed-in.ts"), "utf8");
  const nav = readFileSync(join(root, "src/components/landing/NavAuthLinks.tsx"), "utf8");
  assert.match(hook, /\/api\/auth\/me/);
  assert.match(hook, /data\.signedIn === false/);
  assert.match(nav, /useMarketingSignedIn/);
});

test("initial state matches the server's guess exactly — a React #418 hydration-mismatch regression guard", () => {
  // The homepage/marketing pages are ISR (revalidate=3600, no per-request cookie access), so the
  // very first client render MUST equal `serverSignedIn` — any client-only read (e.g. reaching
  // into document.cookie via a useState lazy initializer) during that first render diverges from
  // the cached server HTML and React throws "Hydration failed" (#418), caught by the marketing
  // error boundary. Reproduced live 2026-09-01 on blackouttrades.com/ for every authenticated
  // session; see the fix commit and use-marketing-signed-in.ts's own top-of-function comment.
  const hook = readFileSync(join(root, "src/lib/use-marketing-signed-in.ts"), "utf8");
  assert.match(
    hook,
    /useState\(\s*serverSignedIn\s*\)/,
    "useState's initial value must be serverSignedIn verbatim, not a function that reads " +
      "document.cookie (resolveClientSignedIn/readClientSignedIn) during the hydration render"
  );
});
