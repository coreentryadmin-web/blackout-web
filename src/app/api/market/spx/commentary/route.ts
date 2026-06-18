import { NextRequest, NextResponse } from "next/server";

import { requireTierApi } from "@/lib/market-api-auth";

import { anthropicConfigured } from "@/lib/providers/anthropic";

import { generateSpxCommentary } from "@/lib/providers/spx-commentary";

import type { SpxDeskPayload } from "@/lib/providers/spx-desk";

import { checkCommentaryLimits, recordCommentaryCall } from "@/lib/spx-commentary-limits";



export const dynamic = "force-dynamic";



export async function POST(req: NextRequest) {

  const authResult = await requireTierApi("premium");

  if (authResult instanceof Response) return authResult;



  const limits = await checkCommentaryLimits(authResult.userId);

  if (limits.ok === false) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (limits.retry_after_sec) headers["Retry-After"] = String(limits.retry_after_sec);
    return NextResponse.json({ error: limits.error }, { status: limits.status, headers });
  }



  if (!anthropicConfigured()) {

    return NextResponse.json(

      { error: "ANTHROPIC_API_KEY not configured" },

      { status: 503 }

    );

  }



  try {

    const body = (await req.json()) as {

      desk?: SpxDeskPayload;

      previous?: Partial<SpxDeskPayload> | null;

    };



    if (!body.desk?.available || !body.desk.price) {

      return NextResponse.json({ error: "Desk data required" }, { status: 400 });

    }



    const commentary = await generateSpxCommentary(body.desk, body.previous ?? null);

    if (!commentary) {

      return NextResponse.json({ error: "Commentary generation failed" }, { status: 502 });

    }



    await recordCommentaryCall(authResult.userId);



    return NextResponse.json({ commentary });

  } catch (error) {

    console.error("[market/spx/commentary]", error);

    return NextResponse.json({ error: "Commentary failed" }, { status: 500 });

  }

}

