import axios from 'axios';
import dns from 'dns/promises';
import { ApiError } from './errorHandler';

let disposableDomains: string[] = [];
let lastFetch: number | null = null;

// Fetch list once every 24h
async function loadDisposableDomains(): Promise<void> {
  if (lastFetch && (Date.now() - lastFetch < 24 * 60 * 60 * 1000)) {
    return; // Use cached list if less than 24h old
  }

  try {
    const { env } = await import('../config/env');
    const disposableEmailDomainsUrl = env.disposableEmailDomainsUrl;
    if (!disposableEmailDomainsUrl) {
      console.warn('[EMAIL GUARD] DISPOSABLE_EMAIL_DOMAINS_URL not configured, skipping domain list load');
      return;
    }
    const response = await axios.get(
      disposableEmailDomainsUrl,
      { timeout: 10000 } // 10 second timeout
    );
    disposableDomains = response.data || [];
    lastFetch = Date.now();
    console.log(`[EMAIL GUARD] Loaded ${disposableDomains.length} disposable domains.`);
  } catch (err: any) {
    console.warn('[EMAIL GUARD] Failed to fetch domain list:', err.message);
    // If we have a cached list, keep using it
    if (disposableDomains.length === 0) {
      console.warn('[EMAIL GUARD] No cached list available, email validation may be less strict.');
    }
  }
}

// Check if domain exists in blocklist
function isTempEmail(email: string): boolean {
  const domain = email.toLowerCase().split('@')[1];
  if (!domain) return false;
  return disposableDomains.includes(domain);
}

// Check if domain has valid mail server (MX records)
async function hasMX(email: string): Promise<boolean> {
  const domain = email.split('@')[1];
  if (!domain) return false;

  try {
    const records = await dns.resolveMx(domain);
    return records.length > 0;
  } catch (err: any) {
    // DNS resolution failed - domain likely doesn't exist or has no MX records
    if (err.code === 'ENOTFOUND' || err.code === 'ENODATA') {
      return false;
    }
    // Other DNS errors - log but don't block (might be temporary network issue)
    console.warn(`[EMAIL GUARD] DNS lookup error for ${domain}:`, err.message);
    return true; // Allow on DNS errors to avoid false positives
  }
}

/**
 * Validates email address:
 * 1. Checks if it's a temporary/disposable email domain
 * 2. Validates MX records to ensure the domain has mail servers
 * 
 * @param email - Email address to validate
 * @throws ApiError if email is invalid
 */
export async function validateEmail(email: string): Promise<void> {
  if (!email || typeof email !== 'string') {
    throw new ApiError('Email is required.', 400);
  }

  // Ensure disposable domains list is loaded
  await loadDisposableDomains();

  // Check if it's a temporary email
  if (isTempEmail(email)) {
    throw new ApiError(
      'Temporary or disposable email addresses are not allowed. Please use a permanent email address.',
      400
    );
  }

  // Check MX records (with timeout to avoid hanging)
  const mxCheckPromise = hasMX(email);
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      console.warn(`[EMAIL GUARD] MX check timeout for ${email}, allowing email`);
      resolve(true); // Allow on timeout to avoid false positives
    }, 5000); // 5 second timeout
  });

  const hasValidMX = await Promise.race([mxCheckPromise, timeoutPromise]);
  
  if (!hasValidMX) {
    throw new ApiError(
      'Invalid email address. The email domain does not have a valid mail server. Please use a valid email address.',
      400
    );
  }
}

/**
 * Express middleware for email validation
 * Use this in routes that accept email addresses
 */
export async function emailGuard(req: any, res: any, next: any): Promise<void> {
  try {
    const email = req.body?.email;
    if (!email) {
      return next(new ApiError('Email is required.', 400));
    }
    await validateEmail(email);
    next();
  } catch (error) {
    next(error);
  }
}

