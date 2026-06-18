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
if (!KEY) {
  console.error("UW_API_KEY missing");
  process.exit(1);
}

const joins = [
  "flow-alerts",
  "market-tide",
  "off-lit-trades",
  "flow_alerts",
  "market_tide",
  "off_lit_trades",
];

const url = `wss://api.unusualwhales.com/socket?token=${encodeURIComponent(KEY)}`;
console.log("connecting", url.replace(KEY, "[REDACTED]"));

const ws = new WebSocket(url);
let msgCount = 0;

ws.onopen = () => {
  console.log("OPEN");
  for (const channel of joins) {
    ws.send(JSON.stringify({ channel, msg_type: "join" }));
    console.log("JOIN", channel);
  }
  ws.send(JSON.stringify({ action: "ping" }));
};

ws.onmessage = (ev) => {
  msgCount++;
  console.log("MSG", String(ev.data).slice(0, 240));
};

ws.onclose = (ev) => {
  console.log("CLOSE", ev.code, ev.reason || "(no reason)");
};

ws.onerror = () => console.log("ERROR event");

setTimeout(() => {
  console.log(`done — messages=${msgCount}`);
  ws.close();
  process.exit(msgCount > 0 ? 0 : 1);
}, 15000);
