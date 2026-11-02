/**
 * When should FlowBrief.tsx's market-open poller force an immediate brief fetch?
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────
 *
 * FlowBrief.tsx polls `isEtCashRth()` every 60s on its OWN interval, separate from the one that
 * actually fetches a fresh brief (`refresh()`, on mount + every 15 minutes):
 *
 *     useEffect(() => {
 *       const id = setInterval(() => setMarketOpen(isEtCashRth()), 60_000);
 *       return () => clearInterval(id);
 *     }, []);
 *
 * That poller only flips the `marketOpen` boolean — it never calls `refresh()`, so it never fetches.
 * The two states this produces at the 9:30 ET open, on a tab that has been open since before then:
 *
 *   1. Opened fresh while the market was still closed: `refresh()` on mount saw `isEtCashRth()`
 *      false and returned without fetching, so `brief` is still `null`. At 9:30 the 60s poller
 *      flips `marketOpen` true within a minute, `showAfterHours` goes false, and `displayText`
 *      becomes `brief` — `null`. `!displayText && !loading` is true, so the component renders
 *      NOTHING. The whole "AI brief · Live" banner silently disappears for up to 15 minutes at the
 *      single most important moment of the trading day, with no loading indicator either.
 *
 *   2. Left open overnight across the close→open boundary: `brief` still holds YESTERDAY's last
 *      fetched text (kept on purpose so the after-hours view doesn't flash — see the component's
 *      own comment on "preserve last RTH brief text across the 4 PM boundary"). At 9:30 the same
 *      poller flips `marketOpen` true, and `displayText` becomes that stale text — rendered under
 *      the "AI brief · Live · as of <yesterday's close time> ET" label, reading as a current,
 *      authoritative read of this morning's flow when it is in fact ~17-18 hours old.
 *
 * Either way, nothing refetches until the 15-minute `refresh()` interval happens to land again,
 * which can be up to 15 minutes after the open — the component's OWN freshness label
 * (`fmtAsOf`/`generatedAt`) is the thing CLAUDE.md's absence/freshness discipline exists to keep
 * honest, and for up to 15 minutes at the open it is either hidden entirely (case 1) or quietly
 * wrong (case 2).
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────────────────────────
 *
 * The 60s poller already has everything it needs to detect the one moment that matters — the
 * CLOSED → OPEN transition — without changing its cadence or fetching every 60s in steady state.
 * `shouldRefreshOnRthTransition` is that one comparison, pulled out so it is testable without a
 * timer/fetch harness (plain pure boolean logic) and so the component only has to call it.
 */
export function shouldRefreshOnRthTransition(wasOpen: boolean, isOpenNow: boolean): boolean {
  return !wasOpen && isOpenNow;
}
