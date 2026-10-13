// Cron: ENGINE B live-sync — mark-and-manage every OPEN/PARTIAL banger position.
//
// SCHEDULE (blackout-infra follow-up — see PR description): piggyback on an EXISTING frequent cron
// cadence rather than requesting new EventBridge wiring. `zerodte-warm`/`desk-warm` fire every ~2-5 min
// during market hours — that cadence (not swing-active-refresh's 15-min) matches the scale-out rule's
// need to catch a 2x touch/hard-stop reasonably promptly. Until blackout-infra wiring exists, this route
// can be fired manually or folded into an existing ~5-min cron's handler.
//
// Kill-switch is checked INSIDE runBangerLiveSync (flag.ts) — a disabled engine leaves every open
// position exactly as-is (marks simply stop refreshing; nothing is force-closed by turning this off).

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/market-api-auth";
import { isEtCashRth } from "@/lib/et-market-hours";
import { logCronRun } from "@/lib/cron-run";
import { runBangerLiveSync } from "@/lib/banger/live-sync";
import {
  fetchOpenBangerPositions,
  updateBangerLiveState,
  updateBangerQuoteFields,
} from "@/lib/banger/positions-db";
import { fetchOptionsUnifiedSnapshot, reliableMarkFromSnapshot } from "@/lib/providers/options-snapshot";
import { fetchOpenClose } from "@/lib/providers/polygon-largo";
import { buildBangerQuoteTickRow, persistBangerQuoteTick } from "@/lib/banger/quote-tick-log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const started = Date.now();
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Registered `market_hours_only: true` but EventBridge has no holiday calendar — same ET-INTENT
  // gap as uw-cache-refresh (#4482). Open banger marks simply stop refreshing off-hours; no need
  // to burn Polygon option-snapshot quota on a closed market.
  if (!isEtCashRth()) {
    const payload = { ok: true, skipped: true, reason: "outside RTH (weekend/holiday/off-hours)" };
    await logCronRun("banger-live-sync", started, payload);
    return NextResponse.json(payload);
  }

  // Populated by `fetchOpenPositions` below and read by `fetchMarks` — safe because
  // runBangerLiveSync always awaits fetchOpenPositions() to completion before calling fetchMarks()
  // (live-sync.ts: `const rows = await deps.fetchOpenPositions(); ... const marks = await
  // deps.fetchMarks(occs);`), so this map is fully built before anything reads it. Lets the
  // bid/ask/greeks carriage below (FINDINGS 2026-10-09 / migration 017) identify WHICH position
  // row a given OCC belongs to without changing live-sync.ts's typed Map<occ, mark> contract at
  // all — zero risk to the scale-out decision engine's existing signature/tests.
  const occToId = new Map<string, number>();

  try {
    const result = await runBangerLiveSync({
      fetchOpenPositions: async () => {
        const rows = await fetchOpenBangerPositions();
        occToId.clear();
        for (const r of rows) occToId.set(r.contract_occ, r.id);
        return rows.map((r) => ({
          id: r.id,
          session_date: r.session_date,
          ticker: r.ticker,
          contract_strike: r.contract_strike,
          contract_expiry: r.contract_expiry,
          contract_occ: r.contract_occ,
          entry_premium: r.entry_premium,
          peak_premium: r.peak_premium,
          scaled_already: r.scaled_already,
          partial_realized_premium: r.partial_realized_premium,
          last_mark: r.last_mark,
          status: r.status,
        }));
      },
      fetchMarks: async (occs) => {
        const snaps = await fetchOptionsUnifiedSnapshot(occs);
        const marks = new Map<string, number>();
        const polledAt = new Date();
        for (const [occ, snap] of snaps) {
          const resolved = reliableMarkFromSnapshot(snap);
          if (typeof resolved === "number" && Number.isFinite(resolved) && resolved > 0) {
            marks.set(occ, resolved);
          }
          // Prospective quote-tick log (docs/audit/BANGER-EXIT-QUOTE-TICK-VALIDATION-2026-09-27.md) —
          // fire-and-forget, never on the decision path: persists the SAME snapshot data already
          // fetched above (zero extra Polygon calls) so a future exit-rule validation has real,
          // historically-faithful ground truth instead of Polygon's archived quote tape, which a real
          // validation attempt found does not always agree with this live snapshot.
          void persistBangerQuoteTick(buildBangerQuoteTickRow(occ, snap, polledAt)).catch((err) => {
            console.warn(`[banger-quote-tick-log] persist failed for ${occ}:`, err);
          });
          // FINDINGS 2026-10-09 (Ask Largo standing mandate): carry the SAME snapshot's bid/ask/OI/
          // greeks onto the live position row — see migration 017's header for the full history.
          // Fire-and-forget, best-effort, additive-only (never read by the decision path above);
          // a missing occToId entry (shouldn't happen — occToId is populated from the exact `rows`
          // this `occs` list was derived from) is a silent no-op rather than a thrown error.
          const positionId = occToId.get(occ);
          if (positionId != null) {
            void updateBangerQuoteFields(positionId, {
              bid: snap.bid,
              ask: snap.ask,
              openInterest: snap.openInterest,
              delta: snap.delta,
              gamma: snap.gamma,
              theta: snap.theta,
              vega: snap.vega,
              iv: snap.iv,
            }).catch((err) => {
              console.warn(`[banger-quote-fields] persist failed for ${occ}:`, err);
            });
          }
        }
        return marks;
      },
      // OCC-style settlement close for an ALREADY-EXPIRED contract's underlying — see
      // `fetchExpiryClose`'s doc comment on `BangerLiveSyncDeps` (live-sync.ts) for why this is
      // needed at all: the provider stops quoting an expired option, so without this a row whose
      // contract has settled would sit in OPEN/PARTIAL forever (measured live 2026-09-23: 41/168
      // open rows, one 40 days past expiry). `null` (no data yet, e.g. a holiday) leaves the row
      // untouched this tick rather than guessing.
      fetchExpiryClose: async (ticker, expiryYmd) => {
        const oc = await fetchOpenClose(ticker, expiryYmd);
        const close = oc && typeof oc.close === "number" ? oc.close : null;
        return close != null && Number.isFinite(close) ? close : null;
      },
      updateLiveState: updateBangerLiveState,
    });
    await logCronRun("banger-live-sync", started, { ...result, duration_ms: Date.now() - started });
    return NextResponse.json(result);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[cron/banger-live-sync]", error);
    await logCronRun("banger-live-sync", started, { ok: false, error: detail });
    return NextResponse.json({ ok: false, error: "Banger live-sync failed" }, { status: 500 });
  }
}
