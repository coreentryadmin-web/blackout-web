# API telemetry redaction partially leaks credentials that contain an escaped quote

> **kind:** FINDING

## Root cause

`src/lib/api-telemetry-sanitize.ts` redacts credential values embedded as JSON object fields
(`{"api_key":"...","token":"...","password":"...",...}`) inside outbound request bodies and
response snippets before they are persisted to telemetry, streamed over SSE, or rendered in the
admin "API event detail" panel (`AdminApiEventDetail.tsx`).

Three regexes did this by matching the field name, then consuming the value with a bare
negated-character-class `[^"]*` (or `[^']*` for the single-quote variant) up to the next quote
character:

- `redactJsonCredentialFields` (used by the exported `sanitizeTelemetryBody`):
  `` `("${key}"\s*:\s*")[^"]*(")` ``
- `sanitizeTelemetrySnippet`'s double-quoted-key pattern: `("...")[^"]*(")"`
- `sanitizeTelemetrySnippet`'s single-quoted-key pattern: `('...')[^']*(')`

`[^"]*` stops at the **first** `"` it encounters. Inside a JSON string, a literal double quote
that is part of the value is always serialized as an **escaped** quote, `\"` — two characters,
backslash then quote — not a bare `"`. The regex has no concept of that escape: it treats the `"`
half of `\"` as the real closing delimiter, so only the portion of the secret **before** that
escaped quote gets redacted. Everything from the escaped quote to the TRUE closing quote survives
in the output, in plaintext.

## Evidence

Reproduced directly against the shipped (pre-fix) code:

```
$ node -e '
const key = "api_key";
const re = new RegExp(`("${key}"\s*:\s*")[^"]*(")`, "gi");
const body = String.raw`{"api_key":"sk-abc\"def-secret-tail"}`;
console.log(body.replace(re, "$1[REDACTED]$2"));
'
{"api_key":"[REDACTED]"def-secret-tail"}
```

The tail of the real secret, `def-secret-tail`, is emitted verbatim right after the `[REDACTED]`
placeholder — i.e. the redaction function's own output still contains most of the original
credential. The same shape of input against `sanitizeTelemetrySnippet`'s double- and
single-quoted patterns reproduces identically (see the new regression tests in
`src/lib/api-telemetry-sanitize.test.ts`, which fail 4/7 against the pre-fix code and pass 7/7
after the fix — confirmed via `git stash`/`git stash pop`).

A credential value containing a literal quote character is not exotic: `password` is one of the
matched keys, and a real user-chosen password routinely contains `"` (or `'` for the single-quote
pattern) — exactly the shape this code exists to protect.

## Blast radius

`sanitizeTelemetryBody`/`sanitizeTelemetrySnippet` are the shared redaction layer for the whole
API-telemetry pipeline, not a single call site:

- `src/lib/api-tracked-fetch.ts` — wraps every tracked outbound `fetch()` call; request bodies and
  response snippets pass through this sanitizer before being recorded.
- `src/lib/api-telemetry-persist.ts` — persists the (supposedly) sanitized body/snippet to the DB.
- `src/lib/api-telemetry.ts` — the in-memory ring buffer / SSE stream consumed by the admin panel.
- `src/lib/error-sink.ts` — error reporting that reuses the same sanitizer.
- `src/components/admin/AdminApiEventDetail.tsx` — renders the (supposedly) sanitized snippet to
  any admin viewing the API event detail panel.

Any of these paths carrying a request/response body whose credential value contains an escaped
quote would leak part of that credential into a DB row, an SSE payload, and the admin UI — the
exact three destinations this file's own doc comment says a secret must never reach.

## Fix rationale

Replaced the naive `[^"]*` / `[^']*` value-consumption with the standard JSON-string-body
alternation `(?:[^"\\]|\\.)*` (and the single-quote analogue `(?:[^'\\]|\\.)*`): at each position,
either consume one character that is neither the delimiter nor a backslash, or consume a
backslash together with whatever follows it (the escape pair, including `\"`/`\'`), as one unit.
This correctly walks past an escaped delimiter instead of treating it as the terminator, while
still stopping at the true, unescaped closing quote. Extracted the double-quote version into a
shared `JSON_STRING_VALUE_BODY` pattern string reused by `redactJsonCredentialFields`, and inlined
the equivalent at the two `sanitizeTelemetrySnippet` call sites (one double-quoted, one
single-quoted) since they're plain regex literals, not a `new RegExp(...)` template.

Deliberately left unchanged: the bare-quote-free value matchers (`key=VALUE` query-string style,
`Bearer TOKEN`, JWT-shape) — none of those have a quote-delimited value, so none share this
vulnerability shape.

| **Status** | Fixed |
|---|---|
| **PR** | fix/telemetry-sanitize-quote-escape |
| **Author** | Claude Sonnet 5 |
