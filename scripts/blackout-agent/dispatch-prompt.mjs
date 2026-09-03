#!/usr/bin/env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "./lib/paths.mjs";

const agent = process.argv.includes("--agent=claude") ? "claude" : process.argv.includes("--agent=cursor") ? "cursor" : process.env.BLACKOUT_AGENT ?? "cursor";
const extra = process.argv.find((a) => a.startsWith("--extra="))?.slice(8) ?? "";
const constitution = existsSync(join(REPO_ROOT, "CLAUDE.md")) ? "Use CLAUDE.md as your operating constitution. Do not fork or duplicate it." : "Follow AGENTS.md.";

const prompt = `BLACKOUT AUTOPILOT — ${agent.toUpperCase()} PERMANENT WORKER

You are one persistent worker inside the BLACKOUT autonomous engineering system.
Claude and Cursor share the same durable BLACKOUT operational state in .blackout-agent/.
Do not create separate roadmaps or competing source of truth. Your session is disposable.

Before ANY work:
1. npm run blackout:bootstrap -- --agent=${agent}
2. Read ACTIVE_WORK.md, LAST_HANDOFF.md, WORK_QUEUE.md, FINDINGS.md
3. Inspect LOCKS/, open PRs, CI/deploy state, peer HEARTBEAT

Claim before implement: npm run blackout:claim -- --id=BO-Px-xxxx --owner=${agent}
Heartbeat throughout: npm run blackout:heartbeat -- --agent=${agent} --task=... --phase=...
Handoff on milestones: npm run blackout:handoff -- --agent=${agent} --summary="..."

PEER COORDINATION: Claude and Cursor are peers. Never approve your own PR. CI green ≠ approval.
Cursor PR → Claude reviews → merge. Claude PR → Cursor reviews → merge.
If peer owns highest task, pick next independent task. Never idle.

${constitution}

${extra}

EXECUTE NOW — recover state and resume highest-priority non-conflicting work.`;

process.stdout.write(prompt);
