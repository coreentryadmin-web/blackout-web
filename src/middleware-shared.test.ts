import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { hasBearerToken } from "./middleware-shared";

function reqWithAuth(header: string | null): NextRequest {
  const headers = new Headers();
  if (header != null) headers.set("authorization", header);
  return new NextRequest("https://blackouttrades.com/api/whatever", { headers });
}

test("hasBearerToken: accepts a real-length Bearer token", () => {
  assert.equal(hasBearerToken(reqWithAuth("Bearer " + "x".repeat(30))), true);
});

test("hasBearerToken: rejects a missing authorization header", () => {
  assert.equal(hasBearerToken(reqWithAuth(null)), false);
});

test("hasBearerToken: rejects a non-Bearer scheme", () => {
  assert.equal(hasBearerToken(reqWithAuth("Basic " + "x".repeat(30))), false);
});

test("hasBearerToken: rejects a Bearer prefix with too-short a token (length gate)", () => {
  // "Bearer " is 7 chars; the >27 gate requires a real token, not just the scheme word or a stub.
  assert.equal(hasBearerToken(reqWithAuth("Bearer short")), false);
});

// DRIFT GUARD: middleware-clerk.ts used to compute its own local `hasBearerToken` inline
// (byte-identical logic to this file's exported function, which sat unused) instead of importing
// it — two copies of a security-relevant check with nothing forcing them to stay in sync if the
// threshold/prefix is ever tightened in one but not the other. It now imports and calls the shared
// function; this guard fails loudly if that inline duplicate is ever reintroduced.
test("DRIFT GUARD: middleware-clerk.ts imports hasBearerToken from middleware-shared instead of recomputing it inline", () => {
  const src = readFileSync(join(process.cwd(), "src/middleware-clerk.ts"), "utf8");
  assert.match(
    src,
    /import\s*\{[^}]*\bhasBearerToken\b[^}]*\}\s*from\s*"@\/middleware-shared"/,
    "middleware-clerk.ts must import hasBearerToken from @/middleware-shared"
  );
  assert.doesNotMatch(
    src,
    /const hasBearerToken\s*=/,
    "middleware-clerk.ts must not locally redefine hasBearerToken — call the shared function instead"
  );
});
