> **kind:** `FINDING`

## Daily article-syndication cron trusted a silently-truncated "already posted" list — a transient Dev.to/Hashnode API failure would re-post an already-live article to the real account — FIXED

| | |
|---|---|
| **Severity** | P2 (external-facing duplicate content on a scheduled, unattended daily cron — not a data-correctness bug on the member-facing product, but a genuine violation of the component's own stated invariant) |
| **Surface** | `scripts/seo/syndicate-articles.mjs` — `devtoAlreadyPosted`, `hashnodePosted`, run daily at 15:05 UTC by `.github/workflows/seo-syndicate.yml` ("SEO article syndication") |
| **Status** | FIXED |

### Root cause

`syndicate-articles.mjs` cross-posts BlackOut Academy `/learn/*` guides to Dev.to and Hashnode.
Its own file header states the idempotency guarantee in plain terms: *"before posting, we read
what the account already published and skip any article whose canonical already exists there —
safe to run on a schedule forever, never double-posts."*

That guarantee depended on `devtoAlreadyPosted(apiKey)` and `hashnodePosted(apiKey, publicationId)`
returning the **complete** set of already-syndicated canonical URLs. Both functions paginate the
platform's own API and, on ANY fetch failure mid-pagination, silently `break` the loop and return
whatever had accumulated so far — not an error, not even a log line:

```js
// devtoAlreadyPosted (before fix)
const res = await fetch(`https://dev.to/api/articles/me/all?per_page=100&page=${page}`, {...});
if (!res.ok) break;           // <-- a 429/500/auth hiccup on ANY page silently truncates the set
...

// hashnodePosted (before fix)
const j = await res.json().catch(() => ({}));
const posts = j?.data?.publication?.posts;
if (!posts) break;            // <-- a GraphQL error/null response silently truncates the set
```

A failure on **page 1** (the common case — one request, one chance to fail) returns an **empty**
set, i.e. "nothing has ever been posted." `main()` then calls `pickToSyndicate(LEARN_ARTICLES,
posted, limit)`, which — trusting that empty/partial set — returns the top-ranked eligible article
(the same pillar/article the previous successful run already posted), and the script re-posts it
live to the real Dev.to/Hashnode account. This is the exact failure the idempotency design exists
to prevent, triggered by nothing more than a transient rate limit or 5xx on the "list what I've
already posted" call — the kind of hiccup a daily unattended cron is expected to hit eventually,
not an exotic edge case.

Why this wasn't caught earlier: every existing test (`syndicate-articles.test.ts`) exercised only
the pure helpers (`pickToSyndicate`, `eligibleArticles`, `canonicalUrl`, etc.) with a hand-built
`alreadyPostedCanonicals` set — none exercised `devtoAlreadyPosted`/`hashnodePosted` themselves, so
the fetch-failure path was never under test. Both functions were also module-private (not
exported), so there was no seam to test them from outside without this fix.

### Evidence (RED → GREEN)

Four new tests added to `syndicate-articles.test.ts`, stubbing `globalThis.fetch`:
1. `devtoAlreadyPosted` on a page-1 `500` — **before fix**: resolves to an empty `Set` (no error).
   **After fix**: rejects with `Dev.to "already posted" fetch failed on page 1: HTTP 500`.
2. `devtoAlreadyPosted` on a full page-1 (100 rows, forcing a page-2 request) then a page-2 `429` —
   **before fix**: resolves, silently dropping every canonical on page 2+. **After fix**: rejects,
   naming the exact page and status.
3. `hashnodePosted` on a GraphQL error response (`{errors:[...]}`, HTTP 200) — **before fix**:
   resolves to an empty `Set`. **After fix**: rejects, including the GraphQL error message.
4. `hashnodePosted` on a genuinely empty publication (`posts.edges: []`, `hasNextPage: false`) —
   unchanged both before and after: resolves to an empty `Set` with no error, proving the fix
   distinguishes a real "nothing posted yet" state from a failed fetch rather than conflating them.

Confirmed RED by reverting only the two changed lines (keeping the new exports) and re-running the
new tests: 3/4 failed exactly as predicted (`Missing expected rejection`). Restoring the fix turned
all 4 green. Full file: `npx tsx --experimental-test-module-mocks --test scripts/seo/*.test.ts
src/lib/seo/*.test.ts` → 27/27 pass. `npx tsc --noEmit` clean. `npx eslint
scripts/seo/syndicate-articles.mjs scripts/seo/syndicate-articles.test.ts` clean.

### Blast radius

Both functions are called from exactly one place each inside `main()` (one per platform, inside
its own `try`/`catch`). `main()`'s existing per-platform `catch (e) { log("... SKIP: " + e.message); }`
already does the RIGHT thing on a thrown error — skip posting for that platform this run and move
on to the other platform — so the fix needed no new error handling, only removing the silent
swallow that kept the error from ever reaching that `catch`. No other file imports
`devtoAlreadyPosted`/`hashnodePosted` (repo-wide grep: only `syndicate-articles.mjs` itself and its
own test); the only other reference to the script at all is the GitHub Actions workflow that
invokes it as a subprocess, unaffected by the exported-functions change.

### Fix rationale

Throwing on a failed intermediate fetch, rather than quietly returning a partial result, is the
minimal change that restores the invariant the module's own comments already claim: "safe to run on
a schedule forever, never double-posts." The alternative (retry-with-backoff inside the pagination
loop) was deliberately NOT done here — it would add real complexity (how many retries, what
backoff, what if ALL retries fail) for a problem `main()`'s existing per-platform catch-and-skip
already solves correctly: on a day the Dev.to/Hashnode "list my posts" call fails, the right
behavior is "skip syndicating to that platform today, try again tomorrow" — not "retry harder" and
not "guess and post anyway." The one real empty-publication case (`posts.edges: []` with
`hasNextPage: false`) is explicitly left as a non-throwing success path and covered by its own
regression test, so the fix cannot be mistaken for "throw whenever posts is falsy-ish."

Also exported `devtoAlreadyPosted`/`hashnodePosted` (previously module-private) so this failure path
has a test seam at all — matches the existing convention in the same file of exporting every pure/
testable function.
