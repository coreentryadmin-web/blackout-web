import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import type { BieLevel } from "@/lib/bie/answer-envelope";
import { formatLargoXPost } from "@/lib/largo/format-x-post";
import { detectSocialArchetype } from "@/lib/largo/social-content-core";
import { extractSocialPostTicker } from "@/lib/largo/ticker-social-guide";
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
    question?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const answer = String(body.answer ?? "").trim();
  if (!answer) {
    return NextResponse.json({ error: "answer required" }, { status: 400 });
  }
  if (answer.length > 12000) {
    return NextResponse.json(
      { error: "answer too long (max 12000 chars)" },
      { status: 400 },
    );
  }

  const questionStr = body.question ? String(body.question) : null;
  const tickerFromQuestion = questionStr ? extractSocialPostTicker(questionStr, body.ticker) : null;
  const ticker = tickerFromQuestion ?? body.ticker ?? null;

  const draft = formatLargoXPost({
    answer,
    headline: body.headline ?? null,
    ticker,
    bias: body.bias ?? null,
    levels: Array.isArray(body.levels) ? body.levels : undefined,
    question: questionStr,
    archetype: questionStr
      ? detectSocialArchetype(questionStr)
      : detectSocialArchetype(answer),
  });

  return NextResponse.json(draft, { headers: NO_STORE_HEADERS });
}
