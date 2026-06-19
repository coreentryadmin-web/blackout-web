import { NextResponse } from "next/server";
import { dbConfigured, ensureSchema } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Minimal deploy liveness — Railway healthcheck; no auth, no market intel. */
export async function GET() {
  const as_of = new Date().toISOString();

  if (!dbConfigured()) {
    return NextResponse.json({ ok: true, as_of, db: "skipped" });
  }

  try {
    await ensureSchema();
    return NextResponse.json({ ok: true, as_of, db: "connected" });
  } catch {
    return NextResponse.json({ ok: false, as_of, db: "error" }, { status: 503 });
  }
}
