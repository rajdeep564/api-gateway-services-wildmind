import { Request, Response, NextFunction } from "express";
import { formatApiResponse } from "../utils/formatApiResponse";
import { getInrRatesCached } from "../services/fxRatesService";
import { resolveSuggestedCurrencyFromCountryCode } from "../services/countryCurrencyService";

/**
 * Public: latest INR-based FX rates (display only). Cached ~24h server-side.
 * Adds suggestedCurrency from Cloudflare country or x-geo-country (optional).
 */
async function getRates(req: Request, res: Response, next: NextFunction) {
  try {
    const cf = (req.headers["cf-ipcountry"] as string) || "";
    const geo = (req.headers["x-geo-country"] as string) || "";
    const country = (cf || geo || "").trim().toUpperCase() || undefined;
    const detectedCountryCode = country && country.length === 2 ? country : null;
    const suggestedCurrency = await resolveSuggestedCurrencyFromCountryCode(
      detectedCountryCode,
    );

    const { base, rates, asOf } = await getInrRatesCached();

    res.setHeader("Cache-Control", "public, max-age=3600");

    return res.json(
      formatApiResponse("success", "FX rates (display only)", {
        base,
        asOf,
        rates,
        suggestedCurrency,
        detectedCountryCode,
        disclaimer:
          "Prices are billed in INR via Razorpay; foreign amounts are indicative.",
      }),
    );
  } catch (e) {
    next(e);
  }
}

export const fxController = {
  getRates,
};
