## 2026-09-07 — [FINDING, P4 test-coverage] `buildOcc` (OCC option symbol builder) had zero test coverage anywhere in the repo — FIXED

> **kind:** `FINDING`

### Symptom

Swept generic (non-lane-owned) `src/lib/*.ts` files for ones with no matching `*.test.ts`. `src/lib/occ-symbol.ts`'s `buildOcc()` — a small, pure function that constructs OCC option symbols (e.g. `O:AAPL260918C00150000`) — had **zero direct test coverage**, despite being imported by 21 files across most of the owning lanes: zerodte (`scan.ts`, `vector-contract-resolve.ts`, `liquid-strike-fallback.ts`, `thesis/contract-attach.ts`), helix (`contract-identity.ts`, `occ-contract-id.ts`), largo (`core/entities.ts`), swing (`occ-from-row.ts`), nighthawk (`option-chain-prompt.ts`, `legacy-play-contract.ts`), banger (`contract.ts`), plus generic providers (`options-snapshot.ts`), API routes (`option-contract/route.ts`, `option-contract-history/route.ts`), `db.ts`, and `ws/options-socket.ts`.

Several of those callers have their own tests that exercise `buildOcc` indirectly through their own logic (`helix/occ-contract-id.test.ts`, `largo/core/entities.test.ts`, `zerodte/scan.test.ts`, `options-snapshot.test.ts`) — so it wasn't completely unexercised — but the function itself, with its several independent validation/formatting branches (SPX→SPXW substitution, expiry-date parsing, strike scaling/padding, bounds checks), had no isolated unit tests covering its own edge cases directly.

### Investigation

Manually read every branch of `buildOcc` before touching it. No bug was found — the function is correct: ticker trim/uppercase, the documented SPX→SPXW root rewrite, 2-digit-year date encoding, call/put mapping, and strike scaling (`Math.round(strike * 1000)`, zero-padded to 8 digits, bounds-checked at 99,999,999) all match the OCC symbol format Polygon/Massive expect. This is a **coverage gap fix, not a bug fix** — flagging that distinction rather than overstating it as a defect found.

### Fix

Added `src/lib/occ-symbol.test.ts` — 14 direct unit tests covering: standard call/put construction, the SPX→SPXW substitution (and confirming SPXW passed directly isn't double-prefixed), ticker trim/uppercase, full-ISO-timestamp expiry truncation, strike scaling/padding including a sub-cent floating-point-precision case (`99.99 * 1000` is `99989.99999999999` in IEEE-754 and must round cleanly, not truncate or leak decimal noise into the output), and every null-returning validation branch (empty/invalid ticker, malformed expiry, wrong option-type literal, non-positive/non-finite strike, strike overflowing the 8-digit OCC field).

### Evidence

- All 14 tests pass against the current (unmodified) implementation — expected, since no bug was found.
- **Proved the tests are meaningful, not vacuous**, via two independent mutation checks (mutate → confirm failure → restore → confirm clean):
  - Broke the SPX→SPXW substitution (`rawRoot === "SPX" ? "SPXW" : rawRoot` → `rawRoot`) → 13 pass / **1 fail**.
  - Broke the strike-scaling factor (`strike * 1000` → `strike * 100`) → 5 pass / **9 fail**.
  - Both times, `git diff --stat` confirmed the source file was restored byte-identical afterward.
- `npx tsc --noEmit`: clean.
- Full `npm test` (Node 20): see PR for final count.

### Blast radius

New test file only (`src/lib/occ-symbol.test.ts`). `src/lib/occ-symbol.ts` itself is unmodified — no runtime behavior changed anywhere.

| **Status** | FIXED — PR opened, merge pending CI/peer-review per standing policy |
