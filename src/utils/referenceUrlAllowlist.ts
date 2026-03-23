/**
 * Reference URL allowlist — SSRF prevention (critical fix).
 * Only reference image URLs from allowed domains may be used (e.g. assistant/converse).
 *
 * Configure via REFERENCE_URL_ALLOWED_DOMAINS (comma-separated, e.g. "cdn.wildmind.ai,storage.wildmind.ai").
 */

const DEFAULT_ALLOWED_DOMAINS = [
  "cdn.wildmind.ai",
  "storage.wildmind.ai",
  "storage.googleapis.com", // Firebase Storage
  "localhost",              // dev
  "127.0.0.1",
];

function getAllowedDomains(): string[] {
  const env = process.env.REFERENCE_URL_ALLOWED_DOMAINS;
  if (env && env.trim()) {
    return env.split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_DOMAINS;
}

function getHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Returns true if every URL is from an allowed domain; false otherwise.
 */
export function areReferenceUrlsAllowed(urls: string[]): boolean {
  if (!urls.length) return true;
  const allowed = getAllowedDomains();
  for (const url of urls) {
    const host = getHost(url);
    if (!host) return false;
    const ok = allowed.some((d) => host === d || host.endsWith("." + d));
    if (!ok) return false;
  }
  return true;
}

/**
 * Validate reference URLs. Returns { valid: true } or { valid: false, reason: string }.
 */
export function validateReferenceUrls(urls: string[]): { valid: true } | { valid: false; reason: string } {
  if (!urls.length) return { valid: true };
  const allowed = getAllowedDomains();
  for (const url of urls) {
    const host = getHost(url);
    if (!host) return { valid: false, reason: `Invalid URL: ${url.slice(0, 80)}` };
    const ok = allowed.some((d) => host === d || host.endsWith("." + d));
    if (!ok) return { valid: false, reason: `Reference URL domain not allowed: ${host}` };
  }
  return { valid: true };
}
