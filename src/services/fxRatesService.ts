import axios from "axios";

/** All quotes Frankfurter exposes for base INR (no fixed `to` list — ECB set). */
const FRANKFURTER = "https://api.frankfurter.app/latest?from=INR";

/** INR → quote: 1 INR = X quote. */
const TTL_MS = 24 * 60 * 60 * 1000;

type Cached = {
  rates: Record<string, number>;
  asOf: string;
  fetchedAt: number;
};

let cache: Cached | null = null;

export async function getInrRatesCached(): Promise<{
  base: "INR";
  rates: Record<string, number>;
  asOf: string;
}> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < TTL_MS) {
    return { base: "INR", rates: cache.rates, asOf: cache.asOf };
  }

  const { data } = await axios.get<{
    base: string;
    date: string;
    rates: Record<string, number>;
  }>(FRANKFURTER, { timeout: 15000 });

  const rates: Record<string, number> = { ...(data.rates || {}) };
  rates.INR = 1;

  cache = {
    rates,
    asOf: data.date || new Date().toISOString().slice(0, 10),
    fetchedAt: now,
  };

  return { base: "INR", rates, asOf: cache.asOf };
}
