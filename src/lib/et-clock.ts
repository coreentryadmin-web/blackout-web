// Single source of truth for rendering a WALL-CLOCK TIME on this product's surfaces.
//
// Pure + alias-free + no "server-only": importable from client components AND server modules, and
// directly unit-testable under `tsx --test`. Sibling of et-date.ts, which owns the ET session-DATE
// string; this file owns the time-of-day half and deliberately does not touch it.
//
// WHY THIS EXISTS
//
// A markets desk quotes one clock: US/Eastern. The session bar, the GEX matrix "as of", the Vector
// rails and the 0DTE timeline all pin `timeZone: "America/New_York"` explicitly. But every one of
// them hand-rolled its own `toLocaleTimeString` options, and a formatter that omits `timeZone`
// silently renders in the VIEWER'S timezone instead — with no error, and looking perfectly fine to
// anyone developing or testing in Eastern.
//
// Eleven call sites had drifted that way. The clearest was MeridianHero, which appended a literal
// " ET" to a viewer-local time, so a member in London read "As of 07:30 PM ET" at 2:30 PM ET. Others
// put two clocks on one screen: /dashboard renders the Pulse and Largo rails (viewer-local) directly
// beside the GEX matrix as-of (Eastern), three hours apart on the US West Coast.
//
// The lesson is that the timezone cannot be a per-call-site option people remember to pass. It is a
// property of the product. So it lives here, it is not overridable, and a test asserts no surface
// formats a time any other way.

const ET_TIME_ZONE = "America/New_York";

export type EtClockOptions = {
  /** Include seconds. Default false. */
  seconds?: boolean;
  /** 12-hour with AM/PM (true, default) or 24-hour. */
  hour12?: boolean;
  /** Zero-pad the hour ("02:30 PM" vs "2:30 PM"). Default false. */
  pad?: boolean;
};

/**
 * Formatters are constructed once per distinct shape and reused.
 *
 * `Intl.DateTimeFormat` construction is the expensive part of formatting, and these render inside
 * per-row list maps — the tape, the pulse feed, the flow stream. The code being replaced built a
 * fresh formatter for every row on every render via `Date.prototype.toLocaleTimeString`.
 */
const cache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(opts: Required<EtClockOptions>): Intl.DateTimeFormat {
  const key = `${opts.seconds}|${opts.hour12}|${opts.pad}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: ET_TIME_ZONE,
      hour: opts.pad ? "2-digit" : "numeric",
      minute: "2-digit",
      ...(opts.seconds ? { second: "2-digit" as const } : {}),
      hour12: opts.hour12,
    });
    cache.set(key, f);
  }
  return f;
}

/** Epoch ms from whatever a caller has to hand, or null if it isn't a real instant. */
function toMs(at: number | string | Date | null | undefined): number | null {
  if (at == null) return null;
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * A wall-clock time in US/Eastern — the only clock this product quotes.
 *
 * Returns null (not "Invalid Date", and not a fabricated time) when the input is missing or
 * unparseable, so callers render their own em-dash rather than a string that looks like data.
 */
export function etClock(
  at: number | string | Date | null | undefined,
  opts: EtClockOptions = {}
): string | null {
  const ms = toMs(at);
  if (ms == null) return null;
  const { seconds = false, hour12 = true, pad = false } = opts;
  try {
    return formatterFor({ seconds, hour12, pad }).format(ms);
  } catch {
    // A runtime without full ICU can throw on a named zone. Returning null keeps the caller's
    // empty state rather than falling back to a local-time string — which is the exact bug this
    // module exists to remove, and it would be invisible again.
    return null;
  }
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Short ET date + time ("Aug 19, 2:30 PM") for rows that can span more than one session.
 *
 * The locale is pinned as well as the zone. BangerBoard passed `undefined` as its locale, which
 * takes the VIEWER's — so the same row rendered "19 Aug, 14:30" in one browser and "Aug 19, 2:30 PM"
 * in another, and would additionally mismatch on hydration if it were ever server-rendered.
 */
export function etDateTimeShort(
  at: number | string | Date | null | undefined,
  opts: { seconds?: boolean } = {}
): string | null {
  const ms = toMs(at);
  if (ms == null) return null;
  const seconds = opts.seconds ?? false;
  const key = String(seconds);
  let f = dateTimeCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: ET_TIME_ZONE,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(seconds ? { second: "2-digit" as const } : {}),
    });
    dateTimeCache.set(key, f);
  }
  try {
    return f.format(ms);
  } catch {
    return null;
  }
}
