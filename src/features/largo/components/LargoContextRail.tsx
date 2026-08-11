"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import {
  buildLevelLadder,
  formatDistance,
  movedLevels,
  readAgeSeconds,
  RAIL_STALE_AFTER_SEC,
  type RailLadderRow,
} from "../lib/rail-levels";

/**
 * CONTEXTUAL RAIL — the live object for the instrument the conversation is about.
 *
 * WHY IT OPENS ONLY AFTER A QUERY. Screen width is the scarcest thing on a desk, and a rail that
 * is always present costs it permanently while being useful only sometimes. It appears when there
 * is an instrument to be about, and it PERSISTS through follow-ups — which is exactly when it
 * earns its space, because "is that wall still there?" is a question about five numbers the last
 * answer gave and the next answer may not repeat.
 *
 * THE TICKER IS NOT GUESSED HERE. It is the symbol the SERVER resolved for the turn, handed back
 * on the response. A client re-deriving it from the question text could render NVDA beside an
 * answer about SPX, and nothing in the UI would surface the disagreement — the member would simply
 * read two instruments as one.
 *
 * A DASH IS NOT A ZERO. Every field renders `—` when the read returned null. "We could not see the
 * call wall" and "the call wall is 0" are different claims, and only one of them is ever true; a
 * rail that shows 0 for a failed read invents a level that does not exist.
 *
 * LEVELS RENDER AS A LADDER, not a label/price list. See `rail-levels.ts` for the live SPX case
 * that forced it: the put wall legitimately sat ABOVE spot, and a bare "PUT WALL 8000" reads as
 * support at a level 3.2% the wrong way. Sorting by price with spot marked says the geometry
 * without changing a single number.
 *
 * A SILENT REFRESH DESTROYS THE SIGNAL IT DELIVERS. A wall migrating is desk information — the
 * member looks away at 7800 and back at 7850 with nothing to say it moved. Changed levels are
 * marked, and the age of the read is shown once it is old enough to distrust.
 */

type RailData = {
  ticker: string;
  as_of?: string | null;
  spot: number | null;
  regime: string | null;
  call_wall: number | null;
  put_wall: number | null;
  gamma_flip: number | null;
  max_pain: number | null;
  net_premium: number | null;
  print_count: number;
  play: { bias: string | null; grade: string | null; conviction: number | null } | null;
  night_hawk: { hits: number; statuses: string[] } | null;
  available: { vector: boolean; flow: boolean; swing: boolean };
};

const fetcher = (url: string) => fetch(url, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));

const price = (n: number | null) =>
  n == null ? "—" : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Compact money — a rail column cannot carry "18,203,441". */
function money(n: number | null): string {
  if (n == null) return "—";
  const sign = n < 0 ? "-" : "+";
  const a = Math.abs(n);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "bull" | "bear" }) {
  return (
    <div className="largo-rail-row">
      <span className="largo-rail-label">{label}</span>
      <span
        className={clsx(
          "largo-rail-value",
          tone === "bull" && "largo-rail-bull",
          tone === "bear" && "largo-rail-bear"
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** One rung of the level ladder: price, what it is, and how far from here. */
function LadderRow({ row, moved }: { row: RailLadderRow; moved: boolean }) {
  return (
    <div
      className={clsx("largo-rail-rung", row.isSpot && "largo-rail-rung-spot", moved && "largo-rail-rung-moved")}
    >
      <span className="largo-rail-rung-price">
        {row.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
      <span className="largo-rail-rung-label">{row.label}</span>
      <span className="largo-rail-rung-dist">{row.isSpot ? "" : formatDistance(row.distancePct)}</span>
    </div>
  );
}

export function LargoContextRail({ ticker }: { ticker: string | null }) {
  const { data } = useSWR<RailData | null>(
    ticker ? `/api/market/largo/context?ticker=${encodeURIComponent(ticker)}` : null,
    fetcher,
    // Slower than the strip: these are structural levels, not a tape. Refreshing a call wall every
    // few seconds implies a precision the underlying GEX recompute does not have.
    { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true }
  );

  // A ticking clock rather than the render time, so "read age" keeps counting up when the fetch
  // itself has stopped landing — a frozen age would read as a fresh number forever.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  const ladder = buildLevelLadder(data?.spot ?? null, [
    { label: "CALL WALL", price: data?.call_wall ?? null, kind: "call-wall" },
    { label: "PUT WALL", price: data?.put_wall ?? null, kind: "put-wall" },
    { label: "GAMMA FLIP", price: data?.gamma_flip ?? null, kind: "gamma-flip" },
    { label: "MAX PAIN", price: data?.max_pain ?? null, kind: "max-pain" },
  ]);

  // Previous ladder, kept per-ticker so switching instruments cannot report the old symbol's walls
  // as the new one's movement.
  const prev = useRef<{ ticker: string; ladder: RailLadderRow[] } | null>(null);
  const moved =
    prev.current && prev.current.ticker === data?.ticker ? movedLevels(prev.current.ladder, ladder) : new Set<string>();
  useEffect(() => {
    if (data?.ticker && ladder.length) prev.current = { ticker: data.ticker, ladder };
  });

  if (!ticker || !data) return null;

  const bias = String(data.play?.bias ?? data.regime ?? "").toLowerCase();
  const tone = /bull/.test(bias) ? "bull" : /bear/.test(bias) ? "bear" : undefined;
  const ageSec = readAgeSeconds(data.as_of, now);
  const stale = ageSec != null && ageSec > RAIL_STALE_AFTER_SEC;

  return (
    <aside className="largo-rail" aria-label={`Live context for ${data.ticker}`}>
      <div className="largo-rail-head">{data.ticker}</div>

      <div className="largo-rail-spot">{price(data.spot)}</div>
      {data.regime && <div className={clsx("largo-rail-regime", tone && `largo-rail-${tone}`)}>{data.regime}</div>}

      {ladder.length > 1 && (
        <div className="largo-rail-group largo-rail-ladder">
          {ladder.map((r) => (
            <LadderRow key={`${r.label}-${r.price}`} row={r} moved={moved.has(r.label)} />
          ))}
        </div>
      )}

      <div className="largo-rail-group">
        <Row
          label="Net flow"
          value={money(data.net_premium)}
          tone={data.net_premium == null ? undefined : data.net_premium >= 0 ? "bull" : "bear"}
        />
        {/* The sample size behind the flow number. A net premium computed from three prints and
            one computed from three hundred are different claims and should not look identical. */}
        <Row label="Prints" value={data.print_count ? String(data.print_count) : "—"} />
      </div>

      {data.play && (
        <div className="largo-rail-group">
          <Row label="Vector" value={[data.play.grade, data.play.bias].filter(Boolean).join(" · ") || "—"} tone={tone} />
        </div>
      )}

      {data.night_hawk && data.night_hawk.hits > 0 && (
        <div className="largo-rail-group">
          <Row label="Night Hawk" value={`${data.night_hawk.hits} ${data.night_hawk.hits === 1 ? "play" : "plays"}`} />
        </div>
      )}

      {/* Say WHICH system could not be read, rather than leaving a column of dashes that looks
          like a market with no structure in it. */}
      {(!data.available.vector || !data.available.flow) && (
        <div className="largo-rail-degraded">
          {!data.available.vector && "Vector unavailable"}
          {!data.available.vector && !data.available.flow && " · "}
          {!data.available.flow && "Flow unavailable"}
        </div>
      )}

      {/* Only shown once the read is old enough to distrust. A permanent "3s ago" trains the eye to
          stop reading it, which is exactly when it needs to be read. */}
      {stale && <div className="largo-rail-degraded">Last read {Math.round(ageSec! / 60)}m ago</div>}
    </aside>
  );
}
