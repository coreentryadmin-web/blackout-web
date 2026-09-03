#!/usr/bin/env node
// Write/refresh .blackout-agent/HEARTBEAT/<agent>.json. last_seen is always
// stamped by this script (never trust a caller-supplied last_seen) so a stale
// heartbeat can only mean "nobody ran this script recently for that agent."
// Usage: node heartbeat.mjs <agent> '<json-fields>'
//   e.g. node heartbeat.mjs claude '{"task":"BO-AUTOPILOT-0001","phase":"IMPLEMENTING","branch":"fix/blackout-agent-autopilot","pr":null,"healthy":true}'
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HB_DIR = join(REPO_ROOT, '.blackout-agent', 'HEARTBEAT');

const [agent, fieldsJson] = process.argv.slice(2);
if (!agent) {
  console.error('usage: heartbeat.mjs <agent> [json-fields]');
  process.exit(2);
}
let fields = {};
if (fieldsJson) {
  try {
    fields = JSON.parse(fieldsJson);
  } catch (e) {
    console.error('fields must be valid JSON:', e.message);
    process.exit(2);
  }
}
if (!existsSync(HB_DIR)) mkdirSync(HB_DIR, { recursive: true });

const record = {
  agent,
  last_seen: new Date().toISOString(),
  ...fields,
};
writeFileSync(join(HB_DIR, `${agent}.json`), JSON.stringify(record, null, 2) + '\n');
console.log(`heartbeat written for ${agent} at ${record.last_seen}`);
