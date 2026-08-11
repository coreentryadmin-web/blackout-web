import {
  helixFlowRead,
  vectorPlayRead,
  gammaRegimeRead,
  nightHawkRead,
  agreementOf,
  type SystemRead,
  type SystemAgreement,
} from "./system-reads";

/**
 * SYSTEM READS, from the tool results the turn ALREADY fetched.
 *
 * The derivation layer (system-reads.ts) has been merged and unused: it computes what each product
 * independently thinks about an instrument, but nothing ever fed it. This is the feed — and it
 * costs NOTHING EXTRA, because it reads `capturedResults`, the raw output of the tools Largo called
 * anyway. Re-fetching flow and positioning to build a consensus strip would double the upstream
 * calls for data already sitting in memory, and would additionally risk the strip disagreeing with
 * the answer above it because the two reads happened at different instants.
 *
 * MATCHED BY STRUCTURE, NOT BY TOOL NAME. `capturedResults` is an untyped array with no record of
 * which tool produced which entry, so each extractor below recognises its input by shape — a flow
 * tape has a `recent` array of premium-bearing prints; a positioning read has `gamma_posture` and
 * `flip`. Shape matching also means a tool renaming cannot silently empty the strip.
 *
 * A SYSTEM THAT WAS NOT CONSULTED GETS NO ROW. If the turn never called the flow tape, HELIX is
 * absent entirely rather than present as `no-read` — "we did not ask" is not the same as "we asked
 * and it had nothing", and system-reads.ts reserves `no-read` for the second. Presenting an
 * unconsulted system as a silent one would understate the desk's agreement.
 *
 * PURE AND TOTAL: no IO, no clock, no throw.
 */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** A flow tape: `recent` array whose entries carry a premium and an option type. */
function findFlowTape(results: readonly unknown[]): { net: number; gross: number; count: number } | null {
  for (const r of results) {
    if (!isRecord(r) || !Array.isArray(r.recent)) continue;
    let net = 0;
    let gross = 0;
    let count = 0;
    for (const p of r.recent) {
      if (!isRecord(p)) continue;
      const prem = num(p.premium);
      if (prem == null || prem <= 0) continue;
      const isPut = String(p.option_type ?? "").toUpperCase().startsWith("P");
      net += isPut ? -prem : prem;
      gross += prem;
      count++;
    }
    if (count > 0) return { net, gross, count };
  }
  return null;
}

/** A positioning read: carries the dealer gamma posture and the flip level. */
function findPositioning(results: readonly unknown[]): { spot: number | null; flip: number | null } | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    // `gamma_posture` is the discriminator — `spot`/`flip` alone appear on several payloads.
    if (!("gamma_posture" in r)) continue;
    return { spot: num(r.spot), flip: num(r.flip ?? r.gamma_flip) };
  }
  return null;
}

/** A Vector state: carries its own derived `play`. */
function findVectorPlay(results: readonly unknown[]): { bias?: string | null; grade?: string | null; conviction?: number | null } | null {
  for (const r of results) {
    if (!isRecord(r)) continue;
    const play = r.play;
    if (isRecord(play) && ("bias" in play || "grade" in play)) {
      return {
        bias: typeof play.bias === "string" ? play.bias : null,
        grade: typeof play.grade === "string" ? play.grade : null,
        conviction: num(play.conviction),
      };
    }
  }
  return null;
}

/** Night Hawk plays for the instrument under discussion. */
function findNightHawkPlays(
  results: readonly unknown[],
  ticker: string | null
): Array<{ direction?: string | null; status?: string | null }> | null {
  if (!ticker) return null;
  const want = ticker.toUpperCase();
  for (const r of results) {
    if (!isRecord(r)) continue;
    const rows = r.sample_plays ?? r.committed ?? r.ledger;
    if (!Array.isArray(rows)) continue;
    const mine = rows.filter(
      (p): p is Record<string, unknown> => isRecord(p) && String(p.ticker ?? "").toUpperCase() === want
    );
    // An empty filter over a real lane IS a finding ("no plays on this name"), so return [] rather
    // than null once we have found the lane.
    return mine.map((p) => ({
      direction: typeof p.direction === "string" ? p.direction : null,
      status: typeof p.status === "string" ? p.status : null,
    }));
  }
  return null;
}

export type SystemReadsBlock = { reads: SystemRead[]; agreement: SystemAgreement };

/**
 * Build the SYSTEM READS block for a turn.
 *
 * Returns null when fewer than two systems were consulted: a "consensus" strip showing one row is
 * not a consensus, and `agreementOf` would correctly call it `insufficient` — rendering a
 * cross-system panel to say "one system looked" costs more attention than it returns.
 */
export function extractSystemReads(
  capturedResults: readonly unknown[] | null | undefined,
  ticker: string | null
): SystemReadsBlock | null {
  const results = capturedResults ?? [];
  if (!results.length) return null;

  const reads: SystemRead[] = [];

  const flow = findFlowTape(results);
  if (flow) reads.push(helixFlowRead({ netPremium: flow.net, grossPremium: flow.gross, printCount: flow.count }));

  const vector = findVectorPlay(results);
  if (vector) reads.push(vectorPlayRead(vector));

  const nh = findNightHawkPlays(results, ticker);
  if (nh) reads.push(nightHawkRead(nh));

  const pos = findPositioning(results);
  if (pos) reads.push(gammaRegimeRead({ spot: pos.spot, gammaFlip: pos.flip }));

  if (reads.length < 2) return null;
  return { reads, agreement: agreementOf(reads) };
}
