#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { syncContext } from "./sync-context.mjs";
import { MARKDOWN_FILES } from "./lib/paths.mjs";
import { readJson } from "./lib/state.mjs";
import { heartbeatPath } from "./lib/paths.mjs";

function parseArgs(argv) {
  const out = { agent: process.env.BLACKOUT_AGENT ?? "cursor" };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith("--")) {
      const [k, v] = arg.slice(2).split("=");
      out[k.replace(/-/g, "_")] = v ?? true;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const { state, activeLocks } = syncContext();
const peer = args.agent === "claude" ? "cursor" : "claude";

const report = {
  agent: args.agent,
  recovered_at: new Date().toISOString(),
  deploy: state.deploy,
  peer: { agent: peer, heartbeat: readJson(heartbeatPath(peer), null), active_tasks: Object.entries(activeLocks).filter(([, l]) => l.owner === peer).map(([id, l]) => ({ id, ...l })) },
  self: { heartbeat: readJson(heartbeatPath(args.agent), null), resumed_tasks: Object.entries(activeLocks).filter(([, l]) => l.owner === args.agent).map(([id, l]) => ({ id, ...l })) },
  open_prs: state.open_prs ?? [],
  review_queue: (state.open_prs ?? []).filter((pr) => !pr.draft && pr.verify.includes("SUCCESS") && ((args.agent === "cursor" && pr.agent === "claude") || (args.agent === "claude" && pr.agent === "cursor"))).map((p) => ({ number: p.number, title: p.title, branch: p.branch })),
  active_work_excerpt: existsSync(MARKDOWN_FILES.activeWork) ? readFileSync(MARKDOWN_FILES.activeWork, "utf8").slice(0, 1200) : null,
  last_handoff_excerpt: existsSync(MARKDOWN_FILES.lastHandoff) ? readFileSync(MARKDOWN_FILES.lastHandoff, "utf8").slice(0, 1200) : null,
};
console.log(JSON.stringify(report, null, 2));
