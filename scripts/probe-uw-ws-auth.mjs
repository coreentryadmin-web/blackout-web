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
const BASE = process.env.UW_WS_BASE ?? "wss://api.unusualwhales.com/api/socket";

async function testRest() {
  const r = await fetch("https://api.unusualwhales.com/api/market/market-tide", {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const text = await r.text();
  console.log(`REST market-tide: ${r.status} ${text.slice(0, 120)}`);
}

function testWs(channel, authPayload) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${BASE}/${channel}`);
    let gotMessage = false;
    const timer = setTimeout(() => {
      ws.close();
      resolve({ authPayload, detail: gotMessage ? "message received" : "timeout/no message", ok: gotMessage });
    }, 6000);

    ws.onopen = () => ws.send(JSON.stringify(authPayload));
    ws.onmessage = (ev) => {
      gotMessage = true;
      clearTimeout(timer);
      ws.close();
      resolve({ authPayload, detail: String(ev.data).slice(0, 100), ok: true });
    };
    ws.onclose = (ev) => {
      if (!gotMessage) {
        clearTimeout(timer);
        resolve({ authPayload, detail: `closed code=${ev.code}`, ok: ev.code === 1000 });
      }
    };
    ws.onerror = () => {
      /* wait for close */
    };
  });
}

async function main() {
  if (!KEY) {
    console.error("UW_API_KEY missing");
    process.exit(1);
  }
  await testRest();
  for (const payload of [
    { action: "auth", key: KEY },
    { action: "auth", token: KEY },
    { action: "auth", api_key: KEY },
  ]) {
    const r = await testWs("flow_alerts", payload);
    console.log(`WS flow_alerts ${JSON.stringify(payload)} → ${r.ok ? "OK" : "FAIL"}: ${r.detail}`);
  }
}

main();
