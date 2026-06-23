/**
 * Fallback alert_id for UW flow prints that lack an upstream id. WIDENING-ONLY:
 * appends premium (and trade_count when present) so distinct same-instant prints no
 * longer collide into one id and get dropped by ON CONFLICT DO NOTHING. Pure.
 */
export function flowFallbackAlertId(flow: {
  ticker: string;
  alerted_at: string;
  strike: number;
  option_type: string;
  premium: number;
  trade_count?: number | null;
}): string {
  let key = `uw:${flow.ticker}:${flow.alerted_at}:${flow.strike}:${flow.option_type}:${flow.premium}`;
  if (flow.trade_count != null) key += `:${flow.trade_count}`;
  return key;
}
