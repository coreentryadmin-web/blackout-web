/**
 * The trading calendar Largo is handed every turn.
 *
 * THE BUG THIS EXISTS TO PREVENT. The turn block used to say exactly this, and nothing else:
 *
 *     Session date (ET): 2026-08-20
 *
 * A bare ISO date carries no weekday and no notion of whether a date is even tradeable. Asked
 * "how is SPX looking for 8/23?", the model had to INFER the weekday, guessed "Friday", and then
 * built a full thesis — walls, invalidation, "into Friday close" — on 2026-08-23, which is a
 * SUNDAY. There is no 8/23 SPX expiry. Nothing in the prompt could have contradicted it, and no
 * tool call would have been prompted to check, so the answer came back confident and wrong.
 *
 * That failure mode is worse than a verbose answer: a member can detect padding, but cannot
 * detect a fabricated expiry. So the calendar is now supplied as FACT rather than left to
 * inference — the model is told the weekday of today, the real upcoming trading days, and
 * explicitly which nearby dates are NOT tradeable and why.
 *
 * `isTradingDayEt`/`isMarketHolidayEt` already existed in features/nighthawk/lib/session.ts with a
 * real NYSE holiday table through 2029. They were simply never wired to Largo. This module is the
 * wiring, kept pure and separate so the behaviour is unit-testable without standing up a turn.
 */

import {
  formatEtDate,
  isMarketHolidayEt,
  isTradingDayEt,
} from "@/features/nighthawk/lib/session";

/** ET weekday name for a `YYYY-MM-DD`, e.g. "Sunday". */
export function weekdayEt(ymd: string): string {
  // Noon anchor: parsing `YYYY-MM-DD` alone is UTC-midnight, which lands on the PREVIOUS ET day
  // for any negative offset and would report the wrong weekday for every date.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
  }).format(new Date(`${ymd}T12:00:00`));
}

export type DayKind = "trading" | "weekend" | "holiday";

export interface CalendarDay {
  ymd: string;
  weekday: string;
  kind: DayKind;
}

export function classifyEtDay(ymd: string): CalendarDay {
  const weekday = weekdayEt(ymd);
  let kind: DayKind = "trading";
  // Order matters for the LABEL, not the verdict: a holiday that falls on a weekend should read
  // as a weekend, since that is the reason a member would recognise.
  if (weekday === "Saturday" || weekday === "Sunday") kind = "weekend";
  else if (isMarketHolidayEt(ymd)) kind = "holiday";
  return { ymd, weekday, kind };
}

function addDaysEt(ymd: string, days: number): string {
  return formatEtDate(new Date(new Date(`${ymd}T12:00:00`).getTime() + days * 86_400_000));
}

/**
 * The next `count` NYSE trading days strictly after `fromYmd`, plus the non-trading days skipped
 * along the way. Both halves are needed: the trading days answer "when CAN I trade", and the
 * skipped days are what stop the model inventing an expiry on one of them.
 */
export function upcomingSessions(
  fromYmd: string,
  count = 5
): { trading: CalendarDay[]; skipped: CalendarDay[] } {
  const trading: CalendarDay[] = [];
  const skipped: CalendarDay[] = [];
  let cursor = fromYmd;
  // Bounded: 21 calendar days comfortably covers 5 sessions across a holiday week, and a bare
  // `while` here would spin forever on a malformed date rather than fail visibly.
  for (let i = 0; i < 21 && trading.length < count; i++) {
    cursor = addDaysEt(cursor, 1);
    const day = classifyEtDay(cursor);
    if (isTradingDayEt(cursor)) trading.push(day);
    else skipped.push(day);
  }
  return { trading, skipped };
}

/**
 * The calendar block injected into every turn.
 *
 * Written as flat assertions rather than prose: this is reference data the model checks a date
 * against, not something it should paraphrase back to the member.
 */
/**
 * `etMinutesNow` — minutes since ET midnight, when the caller knows them.
 *
 * The SETTLED decision is made HERE, not by the caller, because it needs the calendar's own
 * trading-day classification. A caller passing a market-phase enum cannot make it correctly:
 * `CLOSED` covers both 11pm Thursday (today HAS settled) and 2am Thursday (today has NOT), and
 * getting that backwards would announce a settled expiry twelve hours early — a new defect in
 * place of the old one.
 *
 * Optional, so every existing caller and test is unaffected; omit it and the block reads exactly
 * as before.
 */
export function formatSessionCalendarBlock(
  todayYmd: string,
  count = 5,
  etMinutesNow?: number
): string {
  const today = classifyEtDay(todayYmd);
  // A trading day, past the 16:00 ET cash close. Non-trading days are NOT marked settled — the
  // block already states "NOT a trading day" for those, and "today's options have settled" would
  // be a strange thing to tell someone on a Saturday.
  const settled =
    today.kind === "trading" && typeof etMinutesNow === "number" && etMinutesNow >= 16 * 60;
  const { trading, skipped } = upcomingSessions(todayYmd, count);
  const fmt = (d: CalendarDay) => `${d.ymd} (${d.weekday})`;

  const lines = [
    `Session date (ET): ${fmt(today)}${today.kind === "trading" ? "" : ` — NOT a trading day (${today.kind})`}`,
    `Next trading sessions (ET): ${trading.map(fmt).join(", ")}`,
  ];
  if (skipped.length) {
    lines.push(
      `NOT trading days: ${skipped.map((d) => `${fmt(d)} — ${d.kind}`).join(", ")}`
    );
  }
  if (settled) {
    // WITHOUT THIS, "0DTE" SILENTLY MEANS A SETTLED SESSION.
    //
    // The block already carried the session DATE and a rule saying "check here before you state a
    // DTE" — but nothing said whether that session was still open, so `0DTE = today` was the only
    // inference available. Market phase WAS computed and DID reach the prompt, but only as a voice
    // instruction ("Off-hours: shorter answers"), never as a fact.
    //
    // MEASURED ON PROD 2026-08-20 at ~16:45 ET, after the close: "What is the current 0DTE max
    // pain?" answered "SPX 0DTE max pain is **7685**". 7685 was CORRECT — it is the max pain for
    // 2026-08-21, and the chain had properly rolled (`expiries[0] = 2026-08-21`). The DATA was
    // right and the LABEL was wrong: post-close, 8/21 is 1DTE, not 0DTE. Right number, settled
    // session — the same family as the Sunday-expiry defect, and on a term where a trader depends
    // on the precision.
    lines.push(
      `EXPIRY STATUS: today's (${todayYmd}) options have SETTLED — the session is over. "0DTE" no ` +
        `longer refers to ${todayYmd}. The front expiry is now ${trading[0]?.ymd ?? "the next session"}, ` +
        `which is 1DTE until that session opens. Count DTE from the next trading session, and if a ` +
        `member says "0DTE" after the close, say which expiry you are actually quoting.`
    );
  }
  lines.push(
    // The instruction is as important as the data. Supplying the calendar without saying what to
    // do with it still permits "8/23 (Friday)" — the model has to be told that a date the member
    // names is a claim to CHECK, not a premise to accept.
    `DATE RULE: the list above is authoritative. Before you state a weekday, a DTE, or an expiry ` +
      `for ANY date, check it here. If a member names a date that is not a trading day, say so ` +
      `plainly and give the nearest sessions instead — never build a thesis, an expiry or a DTE ` +
      `on it. Never infer a weekday you have not read off this list.`
  );
  return lines.join("\n");
}
