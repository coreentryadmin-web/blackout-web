import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { LOCKS_DIR, lockPath } from "./paths.mjs";

const DEFAULT_LEASE_MS = 90 * 60 * 1000;

export function ensureLocksDir() {
  mkdirSync(LOCKS_DIR, { recursive: true });
}

/** @returns {import('./locks.mjs').TaskLock | null} */
export function readLock(taskId) {
  const path = lockPath(taskId);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** @typedef {{ task_id: string, owner: string, claimed_at: string, lease_until: string, phase: string, branch?: string|null, pr?: number|null, reviewer?: string|null, run_id?: string|null }} TaskLock */

export function claimLock(taskId, owner, opts = {}) {
  ensureLocksDir();
  const path = lockPath(taskId);
  const now = Date.now();
  const existing = readLock(taskId);

  if (existing) {
    const leaseUntil = Date.parse(existing.lease_until);
    if (leaseUntil > now && existing.owner !== owner) {
      return { ok: false, reason: "leased_by_other", lock: existing };
    }
    if (leaseUntil > now && existing.owner === owner) {
      return { ok: true, lock: existing };
    }
    try {
      unlinkSync(path);
    } catch {
      /* raced */
    }
  }

  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const lock = {
    task_id: taskId,
    owner,
    claimed_at: new Date(now).toISOString(),
    lease_until: new Date(now + leaseMs).toISOString(),
    phase: opts.phase ?? "CLAIMED",
    branch: opts.branch ?? null,
    pr: opts.pr ?? null,
    reviewer: opts.reviewer ?? null,
    run_id: opts.runId ?? null,
  };

  try {
    writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx" });
    return { ok: true, lock };
  } catch {
    const raced = readLock(taskId);
    if (raced) {
      const leaseUntil = Date.parse(raced.lease_until);
      if (leaseUntil <= now) {
        writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`);
        return { ok: true, lock };
      }
      if (raced.owner === owner) return { ok: true, lock: raced };
      return { ok: false, reason: "claim_race", lock: raced };
    }
    return { ok: false, reason: "claim_race" };
  }
}

export function releaseLock(taskId, owner) {
  const existing = readLock(taskId);
  if (!existing) return { ok: true, released: false };
  if (existing.owner !== owner) return { ok: false, reason: "not_owner", lock: existing };
  unlinkSync(lockPath(taskId));
  return { ok: true, released: true };
}

export function renewLock(taskId, owner, opts = {}) {
  const existing = readLock(taskId);
  if (!existing) return { ok: false, reason: "no_lock" };
  if (existing.owner !== owner) return { ok: false, reason: "not_owner", lock: existing };
  const leaseMs = opts.leaseMs ?? DEFAULT_LEASE_MS;
  const lock = {
    ...existing,
    lease_until: new Date(Date.now() + leaseMs).toISOString(),
    phase: opts.phase ?? existing.phase,
    branch: opts.branch ?? existing.branch,
    pr: opts.pr ?? existing.pr,
    run_id: opts.runId ?? existing.run_id,
  };
  writeFileSync(lockPath(taskId), `${JSON.stringify(lock, null, 2)}\n`);
  return { ok: true, lock };
}

export function expireStaleLocksSync() {
  ensureLocksDir();
  const expired = [];
  for (const file of readdirSync(LOCKS_DIR)) {
    if (!file.endsWith(".lock")) continue;
    const taskId = file.replace(/\.lock$/, "");
    const lock = readLock(taskId);
    if (!lock) continue;
    if (Date.parse(lock.lease_until) <= Date.now()) {
      unlinkSync(lockPath(taskId));
      expired.push(taskId);
    }
  }
  return expired;
}
