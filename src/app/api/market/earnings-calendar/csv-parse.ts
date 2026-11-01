/**
 * Alpha Vantage EARNINGS_CALENDAR CSV line parser.
 *
 * The upstream CSV header is `symbol,name,reportDate,fiscalDateEnding,estimate,currency`.
 * `name` is a free-text company legal name, and plenty of real tickers carry a comma in
 * that field (e.g. "Brown & Brown, Inc.", "AMC Entertainment Holdings, Inc.") — standard
 * RFC 4180 CSV quotes any field containing the delimiter, so a correctly-generated row
 * looks like: `BRO,"Brown & Brown, Inc.",2024-07-24,2024-06-30,0.98,USD`.
 *
 * A naive `line.split(",")` does not know about quoting: it splits the quoted name into
 * two extra columns and shifts every column after it one or two places to the right. The
 * caller reads `reportDate` by a FIXED index (2), so for any row with a comma in the name
 * it reads part of the name instead of a date — `/^\d{4}-\d{2}-\d{2}$/` correctly rejects
 * that garbage, so the row is silently dropped rather than corrupted. The practical effect
 * is "we don't have that data" (treated as no upcoming earnings for the ticker) when the
 * real answer is "yes, on this date" — the exact measured-zero-conflated-with-absence shape
 * this repo's audits keep naming. This parser handles RFC 4180 quoting (including the
 * `""`-escaped-quote-inside-a-quoted-field case) so every row parses into the right number
 * of columns regardless of commas inside `name`.
 */
export function parseEarningsCalendarCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}
