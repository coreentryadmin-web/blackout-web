import { NextRequest, NextResponse } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { indexStore } from "@/lib/ws/polygon-socket";
import { ensureDataSockets } from "@/lib/ws/init-data-sockets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  ensureDataSockets();
  const encoder = new TextEncoder();
  let interval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          const data = JSON.stringify({
            spx: indexStore["I:SPX"],
            vix: indexStore["I:VIX"],
            vix9d: indexStore["I:VIX9D"],
            vix3m: indexStore["I:VIX3M"],
            tick: indexStore["I:TICK"],
            trin: indexStore["I:TRIN"],
            add: indexStore["I:ADD"],
            t: Date.now(),
          });
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        } catch {
          if (interval) clearInterval(interval);
        }
      };

      interval = setInterval(send, 250);
      send();
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
