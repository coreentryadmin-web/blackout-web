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

function redactJsonCredentialFields(body: string): string {
  let out = body;
  for (const key of JSON_CREDENTIAL_KEYS) {
    const re = new RegExp(`("${key}"\\s*:\\s*")[^"]*(")`, "gi");
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
      /("(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|key)"\s*:\s*")[^"]*(")/gi,
      "$1[REDACTED]$2"
    )
    .replace(
      /('(?:api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|passwd|client[_-]?secret|key)'\s*:\s*')[^']*(')/gi,
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
