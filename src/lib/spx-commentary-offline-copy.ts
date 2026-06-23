import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

export type CommentaryOfflineTone = "weekend" | "premarket" | "extended" | "closed";

export type CommentaryOfflineCopy = {
  tone: CommentaryOfflineTone;
  kicker: string;
  headline: string;
  body: string;
  tagline: string;
};

const POOLS: Record<CommentaryOfflineTone, CommentaryOfflineCopy[]> = {
  weekend: [
    {
      tone: "weekend",
      kicker: "◆ MARKETS LOCKED",
      headline: "MARKETS LOCKED",
      body: "No SPX session, no 0DTE window. Largo runs on live tape — there is none until Monday's open.",
      tagline: "The desk re-arms Monday pre-market.",
    },
    {
      tone: "weekend",
      kicker: "◆ WEEKEND",
      headline: "DESK STAND-DOWN",
      body: "Equity markets are closed through the weekend. Nothing to read until the bell.",
      tagline: "Largo returns Monday pre-market.",
    },
  ],
  premarket: [
    {
      tone: "premarket",
      kicker: "◆ PRE-MARKET",
      headline: "DESK WARMING UP",
      body: "GEX, flow and levels are loading. Largo goes live with the cash session.",
      tagline: "RTH opens 6:30 AM PT.",
    },
    {
      tone: "premarket",
      kicker: "◆ DAWN PATROL",
      headline: "SYSTEMS ONLINE",
      body: "GEX and flow are loading. Tonight's Night Hawk playbook is in. Largo arms at the bell.",
      tagline: "Pre-market standby before the 0DTE session.",
    },
  ],
  extended: [
    {
      tone: "extended",
      kicker: "◆ AFTER-HOURS",
      headline: "SESSION WRAPPED",
      body: "RTH is closed. Extended-hours prints are thin and unreliable — Largo waits for the cash session.",
      tagline: "Real structure resumes at the bell.",
    },
    {
      tone: "extended",
      kicker: "◆ 0DTE WINDOW CLOSED",
      headline: "WINDOW CLOSED",
      body: "The 0DTE window has closed for today. Night Hawk is already scoring tomorrow's playbook.",
      tagline: "Tomorrow's edition is being built.",
    },
  ],
  closed: [
    {
      tone: "closed",
      kicker: "◆ SIGNAL LOST",
      headline: "SIGNAL LOST",
      body: "No live SPX feed means no live intel. Largo doesn't make up data — it waits for real tape.",
      tagline: "Largo re-arms when the desk wakes. Precision doesn't guess.",
    },
    {
      tone: "closed",
      kicker: "◆ DESK DARK",
      headline: "DESK DARK",
      body: "The market just isn't open. No live feed, no live read — by design.",
      tagline: "Largo returns with the session. Patience is a position.",
    },
    {
      tone: "closed",
      kicker: "◆ STANDING BY",
      headline: "STANDING BY",
      body: "There is no live session to read right now. Largo surfaces intel only when the data is real.",
      tagline: "Structure resumes tomorrow.",
    },
  ],
};

function etWeekday(now = new Date()): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? 0;
}

export function commentaryOfflineTone(desk?: SpxDeskPayload | null): CommentaryOfflineTone {
  const day = etWeekday();
  if (day === 0 || day === 6) return "weekend";

  const label = desk?.market_label?.toUpperCase() ?? "";
  if (label.includes("PRE")) return "premarket";
  if (label.includes("EXTENDED")) return "extended";
  if (label.includes("CLOSED")) return "closed";
  return "closed";
}

/** Pick a stable-but-rotating offline card (changes hourly). */
export function pickCommentaryOfflineCopy(desk?: SpxDeskPayload | null): CommentaryOfflineCopy {
  const tone = commentaryOfflineTone(desk);
  const pool = POOLS[tone];
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    }).format(new Date())
  );
  return pool[(hour + dayIndex()) % pool.length] ?? pool[0];
}

function dayIndex(): number {
  return etWeekday();
}
