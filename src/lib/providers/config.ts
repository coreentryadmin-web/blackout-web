export function polygonConfigured(): boolean {
  return Boolean(process.env.POLYGON_API_KEY?.trim());
}

export function uwConfigured(): boolean {
  return Boolean(process.env.UW_API_KEY?.trim());
}

export function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY?.trim());
}

export function marketDataConfigured(): boolean {
  return polygonConfigured() || uwConfigured() || finnhubConfigured();
}
