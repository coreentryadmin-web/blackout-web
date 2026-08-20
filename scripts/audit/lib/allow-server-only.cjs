/**
 * Preload shim that lets an AUDIT HARNESS import production server modules outside Next.
 *
 * `import "server-only"` exists to make `next build` fail when a Client Component pulls in a
 * server module. That guard is doing its job — `scripts/audit/client-server-boundary.mjs` exists
 * to keep it working, and nothing here weakens it. But it also means a plain `node` process cannot
 * import, say, `src/lib/largo/run-tool.ts`, which is exactly what an audit needs to do to inspect
 * what the model actually receives.
 *
 * Scope: preload only (`node --require ./scripts/audit/lib/allow-server-only.cjs`). It is never
 * imported by application code, never bundled, and has no effect on `next build`. Resolving these
 * two specifiers to an empty object is precisely what the Next runtime does on the server.
 */
const Module = require("module");

const NEUTRALIZED = new Set(["server-only", "client-only"]);
const load = Module._load;

Module._load = function (request, ...rest) {
  if (NEUTRALIZED.has(request)) return {};
  return load.call(this, request, ...rest);
};
