## 2026-10-13 — [FINDING, P4 dead-code] `stanceColor`/`toneColor`/`levelColor` (`brand/tokens.ts`) survived the Largo card-feature removal untouched, with zero callers left — FIXED

> **kind:** `FINDING`

| **Area** | **Severity** | **Status** |
|---|---|---|
| Shared brand primitives / Largo card legacy | P4 — dead code, no runtime impact | FIXED |

**What's wrong.** `src/lib/brand/tokens.ts` exported three colour-mapping functions —
`stanceColor`, `toneColor` (plus its `Tone` type), and `levelColor` — with zero callers anywhere
in the repo, not even in `tokens.test.ts`.

**Root cause.** Commit `9935a7e68` ("chore(largo): remove the card/image-generation feature
entirely", PR #2067, 2026-08-11) deleted the entire Largo visual/card-rendering pipeline (50 files)
per an explicit operator decision, but deliberately **kept** `tokens.ts` whole — its own commit
message explains why: *"`tokens.ts`, `font-buffers.ts`, `font-coverage.ts`... are BRAND primitives,
not card code. `src/lib/x-desk-card.tsx` (used by the live `/api/cron/x-autopost` route) and
`src/lib/thermal-discord-card.ts` both import them."* That reasoning is correct for the file's
other exports (`C`, `FONT`, `GLYPH` — all still genuinely used by those two live satori-rendered
card consumers), but the sweep that made that keep-vs-delete call evidently checked the FILE, not
every individual export in it: `stanceColor`/`toneColor`/`levelColor` were part of the
now-deleted Largo card templates' own rendering logic (stance strips, level markers, tone-coded
text) and had no caller left once that templates tree was gone. They've been dead for ~2 months.

**Fix.** Deleted `stanceColor`, `toneColor` + its `Tone` type (confirmed `Tone` itself had no other
importer either), and `levelColor`. `C`, `FONT`, and `GLYPH` — the exports the #2067 commit
message actually named as kept-for-a-reason — are untouched; `GLYPH` specifically still has a real
consumer: `tokens.test.ts`'s own "every GLYPH codepoint exists in all three committed faces" guard.

**Verification.** `tsc --noEmit` clean. `tokens.test.ts` + the two live satori-card consumers'
test suites (`x-desk-card.test.ts`, `thermal-discord-card.test.ts`) — 23/23 pass.

**Blast radius.** One file, three functions + one type removed. No change to `x-desk-card.tsx`,
`thermal-discord-card.ts`, or any other consumer of `brand/tokens.ts`'s surviving exports.

Found via a repo-wide dead-export heuristic sweep of previously-unswept `src/lib/` directories,
independently re-verified before fixing: confirmed zero callers anywhere (including same-file) via
grep, traced the exact commit and its own stated reasoning for why the file as a whole was kept,
and confirmed the surviving exports (`C`/`FONT`/`GLYPH`) each have real, live consumers today.
