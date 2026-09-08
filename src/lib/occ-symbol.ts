/**
 * Pure OCC symbol builder — safe for client + server bundles.
 *
 * SPX index options trade under the SPXW root on Polygon/Massive. Returns null when inputs
 * cannot form a valid OCC (never a malformed symbol).
 */
export function buildOcc(
  ticker: string,
  expiry: string, // YYYY-MM-DD
  optionType: "call" | "put",
  strike: number,
): string | null {
  const rawRoot = ticker.trim().toUpperCase();
  if (!rawRoot) return null;
  const root = rawRoot === "SPX" ? "SPXW" : rawRoot;
  if (!/^[A-Z]{1,6}$/.test(root)) return null;

  const ymd = expiry.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  const yy = m[1].slice(2);
  const date = `${yy}${m[2]}${m[3]}`;

  if (optionType !== "call" && optionType !== "put") return null;
  const cp = optionType === "call" ? "C" : "P";

  if (!Number.isFinite(strike) || strike <= 0) return null;
  const strikeInt = Math.round(strike * 1000);
  if (strikeInt <= 0 || strikeInt > 99_999_999) return null;
  const strikeStr = String(strikeInt).padStart(8, "0");

  return `O:${root}${date}${cp}${strikeStr}`;
}
