#!/usr/bin/env node
// Atomic task claim for .blackout-agent/LOCKS/<task_id>.lock.
// Uses O_EXCL ('wx') so two concurrent callers racing on the same task_id can
// never both succeed — the OS filesystem, not app logic, arbitrates the race.
// Usage: node claim-task.mjs <task_id> <owner> [lease_minutes=30]
import { openSync, writeSync, closeSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCKS_DIR = join(REPO_ROOT, '.blackout-agent', 'LOCKS');

const [taskId, owner, leaseMinArg] = process.argv.slice(2);
if (!taskId || !owner) {
  console.error('usage: claim-task.mjs <task_id> <owner> [lease_minutes=30]');
  process.exit(2);
}
const leaseMin = Number(leaseMinArg || 30);
const lockPath = join(LOCKS_DIR, `${taskId}.lock`);
const now = new Date();
const leaseUntil = new Date(now.getTime() + leaseMin * 60_000);

const payload = JSON.stringify(
  {
    task_id: taskId,
    owner,
    claimed_at: now.toISOString(),
    lease_until: leaseUntil.toISOString(),
  },
  null,
  2
);

let fd;
try {
  fd = openSync(lockPath, 'wx'); // fails with EEXIST if the file already exists
  writeSync(fd, payload);
  closeSync(fd);
  console.log(`CLAIMED ${taskId} by ${owner}, lease until ${leaseUntil.toISOString()}`);
  process.exit(0);
} catch (err) {
  if (err.code === 'EEXIST') {
    // CodeQL flags reading lockPath here as a file-system race (the file could be deleted —
    // by release-task.mjs or recover-stale-lease.mjs running concurrently — between the EEXIST
    // above and this read). That race is real but benign: it can only mean someone else's
    // claim/release/reclaim happened in between, which is exactly the kind of concurrent
    // activity this whole locking scheme exists to arbitrate safely. Handled explicitly rather
    // than left to crash the process on an unhandled ENOENT, and the diagnostic degrades to
    // "already gone" instead of asserting stale ownership details we can no longer read.
    let existing;
    try {
      existing = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch {
      console.error(
        `NOT CLAIMED: ${taskId} was held by another owner but its lock vanished before it could be read ` +
          `(released or reclaimed concurrently) — retry the claim.`
      );
      process.exit(1);
    }
    console.error(
      `NOT CLAIMED: ${taskId} already held by ${existing.owner} (claimed_at=${existing.claimed_at}, lease_until=${existing.lease_until}). ` +
        `If you believe this is stale, run recover-stale-lease.mjs — it verifies the owner's heartbeat before reclaiming, it does not just check lease_until.`
    );
    process.exit(1);
  }
  throw err;
}
