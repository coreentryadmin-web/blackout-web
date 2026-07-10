export function isSpxTicker(ticker: string): boolean {
  const t = ticker.toUpperCase().replace(/^I:/, "");
  return t === "SPX" || t === "SPXW";
}
