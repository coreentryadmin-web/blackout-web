/** Parse ops:collect JSON from stdout (stderr may carry postgres-skip info). */
export function parseOpsCollectPayload(stdout, stderr) {
  const blob = `${stdout}\n${stderr}`;
  const jsonLine = blob.split("\n").find((l) => l.trim().startsWith("{"));
  if (!jsonLine) return null;
  try {
    return JSON.parse(jsonLine);
  } catch {
    return null;
  }
}

/** Grid/0DTE post-close: only grid|zerodte|nighthawk|correctness:flags with grid layer items count as FAIL. */
export function gridOpsItems(items) {
  return (items ?? []).filter((i) => {
    if (i.priority !== "P0" && i.priority !== "P1") return false;
    const hay = `${i.id} ${i.title} ${i.detail}`.toLowerCase();
    return /zerodte|0dte|grid|nighthawk/.test(hay) || (i.id === "correctness:flags" && /zerodte|grid/.test(hay));
  });
}

/** SPX post-close: only SPX/GEX/desk-layer P0/P1 items fail the gate. */
export function spxOpsItems(items) {
  return (items ?? []).filter((i) => {
    if (i.priority !== "P0" && i.priority !== "P1") return false;
    const hay = `${i.id} ${i.title} ${i.detail}`.toLowerCase();
    return (
      /spx|gex|heatmap|desk|slayer|thermal/.test(hay) ||
      (i.id === "correctness:flags" && /spx|gex|heatmap|desk/i.test(hay))
    );
  });
}
