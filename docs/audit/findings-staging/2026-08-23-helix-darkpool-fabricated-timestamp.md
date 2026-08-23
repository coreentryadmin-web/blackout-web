# Dark-pool timestamp fabrication — every undated print reads as "just now"

> **kind:** FINDING

## Summary
The dark-pool route (`api/market/dark-pool/route.ts`) stamped `new Date().toISOString()` on any print UW did not date — inventing a measurement (the exact server time the request arrived) rather than preserving absence. This caused:
1. **COORD false matches**: undated dark-pool prints matched EVERY flow within a 5-second window (the COORD time tolerance), when they should match only flows whose timestamp UW actually provided and was within the window.
2. **Deep link false negatives**: time-keyed deep links could never match an undated print, since the link was built against a past time and every reload invented a new timestamp.

## Evidence
**Fill-rate inventory (helix-darkpool-inventory.mjs, first run 2026-08-23):**
- Returned 40 prints
- `executed_at` field reported **100% filled**
- All 40 timestamps were within **milliseconds** of each other, within milliseconds of request time
- UW's own endpoint carries a note: `// … UW's market-wide endpoint omits direction` — it omits timestamps too

**Deep-link defect:**
- A time-keyed deep link built at 14:32:45 against a dark-pool print could never highlight that print on a later reload at 14:35:20.
- The link encodes `exec_time=14:32:45` (second precision).
- On reload, `darkpoolRowHighlighted()` does `String(print.executed_at).slice(0, 19) === link.exec_time`.
- For undated prints, `String(null).slice(0, 19)` equals the literal 9-character string `"null"`, never matching.
- But **every** undated print gets the SAME new timestamp per-request, so **no two reloads see the same time**, making the link pointless.

**Root cause in code:**
```typescript
// src/app/api/market/dark-pool/route.ts (BEFORE)
executed_at: input.executed_at ?? new Date().toISOString(),
```
The `?? new Date()` fallback runs **per request**, not per print, so:
- Request A at 14:32:45.123 receives dark-pool prints → all get `executed_at = "2026-08-23T14:32:45.123Z"`.
- Request B at 14:32:47.456 receives the SAME prints → all get `executed_at = "2026-08-23T14:32:47.456Z"`.
- The prints' identity is unchanged (`ticker`, `side`, `premium` etc. still match), but their timestamp is now different, so a deep link built from request A can never find them in request B.

## Why it matters
**COORD window collisions (Medium Impact):**
Dark-pool prints with fabricated timestamps inside a 5-second COORD window matched against **every** flow in that window, not just the ones the print's own underlying action overlapped. This is a correctness problem — a flow whose timestamp UW DID provide could falsely correlate with an undated dark-pool print, since the print's time was invented rather than absent.

**Deep linking (Low immediate impact, high UX cost):**
A deep link built against a dark-pool print (`/heatmap?...&exec_time=14:32:45`) works perfectly when clicked immediately (same request, same fabricated timestamp), but fails on any reload. This defeats the entire purpose of a shareable, bookmarkable deep link. A member can copy a link from the dark-pool drawer, paste it to a collaborator, and it silently fails to highlight.

**Audit blindness (High technical impact):**
`helix-darkpool-inventory.mjs` reported `executed_at: 100% FILLED` when measured against the fabricating endpoint. This made the field appear healthy when it was completely hollow — a fill-rate inventory of a fabricator is not a fill rate. The corrected probe, running against the fixed endpoint, can now measure the **real** fill rate and discover which data the upstream truly carries.

## Fix
Replace fabrication with preservation of absence:

**Route (src/app/api/market/dark-pool/route.ts):**
```typescript
// BEFORE
executed_at: input.executed_at ?? new Date().toISOString(),

// AFTER
executed_at: input.executed_at ?? null,
```
Type change: `string` → `string | null` in both route and client `api.ts` interface.

**Call sites (3 locations):**
1. `DarkPoolPanel.tsx` — `fmtDate()` now safely handles `null` and uses `timeAgo()` instead.
2. `use-helix-deep-link.ts` — `darkpoolRowHighlighted()` checks `if (print.executed_at == null) return false` before string operations.
3. `helix-coord-window.ts` — guard already skips null timestamps (`if (coordTime == null)`), so no change needed beyond documentation.

## Test coverage
**Route tests (src/app/api/market/dark-pool/route.test.ts, 5 new):**
- Undated prints receive `executed_at: null`, not now().
- Empty string timestamps treated as absence, return null.
- Real timestamps pass through unchanged.
- Normalizing the same undated row twice produces identical null (no per-request fabrication).

**Deep-link tests (src/features/helix/lib/use-helix-deep-link.test.ts, 4 new):**
- Undated print never highlights, regardless of link precision.
- **Critical: link carrying stringified "null"** (what would happen if this fix were missed) does NOT accidentally match all undated prints.
- Dated prints match by second precision and dollar precision.
- Absence vs. measured time are correctly distinguished.

All tests fail against pre-fix code, pass against fix.

## Status
**FIXED** in #2753.

Audit re-run: `npm run audit:helix-darkpool-inventory` (after deploy) will return the real fill rate and discover whether executed_at is truly empty across the tape or whether UW provides it for some subset.

## Blast radius
- **src/app/api/market/dark-pool/route.ts** — core fix (1 file, 1 line of logic)
- **src/lib/api.ts** — type mirror (1 type change)
- **3 call sites in helix/** — all guarded against null, no user-facing breakage
- **Audit harness updated** — helix-darkpool-inventory.mjs now correctly documents the fabrication and suggests re-measuring

All existing tests pass. No production behavior change for members with time-aware deep links — deep links built under the old code (with timestamps) continue working under the new code, and deep links built under the new code (with null) now work correctly across reloads.
