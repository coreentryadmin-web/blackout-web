> **kind:** FINDING

## Largo slash-prompts payload stamped `as_of` with no ET session anchor — FIXED

| | |
|---|---|
| **Status** | FIXED |
| **Severity** | P3 |
| **Lane** | Largo contract (C1 session-anchor ratchet) |
| **PR** | fix/largo-session-anchor-slash-prompts |

### Root cause

`buildSlashPromptsForDesk` (`src/lib/largo/slash-prompts.ts`) is the builder behind
`GET /api/market/largo/slash-prompts` — the live, desk-scoped chip menu a member sees when they
type `/helix`, `/thermal`, `/nighthawk`, etc. into the Largo chat box. Both return sites
(the `kind === "prompt"` short-circuit, and the normal per-desk branch) stamped:

```ts
as_of: new Date().toISOString(),
```

with no ET session anchor beside it — a bare UTC instant. Per the Largo product contract C1
(`docs/audit/LARGO-PRODUCT-CONTRACT.md`, enforced mechanically by
`src/lib/largo/contract/session-anchor.test.ts`), after ~20:00 ET the UTC *calendar date* is
already tomorrow, so any downstream reader (a model, a log line, a cross-request diff) that
resolves "today's session" from `as_of` alone is a full session ahead for the last four hours of
every trading day — the exact defect class that shipped three times independently in one night
(#2418 OHLC bars, #2420 Helix expiry rows, #2422 Thermal compare card).

This file was listed, unfixed, in `KNOWN_GAPS` since the 2026-08-21 `ROOTS` widening (`["src"]`)
first reached it — it had simply not been triaged yet, not a false positive: there is no
`etSessionDate(`/`etStamp(` call anywhere else in the file or in the client-safe
`slash-prompt-utils.ts` module it shares a type with.

### Evidence (RED → GREEN)

- Added two regression tests to `src/lib/largo/slash-prompts.test.ts` asserting
  `payload.session_date` is present, matches `YYYY-MM-DD`, and is derived from the *same instant*
  `payload.as_of` carries (`etSessionDate(Date.parse(payload.as_of))`) — for both the
  prompt-command branch and the default per-desk branch.
- **RED**: with `src/lib/largo/slash-prompts.ts`/`slash-prompt-utils.ts` reverted to their
  pre-fix content (via `git stash` on just those two files) and the new tests + the removed
  `KNOWN_GAPS` allowlist entry both kept, `npx tsx --experimental-test-module-mocks --test
  src/lib/largo/slash-prompts.test.ts` reported **2 failing** (the two new tests) and
  `session-anchor.test.ts`'s own `"no NEW Largo payload stamps a UTC instant without an ET
  session anchor"` test failed too, naming `src/lib/largo/slash-prompts.ts` as the offender.
- **GREEN**: with the fix restored, both files (`slash-prompts.test.ts` — 11/11 pass,
  `session-anchor.test.ts` — 6/6 pass) and `npx tsc --noEmit` clean.

### Blast radius

Only one producer (`buildSlashPromptsForDesk`, two return sites in the same function) and one
shared type (`SlashPromptsPayload` in `slash-prompt-utils.ts`). Consumers checked:
`src/hooks/useLargoSlashCommands.ts` and `src/features/largo/components/LargoSlashPromptsMenu.tsx`
both consume the payload by field name (never spread/strict-shape-check it), so the additive
`session_date` field is a no-op for them. The route handler
(`src/app/api/market/largo/slash-prompts/route.ts`) passes the payload through unchanged via
`NextResponse.json`.

### Fix rationale

Purely additive, same pattern as every other C1 fix in this ratchet: freeze one `nowMs =
Date.now()` per call (so `as_of` and `session_date` anchor the identical instant rather than two
separate `Date.now()` calls that could straddle a session boundary), keep `as_of` unchanged in
shape, add `session_date: etSessionDate(nowMs)` beside it, and widen `SlashPromptsPayload` by one
nullable field. Removed the file's `KNOWN_GAPS` entry in `session-anchor.test.ts` per the ratchet's
own shrink-only rule.

### What was deliberately left unchanged

The chip `live` snippets and `question` text themselves are untouched — this fix only touches the
payload-level time anchor, not any of the per-desk read logic (HELIX/Thermal/SPX
Slayer/Nighthawk/Vector/Meridian/Largo/track-record builders), which are out of scope for a C1 fix.
