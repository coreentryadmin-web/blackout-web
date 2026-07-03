// Pure validation/shaping for the public client-error beacon
// (src/app/api/telemetry/client-error/route.ts). Kept separate from the route
// so it's unit-testable without spinning up a NextRequest.

export const MAX_BODY_BYTES = 8_000;
export const MAX_FIELD_LEN = 4_000;

export type ClientErrorBody = {
  message?: unknown;
  stack?: unknown;
  name?: unknown;
  url?: unknown;
};

export type ValidatedClientError = {
  message: string;
  stack: string | null;
  name: string;
  scope: string | null;
};

export function clampString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Path-only, always — strips origin AND query/hash server-side. This is a
 *  PUBLIC unauthenticated endpoint: the well-behaved client reporter already
 *  sends a bare path, but a direct POST (compromised script, curl, a modified
 *  client) could send a full URL carrying a secret in the query string (e.g.
 *  `?token=...`). `scope` becomes a discovery-report grouping key that later
 *  gets embedded into BIE's knowledge store — a leaked secret there would be
 *  both admin-visible AND retrievable via RAG. Never trust the client for this. */
function toPathOnly(v: string): string {
  let s = v;
  const schemeIdx = s.indexOf("://");
  if (schemeIdx !== -1) {
    const afterOrigin = s.indexOf("/", schemeIdx + 3);
    s = afterOrigin === -1 ? "/" : s.slice(afterOrigin);
  }
  const cut = Math.min(...[s.indexOf("?"), s.indexOf("#")].filter((i) => i !== -1).concat(s.length));
  return s.slice(0, cut);
}

/** Returns null when the body has no usable message — caller responds 400. */
export function validateClientErrorBody(body: ClientErrorBody): ValidatedClientError | null {
  const message = clampString(body.message, MAX_FIELD_LEN);
  if (!message) return null;
  const rawUrl = clampString(body.url, 300);
  return {
    message,
    stack: clampString(body.stack, MAX_FIELD_LEN),
    name: clampString(body.name, 200) ?? "Error",
    scope: rawUrl ? toPathOnly(rawUrl) || null : null,
  };
}
