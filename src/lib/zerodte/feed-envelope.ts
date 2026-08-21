/**
 * What an EMPTY 0DTE plays payload means — the one place both Largo surfaces agree.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────────────────────────
 *
 * #2477 fixed "a ledger outage was reported to members as a quiet session" in `zeroDtePlaysFeed`
 * (scan.ts), which backs the Largo LIVE FEED. Validated on production afterwards, the defect was
 * still there — because `get_zerodte_plays`, the TOOL a member's question actually routes to,
 * does not call that function. It calls `zeroDtePlaysForLargo` in `platform/zerodte-service.ts`,
 * a second Largo-facing surface built from the board payload, and that one returned:
 *
 *     source, session_date, plays: [], fresh_finds: [], excluded_covered_elsewhere, rules
 *
 * with no `available`, no `upstream_ok`, no `degraded`, no `reason` and no `note` — measured
 * against production 2026-08-21. One fix, two surfaces, only one of them fixed.
 *
 * The board itself is not at fault and is careful about this: when the committed set cannot be
 * read it blanks `setups`, refuses to print fresh finds, and sets `upstream_ok: upstream_ok &&
 * committedKnown` — its own comment says that flag is "what marks the board itself degraded". And
 * `buildMinimalBoardFallback()` returns `upstream_ok: false` with an empty ledger for exactly the
 * Redis-and-build-both-down case. The fact was there the whole time. The tool payload dropped it,
 * so the model saw an empty list and no reason to doubt it.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 *
 * An empty list must say WHICH empty it is. "The scanner ran and nothing cleared the gates" and
 * "we could not see the ledger" serialize to the same `[]`, and only one of them is reportable to
 * a member. When the answer is unknown the `plays` key is ABSENT — not empty — so that nothing
 * downstream can count zero and call it a measurement.
 *
 * Both Largo surfaces now derive their empty states here, which is the actual guarantee: they
 * cannot drift apart into two different meanings for the same silence.
 */

/**
 * The two empty states for the committed-plays feed.
 *
 * `committedKnown` is "do we actually know what was committed this session" — the ledger read
 * succeeded, or a same-session last-good read stands in for it.
 */
export function zeroDteFeedEmptyEnvelope(
  committedKnown: boolean,
  session_date: string
): Record<string, unknown> {
  if (!committedKnown) {
    // An UNKNOWN. Largo's system prompt treats this feed as the authoritative source for the
    // turn, so reporting a quiet session here tells a member "no plays today" during an outage.
    return {
      available: false,
      degraded: true,
      reason: "ledger_unreadable",
      session_date,
      note:
        "Today's committed 0DTE ledger could not be read and this replica has not seen it this " +
        "session. This is NOT 'no plays today' — the committed set is UNKNOWN. Say the ledger " +
        "is unreadable rather than reporting a quiet session.",
    };
  }
  // A real, reportable answer: the scanner ran and nothing cleared the gates.
  return {
    available: true,
    session_date,
    plays: [],
    state: "no_plays_committed",
    note:
      "The 0DTE scanner is running and no setup has cleared the commit gates this session — " +
      "a MEASURED empty result, not a missing read. Report it as a quiet session.",
  };
}

/**
 * The same distinction for `get_zerodte_plays`, which is built from the BOARD payload rather than
 * from a direct ledger read. `upstreamOk` is the board's own degraded flag, which already folds in
 * `committedKnown` (`upstream_ok && committedKnown` at its construction site) — so it answers the
 * same question this envelope asks, and is the right key to hang it on.
 *
 * Returns only the envelope fields; the caller spreads them alongside `source`/`rules`/etc.
 */
export function zeroDtePlaysToolEnvelope(args: {
  upstreamOk: boolean;
  session_date: string;
  playCount: number;
}): Record<string, unknown> {
  const { upstreamOk, session_date, playCount } = args;

  if (!upstreamOk && playCount === 0) {
    // No `plays` key at all — see the rule above. An empty array here is what let the outage read
    // as a quiet session in the first place.
    return {
      available: false,
      degraded: true,
      upstream_ok: false,
      reason: "board_upstream_unavailable",
      session_date,
      note:
        "The 0DTE board could not be built or read for this session, so the committed set is " +
        "UNKNOWN. This is NOT 'no plays today' — say the board is unavailable rather than " +
        "reporting a quiet session. There is deliberately no plays list to count.",
    };
  }

  if (playCount === 0) {
    return {
      available: true,
      upstream_ok: true,
      session_date,
      state: "no_plays_committed",
      note:
        "The 0DTE scanner is running and no setup has cleared the commit gates this session — " +
        "a MEASURED empty result, not a missing read. Report it as a quiet session.",
    };
  }

  if (!upstreamOk) {
    // Known plays served off a board whose upstream is degraded: the rows are real, but their
    // marks and statuses may be stale. Reportable, with the caveat attached rather than implied.
    return {
      available: true,
      degraded: true,
      upstream_ok: false,
      session_date,
      state: "plays_committed",
      note:
        "These committed plays are real, but the board's upstream is degraded — marks, statuses " +
        "and any fresh finds may be stale. Say so when quoting live P&L.",
    };
  }

  return { available: true, upstream_ok: true, session_date, state: "plays_committed" };
}
