import axios from 'axios';
import { env } from '../config/env';
import { logger } from '../utils/logger';

// Re-export types for compatibility
export type LedgerStatus = 'PENDING' | 'CONFIRMED' | 'REVERSED';
export type LedgerType = 'GRANT' | 'DEBIT' | 'REFUND' | 'HOLD';

export interface LedgerEntry {
  type: LedgerType;
  amount: number;
  reason: string;
  status: LedgerStatus;
  meta?: Record<string, any>;
  createdAt?: any;
}

const CREDIT_SERVICE_URL = env.creditServiceUrl;

type CreditServiceHeaders = Record<string, string> | undefined;

// Simple in-memory cache for pricing
const costCache = new Map<string, { cost: number; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function getModelCost(modelName: string, params?: any): Promise<number> {
  const cacheKey = `${modelName}_${JSON.stringify(params || {})}`;
  const now = Date.now();
  const cached = costCache.get(cacheKey);

  if (cached && cached.expiry > now) {
    return cached.cost;
  }

  try {
    const res = await axios.get(`${CREDIT_SERVICE_URL}/pricing/cost`, {
      params: { model: modelName, ...params }
    });

    if (res.data.success) {
      const cost = res.data.data.creditsPerGeneration;
      costCache.set(cacheKey, { cost, expiry: now + CACHE_TTL });
      return cost;
    }
    throw new Error(`Pricing fetch failed for ${modelName}`);
  } catch (e: any) {
    logger.error({ modelName, err: e.message }, '[CREDITS_REPO] getModelCost failed');
    throw e;
  }
}

// Helper for Axios errors
function handleAxiosError(e: any, context: string): never {
  const msg = e.response?.data?.message || e.message;
  const code = e.response?.data?.code;
  const status = e.response?.status;
  logger.error({ err: msg, status: e.response?.status }, `[CREDITS_REPO] ${context} - Error`);
  const err: any = new Error(msg);
  if (typeof code === "string" && code) {
    err.code = code;
  }
  if (typeof status === "number") {
    err.status = status;
    err.statusCode = status;
  }
  throw err;
}

export async function readUserCredits(uid: string): Promise<number> {
  try {
    const res = await axios.get(`${CREDIT_SERVICE_URL}/credits/${uid}`);
    if (res.data.success && res.data.data) {
      return Number(res.data.data.creditBalance || 0);
    }
    return 0;
  } catch (e: any) {
    if (e.response?.status === 404) return 0;

    handleAxiosError(e, 'readUserCredits');
    return 0; // Unreachable
  }
}

export async function readUserInfo(uid: string): Promise<{ creditBalance: number; planCode: string; launchTrialStartDate?: any; storageQuotaBytes?: string; storageUsedBytes?: string; freeTurboUsed?: number; freeTurboLimit?: number } | null> {
  try {
    const res = await axios.get(`${CREDIT_SERVICE_URL}/credits/${uid}`); // accessing via credits endpoint which returns user info
    if (res.data.success && res.data.data) {
      const d = res.data.data;
      return {
        creditBalance: Number(d.creditBalance || 0),
        planCode: (d.planCode as string) || 'FREE',
        launchTrialStartDate: d.launchTrialStartDate, // If missing in response, it's undefined
        storageQuotaBytes: d.storageQuotaBytes,
        storageUsedBytes: d.storageUsedBytes,
        freeTurboUsed: d.freeTurboUsed,
        freeTurboLimit: d.freeTurboLimit
      };
    }
    return null;
  } catch (e: any) {
    if (e.response?.status === 404) return null;

    handleAxiosError(e, 'readUserInfo');
    return null;
  }
}

export async function listRecentLedgers(uid: string, limit: number = 10): Promise<Array<{ id: string; entry: LedgerEntry }>> {
  try {
    const res = await axios.get(`${CREDIT_SERVICE_URL}/credits/ledger/${uid}?limit=${limit}`);
    if (res.data.success && Array.isArray(res.data.data)) {
      return res.data.data.map((l: any) => ({
        id: l.id,
        entry: {
          type: l.type as LedgerType,
          amount: Number(l.amount),
          reason: l.reason,
          status: l.status as LedgerStatus,
          meta: l.meta,
          createdAt: l.createdAt
        }
      }));
    }
    return [];
  } catch (e: any) {
    // DEV FALLBACK: If service is unreachable in dev, return empty list
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, returning empty ledgers');
      return [];
    }
    handleAxiosError(e, 'listRecentLedgers');
    return [];
  }
}

export async function reconcileBalanceFromLedgers(uid: string): Promise<{ calculatedBalance: number; totalGrants: number; totalDebits: number; ledgerCount: number }> {
  try {
    const res = await axios.post(`${CREDIT_SERVICE_URL}/credits/reconcile/${uid}`);
    if (res.data.success && res.data.data) {
      return res.data.data;
    }
    throw new Error('Reconcile failed');
  } catch (e: any) {
    // DEV FALLBACK: If service is unreachable in dev, return default
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, skipping reconcile');
      return { calculatedBalance: 1000, totalGrants: 1000, totalDebits: 0, ledgerCount: 0 };
    }
    handleAxiosError(e, 'reconcileBalanceFromLedgers');
    return { calculatedBalance: 0, totalGrants: 0, totalDebits: 0, ledgerCount: 0 };
  }
}

// Deprecated in microservice architecture (service handles it or specific endpoint needed)
export async function clearAllLedgersForUser(uid: string): Promise<number> {
  logger.warn({ uid }, '[CREDITS_REPO] clearAllLedgersForUser called - operation not supported safely in microservice mode. Skipping.');
  return 0;
}

export async function writeDebitIfAbsent(
  uid: string,
  requestId: string,
  amount?: number,
  reason?: string,
  meta?: Record<string, any>,
  modelName?: string,
  params?: {
    resolution?: string;
    duration?: number;
    inputTokens?: number;
    outputTokens?: number;
  }
): Promise<'SKIPPED' | 'WRITTEN'> {
  try {
    logger.info(
      {
        uid,
        requestId,
        amount,
        modelName,
        params,
        reason,
        meta,
      },
      '[CREDITS_REPO] Sending debit request'
    );
    const res = await axios.post(`${CREDIT_SERVICE_URL}/credits/debit`, {
      userId: uid,
      transactionId: requestId,
      amount: amount ? Math.abs(amount) : undefined,
      reason,
      meta,
      modelName,
      params
    });

    if (res.data.success) {
      if (res.data.data?.alreadyProcessed) {
        logger.info({ uid, requestId }, '[CREDITS_REPO] Debit skipped (idempotent)');
        return 'SKIPPED';
      }
      logger.info(
        {
          uid,
          requestId,
          amount: res.data.data?.amount ?? amount,
          modelName,
        },
        '[CREDITS_REPO] Debit confirmed'
      );
      return 'WRITTEN';
    }
    throw new Error('Debit failed');
  } catch (e: any) {
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, debit not written');
      return 'SKIPPED';
    }

    handleAxiosError(e, 'writeDebitIfAbsent');
    return 'SKIPPED';
  }
}

export async function writeGrantIncrement(
  uid: string,
  requestId: string,
  grantAmount: number,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  try {
    const res = await axios.post(`${CREDIT_SERVICE_URL}/credits/grant`, {
      userId: uid,
      transactionId: requestId,
      amount: Math.abs(grantAmount),
      reason,
      meta
    });

    if (res.data.success) {
      if (res.data.data?.alreadyProcessed) {
        logger.info({ uid, requestId }, '[CREDITS_REPO] Grant skipped (idempotent)');
        return 'SKIPPED';
      }
      return 'WRITTEN';
    }
    throw new Error('Grant failed');
  } catch (e: any) {
    // DEV FALLBACK: If service is unreachable in dev, assume written
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, skipping grant');
      return 'WRITTEN';
    }
    handleAxiosError(e, 'writeGrantIncrement');
    return 'SKIPPED';
  }
}

/**
 * Replaces legacy logic. If this is a plan switch, we verify idempotency via plan/ledger or just call updatePlan?
 * The legacy logic checked for a specific grant ledger. a generic 'updatePlan' API doesn't take a requestId.
 * 
 * COMPROMISE for 'consistent' behavior:
 * 1. If we are setting a plan, we call POST /users/plan. This sets the balance.
 * 2. Does this specific call have a requestId? 
 *    Legacy: Yes.
 *    New: No (updatePlan endpoint doesn't).
 * 
 * However, we can use the 'grant' endpoint IF we just want to add credits.
 * But this function is named 'writeGrantAndSetPlan'.
 * 
 * Refactoring Strategy:
 * If calling code wants to switch plan, it should use 'switchPlan' (which calls users/plan).
 * If calling code uses this for simple grants... well the name implies plan setting.
 * 
 * Helper: We'll implement this by determining if we should call updatePlan.
 */
export async function writeGrantAndSetPlanIfAbsent(
  uid: string,
  requestId: string,
  credits: number,
  newPlanCode: string,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  // In legacy, this updated map and set balance.
  // In new service, POST /users/plan does exactly that (sets plan, sets balance default).

  // IDEMPOTENCY CHECK Hack: 
  // We can't easily check if *this specific request* was done without a ledger.
  // But usually plan switches change the plan code.
  const currentUser = await readUserInfo(uid);
  if (currentUser?.planCode === newPlanCode && currentUser.creditBalance === credits) {
    // Simple heuristic: if already on plan and balance matches, skip.
    // This isn't perfect idempotency for monthly resets but close enough for now.
    logger.info({ uid, newPlanCode }, '[CREDITS_REPO] Plan matches, skipping update (heuristic)');
    return 'SKIPPED';
  }

  try {
    const res = await axios.post(`${CREDIT_SERVICE_URL}/users/plan`, {
      userId: uid,
      planCode: newPlanCode
    });
    if (res.data.success) {
      return 'WRITTEN';
    }
    throw new Error('Plan update failed');
  } catch (e: any) {
    // DEV FALLBACK: If service is unreachable in dev, assume written
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, skipping plan update');
      return 'WRITTEN';
    }
    handleAxiosError(e, 'writeGrantAndSetPlanIfAbsent');
    return 'SKIPPED';
  }
}

export async function writeRefund(
  uid: string,
  requestId: string,
  amount: number,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  // Refund is just a Grant with a different type? Service has GRANT.
  // The service doesn't have explicit REFUND type exposed in Controller, but 'grant' adds credits.
  // We'll use grant but maybe add 'REFUND' to reason or meta.
  // Ideally we update service to support REFUND type, but 'grant' (ADD) is functionally correct.
  return writeGrantIncrement(uid, `refund-${requestId}`, amount, `REFUND: ${reason}`, meta);
}

// NEW METHOD: Initialize User
export async function initUser(uid: string, email: string): Promise<any> {
  try {
    const res = await axios.post(`${CREDIT_SERVICE_URL}/users/init`, {
      userId: uid,
      email
    });
    return res.data.data;
  } catch (e: any) {
    // DEV FALLBACK: If service is unreachable in dev, return mock user
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, returning mock init user');
      return {
        creditBalance: 1000,
        planCode: 'FREE',
        storageQuotaBytes: '1073741824',
        storageUsedBytes: '0'
      };
    }
    handleAxiosError(e, 'initUser');
  }
}

/**
 * Validate if user has sufficient credits AND storage quota for generation
 * Calls credit-service's validate-generation endpoint
 * @throws Error with code STORAGE_QUOTA_EXCEEDED or INSUFFICIENT_CREDITS
 */
export async function validateGeneration(
  uid: string,
  creditCost: number,
  estimatedSizeBytes: number = 0,
  modelName?: string,
  quantity: number = 1
): Promise<{ valid: boolean }> {
  try {
    console.log(`[CreditsRepository] validateGeneration: uid=${uid}, cost=${creditCost}, model=${modelName || 'N/A'}, quantity=${quantity}`);
    const res = await axios.post(`${CREDIT_SERVICE_URL}/credits/validate-generation`, {
      userId: uid,
      creditCost,
      estimatedSizeBytes,
      modelName,
      quantity,
    });

    if (res.data.success) {
      return { valid: true };
    }
    throw new Error('Validation failed');
  } catch (e: any) {
    // Re-throw with code preserved for proper error handling
    if (e.response?.data?.code) {
      const error: any = new Error(e.response.data.message);
      error.code = e.response.data.code;
      error.statusCode = e.response.status;
      throw error;
    }

    // DEV FALLBACK: If service is unreachable in dev, allow generation
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      logger.warn({ uid, err: e.message }, '[CREDITS_REPO] Dev mode: Credit service unreachable, allowing generation');
      return { valid: true };
    }

    handleAxiosError(e, 'validateGeneration');
    return { valid: false }; // Unreachable
  }
}

export async function listInvoices(
  uid: string,
  headers?: CreditServiceHeaders,
): Promise<any[]> {
  try {
    const res = await axios.get(`${CREDIT_SERVICE_URL}/billing/invoices/${uid}`, {
      headers,
    });
    if (res.data.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch (e: any) {
    // If 404, just return empty list
    if (e.response?.status === 404) return [];

    // DEV FALLBACK: If service is unreachable in dev, return empty list
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      return [];
    }

    handleAxiosError(e, 'listInvoices');
    return [];
  }
}

export async function listPayments(
  uid: string,
  headers?: CreditServiceHeaders,
): Promise<any[]> {
  try {
    const res = await axios.get(`${CREDIT_SERVICE_URL}/billing/payments/${uid}`, {
      headers,
    });
    if (res.data.success && Array.isArray(res.data.data)) {
      return res.data.data;
    }
    return [];
  } catch (e: any) {
    if (e.response?.status === 404) return [];

    // DEV FALLBACK: If service is unreachable in dev, return empty list
    if (env.nodeEnv === 'development' && (e.code === 'ECONNREFUSED' || e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT')) {
      return [];
    }

    handleAxiosError(e, 'listPayments');
    return [];
  }
}

export const creditsRepository = {
  readUserCredits,
  readUserInfo,
  listRecentLedgers,
  writeDebitIfAbsent,
  writeGrantAndSetPlanIfAbsent,
  writeGrantIncrement,
  reconcileBalanceFromLedgers,
  clearAllLedgersForUser,
  writeRefund,
  initUser,
  validateGeneration,
  listInvoices,
  listPayments,
  updateStorageUsage
};

export async function updateStorageUsage(uid: string, deltaBytes: number): Promise<void> {
  try {
    await axios.post(`${CREDIT_SERVICE_URL}/users/storage/usage`, {
      userId: uid,
      deltaBytes
    });
  } catch (e: any) {
    // Non-blocking log, don't throw
    logger.warn({ uid, deltaBytes, err: e.message }, '[CREDITS_REPO] Failed to update storage usage');
  }
}
