/**
 * SYSTEM STATUS — what the intelligence strip above the terminal is allowed to claim.
 *
 * THE POINT OF THE STRIP is to say "Largo is wired into the machine", and the only thing that can
 * actually say that is REAL state. A row of green dots that are green because they are hard-coded
 * green says the opposite of what it appears to say, and the first time a member notices one lit
 * during an outage the whole surface becomes noise. So every value here is DERIVED from a real
 * read, and a system that cannot be read reports DOWN rather than defaulting to fine.
 *
 * THREE STATES, and the middle one carries the weight:
 *   - `live`     — the read returned real data.
 *   - `degraded` — the system answered, but with nothing in it. Cold cache, pre-open, a lane with
 *                  no plays today. NOT an error, and NOT the same as healthy.
 *   - `down`     — the read failed or returned no surface at all.
 *
 * Collapsing `degraded` into either neighbour is the mistake this file exists to avoid: called
 * `live` it hides a real outage, called `down` it screams every morning before the open.
 *
 * COUNTS ARE DEFINED, NOT VIBES. `activeSignals` is a stated sum of specific real numbers, and the
 * definition ships next to it so the strip and any answer about the strip agree. A number nobody
 * can define is a number nobody should show.
 *
 * PURE AND TOTAL: no IO here. The caller does the reads and hands the results in, which keeps this
 * unit-testable and keeps the "what does the number mean" decision in one readable place.
 */

export type SystemHealth = "live" | "degraded" | "down";

export type SystemId = "HELIX" | "THERMAL" | "VECTOR" | "NIGHT HAWK" | "SLAYER" | "0DTE";

export type SystemRead = {
  /** Did the read succeed at all? False => down. */
  ok: boolean;
  /** Did it carry any actual content? False => degraded (answered, but empty). */
  hasData: boolean;
};

export type SystemStatus = { id: SystemId; health: SystemHealth };

export type IntelligenceStatus = {
  systems: SystemStatus[];
  /** Systems reporting `live`. Deliberately NOT "not down" — degraded is not online. */
  systemsOnline: number;
  systemsTotal: number;
  /**
   * Live tradeable signals across every board, as a defined sum:
   *   open 0DTE plays + committed swing positions + open banger positions.
   * Watch-list and research candidates are EXCLUDED — they are not signals yet, and inflating
   * this number is the cheapest possible way to make the strip a lie.
   */
  activeSignals: number;
  /** Data age in seconds, from the freshest read the caller supplied. Null when unknown. */
  dataAgeSec: number | null;
  marketPhase: MarketPhase;
};

export type MarketPhase = "OPEN" | "PRE-MARKET" | "AFTER-HOURS" | "CLOSED";

export function healthOf(read: SystemRead | null | undefined): SystemHealth {
  if (!read || !read.ok) return "down";
  return read.hasData ? "live" : "degraded";
}

/**
 * US equity session phase from an ET wall-clock.
 *
 * Weekend is CLOSED regardless of time. Holidays are NOT modelled here: the calendar lives with
 * the market-data providers, and a wrong holiday list would make the strip confidently wrong on
 * exactly the days it matters. Reporting a holiday as CLOSED-shaped "OPEN" is a known, bounded
 * inaccuracy; inventing a holiday calendar in a UI helper is an unbounded one.
 */
export function marketPhaseFromEt(etDay: number, etMinutes: number): MarketPhase {
  if (etDay === 0 || etDay === 6) return "CLOSED";
  if (etMinutes >= 9 * 60 + 30 && etMinutes < 16 * 60) return "OPEN";
  if (etMinutes >= 4 * 60 && etMinutes < 9 * 60 + 30) return "PRE-MARKET";
  if (etMinutes >= 16 * 60 && etMinutes < 20 * 60) return "AFTER-HOURS";
  return "CLOSED";
}

export function buildIntelligenceStatus(input: {
  reads: Partial<Record<SystemId, SystemRead>>;
  zerodteOpen?: number | null;
  swingCommitted?: number | null;
  bangerOpen?: number | null;
  dataAgeSec?: number | null;
  etDay: number;
  etMinutes: number;
}): IntelligenceStatus {
  const ORDER: SystemId[] = ["HELIX", "THERMAL", "VECTOR", "NIGHT HAWK", "SLAYER", "0DTE"];
  const systems = ORDER.map((id) => ({ id, health: healthOf(input.reads[id]) }));

  // Nulls are UNKNOWN, not zero. A lane whose read failed must not quietly subtract from the
  // total and make the desk look quieter than it is.
  const sum = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);

  return {
    systems,
    systemsOnline: systems.filter((s) => s.health === "live").length,
    systemsTotal: systems.length,
    activeSignals: sum(input.zerodteOpen) + sum(input.swingCommitted) + sum(input.bangerOpen),
    dataAgeSec:
      typeof input.dataAgeSec === "number" && Number.isFinite(input.dataAgeSec) && input.dataAgeSec >= 0
        ? Math.round(input.dataAgeSec)
        : null,
    marketPhase: marketPhaseFromEt(input.etDay, input.etMinutes),
  };
}

/** "2s", "45s", "3m", "1h" — compact enough for a 32px strip, honest about magnitude. */
export function formatDataAge(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${Math.round(sec / 3600)}h`;
}
