import { todayEtYmd, priorEtYmd } from "@/lib/providers/spx-session";

/**
 * ET-correct walk-back window for `loadDailyRegime` (vector-daily-regime-server.ts).
 *
 * Extracted to a plain (non `server-only`) module so it can be unit-tested directly — the caller
 * carries `import "server-only"`, which throws under a plain test-runner import.
 *
 * `todayYmd` is passed into `loadSessionWallTail` as the clock that decides "is this session
 * settled?" (`sessionYmd < todayYmd`), and the per-day walk-back must land on the SAME calendar
 * day `todayYmd` names at index 0 — both MUST be derived from the ET trading date, never a UTC
 * calendar slice. During roughly 19:00–23:59 ET, UTC has already rolled over to the next calendar
 * day while the ET session is still "today": a UTC-derived `todayYmd` is then one day ahead of the
 * real trading day, which makes `sessionYmd < todayYmd` misclassify TODAY's own session as
 * "settled" and route it to the historical-DB-mirror tail read — which, per
 * `loadSessionWallTail`'s own comment, "lags the live recorder" — instead of the full live read
 * the un-settled branch exists to give today's still-fresh session.
 */
export function dailyRegimeWalkWindow(count: number): { todayYmd: string; ymds: string[] } {
  const todayYmd = todayEtYmd();
  const ymds: string[] = [];
  for (let i = 0; i < count; i++) ymds.push(priorEtYmd(i));
  return { todayYmd, ymds };
}
