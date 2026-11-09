> **kind:** FINDING

## `sanitizeFeedText` stringified objects/arrays to literal "[object Object]" / "1,2,3" instead of blanking them — FIXED

### Status
| **Status** | FIXED (PR pending) |
|---|---|

### Root cause
`src/lib/largo/sanitize-feed-text.ts`'s `sanitizeFeedText(s: unknown): string` coerced its input
unconditionally via `String(s ?? "")`. That is total for the inputs its own doc comment names
(news titles/teasers/headlines/snippets) only as long as every caller actually hands it a string.
Several direct call sites do not guarantee that — the function's own signature is `unknown`
precisely because callers pass raw provider/tool-result fields whose shape is not statically
known:

- `src/lib/largo/largo-live-feed.ts:735` — `` `- ${headline(o)}${o.teaser ? ` — ${sanitizeFeedText(o.teaser).slice(0, 120)}` : ""}` `` calls `sanitizeFeedText(o.teaser)` directly, with no type guard, where `o` is an `asObj(a)` cast of an untrusted news-article row.
- `src/lib/largo/run-tool.ts:315-324,969-971` — calls `sanitizeFeedText(a.title)` / `sanitizeFeedText(a.teaser || a.body.slice(0, 280))` / `sanitizeFeedText(r.snippet)` etc. directly on fields of externally-sourced rows (news/search results), also with no guard.

Contrast this with the one call site in the SAME file that got it right —
`largo-live-feed.ts:789-790` guards with `typeof play.headline === "string" ? sanitizeFeedText(play.headline) : play.headline` — proving the inconsistency is real: some call sites assumed the
function was already safe for non-strings, others didn't trust it and added their own guard.

The gap was already discovered and worked around once, on a sibling desk, and explicitly flagged
as unresolved here: `src/lib/meridian/meridian-feed-text.ts`'s own doc comment says verbatim
*"NON-STRINGS ARE DROPPED, NOT STRINGIFIED. `sanitizeFeedText` does `String(s ?? "")`, so a
malformed feed row whose `title` arrived as an object yields the literal text "[object Object]" —
a string a panel would happily render as a headline. Caught by the test below, not by reading the
code. **The same hole exists on the Largo side; flagged there rather than edited from this
lane.**"* Meridian's fix was to wrap every call behind its own `meridianFeedText()`, which checks
`typeof value !== "string"` before ever calling `sanitizeFeedText`. That wrapper is Meridian-only;
the shared function itself — and therefore every Largo-side caller that doesn't add its own guard
— stayed exposed.

### Evidence (RED -> GREEN)
Before the fix, direct calls to the unguarded function:
```
sanitizeFeedText({ title: "x" })  -> "[object Object]"
sanitizeFeedText([1, 2, 3])        -> "1,2,3"
sanitizeFeedText(42)               -> "42"   (intentional, unchanged)
```
`meridian-feed-text.ts`'s own test suite (`describe("the boundary is total...")`) already encodes
the correct behavior for its wrapper and passes today precisely because the wrapper, not the
shared function, does the type check — i.e. the shared function was never actually exercised with
an object input by the existing suite before this fix.

After the fix (`src/lib/largo/sanitize-feed-text.ts`):
```
sanitizeFeedText({ title: "x" })  -> ""
sanitizeFeedText([1, 2, 3])        -> ""
sanitizeFeedText(42)               -> "42"   (unchanged, still unit-tested)
```
New regression tests added to `src/lib/largo/sanitize-feed-text.test.ts`:
- `"a plain object never stringifies to the literal '[object Object]'"`
- `"an array never stringifies to a comma-joined list"`

Full targeted run (`sanitize-feed-text.test.ts` + `meridian-feed-text.test.ts`, which exercises
the same decoder transitively): 27/27 pass. `tsc --noEmit` clean on the touched files.

### Blast radius
Every current caller of `sanitizeFeedText` benefits from the hardened contract, including the
ones that already individually guard (no behavior change for those) and the ones that didn't:
`largo-live-feed.ts` (news teaser line + two other calls), `run-tool.ts` (news/search-result
title/teaser/snippet calls — excluded from this round's edit scope, not touched), `spx-desk.ts`,
`edition-builder.ts`, `format.ts` (nighthawk), `meridian-feed-text.ts`'s own delegate call, and
`bie/ecosystem-context.ts`. None of these call sites were edited — the fix is entirely inside the
shared function, so it closes the gap for all of them at once without touching any
excluded-lane file (`run-tool.ts` is confirmed excluded per the round's hard-exclusion list and
was correctly left untouched; it still benefits because it imports the now-hardened function).

### Fix rationale
Hardening the shared function (rather than adding a guard at each call site, or editing the
excluded `run-tool.ts`) is the fix `meridian-feed-text.ts`'s own comment explicitly asked for
("flagged there rather than edited from this lane"), and it is strictly additive: the only
behavior change is for non-null `typeof === "object"` inputs (plain objects and arrays), which
previously had no meaningful rendering anyway ("[object Object]" / a comma-joined list are not
real headline text under any interpretation). The pre-existing, explicitly unit-tested primitive
coercion (`sanitizeFeedText(42) -> "42"`, `sanitizeFeedText(true) -> "true"`) is left unchanged,
so no existing caller that relies on numeric/boolean coercion is affected. Deliberately left
unchanged: `meridian-feed-text.ts`'s own wrapper and its `typeof` guard — it stays as defense in
depth and its own test suite continues to document the "boundary is total" guarantee at that
layer too; removing it was out of scope and not necessary for this fix.
