/** Build OCC symbol for Vector pick live quotes (same rules as Night Hawk chain). */
export function vectorPickOcc(
  ticker: string,
  expiryYmd: string,
  side: "call" | "put",
  strike: number
): string | null {
  const root = ticker.trim().toUpperCase() === "SPX" ? "SPXW" : ticker.trim().toUpperCase();
  if (!/^[A-Z]{1,6}$/.test(root)) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(expiryYmd.slice(0, 10));
  if (!m) return null;
  if (!Number.isFinite(strike) || strike <= 0) return null;
  const strikeInt = Math.round(strike * 1000);
  if (strikeInt <= 0 || strikeInt > 99_999_999) return null;
  return `O:${root}${m[1].slice(2)}${m[2]}${m[3]}${side === "call" ? "C" : "P"}${String(strikeInt).padStart(8, "0")}`;
}
