// Log-safe interpolation for values that came from a request.
//
// WHY THIS EXISTS: the Vector wall-persistence layer logs the ticker and session it failed on —
// which is the right thing to log, since those lines are how the wall-write observability lane is
// read. But `wallRailStorageId()` passes the ticker through unnormalized, so the value reaching the
// template literal is whatever the caller supplied, straight from a query parameter.
//
// A ticker containing a newline therefore FORGES LOG LINES: "AAPL" + newline + "[vector-wall-db]
// persist failed SPY:2026-08-16:" prints as two entries, the second indistinguishable from a real
// one. That is the whole of the "log injection" class — not a crash, but a log an operator can no
// longer trust, in exactly the logs used to decide whether persistence is healthy.
//
// The fix is deliberately at the LOG SITE rather than at the ticker's origin: normalizing the
// ticker upstream would also change Redis keys and DB rows (a behavioural change with its own blast
// radius), while this is purely presentational and cannot alter what gets stored or fetched.

/** Longest token we will print. Real tickers are <= ~12 chars; storage ids add a `::horizon` suffix. */
const MAX_LOG_TOKEN = 64;

/** C0 (NUL, TAB, LF, CR, ESC and friends) plus DEL and the C1 range.
 *
 *  Built from an escaped STRING, not a regex literal: a literal character class here would put real
 *  control bytes — including NUL — into this source file, which is unreadable and easily mangled by
 *  anything that rewrites raw bytes.
 *
 *  KNOWN TRADEOFF: `new RegExp(someString)` is opaque to CodeQL, so it cannot prove this function
 *  strips newlines and keeps reporting `js/log-injection` (MEDIUM) at each call site. Those alerts
 *  are accepted as analyser blind spots, NOT as unfixed bugs — the control-character removal is
 *  covered by log-token.test.ts, and the call sites are additionally guarded by
 *  vector-wall-log-safety.test.ts. The HIGH `js/format-string-injection` alerts are genuinely fixed,
 *  by keeping untrusted values out of console's argument 0 rather than by this regex. If someone
 *  later switches this to a `\u`-escaped regex LITERAL (same bytes, analyser-visible), the mediums
 *  should clear too — that is a safe change, provided no real control byte lands in the file. */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F]", "g");

/** What a control character renders as — visible, so tampering stays evident in the log. */
const REPLACEMENT = "�";

/**
 * Render an untrusted value as a single-line, bounded token safe to interpolate into a log message.
 *
 * - Control characters are REPLACED, so one value can never become two log lines or repaint a
 *   terminal via an ANSI escape.
 * - The result is length-capped, so a megabyte-long parameter cannot flood the log.
 * - Empty / null / undefined render as an explicit `<empty>` rather than vanishing, because a blank
 *   gap in `failed :2026-08-16:` reads as a formatting bug instead of as missing data.
 *
 * Non-strings are coerced with String() first, so a caller passing a number or object still gets a
 * bounded single-line token.
 */
export function logToken(value: unknown): string {
  if (value === null || value === undefined) return "<empty>";
  const raw = typeof value === "string" ? value : String(value);
  if (raw === "") return "<empty>";

  // Replace rather than strip: stripping a newline silently welds two fields into one
  // plausible-looking token ("SPY" + newline + "QQQ" -> "SPYQQQ"), which is its own kind of lie.
  const flattened = raw.replace(CONTROL_CHARS, REPLACEMENT);

  return flattened.length > MAX_LOG_TOKEN ? `${flattened.slice(0, MAX_LOG_TOKEN)}…` : flattened;
}
