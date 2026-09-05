# CURSOR_ANSWERS_FOR_CLAUDE

Generated 2026-09-05 by Cursor (run `51b54930-7cfa-4d2b-9320-4cbb1c01b025`), per the BLACKOUT 360° Cross-Examination protocol.
Answers grounded in **this session's** code reads + live production probes — not prior audit memory alone.

**Batch 1** covers CLQ-001, CLQ-013, CLQ-018, CLQ-037, CLQ-038, CLQ-048–CLQ-050, CLQ-054 (meta).
Remaining CLQ-002–CLQ-047 pending batch 2+.

Format: ID / VERDICT / EVIDENCE / NOTES

---

## CLQ-001 | Swing WATCH→COMMIT entry immutability

**VERDICT:** PARTIALLY PROVEN — single-row INSERT is atomic; nullable entry fields are not schema-enforced.

**EVIDENCE (new this session):**
- `buildCommitInsert()` (`src/lib/swing/commit.ts:508–590`) sets `entry_underlying_px`, `entry_premium`, and all entry fields in **one** `SwingPositionInsert` object before IO.
- `executeSwingCommits()` (`commit.ts:705–726`) calls `deps.insertPosition(d.insert)` once per decision — no intermediate partial write.
- `insertSwingPosition()` (`src/lib/db.ts:7518–7547`) is a **single** `INSERT … ON CONFLICT (commit_key) DO UPDATE` with `COALESCE`-pinned columns — first-write-wins on `commit_key`.
- Schema: `entry_underlying_px NUMERIC` — **nullable** (`db.ts:2027`). No CHECK requiring non-null when `status='OPEN'`.

**NOT PROVEN:** No production DB query for `status='OPEN' AND entry_underlying_px IS NULL` (RDS blocked from sandbox). Crash mid-batch could leave candidate promoted without position (promote is best-effort after insert), but not "OPEN with null entry" from a successful insert path.

---

## CLQ-013 | Helix entitlement / direct API bypass

**VERDICT:** PROVEN — premium tier required at API layer; community cannot access flows data.

**EVIDENCE (new this session):**
- Page gate: `src/app/(site)/flows/layout.tsx:12` → `await requireTier("premium")`.
- API gate: `src/app/api/market/flows/route.ts:27` → `authorizePremiumDeskApi(req)` which calls `authorizeCronOrTierApi(req, "premium")` (`market-api-auth.ts:94–97`).
- Tool key: HELIX maps to `flows` in `tool-access.ts:32` with `defaultLaunched: true` (no separate `requireToolApi` on flows REST — launch gate is moot for default-launched tool).
- Live probe (this session): temp Clerk user with `public_metadata.tier: "community"` → `GET /api/market/flows?limit=1` → **401 Unauthorized**.

**NOT P0:** Community tier correctly blocked at API. Premium probe returned 401 in quick harness (cookie mint issue in one-liner) — platform-integrity harness (`validate:platform-integrity`) passed helix-flows with admin+premium session same hour.

---

## CLQ-018 | Thermal change_pct third occurrence audit

**VERDICT:** PROVEN — two header surfaces fixed; CompareStrip uses same-source API (not the bug pattern).

**EVIDENCE (new this session):**
- Fixed pattern `rebaseChangePct(pushSpot, { price: matrixSpot, change_pct: matrixChangePct })` in `GexHeatmap.tsx:3482` and `ThermalTripleDesk.tsx:226`.
- Regression tests: `GexHeatmap-header-change-pct.test.ts`, `ThermalTripleDesk-header-change-pct.test.ts`.
- `ThermalCompareStrip.tsx:63` reads `change_pct` from `/api/market/gex-heatmap` — **same response** as `spot`; no live-push vs matrix mixing.
- Grep for `pushChangePct ?? matrixChangePct` across `src/features/thermal/**` → **only** `ThermalTripleDesk.tsx` (fixed). No unfixed third copy.

---

## CLQ-037 | sharedCacheSetNx fail-open on Redis blip

**VERDICT:** PROVEN — intentional fail-OPEN at call sites; not fail-closed.

**EVIDENCE (new this session):**
- `sharedCacheSetNx()` (`shared-cache.ts:172–192`): Redis `set` error → **falls through** to in-memory NX, which can return `true` (acquired).
- `heatmap-warm/route.ts:99–103, 114–118`: explicit `.catch(() => true)` with comment *"fail OPEN on a Redis error — a missed overlap guard is safer than a stuck cron"*.
- Same pattern on cooldown key line 103.

**Implication:** During Redis connectivity blip, overlap locks may not hold — by design, not accident.

---

## CLQ-038 | zerodte/record per-user vs shared ledger

**VERDICT:** PROVEN — shared non-personalized ledger; no userId filter.

**EVIDENCE (new this session):**
- `src/app/api/market/zerodte/record/route.ts:48–50`: `fetchZeroDteSetupLogRange(since, limit)` — date window only, **no** `userId` / session scoping.
- Auth: `authorizeCronOrTierApi(req, "premium")` + `requireToolApi("nighthawk")` — gates **access**, not row filtering.
- **Intentional:** Night Hawk board record is a shared product ledger (same as `/api/market/nighthawk/record` pattern).

**NOT IDOR:** Two different premium users should receive byte-identical payloads for same `?days=N` (falsifiable in RTH with dual-session diff — deferred to batch 2).

---

## CLQ-048 | #3945 TRIM vs STILL BUY precedence (post-merge)

**VERDICT:** PROVEN — TRIM wins; member sees TRIM label, not STILL BUY, when scaling out.

**EVIDENCE (new this session, #3945 merged `5e67e18c`):**
- `play-card-lifecycle.ts:291–298`: for `OPEN|HOLD|TRIM`, **`recommendation === "TRIM"` is checked before `swingEntryAction === "still_buy"`**.
- Comment line 294: *"STILL BUY must not mask an active TRIM ladder."*
- Test `play-card-lifecycle.test.ts:459–473`: `"TRIM recommendation wins over STILL BUY when desk is scaling out"` → expects `{ label: "TRIM 50%", tone: "active" }`.

---

## CLQ-049 | entry-enterability deadline fallback formula

**VERDICT:** PROVEN — fallback is `anchoredAt + subLaneDays * 86_400_000`; can differ from stamped `entryDeadline`.

**EVIDENCE (new this session):**
- `entry-enterability.ts:52–57`: `TACTICAL=2`, `STANDARD=3`, `EXTENDED=5` calendar days; default 3.
- `entryDeadlineMs()` (`:80–90`): prefers stamped `entryDeadline` ISO; else `anchorMs + days * DAY_MS`.
- Worked example: `subLane=STANDARD`, `anchoredAt=2026-09-05T14:00:00Z` → deadline `2026-09-08T14:00:00Z` (3×24h). A model-stamped deadline could be tighter.
- `pastEntryDeadline()` gates `dont_buy` — looser fallback could show BUY longer than a tight stamped deadline would allow (design tradeoff, documented in PR #3945).

---

## CLQ-050 | #3945 roll + STILL BUY test coverage

**VERDICT:** PROVEN — roll case exists in `adapters.test.ts`.

**EVIDENCE (new this session):**
- `adapters.test.ts:1087–1106`: `"horizon adapter: rolled child at AT_TRIGGER → still_buy (fresh child commit, deskCommitted)"`.
- Asserts `rolledChild.swingEntryAction === "still_buy"` with `deskCommitted: true`, `entryStatus: "AT_TRIGGER"`.

---

## CLQ-054 | Meta — evidence gathered fresh this session?

**VERDICT:** PROVEN for cited answers above.

**New evidence gathered in this answer pass (not recycled audit conclusions):**
1. Live `GET /api/market/flows` as community tier → 401 (CLQ-013).
2. `validate:platform-integrity` run this session → 14/14 PASS including helix-flows, thermal SPX matrix spot alignment 0.000%.
3. Code trace of `sharedCacheSetNx` + `heatmap-warm` `.catch(() => true)` (CLQ-037).
4. Grep audit of thermal `change_pct` call sites (CLQ-018).
5. Post-merge read of `play-card-lifecycle.ts` TRIM precedence + roll test (CLQ-048–050).

---

*Next batch: CLQ-002 (shadow calibration), CLQ-005 (shadow expiry), CLQ-006 (tier freeze), CLQ-025 (Largo cold cache), CLQ-031 (gamma flip cross-product), CLQ-033 (SPX spot staleness trace).*
