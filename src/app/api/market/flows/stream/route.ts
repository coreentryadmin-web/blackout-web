import { NextRequest } from "next/server";
import { authorizeMarketDeskApi } from "@/lib/market-api-auth";
import { initFlowEventBridge, subscribeFlowEvents } from "@/lib/flow-events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const auth = await authorizeMarketDeskApi(req);
  if (auth instanceof Response) return auth;

  await initFlowEventBridge();

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          if (heartbeat) clearInterval(heartbeat);
          unsubscribe?.();
        }
      };

      send({ type: "connected", ts: Date.now() });

      unsubscribe = subscribeFlowEvents((flow) => {
        send({ type: "flow", ...flow });
      });

      heartbeat = setInterval(() => {
        send({ type: "heartbeat", ts: Date.now() });
      }, 25_000);
    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
