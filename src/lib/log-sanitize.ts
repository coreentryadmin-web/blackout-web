/**
 * Strip newlines/control characters from a caller-supplied string before it reaches a log call —
 * otherwise a crafted value (a ticker, an OCC contract id, an email subject) could inject fake log
 * entries (CWE-117 / CodeQL "Log injection"). Truncated too, so a very long value can't blow out a
 * log line. Callers should pass the sanitized value as a separate structured arg rather than
 * interpolating it into the message string, so nothing tainted ever flows into the log format
 * itself.
 *
 * Extracted from src/lib/email/resend-client.ts's original file-local copy after the identical
 * pattern (a user-derived identifier logged alongside an error) was flagged by CodeQL a second
 * time, in src/app/api/market/option-contract-history/route.ts and its sibling
 * option-contract/route.ts — one shared helper instead of a third copy-paste.
 */
export function sanitizeForLog(value: string, maxLen = 200): string {
  return value.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ").slice(0, maxLen);
}
