/**
 * Escape a caller-supplied string before it reaches a log call — otherwise a crafted value (a
 * ticker, an OCC contract id, an email subject) could inject fake log entries (CWE-117 / CodeQL
 * "Log injection"). Truncated first, so a very long value can't blow out a log line, then
 * `JSON.stringify`'d: this is the fix CodeQL's own `js/log-injection` query documents and
 * recognizes as a sanitizing step (a custom regex `.replace()` is NOT recognized — CodeQL's taint
 * tracking doesn't reason about whether a regex actually strips every dangerous character, so a
 * first version of this helper that did `value.replace(/[\r\n\t\x00-\x1f\x7f]/g, " ")` kept
 * re-triggering the SAME alert on every call site after the "fix" landed). `JSON.stringify`
 * escapes `\r`/`\n`/other control characters to their literal `\r`/`\n` two-character sequences —
 * a forged newline can no longer start a fake new log line — and the surrounding quotes make clear
 * in the log output that this is an escaped, caller-supplied value, not a fixed string. Callers
 * should pass the result as a separate structured arg rather than interpolating it into the
 * message string, so nothing tainted ever flows into the log format itself.
 *
 * Extracted from src/lib/email/resend-client.ts's original file-local copy after the identical
 * pattern (a user-derived identifier logged alongside an error) was flagged by CodeQL a second
 * time, in src/app/api/market/option-contract-history/route.ts and its sibling
 * option-contract/route.ts — one shared helper instead of a third copy-paste.
 */
export function sanitizeForLog(value: string, maxLen = 200): string {
  return JSON.stringify(value.slice(0, maxLen));
}
