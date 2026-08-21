import "server-only";

import { getGexPositioning } from "@/lib/providers/gex-positioning";
import { todayEtYmd } from "@/lib/providers/spx-session";
import { serverCache } from "@/lib/server-cache";
import { normalizeVectorTicker } from "@/features/vector/lib/vector-ticker";
import { loadCurrentChainContracts } from "@/features/vector/lib/vector-gex-reconstruct-server";
import { deriveExpectedMoveInputsForEarningsDate } from "@/features/vector/lib/vector-expected-move-atm";
import { computeExpectedMove, type ExpectedMove } from "@/features/vector/lib/vector-expected-move";
import {
  describeEmCoverage,
  rankEarningsForExpectedMove,
  type EmCandidate,
  type EmCoverage,
} from "@/lib/meridian/meridian-em-priority";

const EM_CACHE_MS = 10 * 60 * 1000;
const BATCH_CAP = 36;
/** In-flight chain pulls. Small on purpose — see the note in batchLoadEarningsExpectedMovePct. */
const EM_CONCURRENCY = 6;

export type EarningsExpectedMove = ExpectedMove & { expiry: string };

/**
 * Options-implied expected move for an earnings print — expiry bracketing the report date,
 * ATM IV from the live Polygon chain. Best-effort null when chain/spot unavailable.
 */
export async function loadEarningsExpectedMove(
  ticker: string,
  earningsDateYmd: string | null
): Promise<EarningsExpectedMove | null> {
  const sym = normalizeVectorTicker(ticker);
  const dateKey = earningsDateYmd?.slice(0, 10) ?? "next";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && dateKey !== "next") return null;

  return serverCache(`meridian:earnings-em:v2:${sym}:${dateKey}`, EM_CACHE_MS, async () => {
    try {
      const pos = await getGexPositioning(sym);
      const spot = pos?.spot;
      if (!(spot && spot > 0)) return null;

      const contracts = await loadCurrentChainContracts(sym, spot);
      if (!contracts.length) return null;

      const reportYmd = dateKey === "next" ? todayEtYmd() : dateKey;
      const inputs = deriveExpectedMoveInputsForEarningsDate(
        contracts,
        spot,
        reportYmd,
        todayEtYmd()
      );
      if (!inputs) return null;

      const em = computeExpectedMove({
        spot: inputs.spot,
        atmIv: inputs.atmIv,
        dteDays: inputs.dteDays,
      });
      if (!em) return null;
      return { ...em, expiry: inputs.expiry };
    } catch {
      return null;
    }
  }).catch(() => null);
}

/** Headline expected-move percent for desk chips (e.g. 8.2). */
export async function loadEarningsExpectedMovePct(
  ticker: string,
  earningsDateYmd: string | null
): Promise<number | null> {
  const em = await loadEarningsExpectedMove(ticker, earningsDateYmd);
  if (em?.movePct == null) return null;
  return Number((em.movePct * 100).toFixed(1));
}

/**
 * Batch chain-IV expected moves for timeline rows — one upstream pull per ticker (cached).
 *
 * RANKED, THEN CAPPED. This used to `.slice(0, BATCH_CAP)` a Map in insertion order, so the 36
 * available pulls went to whichever names happened to sort first rather than to the ones anyone
 * is watching. Measured live on a 21-day timeline (154 prints): the 7 names that ended up with an
 * implied move all sat at positions 2-33, and six high-impact names sampled beyond the cap —
 * VEEV, SJM, **NVDA**, NTNX, HPQ, DCI — every one had a chain and returned a value when asked
 * directly. NVDA showed nothing on the busiest print of the window purely because of ordering.
 *
 * See `meridian-em-priority.ts`. The cap stays: 154 chain pulls per load is not affordable, and
 * raising it would trade a visible gap for a latency one.
 */
export async function batchLoadEarningsExpectedMovePct(
  items: Array<EmCandidate>
): Promise<{ byTicker: Map<string, number | null>; coverage: EmCoverage }> {
  const { attempt, requested } = rankEarningsForExpectedMove(items, BATCH_CAP);

  // BOUNDED CONCURRENCY. Each pull is a GEX positioning read plus a full chain fetch, and this
  // runs while the timeline load is already saturating the same Polygon limiter with its own
  // per-ticker GEX work. Firing all 36 at once measured 2/36 resolved end-to-end, while the same
  // names asked in a quieter process resolved 9/12 — the names have chains; the burst does not
  // get them. A small pool trades a little wall-clock for answers that actually arrive.
  const out = new Map<string, number | null>();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(EM_CONCURRENCY, attempt.length) }, async () => {
      while (cursor < attempt.length) {
        const c = attempt[cursor++]!;
        out.set(c.ticker, await loadEarningsExpectedMovePct(c.ticker, c.report_date));
      }
    })
  );
  // `resolved` counts names that came back with a NUMBER. The difference between attempted and
  // resolved is the honest "we looked and there was no chain" population — which is a fact about
  // those names, unlike the skipped ones, which is a fact about our budget.
  const resolved = [...out.values()].filter((v) => v != null).length;
  return { byTicker: out, coverage: describeEmCoverage(requested, attempt.length, resolved) };
}
