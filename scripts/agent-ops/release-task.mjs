#!/usr/bin/env node
// Release a task claim. Only the recorded owner can release it — this stops
// agent B from releasing (and then re-claiming) agent A's active lease.
// Usage: node release-task.mjs <task_id> <owner>
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
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
if (!existsSync(lockPath)) {
  console.log(`NOOP: ${taskId} was not locked`);
  process.exit(0);
}
const existing = JSON.parse(readFileSync(lockPath, 'utf8'));
if (existing.owner !== owner) {
  console.error(`REFUSED: ${taskId} is held by ${existing.owner}, not ${owner} — will not release someone else's lease`);
  process.exit(1);
}
unlinkSync(lockPath);
console.log(`RELEASED ${taskId} by ${owner}`);
