import { NextResponse } from "next/server";
import { engineConfigured, fetchEngine } from "@/lib/engine";

// Probe the engine live on every request. Without this, Next.js serves a build-time
// health snapshot that never reflects the engine's actual current state (synthesis P1 #10).
export const dynamic = "force-dynamic";

export async function GET() {
  if (!engineConfigured()) {
      return NextResponse.json({
      ok: false,
      engine: "missing",
      message: "Engine API not configured",
    });
  }

  try {
    await fetchEngine("/health");
    return NextResponse.json({ ok: true, engine: "online" });
  } catch {
    return NextResponse.json({ ok: false, engine: "offline" }, { status: 502 });
  }
}
