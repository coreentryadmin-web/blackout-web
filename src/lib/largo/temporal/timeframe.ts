import type { LargoCapability } from "@/lib/largo/registry/capability-registry";

/**
 * TEMPORAL RESOLUTION — turning "since open", "last 15 minutes", "when the trade fired" and
 * "yesterday" into an explicit window, and refusing to answer any of them from a live-only source.
 *
 * THE FAILURE THIS EXISTS TO PREVENT. Ask Largo "what did SPX look like at 10:15" and the obvious
 * thing happens: it calls the SPX tools, gets NOW, and writes a fluent, correctly-sourced,
 * fully-grounded answer about the wrong moment. Every downstream check passes — the numbers are
 * real, they trace to this turn's tool results, the contract is satisfied. Nothing catches it,
 * because nothing else in the system knows the question was about the past.
 *
 * So temporal intent is resolved in DETERMINISTIC CODE, before the model plans, and the resolved
 * window is checked against the capability registry's `temporal` class. A live-only source paired
 * with a historical question is a hard conflict the model is told about, not a subtlety it is
 * asked to notice.
 *
 * EVERYTHING IS EXPLICIT-`now`. No function here reads the clock. A temporal engine that calls
 * `Date.now()` internally cannot be tested at a boundary — and the boundaries (09:29 vs 09:31, the
 * DST changeover, a Sunday) are exactly where it will be wrong. The caller passes `now`.
 *
 * ET, NOT A FIXED OFFSET. Session boundaries are computed through `America/New_York`, so the
 * March/November DST transitions are correct without a hardcoded -5/-4 that is wrong for half the
 * year. Getting this wrong would shift "since open" by an hour twice a year, which is precisely
 * when a member is most likely to be asking.
 */

export type TimeframeKind =
  /** The live present. The only kind a `live_only` source may serve. */
  | "now"
  /** A bounded span with both ends known — "last 15 minutes", "since open", "yesterday". */
  | "window"
  /** One past instant — "at 10:15", "when the trade fired". */
  | "point"
  /** A count of trading sessions back — "last 30 sessions". */
  | "sessions";

export type Timeframe = {
  kind: TimeframeKind;
  /** Inclusive start, epoch ms. Null for `now`. */
  fromMs: number | null;
  /** Inclusive end, epoch ms. Equals `now` for windows that run to the present. */
  toMs: number;
  /** Session count for `kind: "sessions"`. */
  sessions?: number;
  /** Member-readable description, used verbatim in the answer so the window is never implicit. */
  label: string;
  /**
   * True when answering requires data from BEFORE now. The single most important field: it is what
   * makes "you cannot serve this from a live source" a checkable condition rather than a hope.
   */
  historical: boolean;
  /** The phrase that produced this, for diagnostics and for echoing back on an ambiguous parse. */
  matched: string | null;
};

const ET = "America/New_York";

/** Wall-clock parts in ET for an instant. Uses Intl so DST is handled, never a fixed offset. */
function etParts(ms: number): { y: number; m: number; d: number; hh: number; mm: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    // Intl renders midnight as "24" in some ICU versions under hour12:false — normalise it, or
    // "since open" on a question asked at 00:05 ET would compute against hour 24 and go negative.
    hh: Number(parts.hour) % 24,
    mm: Number(parts.minute),
    weekday: WD[String(parts.weekday)] ?? 0,
  };
}

/** ET offset in ms at a given instant (positive = behind UTC). Derived, never assumed. */
function etOffsetMs(ms: number): number {
  const p = etParts(ms);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
  // Round to the minute on both sides so seconds don't leak into the offset.
  return Math.round((asUtc - Math.floor(ms / 60_000) * 60_000) / 60_000) * 60_000;
}

/** The epoch ms of an ET wall-clock time on the ET calendar day containing `ms`. */
export function etTimeOnDay(ms: number, hh: number, mm: number): number {
  const p = etParts(ms);
  const guess = Date.UTC(p.y, p.m - 1, p.d, hh, mm) - etOffsetMs(ms);
  // One correction pass: if the guess lands on the other side of a DST boundary its own offset
  // differs, so recompute with the offset that actually applies there.
  const corrected = Date.UTC(p.y, p.m - 1, p.d, hh, mm) - etOffsetMs(guess);
  return corrected;
}

/** RTH open (09:30 ET) on the day containing `ms`. */
export function sessionOpenMs(ms: number): number {
  return etTimeOnDay(ms, 9, 30);
}

/** RTH close (16:00 ET) on the day containing `ms`. */
export function sessionCloseMs(ms: number): number {
  return etTimeOnDay(ms, 16, 0);
}

/** Is `ms` inside regular trading hours on a weekday? (Holidays are NOT modelled — see below.) */
export function isRegularHours(ms: number): boolean {
  const p = etParts(ms);
  if (p.weekday === 0 || p.weekday === 6) return false;
  const mins = p.hh * 60 + p.mm;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * Step back N trading days, skipping weekends.
 *
 * Market HOLIDAYS are deliberately not modelled here. A holiday calendar that silently goes stale
 * is worse than one that never existed, because it produces confidently-wrong session maths in
 * exactly the weeks that matter (Thanksgiving, July 4th). Callers that need true session alignment
 * pass a session count to a `windowed` capability and let the SERVER — which owns the real
 * calendar — resolve it. This helper exists for approximate labelling only, and its docstring is
 * the contract.
 */
export function previousWeekday(ms: number, n = 1): number {
  let cur = ms;
  let left = n;
  while (left > 0) {
    cur -= 24 * 60 * 60 * 1000;
    const wd = etParts(cur).weekday;
    if (wd !== 0 && wd !== 6) left -= 1;
  }
  return cur;
}

const MIN = 60_000;
const HOUR = 60 * MIN;

type Rule = {
  re: RegExp;
  build: (m: RegExpMatchArray, now: number) => Timeframe | null;
};

/**
 * Rules are ordered MOST SPECIFIC FIRST and the first match wins.
 *
 * "since the open today" must not be captured by a looser "today" rule, and "last 30 sessions"
 * must beat "last 30 minutes"'s number capture. Ordering is the whole correctness story here, so
 * new rules go in by specificity, not by convenience.
 */
const RULES: Rule[] = [
  {
    // `(minute|min|m)\b` was WRONG: there is no word boundary between the "e" of "minute" and
    // the "s" of "minutes", so the most common phrasing of all never matched and fell through to
    // the bare "what changed" rule, silently answering a 30-MINUTE question with a since-open
    // window. The plural belongs INSIDE the group.
    re: /\b(?:in|over|during)?\s*(?:the\s+)?(?:last|past)\s+(\d{1,3})\s*(?:minutes?|mins?|m)\b/i,
    build: (m, now) => window_(now - Number(m[1]) * MIN, now, `the last ${m[1]} minutes`, m[0]),
  },
  {
    re: /\b(?:in|over|during)?\s*(?:the\s+)?(?:last|past)\s+(\d{1,2})\s*(?:hours?|hrs?|h)\b/i,
    build: (m, now) => window_(now - Number(m[1]) * HOUR, now, `the last ${m[1]} hours`, m[0]),
  },
  {
    re: /\b(?:last|past)\s+(\d{1,3})\s*(?:trading\s+)?(?:session|day)s?\b/i,
    build: (m, now) => {
      const n = Number(m[1]);
      return {
        kind: "sessions",
        // Approximate only — the true boundary belongs to the server's session calendar.
        fromMs: previousWeekday(now, n),
        toMs: now,
        sessions: n,
        label: `the last ${n} sessions`,
        historical: true,
        matched: m[0],
      };
    },
  },
  {
    re: /\bsince\s+(?:the\s+)?(?:market\s+)?open\b|\bsince\s+9:?30\b|\bso far\s+today\b/i,
    build: (m, now) => window_(sessionOpenMs(now), now, "since the open", m[0]),
  },
  {
    re: /\bsince\s+(?:the\s+)?(?:previous|last|yesterday'?s)?\s*close\b/i,
    build: (m, now) => window_(sessionCloseMs(previousWeekday(now)), now, "since the prior close", m[0]),
  },
  {
    re: /\byesterday\b/i,
    build: (m, now) => {
      const y = previousWeekday(now);
      return window_(sessionOpenMs(y), sessionCloseMs(y), "yesterday's session", m[0]);
    },
  },
  {
    re: /\bthis\s+week\b|\bweek\s+to\s+date\b|\bwtd\b/i,
    build: (m, now) => window_(previousWeekday(now, 5), now, "this week", m[0]),
  },
  {
    re: /\blast\s+month\b|\bpast\s+month\b|\bmonth\s+to\s+date\b|\bmtd\b/i,
    build: (m, now) => window_(previousWeekday(now, 21), now, "the last month", m[0]),
  },
  {
    // "at 10:15", "at 10:15am" — a single past instant.
    re: /\bat\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b/i,
    build: (m, now) => {
      let hh = Number(m[1]);
      const mm = Number(m[2]);
      const mer = m[3]?.toLowerCase();
      if (mer === "pm" && hh < 12) hh += 12;
      if (mer === "am" && hh === 12) hh = 0;
      // No meridiem and an hour that cannot be a morning session time reads as afternoon —
      // "at 3:15" during a trading conversation means 15:15, never 03:15.
      if (!mer && hh < 9) hh += 12;
      if (hh > 23 || mm > 59) return null;
      const at = etTimeOnDay(now, hh, mm);
      // A time later than now must mean YESTERDAY, not the future.
      const resolved = at > now ? etTimeOnDay(previousWeekday(now), hh, mm) : at;
      return { kind: "point", fromMs: resolved, toMs: resolved, label: `at ${m[1]}:${m[2]} ET`, historical: true, matched: m[0] };
    },
  },
  {
    // Event-anchored. The instant is NOT resolvable here — it lives in the ledger — but flagging
    // it as historical is what stops a live source answering it.
    re: /\b(?:when|since)\s+(?:the\s+)?(?:trade|play|position|signal)\s+(?:fired|opened|triggered|was\s+committed|entered)\b/i,
    build: (m, now) => ({
      kind: "point",
      fromMs: null,
      toMs: now,
      label: "at the moment the trade fired",
      historical: true,
      matched: m[0],
    }),
  },
  {
    re: /\bsince\s+(?:i\s+)?(?:last\s+)?asked\b|\bsince\s+my\s+last\s+question\b/i,
    build: (m, now) => ({
      kind: "window",
      fromMs: null, // filled by the caller from conversation state
      toMs: now,
      label: "since your last question",
      historical: true,
      matched: m[0],
    }),
  },
  {
    re: /\b(?:what\s+)?changed\b|\bmoved\b|\bshifted\b|\bdifferent\s+(?:now|from)\b/i,
    // A bare "what changed" with no stated window. Defaulting silently to an hour would invent a
    // window the member never gave; the label says so and the caller can ask.
    build: (m, now) => ({
      kind: "window",
      fromMs: sessionOpenMs(now),
      toMs: now,
      label: "since the open (no window given — assumed)",
      historical: true,
      matched: m[0],
    }),
  },
  {
    re: /\btoday\b|\bthis\s+session\b/i,
    build: (m, now) => window_(sessionOpenMs(now), now, "today's session", m[0]),
  },
];

function window_(fromMs: number, toMs: number, label: string, matched: string): Timeframe {
  return { kind: "window", fromMs, toMs, label, historical: true, matched };
}

/** The default when a question carries no temporal language at all: the live present. */
export function nowTimeframe(now: number): Timeframe {
  return { kind: "now", fromMs: null, toMs: now, label: "right now", historical: false, matched: null };
}

/**
 * Resolve the timeframe a question is asking about.
 *
 * Returns the live present when no temporal language is present — the common case, and the one
 * that must stay fast. Never throws.
 */
export function resolveTimeframe(question: string, now: number): Timeframe {
  if (!question) return nowTimeframe(now);
  for (const rule of RULES) {
    const m = question.match(rule.re);
    if (!m) continue;
    const tf = rule.build(m, now);
    if (tf) return tf;
  }
  return nowTimeframe(now);
}

export type TemporalConflict = {
  capabilityId: string;
  tool: string;
  reason: string;
};

/**
 * Which of the planned capabilities cannot honestly serve this timeframe.
 *
 * `live_only` and `as_of` both return the present. `as_of` at least stamps when its data is from,
 * so it can support a freshness caveat — but neither can answer about a past moment, and offering
 * either for a historical question is how a confidently-wrong answer gets made.
 */
export function temporalConflicts(tf: Timeframe, capabilities: readonly LargoCapability[]): TemporalConflict[] {
  if (!tf.historical) return [];
  const out: TemporalConflict[] = [];
  for (const c of capabilities) {
    if (c.temporal === "live_only" || c.temporal === "as_of") {
      out.push({
        capabilityId: c.id,
        tool: c.tool,
        reason: `${c.id} is ${c.temporal} — it returns the present and cannot answer about ${tf.label}.`,
      });
    }
  }
  return out;
}

/**
 * The block appended to the turn's system context stating the resolved window and any conflicts.
 *
 * Deliberately instructs the model to SAY what it could not see rather than substitute the
 * present. "I can't see 10:15, here is now instead, and I am telling you that" is a good answer;
 * silently serving now is the failure.
 */
export function formatTemporalBlock(tf: Timeframe, conflicts: TemporalConflict[]): string {
  if (!tf.historical && conflicts.length === 0) return "";
  const lines = [`\n\n## Resolved timeframe`, `The question is about **${tf.label}**.`];
  if (tf.kind === "sessions" && tf.sessions) {
    lines.push(
      `Pass a session/day count of ${tf.sessions} to a windowed tool — do NOT compute the date range yourself.`
    );
  }
  if (tf.fromMs == null && tf.historical) {
    lines.push(
      `The exact start of that window is NOT resolvable from the question alone — read it from the ledger/conversation, and if you cannot, say so under **Data** instead of assuming one.`
    );
  }
  if (conflicts.length) {
    lines.push(
      `\nThese sources CANNOT answer it and must not be used as if they could:`,
      ...conflicts.map((c) => `- ${c.reason}`),
      `\nUse a windowed / point-in-time / event-log source instead. If none can cover ${tf.label}, say plainly under **Data** that the period is not retrievable — do NOT answer with the current state and present it as the answer to a question about the past.`
    );
  }
  return lines.join("\n");
}
