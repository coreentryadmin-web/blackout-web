/**
 * Next.js instrumentation hook — runs once per server process at startup.
 *
 * Boots the UW + Polygon WebSocket managers eagerly so live options flow and the
 * SPX desk are persisted continuously. Previously the sockets only connected
 * lazily when an SPX/market route was hit; the HELIX flows route never triggered
 * them, so on a replica that only served /api/market/flows the WS never connected
 * and the REST cron became the sole flow writer. Booting at startup makes live
 * flow reliable regardless of which route is hit first.
 *
 * Node runtime only (no WS on the edge runtime). Uses a relative import — the "@/"
 * alias is not reliably resolved in a dynamic import inside the production server.
 * Any failure is swallowed so a socket hiccup can never crash server boot.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { ensureDataSockets } = await import("./lib/ws/init-data-sockets");
    ensureDataSockets();
    console.log("[instrumentation] data sockets booted at server start");
  } catch (err) {
    console.error("[instrumentation] ensureDataSockets failed:", err);
  }
}
