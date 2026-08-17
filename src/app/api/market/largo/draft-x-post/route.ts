import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { BieLevel } from "@/lib/bie/answer-envelope";
import { formatLargoXPost } from "@/lib/largo/format-x-post";
import { requireTierApi } from "@/lib/market-api-auth";
import { NO_STORE_HEADERS } from "@/lib/no-store-headers";
import { requireToolApi } from "@/lib/tool-access-server";

export const dynamic = "force-dynamic";

/** Draft tweet copy from a grounded Largo answer (copy-only — does not post to X). */
export async function POST(req: NextRequest) {
  const auth = await requireTierApi("premium");
  if (auth instanceof Response) return auth;
  const locked = await requireToolApi("largo");
  if (locked) return locked;

  let body: {
    answer?: string;
    headline?: string | null;
    ticker?: string | null;
    bias?: string | null;
    levels?: BieLevel[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answer = String(body.answer ?? "").trim();
  if (!answer || answer.length > 8000) {
    return NextResponse.json(
      { error: "answer required (max 8000 chars)" },
      { status: 400 },
    );
  }

  const draft = formatLargoXPost({
    answer,
    headline: body.headline ?? null,
    ticker: body.ticker ?? null,
    bias: body.bias ?? null,
    levels: Array.isArray(body.levels) ? body.levels : undefined,
  });

  return NextResponse.json(draft, { headers: NO_STORE_HEADERS });
}
