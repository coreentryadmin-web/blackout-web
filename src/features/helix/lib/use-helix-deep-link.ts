"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import type { FlowAlert } from "@/lib/api";
import {
  deepLinkResolutionKey,
  flowMatchesDeepLink,
  flowRowForDeepLink,
  parseHelixDeepLink,
  type HelixDeepLinkTarget,
} from "@/lib/helix-flow-deep-link";

export type HelixDarkpoolHighlight = {
  executed_at: string;
  premium: number;
} | null;

type UseHelixDeepLinkArgs = {
  alerts: FlowAlert[];
  setTickerFilter: (ticker: string) => void;
  setSelectedContract: (flow: FlowAlert | null) => void;
  setShowMorePanels: (open: boolean) => void;
  setDarkpoolHighlight: (highlight: HelixDarkpoolHighlight) => void;
};

/** Apply `/flows?alert=…` / contract / darkpool query params once the tape has data. */
export function useHelixDeepLink({
  alerts,
  setTickerFilter,
  setSelectedContract,
  setShowMorePanels,
  setDarkpoolHighlight,
}: UseHelixDeepLinkArgs): HelixDeepLinkTarget | null {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const target = useMemo(() => parseHelixDeepLink(searchParams), [query, searchParams]);
  const targetRef = useRef<HelixDeepLinkTarget | null>(null);
  const resolvedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    targetRef.current = target;
    resolvedKeyRef.current = null;
    if (!target) {
      setDarkpoolHighlight(null);
      return;
    }
    if (target.ticker) setTickerFilter(target.ticker);
    if (target.kind === "darkpool") {
      setShowMorePanels(true);
      setDarkpoolHighlight({ executed_at: target.executed_at, premium: target.premium });
    } else {
      setDarkpoolHighlight(null);
    }
  }, [
    target,
    query,
    setTickerFilter,
    setShowMorePanels,
    setDarkpoolHighlight,
  ]);

  useEffect(() => {
    const link = targetRef.current;
    if (!link || link.kind !== "flow" || !alerts.length) return;
    const key = deepLinkResolutionKey(link);
    if (resolvedKeyRef.current === key) return;

    const match = alerts.find((row) => flowMatchesDeepLink(row, link));
    if (!match) return;

    resolvedKeyRef.current = key;
    setSelectedContract(flowRowForDeepLink(match, link));
    if (link.ticker) setTickerFilter(link.ticker);
  }, [alerts, query, setSelectedContract, setTickerFilter]);

  return target;
}

export function darkpoolRowHighlighted(
  print: { executed_at: string; premium: number },
  highlight: HelixDarkpoolHighlight
): boolean {
  if (!highlight) return false;
  if (Math.round(print.premium) !== Math.round(highlight.premium)) return false;
  return String(print.executed_at).slice(0, 19) === highlight.executed_at.slice(0, 19);
}
