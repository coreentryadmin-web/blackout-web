/** Shared monotonic IDs for in-memory play rows (no DB). */
let nextPlayId = 1;

export function nextMemoryPlayId(): number {
  return nextPlayId++;
}
