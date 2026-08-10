"use client";

import useSWR from "swr";
import { clsx } from "clsx";

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
 */

type RailData = {
  ticker: string;
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

export function LargoContextRail({ ticker }: { ticker: string | null }) {
  const { data } = useSWR<RailData | null>(
    ticker ? `/api/market/largo/context?ticker=${encodeURIComponent(ticker)}` : null,
    fetcher,
    // Slower than the strip: these are structural levels, not a tape. Refreshing a call wall every
    // few seconds implies a precision the underlying GEX recompute does not have.
    { refreshInterval: 60_000, revalidateOnFocus: true, keepPreviousData: true }
  );

  if (!ticker || !data) return null;

  const bias = String(data.play?.bias ?? data.regime ?? "").toLowerCase();
  const tone = /bull/.test(bias) ? "bull" : /bear/.test(bias) ? "bear" : undefined;

  return (
    <aside className="largo-rail" aria-label={`Live context for ${data.ticker}`}>
      <div className="largo-rail-head">{data.ticker}</div>

      <div className="largo-rail-spot">{price(data.spot)}</div>
      {data.regime && <div className={clsx("largo-rail-regime", tone && `largo-rail-${tone}`)}>{data.regime}</div>}

      <div className="largo-rail-group">
        <Row label="Call wall" value={price(data.call_wall)} />
        <Row label="Put wall" value={price(data.put_wall)} />
        <Row label="Gamma flip" value={price(data.gamma_flip)} />
        <Row label="Max pain" value={price(data.max_pain)} />
      </div>

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
    </aside>
  );
}
