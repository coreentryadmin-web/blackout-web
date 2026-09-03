#!/usr/bin/env node
// Reclaim a task's lock ONLY if BOTH are true:
//   1. lease_until has passed, AND
//   2. the recorded owner's heartbeat is missing or older than --max-age-min
// Passing only #1 (an expired lease_until) is NOT sufficient — a slow-but-alive
// agent still renewing its heartbeat must not be stolen from. This is the
// concrete "verify heartbeat/process state before lease recovery" rule.
// Usage: node recover-stale-lease.mjs <task_id> [--max-age-min=30]
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCKS_DIR = join(REPO_ROOT, '.blackout-agent', 'LOCKS');
const HB_DIR = join(REPO_ROOT, '.blackout-agent', 'HEARTBEAT');

const args = process.argv.slice(2);
const taskId = args.find((a) => !a.startsWith('--'));
const maxAgeArg = args.find((a) => a.startsWith('--max-age-min='));
const maxAgeMin = Number(maxAgeArg ? maxAgeArg.split('=')[1] : 30);

if (!taskId) {
  console.error('usage: recover-stale-lease.mjs <task_id> [--max-age-min=30]');
  process.exit(2);
}

const lockPath = join(LOCKS_DIR, `${taskId}.lock`);
if (!existsSync(lockPath)) {
  console.log(`NOOP: ${taskId} is not locked, nothing to recover`);
  process.exit(0);
}

const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
const now = Date.now();
const leaseExpired = new Date(lock.lease_until).getTime() < now;

if (!leaseExpired) {
  console.log(
    `NOT RECLAIMED: ${taskId} lease for ${lock.owner} does not expire until ${lock.lease_until} (now=${new Date(now).toISOString()})`
  );
  process.exit(1);
}

const hbPath = join(HB_DIR, `${lock.owner}.json`);
let heartbeatStale = true;
let hbEvidence = 'no heartbeat file found for this owner';
if (existsSync(hbPath)) {
  const hb = JSON.parse(readFileSync(hbPath, 'utf8'));
  const ageMin = (now - new Date(hb.last_seen).getTime()) / 60_000;
  heartbeatStale = ageMin > maxAgeMin;
  hbEvidence = `heartbeat last_seen=${hb.last_seen} (${ageMin.toFixed(1)}min ago), threshold=${maxAgeMin}min`;
}

if (!heartbeatStale) {
  console.log(
    `NOT RECLAIMED: ${taskId} lease_until expired but owner ${lock.owner}'s heartbeat is still fresh (${hbEvidence}) — ` +
      `treating as a slow-but-alive agent, not a dead one. Refusing to steal.`
  );
  process.exit(1);
}

unlinkSync(lockPath);
console.log(
  `RECLAIMED: ${taskId} was held by ${lock.owner} (lease_until=${lock.lease_until}, ${hbEvidence}) — lock removed, task is now claimable.`
);
