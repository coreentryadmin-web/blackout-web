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

async function testRest() {
  const r = await fetch("https://api.unusualwhales.com/api/market/market-tide", {
    headers: { Authorization: `Bearer ${KEY}`, Accept: "application/json" },
  });
  const text = await r.text();
  console.log(`REST market-tide: ${r.status} ${text.slice(0, 120)}`);
}

function testMultiplex(label, withToken) {
  return new Promise((resolve) => {
    const url = withToken
      ? `wss://api.unusualwhales.com/socket?token=${encodeURIComponent(KEY)}`
      : "wss://api.unusualwhales.com/socket";
    const ws = new WebSocket(url, {
      headers: {
        Accept: "application/json",
        "UW-CLIENT-API-ID": process.env.UW_CLIENT_API_ID ?? "100001",
      },
    });
    let gotMessage = false;
    let opened = false;
    const timer = setTimeout(() => {
      ws.close();
      resolve({ label, detail: gotMessage ? "message received" : opened ? "open/no message" : "timeout/no open", ok: gotMessage || opened });
    }, 8000);

    ws.onopen = () => {
      opened = true;
      ws.send(JSON.stringify({ channel: "flow_alerts", msg_type: "join" }));
      ws.send(JSON.stringify({ channel: "off_lit_trades", msg_type: "join" }));
    };
    ws.onmessage = (ev) => {
      gotMessage = true;
      clearTimeout(timer);
      ws.close();
      resolve({ label, detail: String(ev.data).slice(0, 120), ok: true });
    };
    ws.onclose = (ev) => {
      if (!gotMessage) {
        clearTimeout(timer);
        resolve({ label, detail: opened ? `opened then closed code=${ev.code}` : `closed code=${ev.code}`, ok: opened });
      }
    };
    ws.onerror = () => {};
  });
}

async function main() {
  if (!KEY) {
    console.error("UW_API_KEY missing");
    process.exit(1);
  }
  await testRest();
  for (const [label, withToken] of [
    ["no token (expect fail)", false],
    ["?token= (official)", true],
  ]) {
    const r = await testMultiplex(label, withToken);
    console.log(`WS multiplex ${label} → ${r.ok ? "OK" : "FAIL"}: ${r.detail}`);
  }
}

main();
