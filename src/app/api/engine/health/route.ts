import { NextResponse } from "next/server";
import { engineConfigured, fetchEngine } from "@/lib/engine";

export async function GET() {
  if (!engineConfigured()) {
    return NextResponse.json({
      ok: false,
      engine: "missing",
      message: "Set NEXT_PUBLIC_API_BASE on Railway",
    });
  }

  try {
    await fetchEngine("/health");
    return NextResponse.json({ ok: true, engine: "online" });
  } catch {
    return NextResponse.json({ ok: false, engine: "offline" }, { status: 502 });
  }
}
