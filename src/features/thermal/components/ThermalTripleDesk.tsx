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
import Link from "next/link";
import { clsx } from "clsx";
import { FreshnessChip } from "@/components/ui";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";
import { useLiveQuoteStream } from "@/hooks/useLiveQuoteStream";
import { fmtHeatmapExpiry, type GexHeatmapLens } from "@/lib/gex-heatmap-display";
import { resolveZeroDteExpiry } from "@/features/thermal/lib/thermal-compact-matrix";
import {
  thermalLayerFreshness,
  isUsableGexHeatmapPayload,
} from "@/features/thermal/lib/thermal-desk-state";
import {
  readGexHeatmapSessionCache,
  writeGexHeatmapSessionCache,
} from "@/lib/gex-heatmap-session-cache";
import { matrixShiftForLens } from "@/lib/gex-shift-leaders";
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
  shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
  vex_shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
  dex_shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
  charm_shift?: { available?: boolean; delta_by_strike?: Record<string, number> };
  gex?: LensBlock;
  vex?: LensBlock;
  dex?: LensBlock;
  charm?: LensBlock;
};

type BatchResponse = {
  tickers: Record<string, HeatmapPayload>;
};

async function fetchHeatmapBatch(url: string): Promise<BatchResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12_000);
  try {
    const res = await fetch(url, {
      credentials: "same-origin",
      cache: "no-store",
      signal: ctrl.signal,
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    });
    if (!res.ok) throw new Error(`heatmap batch ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

function readBatchFallback(tickers: readonly string[]): BatchResponse | undefined {
  const out: Record<string, HeatmapPayload> = {};
  let any = false;
  for (const t of tickers) {
    const cached = readGexHeatmapSessionCache<HeatmapPayload>(t);
    if (cached && isUsableGexHeatmapPayload(cached)) {
      out[t] = cached;
      any = true;
    }
  }
  return any ? { tickers: out } : undefined;
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
  view: HeatmapPayload | null;
  matrixLoading: boolean;
  hadError: boolean;
};

function ThermalMatrixFreshnessChip({
  asof,
  matrixLoading,
}: {
  asof?: string | null;
  matrixLoading: boolean;
}) {
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
  view,
  matrixLoading,
  hadError,
}: ColumnProps) {
  const { quotes: livePushQuotes } = useLiveQuoteStream([ticker]);
  const pushQuote = livePushQuotes[ticker.toUpperCase()];
  const pushSpot = pushQuote != null && pushQuote.price > 0 ? pushQuote.price : null;

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
  const columnExpiry = useMemo(() => {
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
        <div className="thermal-triple-col-head-meta">
          {columnExpiry ? (
            <span className="thermal-triple-col-exp-date" title={columnExpiry}>
              {fmtHeatmapExpiry(columnExpiry)}
            </span>
          ) : null}
          <Link
            href={`/vector?ticker=${encodeURIComponent(ticker)}`}
            className="thermal-triple-vector-link"
            title={`Open ${ticker} on Vector`}
          >
            Vector
          </Link>
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
        </div>
      </header>

      {hadError && !isUsableGexHeatmapPayload(view) ? (
        <div className="thermal-compact-empty" role="alert">
          Feed error — retrying…
        </div>
      ) : matrixLoading && !isUsableGexHeatmapPayload(view) ? (
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
            strikes: view!.strikes!,
            expiries: view!.expiries!,
            nearTermExpiries: view!.near_term_expiries,
            cells: block.cells,
            shift: matrixShiftForLens(lens, view),
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
  const userPinnedScrollRefStore = useRef<Record<string, MutableRefObject<boolean>>>({});
  const [forceNonce, setForceNonce] = useState(0);
  const [forceActive, setForceActive] = useState(false);
  const lastGoodRef = useRef<Record<string, HeatmapPayload>>({});

  const columnTickers = useMemo(() => tickers.map((t) => t.toUpperCase()), [tickers]);
  const pollMs = usePollIntervalMs(5_000, 5_000);

  const batchKey =
    columnTickers.length > 0
      ? forceActive && forceNonce > 0
        ? `/api/market/gex-heatmap/batch?tickers=${encodeURIComponent(columnTickers.join(","))}&compact=1&force=1&n=${forceNonce}`
        : `/api/market/gex-heatmap/batch?tickers=${encodeURIComponent(columnTickers.join(","))}&compact=1`
      : null;

  const { data: batchData, error, isLoading, isValidating, mutate } = useSWR<BatchResponse>(
    batchKey,
    fetchHeatmapBatch,
    {
      refreshInterval: pollMs,
      revalidateOnFocus: true,
      revalidateIfStale: true,
      errorRetryInterval: pollMs,
      dedupingInterval: 2_000,
      keepPreviousData: true,
      fallbackData: readBatchFallback(columnTickers),
      onSuccess: (payload) => {
        for (const [ticker, heatmap] of Object.entries(payload.tickers ?? {})) {
          if (isUsableGexHeatmapPayload(heatmap)) {
            lastGoodRef.current[ticker] = heatmap;
            writeGexHeatmapSessionCache(ticker, heatmap);
          }
        }
        setForceActive(false);
      },
      onError: () => setForceActive(false),
    },
  );

  const viewByTicker = useMemo(() => {
    const out: Record<string, HeatmapPayload | null> = {};
    for (const ticker of columnTickers) {
      const fresh = batchData?.tickers?.[ticker] ?? null;
      if (isUsableGexHeatmapPayload(fresh)) {
        out[ticker] = fresh;
      } else if (isUsableGexHeatmapPayload(lastGoodRef.current[ticker])) {
        out[ticker] = lastGoodRef.current[ticker]!;
      } else {
        out[ticker] = fresh ?? null;
      }
    }
    return out;
  }, [batchData, columnTickers]);

  useEffect(() => {
    setPins(readPins());
  }, []);

  useEffect(() => {
    lastGoodRef.current = {};
  }, [columnTickers.join(",")]);

  const refreshAndRecenter = useCallback(async () => {
    for (const ticker of columnTickers) {
      userPinnedScrollRefFor(userPinnedScrollRefStore, ticker).current = false;
    }
    setRefreshing(true);
    try {
      setForceNonce((n) => n + 1);
      setForceActive(true);
      await mutate();
    } finally {
      setRefreshing(false);
      setRecenterEpoch((n) => n + 1);
    }
  }, [columnTickers, mutate]);

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

  const matrixLoading = isLoading || isValidating || forceActive || refreshing;

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
            view={viewByTicker[ticker] ?? null}
            matrixLoading={matrixLoading}
            hadError={Boolean(error)}
          />
        ))}
      </div>
    </div>
  );
});

export default ThermalTripleDesk;
