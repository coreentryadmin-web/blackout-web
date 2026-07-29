"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import useSWR from "swr";
import { FreshnessChip } from "@/components/ui";
import { usePollIntervalMs } from "@/hooks/use-et-market-open";
import type { GexHeatmapLens } from "@/lib/gex-heatmap-display";
import {
  THERMAL_COMPARE_TICKERS,
  thermalLayerFreshness,
} from "@/features/thermal/lib/thermal-desk-state";
import ThermalCompactMatrix, {
  type ThermalCompareMode,
} from "@/features/thermal/components/ThermalCompactMatrix";

const PIN_STORAGE_KEY = "thermal:pinned-strikes:v1";

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

function wallPair(block: LensBlock | undefined, lens: GexHeatmapLens): { a: string; b: string } {
  if (!block) return { a: "—", b: "—" };
  if (lens === "gex") {
    return {
      a: Number.isFinite(block.call_wall as number) ? String(Math.round(block.call_wall!)) : "—",
      b: Number.isFinite(block.put_wall as number) ? String(Math.round(block.put_wall!)) : "—",
    };
  }
  if (lens === "vex") {
    return {
      a: Number.isFinite(block.pos_wall as number) ? String(Math.round(block.pos_wall!)) : "—",
      b: Number.isFinite(block.neg_wall as number) ? String(Math.round(block.neg_wall!)) : "—",
    };
  }
  const z = Number.isFinite(block.zero_level as number) ? String(Math.round(block.zero_level!)) : "—";
  return { a: z, b: "—" };
}

function exportCsv(
  ticker: string,
  lens: GexHeatmapLens,
  strikes: number[],
  expiries: string[],
  cells: Record<string, Record<string, number>>,
) {
  const header = ["strike", ...expiries].join(",");
  const rows = strikes.map((strike) => {
    const row = cells[String(strike)] ?? {};
    const vals = expiries.map((exp) => {
      const v = row[exp];
      return typeof v === "number" && Number.isFinite(v) ? String(v) : "";
    });
    return [strike, ...vals].join(",");
  });
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${ticker.toLowerCase()}-${lens}-matrix.csv`;
  a.click();
  URL.revokeObjectURL(url);
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
  crosshairIndex: number | null;
  onCrosshairIndex: (index: number | null) => void;
  scrollRef: RefObject<HTMLDivElement>;
  onScrollSync: (scrollTop: number, scrollLeft: number) => void;
};

function TripleColumn({
  ticker,
  lens,
  mode,
  active,
  pinnedStrikes,
  onFocus,
  onTogglePin,
  shortcut,
  crosshairIndex,
  onCrosshairIndex,
  scrollRef,
  onScrollSync,
}: ColumnProps) {
  const pollMs = usePollIntervalMs(5_000, 5_000);
  const { data, error, isLoading } = useSWR<HeatmapPayload>(
    `/api/market/gex-heatmap?ticker=${encodeURIComponent(ticker)}`,
    fetchHeatmap,
    {
      refreshInterval: pollMs,
      revalidateOnFocus: true,
      keepPreviousData: true,
    },
  );

  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const block = data ? pickBlock(data, lens) : undefined;
  const walls = wallPair(block, lens);
  const layers =
    nowMs == null
      ? null
      : thermalLayerFreshness({
          nowMs,
          matrixAsof: data?.asof,
          overlaysAt: null,
          hasOverlays: false,
          crossValUwAsof: null,
          crossValPresent: false,
          matrixLoading: isLoading && !data,
        });

  const matrixStatus = layers?.matrix.status ?? (isLoading ? "syncing" : "offline");
  const matrixAsOf = layers?.matrix.asOf ?? null;

  return (
    <section
      className={`thermal-triple-col${active ? " is-active" : ""}`}
      data-ticker={ticker}
      aria-label={`${ticker} thermal column`}
    >
      <header className="thermal-triple-col-head">
        <button type="button" className="thermal-triple-ticker-btn" onClick={onFocus}>
          <span className="thermal-triple-shortcut" aria-hidden>
            {shortcut}
          </span>
          <span className="thermal-triple-ticker">{ticker}</span>
          {Number.isFinite(data?.spot) ? (
            <span className="thermal-triple-spot">{Number(data!.spot).toFixed(2)}</span>
          ) : (
            <span className="thermal-triple-spot is-empty">—</span>
          )}
        </button>
        <div className="thermal-triple-col-meta">
          <FreshnessChip status={matrixStatus} asOf={matrixAsOf} label="Matrix" />
          <button
            type="button"
            className="thermal-triple-export"
            disabled={!block?.cells || !data?.strikes?.length || !data?.expiries?.length}
            onClick={() => {
              if (!data?.strikes || !data?.expiries || !block?.cells) return;
              exportCsv(ticker, lens, data.strikes, data.expiries, block.cells);
            }}
            title="Export CSV"
          >
            CSV
          </button>
        </div>
      </header>

      <div className="thermal-triple-walls" aria-label={`${ticker} levels`}>
        <span className="thermal-triple-wall is-call">
          {lens === "gex" ? "C" : lens === "vex" ? "+" : "Ø"} {walls.a}
        </span>
        {(lens === "gex" || lens === "vex") && (
          <span className="thermal-triple-wall is-put">
            {lens === "gex" ? "P" : "−"} {walls.b}
          </span>
        )}
      </div>

      {error ? (
        <div className="thermal-compact-empty" role="alert">
          Feed error — retrying…
        </div>
      ) : isLoading && !data ? (
        <div className="thermal-compact-empty" role="status">
          Loading {ticker}…
        </div>
      ) : data?.available && block?.cells && data.strikes && data.expiries ? (
        <ThermalCompactMatrix
          data={{
            ticker,
            spot: data.spot,
            strikes: data.strikes,
            expiries: data.expiries,
            nearTermExpiries: data.near_term_expiries,
            cells: block.cells,
          }}
          lens={lens}
          mode={mode}
          pinnedStrikes={pinnedStrikes}
          onTogglePin={onTogglePin}
          crosshairIndex={crosshairIndex}
          onCrosshairIndex={onCrosshairIndex}
          scrollRef={scrollRef}
          onScrollSync={onScrollSync}
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
  onFocusTicker: (ticker: string) => void;
  onLensChange?: (lens: GexHeatmapLens) => void;
};

export default function ThermalTripleDesk({
  lens,
  activeTicker,
  onFocusTicker,
  onLensChange,
}: Props) {
  const [pins, setPins] = useState<Record<string, number[]>>({});
  // Default Near = five expiry days × SPY|SPX|QQQ (0DTE toggle still available).
  const [mode, setMode] = useState<ThermalCompareMode>("near");
  const [crosshairIndex, setCrosshairIndex] = useState<number | null>(null);
  const col0Scroll = useRef<HTMLDivElement | null>(null);
  const col1Scroll = useRef<HTMLDivElement | null>(null);
  const col2Scroll = useRef<HTMLDivElement | null>(null);
  const scrollRefList = useMemo(
    () => [col0Scroll, col1Scroll, col2Scroll],
    [],
  );
  const syncingScroll = useRef(false);

  useEffect(() => {
    setPins(readPins());
  }, []);

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

  const onScrollSync = useCallback(
    (scrollTop: number, scrollLeft: number) => {
      if (syncingScroll.current) return;
      syncingScroll.current = true;
      for (const ref of scrollRefList) {
        const el = ref.current;
        if (!el) continue;
        if (el.scrollTop !== scrollTop) el.scrollTop = scrollTop;
        if (el.scrollLeft !== scrollLeft) el.scrollLeft = scrollLeft;
      }
      requestAnimationFrame(() => {
        syncingScroll.current = false;
      });
    },
    [scrollRefList],
  );

  const tickers = useMemo(() => [...THERMAL_COMPARE_TICKERS], []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "1") onFocusTicker(tickers[0]!);
      else if (e.key === "2") onFocusTicker(tickers[1]!);
      else if (e.key === "3") onFocusTicker(tickers[2]!);
      else if (e.key === "0") setMode("0dte");
      else if (e.key === "n" || e.key === "N") setMode("near");
      else if (onLensChange) {
        if (e.key === "g" || e.key === "G") onLensChange("gex");
        else if (e.key === "v" || e.key === "V") onLensChange("vex");
        else if (e.key === "d" || e.key === "D") onLensChange("dex");
        else if (e.key === "c" || e.key === "C") onLensChange("charm");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFocusTicker, onLensChange, tickers]);

  return (
    <div className="thermal-triple-desk" data-lens={lens} data-mode={mode}>
      <div className="thermal-triple-atmosphere" aria-hidden />
      <div className="thermal-triple-rail">
        <div className="thermal-triple-rail-label">
          {mode === "0dte" ? "0DTE TRIPLE DESK" : "NEAR-TERM TRIPLE DESK"}
        </div>
        <div className="thermal-triple-mode" role="group" aria-label="Compare expiry mode">
          <button
            type="button"
            className={`thermal-triple-mode-btn${mode === "0dte" ? " is-on" : ""}`}
            onClick={() => setMode("0dte")}
            aria-pressed={mode === "0dte"}
          >
            0DTE
          </button>
          <button
            type="button"
            className={`thermal-triple-mode-btn${mode === "near" ? " is-on" : ""}`}
            onClick={() => setMode("near")}
            aria-pressed={mode === "near"}
          >
            Near
          </button>
        </div>
        <div className="thermal-triple-rail-hint">
          <kbd>1</kbd>
          <kbd>2</kbd>
          <kbd>3</kbd>
          <span>focus</span>
          <span className="thermal-triple-rail-sep" aria-hidden>
            ·
          </span>
          <kbd>0</kbd>
          <span>0DTE</span>
          <kbd>N</kbd>
          <span>near</span>
          <span className="thermal-triple-rail-sep" aria-hidden>
            ·
          </span>
          <kbd>G</kbd>
          <kbd>V</kbd>
          <kbd>D</kbd>
          <kbd>C</kbd>
          <span>lens · synced cursor</span>
        </div>
      </div>
      <div className="thermal-triple-grid">
        {tickers.map((ticker, i) => (
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
            crosshairIndex={crosshairIndex}
            onCrosshairIndex={setCrosshairIndex}
            scrollRef={scrollRefList[i]!}
            onScrollSync={onScrollSync}
          />
        ))}
      </div>
    </div>
  );
}
