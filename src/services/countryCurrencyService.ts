import axios from "axios";

/**
 * ISO 3166-1 alpha-2 → primary ISO 4217 code via REST Countries (free, no API key).
 * Cache aggressively — /me and /fx hit this often; the upstream API is community-run.
 */
const REST_COUNTRIES = "https://restcountries.com/v3.1/alpha";
const TTL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15000;

type CacheEntry = { currency: string; fetchedAt: number };

const cache = new Map<string, CacheEntry>();

function pickFirstCurrency(currencies: Record<string, unknown> | undefined): string | null {
  if (!currencies || typeof currencies !== "object") return null;
  const keys = Object.keys(currencies);
  for (const k of keys) {
    if (/^[A-Z]{3}$/.test(k)) return k;
  }
  return null;
}

/**
 * Suggested display currency from country code. Billing default INR when unknown or on failure.
 */
export async function resolveSuggestedCurrencyFromCountryCode(
  countryCode: string | null | undefined,
): Promise<string> {
  if (!countryCode || typeof countryCode !== "string") return "INR";
  const cc = countryCode.trim().toUpperCase();
  if (cc.length !== 2) return "INR";

  const now = Date.now();
  const hit = cache.get(cc);
  if (hit && now - hit.fetchedAt < TTL_MS) {
    return hit.currency;
  }

  try {
    const { data, status } = await axios.get<{
      currencies?: Record<string, { name?: string; symbol?: string }>;
    }>(`${REST_COUNTRIES}/${encodeURIComponent(cc)}`, {
      params: { fields: "currencies" },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: (s) => s === 200 || s === 404,
    });

    if (status === 404) {
      const fallback = "INR";
      cache.set(cc, { currency: fallback, fetchedAt: now });
      return fallback;
    }

    const cur = pickFirstCurrency(data?.currencies);
    const resolved = cur || "INR";
    cache.set(cc, { currency: resolved, fetchedAt: now });
    return resolved;
  } catch (e) {
    console.warn("[countryCurrencyService] REST Countries lookup failed", { cc, err: e });
    return "INR";
  }
}
