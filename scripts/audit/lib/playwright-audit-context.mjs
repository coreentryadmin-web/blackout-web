/**
 * Playwright audit context — tunnel when the agent proxy is up, direct otherwise.
 *
 * Cloud sandboxes block Chromium egress; `createTunneledContext` routes every request through
 * CONNECT. Some agent VMs (and local dev) reach prod directly — probing 127.0.0.1:42795 avoids
 * ECONNREFUSED when HTTPS_PROXY is unset.
 */
import net from "node:net";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { resolveChromiumPath } from "./playwright-chromium-path.mjs";

const require_ = createRequire(import.meta.url);
const { createTunneledContext, applyCookieToContext } = require_("./proxy-tunnel-context.cjs");

const DEFAULT_PROXY = "http://127.0.0.1:42795";

function proxyReachable(proxyUrl = process.env.HTTPS_PROXY || DEFAULT_PROXY) {
  return new Promise((resolve) => {
    try {
      const u = new URL(proxyUrl);
      const sock = net.connect({ host: u.hostname, port: Number(u.port) || 8080 }, () => {
        sock.destroy();
        resolve(true);
      });
      sock.on("error", () => resolve(false));
      sock.setTimeout(400, () => {
        sock.destroy();
        resolve(false);
      });
    } catch {
      resolve(false);
    }
  });
}

/**
 * @param {{ url: string, cookie?: string, viewport?: string, desktop?: boolean, requestTimeoutMs?: number }} opts
 */
export async function createPlaywrightAuditContext({
  url,
  cookie = "",
  viewport = "1680x1050",
  desktop = true,
  requestTimeoutMs = 60_000,
}) {
  const useTunnel = Boolean(process.env.HTTPS_PROXY) || (await proxyReachable());

  if (useTunnel) {
    const tunneled = await createTunneledContext({
      url,
      cookie,
      viewport,
      desktop,
      requestTimeoutMs,
    });
    return { ...tunneled, mode: "tunnel" };
  }

  const [vw, vh] = String(viewport).split("x").map(Number);
  const browser = await chromium.launch({
    headless: true,
    executablePath: resolveChromiumPath(),
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: desktop ? 1.5 : 3,
  });
  if (cookie) await applyCookieToContext(ctx, cookie, url);

  return {
    browser,
    ctx,
    counts: { ok: 0, fail: 0, streamsBuffered: 0, streamsHeldOpen: 0 },
    mode: "direct",
  };
}
