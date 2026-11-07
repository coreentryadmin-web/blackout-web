> **kind:** FINDING

## `isTimelinePostAllowed` — a cold @tag riding the SAME line as the trusted self-tag footer bypassed the anti-spam check — FIXED

| | |
|---|---|
| **Area** | `src/lib/x-feed-policy.ts`'s `isTimelinePostAllowed()` — the shared gate that rejects original X/Twitter timeline posts that @tag another account (the module's own header: "NEVER post '@someone ...' as an original tweet on our profile"). Called from `x-post-guard.ts`, `x-content-humanize.ts`, and `x-api.ts` (both post call sites) — every original desk post goes through this one function. |
| **Status** | FIXED |

### Root cause

The per-line scan (added 2026-09-?? to catch a mention hidden past line 1, per the module's own
comment above it) exempted the self-tag footer with a whole-**line** check:

```ts
if (/(?:^|\s)@\w{2,}/.test(line) && !line.includes("@BlackOutTrade")) {
  return false;
}
```

`line.includes("@BlackOutTrade")` is true the moment the trusted footer's self-tag appears
*anywhere* on that line — it says nothing about whether a SECOND, different mention also appears
on the same line. So a line carrying both the self-tag and a cold @tag of another account —
`"@BlackOutTrade and @someone else"` — short-circuited the whole line as exempt and never
separately inspected `@someone`. The exact spam pattern this function exists to reject (tagging
another account on an original post) reached the timeline uncaught whenever it happened to share
a line with the footer.

### Evidence

Minimal repro, run against the UNFIXED source:

```js
isTimelinePostAllowed("Check this out\n@BlackOutTrade and @someone else")
// => true  (should be false — it @tags @someone)

isTimelinePostAllowed("Nice read\nThanks @BlackOutTrade for the heads up @randomguy")
// => true  (should be false — it @tags @randomguy)
```

Both existing regression tests (added for the "hidden past line 1" fix) only ever put the cold
@tag on a **different** line from the footer, so this same-line combination was never exercised —
RED→GREEN proven in `src/lib/x-feed-policy.test.ts`'s new third case (`git stash` the fix, the new
assertions fail with `true !== false`; restore it, all 4 subtests pass).

### Blast radius

One function, one call site pattern repeated 4 times (`x-post-guard.ts`, `x-content-humanize.ts`,
`x-api.ts` ×2) — all of them call the same exported `isTimelinePostAllowed`, so the single fix
covers every original-post path that guards against cold @tags. No other implementation of this
check exists repo-wide (grep confirms one definition, one export).

### Fix rationale

Changed the per-line exemption from a whole-line `includes` check to a per-**mention** check:
extract every individual `@word` token on the line (`line.match(/(?:^|\s)@\w{2,}/g)`) and reject
the line only if some mention other than the exact self-tag `@BlackOutTrade` appears. The self-tag
itself (even duplicated on one line) is still allowed; a genuinely cold mention on the same line as
the footer is now caught, same as one on its own line. Left the first-line-starts-with-`@` check
and the regex's own `\w{2,}` shape untouched — this fix only changes how the self-tag exemption is
scoped, not what counts as a mention.
