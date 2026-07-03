// POST /api/telemetry/client-error — public, unauthenticated beacon for
// browser-side errors (window.onerror / unhandledrejection). Browsers can't
// carry admin auth, so this route is deliberately public — and deliberately
// narrow: per-IP rate limited, hard body-size cap, fixed small field set, and
// everything that reaches the DB goes through captureError's existing
// sanitize/truncate/prune pipeline (the same one every server-side error
// already uses). See docs/bie/FULL-SYSTEM-AWARENESS.md — this closes the
// "frontend errors" gap in BIE's discovery report (source: "frontend").
import { NextRequest, NextResponse } from "next/server";
import { captureError } from "@/lib/error-sink";
import { checkIpRateLimit, getClientIp, rateLimitHeaders } from "@/lib/ip-rate-limit";
import { MAX_BODY_BYTES, validateClientErrorBody, type ClientErrorBody } from "@/lib/client-error-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  // 20/min per IP: generous for a real session's occasional error burst,
  // bounded against a scripted flood. Fails open on Redis outage (same
  // documented trade-off as every other public rate limit in this app) —
  // the DB-side prune to the newest 2000 rows (error-sink.ts) is the
  // backstop for that window.
  const rl = await checkIpRateLimit(ip, "public:client-error", 20, 60);
  if (!rl.ok) {
    return NextResponse.json({ ok: false }, { status: 429, headers: rateLimitHeaders(rl) });
  }

  // Hard cap BEFORE any parsing/DB work — a write endpoint with no auth must
  // never let an oversized body do meaningful work, rate limit or not.
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  let body: ClientErrorBody;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ ok: false }, { status: 413 });
    body = JSON.parse(raw) as ClientErrorBody;
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const validated = validateClientErrorBody(body);
  if (!validated) return NextResponse.json({ ok: false }, { status: 400 });

  // captureError's toErr() only extracts message/stack/name from an actual
  // Error instance (a plain object falls through to JSON.stringify and loses
  // the structure) — build a real Error to carry the three fields through.
  const err = new Error(validated.message);
  err.name = validated.name;
  if (validated.stack) err.stack = validated.stack;

  // Never await in the hot path — this route's whole job is to return fast.
  void captureError(err, { source: "frontend", scope: validated.scope ?? undefined, meta: { ip } });

  return new NextResponse(null, { status: 204, headers: rateLimitHeaders(rl) });
}
