import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { LOCKS_DIR } from "./paths.mjs";

const STATE_WRITE_LOCK = "state.write.lock";
const DEFAULT_TTL_MS = 30_000;

export function withStateLock(fn, opts = {}) {
  mkdirSync(LOCKS_DIR, { recursive: true });
  const lockFile = `${LOCKS_DIR}/${STATE_WRITE_LOCK}`;
  const owner = opts.owner ?? `pid-${process.pid}`;
  const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
  const now = Date.now();

  if (existsSync(lockFile)) {
    try {
      const held = JSON.parse(readFileSync(lockFile, "utf8"));
      if (Date.parse(held.until) > now && held.owner !== owner) {
        return { ok: false, reason: "state_lock_held", lock: held };
      }
      unlinkSync(lockFile);
    } catch {
      try {
        unlinkSync(lockFile);
      } catch {
        /* */
      }
    }
  }

  const meta = { owner, since: new Date(now).toISOString(), until: new Date(now + ttl).toISOString() };
  try {
    writeFileSync(lockFile, `${JSON.stringify(meta, null, 2)}\n`, { flag: "wx" });
  } catch {
    return { ok: false, reason: "state_lock_race" };
  }

  try {
    return { ok: true, result: fn() };
  } finally {
    try {
      unlinkSync(lockFile);
    } catch {
      /* */
    }
  }
}
