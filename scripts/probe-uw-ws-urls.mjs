#!/usr/bin/env node
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const f of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(join(root, f), "utf8").split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i <= 0) continue;
      const k = t.slice(0, i).trim();
      if (!process.env[k]) process.env[k] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    /* optional */
  }
}

const KEY = (process.env.UW_API_KEY ?? "").trim();

function probe(url, onOpen) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    let detail = "timeout";
    const timer = setTimeout(() => {
      ws.close();
      resolve({ url, ok: false, detail });
    }, 7000);

    ws.onopen = () => {
      if (onOpen) onOpen(ws);
    };
    ws.onmessage = (ev) => {
      clearTimeout(timer);
      ws.close();
      resolve({ url, ok: true, detail: String(ev.data).slice(0, 120) });
    };
    ws.onclose = (ev) => {
      if (detail !== "timeout") return;
      clearTimeout(timer);
      resolve({ url, ok: false, detail: `code=${ev.code}` });
    };
    ws.onerror = () => {};
  });
}

async function main() {
  const urls = [
    ["wss://api.unusualwhales.com/socket", (ws) => ws.send(JSON.stringify({ action: "auth", key: KEY }))],
    ["wss://api.unusualwhales.com/socket", (ws) => ws.send(JSON.stringify({ action: "auth", token: KEY }))],
    [`wss://api.unusualwhales.com/api/socket/flow_alerts`, (ws) => ws.send(JSON.stringify({ action: "auth", key: KEY }))],
    [`wss://api.unusualwhales.com/api/socket/flow_alerts?token=${encodeURIComponent(KEY)}`, null],
  ];
  for (const [url, onOpen] of urls) {
    const r = await probe(url, onOpen);
    const safeUrl = url.replace(KEY, "[REDACTED]");
    console.log(`${r.ok ? "OK" : "FAIL"} ${safeUrl} → ${r.detail}`);
  }
}

main();
