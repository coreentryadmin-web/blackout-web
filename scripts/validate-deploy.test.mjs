import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "validate-deploy.mjs"), "utf8");

test("validate-deploy Postgres catch block uses describeConnectError + isTransientAuditPgError, not bare e.message", () => {
  assert.match(src, /describeConnectError/);
  assert.match(src, /isTransientAuditPgError/);
  assert.match(src, /isStaleAuditDbAuthError/);
  // Guards against reintroducing the narrower helper + raw e.message pairing this PR replaced —
  // isPrivateDbUnreachableError alone missed "connection terminated" and similar proxy-drop
  // messages that isTransientAuditPgError (which already subsumes it) classifies correctly,
  // and e.message alone drops any detail carried only on e.cause.
  assert.equal(/isPrivateDbUnreachableError\(e\.message\)/.test(src), false);
});
