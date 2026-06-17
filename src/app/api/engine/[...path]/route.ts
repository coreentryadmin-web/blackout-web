import { NextRequest, NextResponse } from "next/server";
import { engineConfigured, fetchEngine } from "@/lib/engine";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxyGet(req: NextRequest, context: RouteContext) {
  if (!engineConfigured()) {
    return NextResponse.json({ error: "Engine not configured", available: false }, { status: 503 });
  }

  const { path } = await context.params;
  const enginePath = `/${path.join("/")}`;
  const query = req.nextUrl.searchParams.toString();
  const fullPath = query ? `${enginePath}?${query}` : enginePath;

  try {
    const data = await fetchEngine(fullPath);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[engine proxy]", fullPath, error);
    return NextResponse.json({ error: "Engine unreachable" }, { status: 502 });
  }
}

async function proxyPost(req: NextRequest, context: RouteContext) {
  if (!engineConfigured()) {
    return NextResponse.json({ error: "Engine not configured" }, { status: 503 });
  }

  const { path } = await context.params;
  const enginePath = `/${path.join("/")}`;
  const body = await req.text();

  try {
    const data = await fetchEngine(enginePath, {
      method: "POST",
      body,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("[engine proxy POST]", enginePath, error);
    return NextResponse.json({ error: "Engine unreachable" }, { status: 502 });
  }
}

export const GET = proxyGet;
export const POST = proxyPost;
