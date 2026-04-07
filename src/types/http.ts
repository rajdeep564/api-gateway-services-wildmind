import 'express';

declare global {
  namespace Express {
    interface Request {
      authenticatedReq?: true;
      /** Raw JWT the gateway actually validated (session cookie or ID token). Use when proxying to services that must verify the same credential. */
      verifiedAuthToken?: string;
      uid: string;
      email?: string;
      username?: string;
      context?: {
        creditCost?: number;
        reason?: string;
        idempotencyKey?: string;
        pricingVersion?: string;
        meta?: Record<string, any>;
      };
    }
  }
}

export {};


