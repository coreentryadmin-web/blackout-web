## 2026-09-28 — [FINDING, P3 Ask Largo / Night Hawk Swings] Swing play-brief's Catalysts & news section could show the same headline twice, burning one of only 4 shown slots

> **kind:** `FINDING`

| Field | Detail |
|---|---|
| **Symptom** | Live-confirmed 2026-09-28 on `GET /api/market/swing/play-brief?playId=SWING:U&ticker=U&status=WATCH` — the "Catalysts & news" section's Headlines block rendered the SAME headline text twice: `"10 Information Technology Stocks Whale Activity In Today's Session"` appeared as both the 1st and 3rd of only 4 shown headlines. |
| **Root cause** | `catalystsSection` (`src/lib/swing/play-brief-intel.ts`) renders `arsenal.news.headlines.slice(0, 4)` verbatim, with no deduplication. Upstream Benzinga re-publishes near-identical wire items that can carry byte-identical titles, so a real duplicate can land in the raw array the play-brief receives. |
| **Blast radius** | Every swing play-brief (any bucket — OPEN/WATCH/CLOSED) whose ticker's news feed happens to contain a duplicate-titled headline this cycle. Cosmetic, not a data-integrity defect, but it wastes a real display slot on zero new information in a section capped at only 4 lines — a member reading it sees 3 distinct facts instead of 4. |
| **Fix** | Dedup `arsenal.news.headlines` (case/whitespace-insensitive, first-occurrence order preserved) BEFORE the `.slice(0, 4)` cut, so a duplicate never displaces a real distinct headline that would otherwise have made the cut. Scoped to this one render — the two other readers of the same field (`ecosystem-narrative.ts`, `ticker-verdict.ts`) only ever take `headlines[0]` and are structurally unaffected either way, so no shared-field change was needed. |
| **Evidence** | Live repro above (raw JSON body confirmed byte-identical duplicate via direct fetch). New regression test `catalystsSection: duplicate headline text is deduped, never burning one of the 4 shown slots` (`play-brief-intel.test.ts`) — verified RED pre-fix (`git stash` proof) / GREEN post-fix. Full file suite: 201/201 pass. `npx tsc --noEmit` clean. |
| **Status** | FIXED — PR opened, awaiting CI. |
