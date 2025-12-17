import dns from 'dns/promises';
import { isDisposableEmail, isDisposableEmailDomain } from 'disposable-email-domains-js';
import { ApiError } from './errorHandler';

// --- Layer 1: Syntax check (RFC-ish, safe-mode, no SMTP probing) ---
const EMAIL_SYNTAX_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function assertValidSyntax(email: string): void {
  if (typeof email !== 'string') {
    throw new ApiError('Email is required.', 400);
  }

  const trimmed = email.trim();

  if (!trimmed || !EMAIL_SYNTAX_REGEX.test(trimmed)) {
    throw new ApiError('Invalid email address format.', 400);
  }

  // Basic unicode safety: reject control chars that can break downstream
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    throw new ApiError('Invalid email address characters.', 400);
  }
}

function getDomain(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const parts = trimmed.split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1]?.trim();
  return domain || null;
}

// --- Layer 3: Disposable domain blocking (via disposable-email-domains-js) ---
function isTempEmail(email: string): boolean {
  const trimmed = email.trim().toLowerCase();
  const domain = getDomain(trimmed);
  if (!domain) return false;

  // Library handles both domain and full-email checks with its own up-to-date list
  return isDisposableEmail(trimmed) || isDisposableEmailDomain(domain);
}

// --- Layer 4: DNS MX validation (safe mode – no SMTP probing) ---
async function hasMX(email: string): Promise<boolean> {
  const domain = getDomain(email);
  if (!domain) return false;

  try {
    const records = await dns.resolveMx(domain);
    if (!records || records.length === 0) {
      return false;
    }
    return true;
  } catch (err: any) {
    // DNS resolution failed - domain likely doesn't exist or has no MX records
    if (err?.code === 'ENOTFOUND' || err?.code === 'ENODATA') {
      return false; // NXDOMAIN / no MX ⇒ reject
    }

    // Other DNS errors - log but don't block (might be temporary network issue)
    console.warn(`[EMAIL GUARD] DNS lookup error for ${domain}:`, err?.message || err);
    return true; // Allow on DNS errors to avoid false positives
  }
}

/**
 * validateEmail():
 *  - Layer 1: syntaxCheck
 *  - Layer 3: disposableListCheck (via disposable-email-domains-js)
 *  - Layer 4: MX check (safe mode, 3s timeout)
 */
export async function validateEmail(email: string): Promise<void> {
  // Layer 1 – syntax
  assertValidSyntax(email);

  // Layer 3 – disposable domain (library-based)
  if (isTempEmail(email)) {
    throw new ApiError(
      'Temporary or disposable email addresses are not allowed. Please use a permanent email address.',
      400
    );
  }

  // Layer 4 – MX (safe mode with timeout)
  const mxCheckPromise = hasMX(email);
  const timeoutPromise = new Promise<boolean>((resolve) => {
    setTimeout(() => {
      console.warn(`[EMAIL GUARD] MX check timeout for ${email}, allowing email`);
      resolve(true); // Allow on timeout to avoid false positives
    }, 3000); // 3 seconds
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
 * Express-style guard wrapper for routes that accept email addresses.
 * Keeps compatibility with existing middleware usage.
 */
export async function emailGuard(req: any, _res: any, next: any): Promise<void> {
  try {
    const email = req.body?.email;
    if (!email) {
      throw new ApiError('Email is required.', 400);
    }
    await validateEmail(email);
    next();
  } catch (err) {
    next(err);
  }
}


