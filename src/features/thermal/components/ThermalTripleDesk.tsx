"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import useSWR from "swr";
import { clsx } from "clsx";
import { FreshnessChip } from "@/components/ui";
import { usePollIntervalMs, useEtMarketOpen } from "@/hooks/use-et-market-open";
import { useLiveQuoteStream } from "@/hooks/useLiveQuoteStream";
import { fmtHeatmapExpiry, type GexHeatmapLens } from "@/lib/gex-heatmap-display";
import { resolveZeroDteExpiry } from "@/features/thermal/lib/thermal-compact-matrix";
import {
  thermalLayerFreshness,
  isUsableGexHeatmapPayload,
  shouldForceMatrixRefresh,
  MATRIX_FORCE_THROTTLE_MS,
} from "@/features/thermal/lib/thermal-desk-state";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";
import ThermalCompactMatrix, {
  type ThermalCompareMode,
} from "@/features/thermal/components/ThermalCompactMatrix";

const PIN_STORAGE_KEY = "thermal:pinned-strikes:v1";

function todayEtYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function fmtHeaderPct(n: number): string {
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

type LensBlock = {
  cells: Record<string, Record<string, number>>;
  call_wall?: number | null;
  put_wall?: number | null;
  pos_wall?: number | null;
  neg_wall?: number | null;
  flip?: number | null;
  zero_level?: number | null;
  total?: number;
};

type HeatmapPayload = {
  available: boolean;
  underlying?: string;
  spot?: number;
  change_pct?: number;
  asof?: string;
  expiries?: string[];
  strikes?: number[];
  near_term_expiries?: string[];
  gex?: LensBlock;
  vex?: LensBlock;
  dex?: LensBlock;
  charm?: LensBlock;
};

async function fetchHeatmap(url: string): Promise<HeatmapPayload> {
  const res = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
  });
  if (!res.ok) throw new Error(`heatmap ${res.status}`);
  return res.json();
}

function readPins(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PIN_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number[]>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writePins(pins: Record<string, number[]>) {
  try {
    window.localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pins));
  } catch {
    /* ignore quota */
  }
}

function pickBlock(data: HeatmapPayload, lens: GexHeatmapLens): LensBlock | undefined {
  if (lens === "gex") return data.gex;
  if (lens === "vex") return data.vex;
  if (lens === "dex") return data.dex;
  return data.charm;
}

type ColumnProps = {
  ticker: string;
  lens: GexHeatmapLens;
  mode: ThermalCompareMode;
  active: boolean;
  pinnedStrikes: number[];
  onFocus: () => void;
  onTogglePin: (strike: number) => void;
  shortcut: string;
  userPinnedScrollRef: MutableRefObject<boolean>;
  recenterEpoch: number;
  onRegisterMutate: (
    ticker: string,
    mutate: () => Promise<unknown>,
    isValidating: boolean,
  ) => void;
};

function ThermalMatrixFreshnessChip({
  asof,
  matrixLoading,
}: {
  asof?: string | null;
  matrixLoading: boolean;
}) {
  // Own the 1Hz clock here so TripleColumn (matrix + spot header) does not re-render every second.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const layers =
    nowMs == null
      ? null
      : thermalLayerFreshness({
          nowMs,
          matrixAsof: asof,
          overlaysAt: null,
          hasOverlays: false,
          crossValUwAsof: null,
          crossValPresent: false,
          matrixLoading,
        });

  const matrixStatus = layers?.matrix.status ?? (matrixLoading ? "syncing" : "offline");
  const matrixAsOf = layers?.matrix.asOf ?? null;
  return <FreshnessChip status={matrixStatus} asOf={matrixAsOf} label="Matrix" />;
}

function TripleColumn({
  ticker,
  lens,
  mode,
  active,
  pinnedStrikes,
  onFocus,
  onTogglePin,
  shortcut,
  userPinnedScrollRef,
  recenterEpoch,
  onRegisterMutate,
}: ColumnProps) {
  const pollMs = usePollIntervalMs(5_000, 5_000);
  const sessionLive = useEtMarketOpen();

  // Sub-second header spot overlay (PR 3/N of the sub-second-spot project —
  // see GexHeatmap.tsx for PR 3a). Display-only: this ticker column's header
  // badge prefers the push tick when available, falling back to the matrix
  // snapshot's own `spot` field otherwise. Deliberately NOT threaded into
  // `data.spot` passed to ThermalCompactMatrix below — that value drives the
  // ladder's ATM-row highlight and Slayer-parity auto-scroll-to-spot, which is
  // intentionally paced to the matrix's own 5s/force-refresh cadence, not a
  // faster independent clock (a push-fast spot there would highlight/scroll
  // to a strike ahead of the strikes/cells actually painted). SPX has no
  // stock-candle-store WS coverage (index, not a Polygon stock/ETF ticker) —
  // the hook simply never reports a quote for it and the matrix's own spot
  // is used, per useLiveQuoteStream's documented "absent = no live tick yet"
  // contract.
  const { quotes: livePushQuotes } = useLiveQuoteStream([ticker]);
  const pushQuote = livePushQuotes[ticker.toUpperCase()];
  const pushSpot = pushQuote != null && pushQuote.price > 0 ? pushQuote.price : null;
  // Age-based force (SPX Slayer parity): EventBridge heatmap-warm floors at 1m, so without
  // ?force=1 SPY/QQQ asof ages well past the 5s poll. Force when asof is >5s old (server
  // throttles ≤1/5s; single-flight coalesces concurrent viewers).
  //
  // forceNonce is monotonic and NEVER reused: clearing it back to 0 then bumping to 1 again
  // made every force hit the same SWR key (`…&force=1&n=1`), so later forces could paint a
  // stale cached payload while a slow revalidate ran (live 2026-07-29: SPY/QQQ felt stuck
  // at 15–25s). forceActive flips the key on/off; nonce only increases.
  const [forceNonce, setForceNonce] = useState(0);
  const [forceActive, setForceActive] = useState(false);
  const lastForceAtRef = useRef(0);
  const [lastGood, setLastGood] = useState<HeatmapPayload | null>(null);

  const matrixKey =
    forceActive && forceNonce > 0
      ? `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}&force=1&n=${forceNonce}`
      : `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`;

  const clearForce = () => setForceActive(false);

  const triggerForce = useCallback(() => {
    lastForceAtRef.current = Date.now();
    setForceNonce((n) => n + 1);
    setForceActive(true);
  }, []);

  const { data, error, isLoading, isValidating, mutate } = useSWR<HeatmapPayload>(
    matrixKey,
    fetchHeatmap,
    {
      refreshInterval: pollMs,
      revalidateOnFocus: true,
      keepPreviousData: true,
      fallbackData: readGexHeatmapSessionCache<HeatmapPayload>(ticker),
      onSuccess: (payload) => {
        if (isUsableGexHeatmapPayload(payload)) {
          setLastGood(payload);
          writeGexHeatmapSessionCache(ticker, payload);
        }
        clearForce();
      },
      onError: clearForce,
    },
  );

  // Prefer a usable payload; never blank the column on a transient available:false.
  const view =
    isUsableGexHeatmapPayload(data) ? data
    : isUsableGexHeatmapPayload(lastGood) ? lastGood
    : data;

  useEffect(() => {
    const tick = () => {
      if (!sessionLive) return;
      const nowMs = Date.now();
      if (forceActive || isLoading || isValidating) return;
      if (error && !isUsableGexHeatmapPayload(view)) return;
      if (nowMs - lastForceAtRef.current < MATRIX_FORCE_THROTTLE_MS) return;
      // Blank / unusable column: force immediately (throttled) so SPY doesn't sit on
      // "No matrix yet" waiting for the 1-min warm cron while SPX/QQQ already painted.
      const blank = !isUsableGexHeatmapPayload(view);
      const asofRaw = view?.asof;
      const asofMs = asofRaw ? new Date(asofRaw).getTime() : NaN;
      const stale =
        !blank &&
        shouldForceMatrixRefresh({
          asofMs: Number.isFinite(asofMs) ? asofMs : null,
          nowMs,
          lastForceAtMs: lastForceAtRef.current,
          sessionLive,
        });
      if (!blank && !stale) return;
      triggerForce();
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [view, ticker, forceActive, triggerForce, sessionLive, isLoading, isValidating, error]);

  // Reset last-good when the column ticker changes so we never paint SPX cells under a SPY header.
  useEffect(() => {
    setLastGood(null);
  }, [ticker]);

  // Rail ↻: force a fresh matrix compute (same path as age-based force) then let the
  // desk bump recenterEpoch so each ladder maps onto live spot.
  useEffect(() => {
    onRegisterMutate(
      ticker,
      async () => {
        triggerForce();
        // Key change drives the fetch; mutate() on the prior key is a no-op for force.
        await new Promise((r) => setTimeout(r, 50));
        await mutate();
      },
      isValidating || forceActive,
    );
  }, [ticker, mutate, isValidating, forceActive, onRegisterMutate, triggerForce]);

  const block = view ? pickBlock(view, lens) : undefined;
  const matrixSpot = view?.spot != null && view.spot > 0 ? view.spot : null;
  const headerSpot = pushSpot ?? matrixSpot;
  const matrixChangePct =
    view?.change_pct != null && Number.isFinite(view.change_pct) ? view.change_pct : null;
  const pushChangePct =
    pushQuote?.changePct != null && Number.isFinite(pushQuote.changePct)
      ? pushQuote.changePct
      : null;
  const headerChangePct = pushChangePct ?? matrixChangePct;
  const changeUp = (headerChangePct ?? 0) >= 0;
  const zeroDteExpiry = useMemo(() => {
    if (!view?.expiries?.length) return null;
    return resolveZeroDteExpiry(view.near_term_expiries, view.expiries, todayEtYmd());
  }, [view?.expiries, view?.near_term_expiries]);

  return (
    <section
      className={`thermal-triple-col${active ? " is-active" : ""}`}
      data-ticker={ticker}
      aria-label={`${ticker} thermal column`}
    >
      <header className="thermal-triple-col-head thermal-triple-col-head--band">
        <button type="button" className="thermal-triple-ticker-btn thermal-triple-col-head-ticker" onClick={onFocus}>
          <span className="thermal-triple-shortcut" aria-hidden>
            {shortcut}
          </span>
          <span className="thermal-triple-ticker">{ticker}</span>
        </button>
        {zeroDteExpiry ? (
          <div className="thermal-triple-col-head-expiry" title={zeroDteExpiry}>
            <span className="thermal-compact-exp-chip">0DTE</span>
            <span className="thermal-compact-exp-date">{fmtHeatmapExpiry(zeroDteExpiry)}</span>
          </div>
        ) : (
          <div className="thermal-triple-col-head-expiry is-empty" aria-hidden />
        )}
        <div className="thermal-triple-col-head-spot" aria-label={`${ticker} spot`}>
          {headerSpot != null ? (
            <span className="thermal-triple-spot-wrap">
              <span className="thermal-triple-spot thermal-triple-spot--head">
                {Number(headerSpot).toFixed(2)}
              </span>
              {headerChangePct != null ? (
                <span
                  className={clsx(
                    "thermal-triple-spot-chg",
                    changeUp ? "is-up" : "is-down",
                  )}
                  title={`${ticker} day change`}
                >
                  {fmtHeaderPct(headerChangePct)}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="thermal-triple-spot thermal-triple-spot--head is-empty">—</span>
          )}
        </div>
      </header>

      {error && !isUsableGexHeatmapPayload(view) ? (
        <div className="thermal-compact-empty" role="alert">
          Feed error — retrying…
        </div>
      ) : isLoading && !isUsableGexHeatmapPayload(view) ? (
        <div className="thermal-compact-empty thermal-compact-syncing" role="status">
          <ThermalMatrixFreshnessChip asof={view?.asof ?? null} matrixLoading />
          <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-sky-300">
            Syncing {ticker} matrix…
          </p>
        </div>
      ) : isUsableGexHeatmapPayload(view) && block?.cells ? (
        <ThermalCompactMatrix
          data={{
            ticker,
            spot: view!.spot,
            labelSpot: headerSpot,
            strikes: view!.strikes!,
            expiries: view!.expiries!,
            nearTermExpiries: view!.near_term_expiries,
            cells: block.cells,
          }}
          lens={lens}
          mode={mode}
          pinnedStrikes={pinnedStrikes}
          onTogglePin={onTogglePin}
          userPinnedScrollRef={userPinnedScrollRef}
          recenterEpoch={recenterEpoch}
        />
      ) : (
        <div className="thermal-compact-empty" role="status">
          No matrix yet.
        </div>
      )}
    </section>
  );
}

type Props = {
  lens: GexHeatmapLens;
  activeTicker: string;
  tickers: readonly string[];
  onFocusTicker: (ticker: string) => void;
  onLensChange?: (lens: GexHeatmapLens) => void;
};

export type ThermalTripleDeskHandle = {
  refreshAndRecenter: () => Promise<void>;
};

function userPinnedScrollRefFor(
  store: MutableRefObject<Record<string, MutableRefObject<boolean>>>,
  ticker: string,
): MutableRefObject<boolean> {
  if (!store.current[ticker]) {
    store.current[ticker] = { current: false };
  }
  return store.current[ticker]!;
}

const ThermalTripleDesk = forwardRef<ThermalTripleDeskHandle, Props>(function ThermalTripleDesk(
  { lens, activeTicker, tickers, onFocusTicker, onLensChange },
  ref,
) {
  const [pins, setPins] = useState<Record<string, number[]>>({});
  const mode: ThermalCompareMode = "0dte";
  const [recenterEpoch, setRecenterEpoch] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [columnValidating, setColumnValidating] = useState<Record<string, boolean>>({});
  const userPinnedScrollRefStore = useRef<Record<string, MutableRefObject<boolean>>>({});
  const mutateByTickerRef = useRef<Record<string, () => Promise<unknown>>>({});

  const columnTickers = useMemo(() => tickers.map((t) => t.toUpperCase()), [tickers]);

  useEffect(() => {
    setPins(readPins());
  }, []);

  const onRegisterMutate = useCallback(
    (ticker: string, mutate: () => Promise<unknown>, isValidating: boolean) => {
      mutateByTickerRef.current[ticker] = mutate;
      setColumnValidating((prev) =>
        prev[ticker] === isValidating ? prev : { ...prev, [ticker]: isValidating },
      );
    },
    [],
  );

  const refreshAndRecenter = useCallback(async () => {
    for (const ticker of columnTickers) {
      userPinnedScrollRefFor(userPinnedScrollRefStore, ticker).current = false;
    }
    setRefreshing(true);
    try {
      const mutates = Object.values(mutateByTickerRef.current);
      await Promise.all(mutates.map((m) => m()));
    } finally {
      setRefreshing(false);
      // Each column recenters on its own spot row (independent scroll positions).
      setRecenterEpoch((n) => n + 1);
    }
  }, [columnTickers]);

  useImperativeHandle(ref, () => ({ refreshAndRecenter }), [refreshAndRecenter]);

  const togglePin = useCallback((ticker: string, strike: number) => {
    setPins((prev) => {
      const cur = prev[ticker] ?? [];
      const next = cur.includes(strike)
        ? cur.filter((s) => s !== strike)
        : [...cur, strike].sort((a, b) => a - b);
      const merged = { ...prev, [ticker]: next };
      writePins(merged);
      return merged;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const idx = Number.parseInt(e.key, 10);
      if (idx >= 1 && idx <= columnTickers.length) {
        onFocusTicker(columnTickers[idx - 1]!);
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        void refreshAndRecenter();
      } else if (onLensChange) {
        if (e.key === "g" || e.key === "G") onLensChange("gex");
        else if (e.key === "v" || e.key === "V") onLensChange("vex");
        else if (e.key === "d" || e.key === "D") onLensChange("dex");
        else if (e.key === "c" || e.key === "C") onLensChange("charm");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFocusTicker, onLensChange, columnTickers, refreshAndRecenter]);

  return (
    <div
      className="thermal-triple-desk"
      data-lens={lens}
      data-mode={mode}
      data-cols={columnTickers.length}
    >
      <div className="thermal-triple-atmosphere" aria-hidden />
      <div className="thermal-triple-grid">
        {columnTickers.map((ticker, i) => (
          <TripleColumn
            key={ticker}
            ticker={ticker}
            lens={lens}
            mode={mode}
            active={activeTicker.toUpperCase() === ticker}
            pinnedStrikes={pins[ticker] ?? []}
            onFocus={() => onFocusTicker(ticker)}
            onTogglePin={(strike) => togglePin(ticker, strike)}
            shortcut={String(i + 1)}
            userPinnedScrollRef={userPinnedScrollRefFor(userPinnedScrollRefStore, ticker)}
            recenterEpoch={recenterEpoch}
            onRegisterMutate={onRegisterMutate}
          />
        ))}
      </div>
    </div>
  );
});

export default ThermalTripleDesk;
