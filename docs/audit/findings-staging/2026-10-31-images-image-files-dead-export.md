> **kind:** `FINDING`

## `IMAGE_FILES` in `src/lib/images.ts` has been dead, zero-reference exported data since the file's first commit — REMOVED

| | |
|---|---|
| **Severity** | P4 (dead code, no runtime behavior change — cleanup only) |
| **Surface** | `src/lib/images.ts` — `IMAGE_FILES` |
| **Status** | FIXED |

### Root cause

`IMAGE_FILES` is an exported array of `{ path, label }` records, commented `/** Assets still
referenced by the live site (guard / docs). */`, implying it exists to back some build-time
asset-existence guard or a docs generator. It never did either — a repo-wide grep for the
identifier (`grep -rn "IMAGE_FILES" .`, excluding `node_modules`) turns up exactly **one** hit:
its own definition at `src/lib/images.ts:44`. No script, test, component, or doc references it.

`git log -S"IMAGE_FILES" --follow -- src/lib/images.ts` shows it was introduced in the very first
commit that created `images.ts` (`e71a0bb3`, 2026-06-16, "feat: launch landing UI, Clerk auth,
brand assets, and domain config") and has been edited twice since (both times just keeping its
three literal paths in sync with the surrounding `IMAGES`/`MARKETING_MODULE_IMAGES` constants
above it) — it was never wired to a consumer at any point in its history, not something that
later lost its only caller.

The rest of `images.ts` (`IMAGES`, `MARKETING_MODULE_IMAGES`, `MARKETING_MODULE_GALLERY`) is
real, live-consumed data: `src/app/layout.tsx`, `src/components/seo/JsonLd.tsx`,
`src/components/landing/RedesignHome.tsx` import `IMAGES`/`MARKETING_MODULE_GALLERY` directly, and
`src/lib/marketing/product-manifest.ts`/`products.ts`/`src/components/ui/icons/InstrumentIcons.tsx`
import the `MarketingModuleId` type derived from `MARKETING_MODULE_IMAGES`. None of these six
consumers reference `IMAGE_FILES` (verified by grepping each file individually).

### Evidence

Repo-wide, pre-fix:
```
$ grep -rn "IMAGE_FILES" . --include="*.ts" --include="*.tsx" --include="*.mjs" --include="*.cjs" --include="*.md" | grep -v node_modules
./src/lib/images.ts:44:export const IMAGE_FILES = [
```
One hit — the definition itself. No test file existed for `src/lib/images.ts` before this PR.

New test `src/lib/images.test.ts`, RED→GREEN confirmed via `git stash` on `src/lib/images.ts`
alone (test file untouched):
- **Before the fix** (original file, `IMAGE_FILES` present): `images.ts does not re-export the
  removed dead IMAGE_FILES list` FAILS — `IMAGE_FILES` is the 3-entry array, not `undefined`.
- **After the fix**: both tests pass — `IMAGE_FILES` is gone, and the still-live
  `IMAGES`/`MARKETING_MODULE_IMAGES`/`MARKETING_MODULE_GALLERY` exports are unchanged and intact.

Also ran the sibling suites for every real consumer of `src/lib/images.ts`
(`RedesignHome.seo.test.ts`, `JsonLd.ssr.test.ts`, `OrganizationJsonLd.ssr.test.ts`,
`site.test.ts`) — 20/20 pass, confirming the removal doesn't disturb anything that actually reads
this module. `tsc --noEmit` and `eslint` on the touched files are both clean.

### Blast radius

None beyond `src/lib/images.ts` itself — no other file imported `IMAGE_FILES`, so there is nothing
else to update. The three asset paths it listed (`public/images/blackout-emblem.webp`,
`public/og-image.webp`, `public/og-image.png`) remain fully described by the still-live `IMAGES`
constant two exports above it in the same file, so no asset-reference information is lost.

### Fix rationale

Delete the dead export outright rather than wiring it to a real consumer (e.g. building a new
build-time "do these files on disk actually exist" guard around it) — that would be inventing a
feature nobody asked for under the banner of a cleanup. If a real asset-existence guard is wanted
later, it's cheap to recreate from `IMAGES` directly, which already carries the same three paths
and stays live/exercised by its actual consumers, so it can't silently drift out of sync with them
the way a second, unconsumed copy already had the structural risk of doing.

Added a regression test (`src/lib/images.test.ts` — the file had no test coverage at all before
this PR) asserting `IMAGE_FILES` is not re-exported, so a careless revert reintroducing the dead
export is caught rather than silently landing again.

### Related context — primary round-154 lead ruled out (no fix)

This round's primary assigned lead — `const snap = getApiTelemetrySnapshot(5 * 60_000)` in
`buildInstancePayload()`, `src/lib/api-telemetry-redis.ts` — was investigated and is genuinely
**dead/wasted work with no wiring bug (case (a))**, not touched here per the round's explicit
instruction to avoid pushing a conflicting edit to that file while PR #7019 is mid-CI on it.
Traced every field `buildInstancePayload()`'s returned `InstanceTelemetryPayload` actually carries
(`instance_id`, `updated_at`, `rate_limits`, `providers[].{calls_5m,errors_5m,last_at,last_status,
last_ok}`) back to `getProviderHealthSummary()` alone — `snap` (from `getApiTelemetrySnapshot()`,
which returns `recent_events`/`recent_errors`/`active_retries`/`by_provider`/`totals`/
`buffer_since`) contributes nothing to the payload. Checked whether any consumer is missing one of
those fields: `src/lib/admin-api-dashboard.ts` (the only real consumer of the Redis-backed
cross-instance payload via `readCrossInstanceTelemetry()`) already sources `recent_errors`,
`recent_events`, and `active_retries` from its own **local**, in-process
`getApiTelemetrySnapshot()` call directly — those are inherently per-process, in-memory event-log
data that don't make sense to replicate cross-instance via Redis, so there's no missing field,
just a wasted computation on every `flushTelemetryToRedis()` call (itself on-demand from the admin
dashboard / `market-health` route per #7019's in-flight rewrite, not a timer). Leaving this for a
follow-up round once #7019 lands, since the line `#7019` doesn't touch is adjacent to lines it
does, and the instruction for this round was explicit: report, don't race a push.
