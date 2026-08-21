/**
 * Shape the app's own earnings-calendar read into a model-facing tool result.
 *
 * WHY THIS IS A SEPARATE PURE MODULE (don't inline it back into run-tool.ts): the bug this
 * exists to prevent was a SHAPE mis-read, and shape bugs are exactly what a unit test catches
 * cheaply. `callInternalApiRead` returns a transport ENVELOPE — `{ ok, status, path, area,
 * data }` — and the route's own body (`{ earnings, configured }`) lives under `data`. The
 * get_earnings_calendar case used to test `"earnings" in res` against that envelope, which is
 * never true, so the calendar map was ALWAYS `{}` and every ticker-filtered call answered
 * "No upcoming date for <TICKER>" no matter what the calendar held. Nothing threw and nothing
 * logged — the reply is a fluent, plausible sentence, which is why it survived.
 *
 * It could not be regression-tested where it lived: run-tool.ts reaches the reader through a
 * DYNAMIC `import("@/lib/bie/internal-api")`, and the `@/` alias does not resolve for dynamic
 * specifiers under the test runner (all 30 of run-tool's dynamic `@/` imports share this), so
 * the case is unreachable from run-tool.test.ts. Keeping the decision logic here — pure, no
 * transport, no `server-only` — makes it directly testable and leaves run-tool.ts holding
 * nothing but the fetch.
 *
 * THE SECOND BUG, which is the one that actually misleads a member: the old code answered
 * `configured: true` unconditionally. Three very different states were being collapsed into
 * one confident "this ticker has no upcoming report":
 *   - the read FAILED            → we do not know anything
 *   - the calendar is UNCONFIGURED → it is empty for every ticker on earth, a fact about our
 *                                    deployment, not about the ticker
 *   - the calendar is configured and genuinely has no date in its 3-month horizon
 * Only the third is evidence about the ticker. They are kept distinct below and named in the
 * payload so the model cannot re-collapse them.
 */

/** The transport envelope `callInternalApiRead` returns. */
export type EarningsCalendarEnvelope = {
  ok: boolean;
  status?: number;
  error?: string;
  data?: unknown;
};

export type EarningsCalendarRead =
  | {
      available: false;
      configured: null;
      earnings: Record<string, never>;
      ticker?: string;
      error: string;
      note: string;
    }
  | {
      available: true;
      configured: boolean;
      ticker: string;
      next_report_date: string | null;
      earnings: Record<string, string>;
      note?: string;
    }
  | {
      available: true;
      configured: boolean;
      count: number;
      earnings: Record<string, string>;
    };

type CalendarBody = {
  earnings?: Record<string, string>;
  configured?: boolean;
  error?: string;
};

/**
 * @param envelope what `callInternalApiRead("/api/market/earnings-calendar")` returned
 * @param ticker   already normalized (uwTicker); null for the market-wide read
 */
export function shapeEarningsCalendarRead(
  envelope: EarningsCalendarEnvelope | null | undefined,
  ticker: string | null
): EarningsCalendarRead {
  const body =
    envelope?.ok && envelope.data && typeof envelope.data === "object"
      ? (envelope.data as CalendarBody)
      : null;

  if (!body) {
    return {
      available: false,
      configured: null,
      earnings: {},
      ...(ticker ? { ticker } : {}),
      error:
        envelope?.error ?? `earnings-calendar read failed (HTTP ${envelope?.status ?? "n/a"})`,
      note: "The earnings calendar could not be read. This is NOT evidence that any ticker lacks an upcoming report date.",
    };
  }

  // `configured` is the ROUTE's own answer about whether ALPHAVANTAGE_API_KEY is set. Default
  // to false rather than true: an absent flag means we did not learn that it is configured,
  // and the honest default for "did not learn" is the one that makes the caller say so.
  const configured = body.configured === true;
  const earnings = body.earnings ?? {};

  if (ticker) {
    // hasOwnProperty, not a bare lookup: `earnings` is a plain object built from upstream CSV,
    // so `earnings[ticker]` would also resolve inherited Object.prototype members for a symbol
    // colliding with one, handing back a function where a date belongs.
    const date = Object.prototype.hasOwnProperty.call(earnings, ticker)
      ? earnings[ticker]
      : null;
    return {
      available: true,
      configured,
      ticker,
      next_report_date: date ?? null,
      // Object.fromEntries rather than a `{ [ticker]: date }` computed-key literal — the repo
      // treats dynamic-key assignment syntax as a property-injection sink regardless of taint.
      earnings: date ? Object.fromEntries([[ticker, date]]) : {},
      ...(date
        ? {}
        : {
            note: configured
              ? `No upcoming report date for ${ticker} within the calendar's 3-month horizon.`
              : `Earnings calendar is not configured, so it holds no dates for ANY ticker — this is NOT evidence that ${ticker} has no upcoming report.`,
          }),
    };
  }

  return {
    available: true,
    configured,
    count: Object.keys(earnings).length,
    earnings,
  };
}
