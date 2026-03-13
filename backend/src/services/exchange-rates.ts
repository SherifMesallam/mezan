/**
 * Fetches exchange rates to EGP and computes EGP equivalent for non-EGP amounts.
 * Uses free API (no key): https://github.com/fawazahmed0/exchange-api
 * Rates are cached in memory for 1 hour per currency to avoid rate limits.
 * Tries jsdelivr CDN first, then Cloudflare fallback per API docs.
 */

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const BASE_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies',
  'https://latest.currency-api.pages.dev/v1/currencies',
];

const cache = new Map<string, { rate: number; fetchedAt: number }>();

function cacheKey(currency: string): string {
  return currency.trim().toLowerCase().slice(0, 3);
}

/**
 * Fetches the rate for 1 unit of `currency` in EGP.
 * Returns null if currency is EGP or if the API fails.
 */
async function fetchRateToEgp(currency: string): Promise<number | null> {
  const code = cacheKey(currency);
  if (code === 'egp') return 1;

  const cached = cache.get(code);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rate;
  }

  for (const baseUrl of BASE_URLS) {
    try {
      const url = `${baseUrl}/${code}.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      const rates = json[code] as Record<string, number> | undefined;
      const egpRate = rates?.egp;
      if (typeof egpRate !== 'number' || !Number.isFinite(egpRate) || egpRate <= 0) {
        continue;
      }
      cache.set(code, { rate: egpRate, fetchedAt: Date.now() });
      return egpRate;
    } catch (e) {
      continue;
    }
  }
  console.error('Exchange rate fetch failed for', code, 'tried', BASE_URLS.length, 'endpoints');
  return null;
}

/**
 * Returns the EGP equivalent of `amount` in `currency`.
 * - If currency is EGP, returns amount.
 * - If no rate is available or API fails, returns null (caller can leave egp_value unset).
 */
export async function amountToEgp(currency: string, amount: number): Promise<number | null> {
  const code = cacheKey(currency);
  if (code === 'egp') return amount;
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const rate = await fetchRateToEgp(currency);
  if (rate == null) {
    console.log('[EXCHANGE-RATES] amountToEgp: no rate for', currency, '- egpValue will be unset');
    return null;
  }
  const egp = Math.round(amount * rate * 100) / 100;
  console.log('[EXCHANGE-RATES] amountToEgp:', { currency, amount, rate, egp });
  return egp;
}
