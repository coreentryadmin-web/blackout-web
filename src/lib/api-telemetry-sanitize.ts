/** Client-safe URL/body/header redaction for API telemetry display and persist. */

function sanitizeUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of ["apiKey", "token", "apikey", "key"]) {
      if (u.searchParams.has(key)) u.searchParams.set(key, "[REDACTED]");
    }
    return u.toString();
  } catch {
    return url
      .replace(/apiKey=[^&]+/gi, "apiKey=[REDACTED]")
      .replace(/token=[^&]+/gi, "token=[REDACTED]")
      .replace(/([?&]key=)[^&]+/gi, "$1[REDACTED]");
  }
}

/**
 * Header names that carry credentials and must not be persisted in telemetry.
 * The names are matched case-insensitively.
 */
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-blackout-key",
  "x-engine-secret",
  "x-api-key",
  "cookie",
  "set-cookie",
]);

/**
 * Returns only the header *names* that are safe to log, stripping any header
 * whose name appears in SENSITIVE_HEADERS.
 */
export function sanitizeHeaderNames(headers: string[]): string[] {
  return headers.filter((h) => !SENSITIVE_HEADERS.has(h.toLowerCase()));
}

export function sanitizeTelemetryUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return sanitizeUrl(url);
}

/**
 * Credential field names appearing as JSON object keys in request bodies (e.g.
 * Tavily POST {"api_key":"..."}). Matched case-insensitively. The VALUE is always
 * replaced with [REDACTED]; the raw secret is never emitted.
 */
const JSON_CREDENTIAL_KEYS = [
  "api_key",
  "apikey",
  "access_token",
  "accessToken",
  "token",
  "secret",
  "password",
];

// Matches a JSON string's VALUE body up to its TRUE closing quote.
//
// ROOT CAUSE this guards against: the previous pattern used a bare `[^"]*` to consume the value,
// which treats the FIRST `"` it meets as the closing delimiter — including an ESCAPED quote
// (`\"`) that is still inside the JSON string. A credential value containing a literal `"`
// (serialized as `\"`, e.g. a password the user chose, or any secret that happens to embed one)
// therefore only had its PREFIX up to that `\"` redacted; everything after the escaped quote and
// before the real closing `"` was emitted verbatim — a partial credential leak into persisted
// telemetry, the SSE stream and the admin UI. e.g. `{"api_key":"sk-abc\"def-tail"}` redacted to
// `{"api_key":"[REDACTED]"def-tail"}`, leaking `def-tail`. Fixed by the classic
// "any non-quote/non-backslash char, OR a backslash followed by any char" alternation, which
// correctly consumes the escape pair instead of treating its `"` half as the terminator.
const JSON_STRING_VALUE_BODY = '(?:[^"\\\\]|\\\\.)*';

function redactJsonCredentialFields(body: string): string {
  let out = body;
  for (const key of JSON_CREDENTIAL_KEYS) {
    const re = new RegExp(`("${key}"\\s*:\\s*")${JSON_STRING_VALUE_BODY}(")`, "gi");
    out = out.replace(re, "$1[REDACTED]$2");
  }
  return out;
}

export function sanitizeTelemetryBody(body: string | null | undefined): string | null {
  if (!body) return null;
  return redactJsonCredentialFields(
    body
      .replace(/apiKey=[^&\s"']+/gi, "apiKey=[REDACTED]")
      .replace(/token=[^&\s"']+/gi, "token=[REDACTED]")
      .replace(/([?&]key=)[^&\s"']+/gi, "$1[REDACTED]")
  );
}

/**
 * Redacts secret-bearing patterns from an arbitrary response body snippet before it
 * is stored in the ring buffer, streamed over SSE, persisted, or rendered in the admin
 * UI. Matches PATTERNS and replaces the VALUE with a fixed placeholder; never
 * logs/returns the original secret. Pure + alias-free.
 */
export function sanitizeTelemetrySnippet(snippet: string | null | undefined): string | null {
  if (!snippet) return null;
  return snippet
    .replace(
      /("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|key)"\s*:\s*")(?:[^"\\]|\\.)*(")/gi,
      "$1[REDACTED]$2"
    )
    .replace(
      /('(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|key)'\s*:\s*')(?:[^'\\]|\\.)*(')/gi,
      "$1[REDACTED]$2"
    )
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|key)=[^&\s"']+/gi,
      "$1=[REDACTED]"
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED]");
}

export function sanitizeUrlForTelemetry(url: string): string {
  return sanitizeUrl(url);
}

export const sanitizeTrackedFetchUrl = sanitizeUrlForTelemetry;
