/**
 * STEP 1 heartbeat validation (2026-08-22): confirm #2423 on PRODUCTION.
 *  - expected-move movePct: a real fraction, not a literal 0 (was "±31 pts (0.00%)").
 *  - largo/context: the shared fetchVectorFullState path is healthy (spot/walls non-null),
 *    since get_vector_full_state (which carries magnet.distancePct) is only reachable through
 *    the P0-broken Largo answer loop and cannot be observed end-to-end right now.
 * One Clerk mint, deleted in finally.
 */
import { mintVectorAuditSession } from "./lib/vector-audit-auth.mjs";

const BASE = "https://blackouttrades.com";
const TICKERS = ["SPX", "SPY", "NVDA"];

const s = await mintVectorAuditSession({ base: BASE, emailPrefix: "vector-2423" });
try {
  console.log(`# minted premium session ${s.email}`);
  for (const t of TICKERS) {
    const em = s.app(`/api/market/vector/expected-move?ticker=${t}&dte=all`);
    const b = em.json?.expectedMove ?? null;
    const movePct = b?.movePct ?? null;
    const literalZeroBug = movePct === 0;
    console.log(
      `\n## ${t} expected-move  http=${em.status}` +
        (b
          ? `\n   movePct=${movePct}  atmIv=${b.atmIv}  dteDays=${b.dteDays}  spot=${b.spot}` +
            `\n   bands=${JSON.stringify(b.bands)}` +
            `\n   VERDICT movePct: ${literalZeroBug ? "❌ LITERAL 0 (regression!)" : movePct == null ? "⚠ null (no honest band)" : "✅ real fraction"}`
          : `\n   expectedMove=null  (raw: ${(em.raw || "").slice(0, 160)})`)
    );
  }
  // Shared data path health (same fetchVectorFullState get_vector_full_state uses).
  const ctx = s.app(`/api/market/largo/context?ticker=SPX`);
  const j = ctx.json ?? {};
  console.log(
    `\n## SPX largo/context  http=${ctx.status}` +
      `\n   spot=${j.spot}  regime=${j.regime}  call_wall=${j.call_wall}  put_wall=${j.put_wall}` +
      `\n   gamma_flip=${j.gamma_flip}  max_pain=${j.max_pain}  available=${JSON.stringify(j.available)}` +
      `\n   VERDICT data path: ${j.available?.vector ? "✅ vector full-state read landed" : "❌ vector read failed"}`
  );
} finally {
  s.cleanup();
  console.log("\n# session deleted");
}
