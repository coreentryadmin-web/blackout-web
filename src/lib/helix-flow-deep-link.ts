/**
 * Deep links into HELIX `/flows` — open the tape on a specific print (or dark pool block).
 * Pure URL builders + matchers; FlowFeed consumes the same query shape client-side.
 */
import type { FlowAlert } from "@/lib/api";
import type { DarkPoolDiscordPrint } from "@/lib/darkpool-discord-format";
import type { HelixDiscordFlowInput } from "@/lib/helix-discord-format";
import { flowDedupeKey } from "@/features/helix/lib/helix-flow-tape-merge";

const APP_BASE = (process.env.NEXT_PUBLIC_SITE_URL || "https://blackouttrades.com").replace(/\/$/, "");

export type HelixFlowDeepLinkInput = {
  ticker: string;
  alert_id?: string | null;
  strike?: number | null;
  expiry?: string | null;
  option_type?: string | null;
  /** ISO timestamp — event_at preferred, alerted_at fallback */
  at?: string | null;
  premium?: number | null;
};

export type HelixDarkpoolDeepLinkInput = {
  ticker: string;
  executed_at: string;
  premium: number;
};

export type HelixDeepLinkTarget =
  | ({ kind: "flow" } & HelixFlowDeepLinkInput)
  | ({ kind: "darkpool" } & HelixDarkpoolDeepLinkInput);

function normType(option_type: string | null | undefined): "C" | "P" | null {
  const t = String(option_type ?? "").toUpperCase();
  if (t.startsWith("C")) return "C";
  if (t.startsWith("P")) return "P";
  return null;
}

/** Build a member-facing HELIX URL that opens a specific options flow print. */
export function buildHelixFlowDeepLink(input: HelixFlowDeepLinkInput): string {
  const params = new URLSearchParams();
  const ticker = String(input.ticker || "").toUpperCase();
  if (!ticker) return `${APP_BASE}/flows`;

  if (input.alert_id?.trim()) {
    params.set("alert", input.alert_id.trim());
    params.set("ticker", ticker);
    return `${APP_BASE}/flows?${params.toString()}`;
  }

  params.set("ticker", ticker);
  if (input.strike != null && Number.isFinite(Number(input.strike))) {
    params.set("strike", String(Math.round(Number(input.strike))));
  }
  const exp = String(input.expiry ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(exp)) params.set("expiry", exp);
  const side = normType(input.option_type);
  if (side) params.set("type", side);
  const at = String(input.at ?? "").trim();
  if (at) params.set("at", at.slice(0, 19));
  if (input.premium != null && Number.isFinite(Number(input.premium))) {
    params.set("premium", String(Math.round(Number(input.premium))));
  }
  return `${APP_BASE}/flows?${params.toString()}`;
}

export function helixDiscordFlowToDeepLink(flow: HelixDiscordFlowInput): string {
  return buildHelixFlowDeepLink({
    ticker: flow.ticker,
    alert_id: flow.alert_id ?? null,
    strike: flow.strike,
    expiry: flow.expiry,
    option_type: flow.option_type,
    at: flow.event_at ?? flow.alerted_at ?? null,
    premium: flow.premium,
  });
}

/** Dark pool blocks deep-link into HELIX with ticker scoped + dark pool panel focused. */
export function buildHelixDarkpoolDeepLink(input: HelixDarkpoolDeepLinkInput): string {
  const params = new URLSearchParams();
  params.set("ticker", String(input.ticker).toUpperCase());
  params.set("darkpool", "1");
  params.set("at", String(input.executed_at).slice(0, 19));
  params.set("premium", String(Math.round(input.premium)));
  return `${APP_BASE}/flows?${params.toString()}`;
}

export function darkpoolPrintToDeepLink(print: DarkPoolDiscordPrint): string {
  return buildHelixDarkpoolDeepLink({
    ticker: print.ticker,
    executed_at: print.executed_at,
    premium: print.premium,
  });
}

export function parseHelixDeepLink(searchParams: URLSearchParams): HelixDeepLinkTarget | null {
  const ticker = searchParams.get("ticker")?.trim().toUpperCase();
  const alert = searchParams.get("alert")?.trim();
  const darkpool = searchParams.get("darkpool") === "1";

  if (darkpool && ticker) {
    const at = searchParams.get("at")?.trim();
    const premium = Number(searchParams.get("premium"));
    if (!at || !Number.isFinite(premium)) return { kind: "darkpool", ticker, executed_at: at ?? "", premium: 0 };
    return { kind: "darkpool", ticker, executed_at: at, premium };
  }

  if (alert || ticker) {
    const strikeRaw = searchParams.get("strike");
    const strike = strikeRaw != null ? Number(strikeRaw) : null;
    return {
      kind: "flow",
      ticker: ticker ?? "",
      alert_id: alert ?? null,
      strike: strike != null && Number.isFinite(strike) ? strike : null,
      expiry: searchParams.get("expiry"),
      option_type: searchParams.get("type"),
      at: searchParams.get("at"),
      premium: Number(searchParams.get("premium")),
    };
  }

  return null;
}

function contractKey(flow: {
  ticker: string;
  strike: number;
  expiry: string;
  option_type: string;
  at?: string | null;
  premium?: number | null;
}): string {
  const side = normType(flow.option_type) ?? "?";
  const at = String(flow.at ?? "").slice(0, 19);
  const prem = flow.premium != null ? Math.round(Number(flow.premium)) : 0;
  return `${flow.ticker.toUpperCase()}|${Math.round(flow.strike)}|${String(flow.expiry).slice(0, 10)}|${side}|${at}|${prem}`;
}

/** Match a tape row to a parsed deep link (alert_id first, then contract fingerprint). */
export function flowMatchesDeepLink(flow: FlowAlert, target: HelixDeepLinkTarget): boolean {
  if (target.kind !== "flow") return false;
  if (target.alert_id && flow.alert_id) {
    return flow.alert_id === target.alert_id;
  }
  if (target.alert_id && !flow.alert_id) {
    // REST rows may omit alert_id — fall through to contract match below.
  }
  if (!target.ticker || flow.ticker.toUpperCase() !== target.ticker.toUpperCase()) return false;
  if (target.strike != null && Math.round(flow.strike) !== Math.round(target.strike)) return false;
  if (target.expiry && String(flow.expiry).slice(0, 10) !== target.expiry.slice(0, 10)) return false;
  if (target.option_type) {
    const want = normType(target.option_type);
    const got = normType(flow.option_type);
    if (want && got && want !== got) return false;
  }
  if (target.at) {
    const atFlow = String(flow.event_at ?? flow.alerted_at ?? "").slice(0, 19);
    if (atFlow && atFlow !== target.at.slice(0, 19)) return false;
  }
  if (target.premium != null && Number.isFinite(target.premium)) {
    if (Math.round(flow.premium) !== Math.round(target.premium)) return false;
  }
  return Boolean(target.strike != null || target.at || target.premium != null || target.alert_id);
}

export function darkpoolMatchesDeepLink(
  print: { ticker: string; executed_at: string; premium: number },
  target: HelixDeepLinkTarget
): boolean {
  if (target.kind !== "darkpool") return false;
  if (print.ticker.toUpperCase() !== target.ticker.toUpperCase()) return false;
  if (Math.round(print.premium) !== Math.round(target.premium)) return false;
  return String(print.executed_at).slice(0, 19) === target.executed_at.slice(0, 19);
}

/** Stable key for deduping deep-link resolution attempts in FlowFeed. */
export function deepLinkResolutionKey(target: HelixDeepLinkTarget): string {
  if (target.kind === "darkpool") {
    return `dp:${target.ticker}|${target.executed_at.slice(0, 19)}|${Math.round(target.premium)}`;
  }
  if (target.alert_id) return `id:${target.alert_id}`;
  return contractKey({
    ticker: target.ticker,
    strike: target.strike ?? 0,
    expiry: target.expiry ?? "",
    option_type: target.option_type ?? "",
    at: target.at,
    premium: target.premium,
  });
}

/** Prefer alert_id key for tape dedupe when resolving a deep-linked row. */
export function flowRowForDeepLink(flow: FlowAlert, target: HelixDeepLinkTarget): FlowAlert {
  if (target.kind !== "flow" || !target.alert_id || flow.alert_id) return flow;
  return { ...flow, alert_id: target.alert_id };
}

export { flowDedupeKey };
