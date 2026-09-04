#!/usr/bin/env node
// Release a task claim. Only the recorded owner can release it — this stops
// agent B from releasing (and then re-claiming) agent A's active lease.
// Usage: node release-task.mjs <task_id> <owner>
import { readFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCKS_DIR = join(REPO_ROOT, '.blackout-agent', 'LOCKS');

const [taskId, owner] = process.argv.slice(2);
if (!taskId || !owner) {
  console.error('usage: release-task.mjs <task_id> <owner>');
  process.exit(2);
}
const lockPath = join(LOCKS_DIR, `${taskId}.lock`);
// Read directly rather than existsSync-then-readFileSync: that check-then-use pattern is a
// file-system race (the lock can vanish between the two calls, e.g. a concurrent release or
// reclaim) — CodeQL flags it, and it's real, so read once and handle ENOENT as the NOOP case.
let existing;
try {
  existing = JSON.parse(readFileSync(lockPath, 'utf8'));
} catch (err) {
  if (err.code === 'ENOENT') {
    console.log(`NOOP: ${taskId} was not locked`);
    process.exit(0);
  }
  throw err;
}
if (existing.owner !== owner) {
  console.error(`REFUSED: ${taskId} is held by ${existing.owner}, not ${owner} — will not release someone else's lease`);
  process.exit(1);
}
unlinkSync(lockPath);
console.log(`RELEASED ${taskId} by ${owner}`);
