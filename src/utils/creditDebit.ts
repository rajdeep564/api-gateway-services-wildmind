import { creditsRepository } from '../repository/creditsRepository';
import { logger } from './logger';

/**
 * Unified post-success debit helper.
 * Contract:
 *  - Idempotent: uses historyId if present else idempotencyKey provided by pricing middleware.
 *  - Skips if cost missing/zero or if no requestId could be derived.
 *  - Standard reason format: `${provider}.${operation}` unless overridden by ctx.reason.
 *  - Meta is augmented with historyId, provider, pricingVersion.
 */
export interface DebitContext {
  creditCost?: number;
  idempotencyKey?: string;
  reason?: string;
  pricingVersion?: string;
  meta?: Record<string, any>;
}

export async function postSuccessDebit(
  uid: string,
  result: any,
  ctx: DebitContext,
  provider: string,
  defaultOperation: string
): Promise<'SKIPPED' | 'WRITTEN' | 'NO_COST'> {
  try {
    const cost = typeof ctx?.creditCost === 'number' ? ctx.creditCost : undefined;
    if (!cost || cost <= 0) return 'NO_COST';
    const historyId = (result && (result as any).historyId) || undefined;
    const requestId = historyId || ctx.idempotencyKey;
    if (!requestId) return 'SKIPPED';
    const reason = ctx.reason || `${provider}.${defaultOperation}`;
    const meta = {
      ...(ctx.meta || {}),
      historyId,
      provider,
      pricingVersion: ctx.pricingVersion,
    };
    const outcome = await creditsRepository.writeDebitIfAbsent(uid, requestId, cost, reason, meta);
    logger.info({ uid, requestId, cost, reason, outcome }, '[CREDITS] postSuccessDebit');
    return outcome;
  } catch (e) {
    logger.error({ uid, err: e }, '[CREDITS] postSuccessDebit error');
    return 'SKIPPED';
  }
}

/**
 * Post-completion debit helper for async / queue workflows.
 * Use when the cost is only known after the provider finishes (e.g. video duration, dynamic model).
 * Contract:
 *  - historyId: authoritative idempotency key; exactly-once semantics via writeDebitIfAbsent.
 *  - Returns 'NO_COST' if cost <= 0, 'WRITTEN' if a new debit entry was created, 'SKIPPED' if already exists or on error.
 *  - Standard reason format: `${provider}.${operation}`; pass a fully qualified reason if you need sub-operations (e.g. replicate.queue.wan-t2v).
 */
export async function postHistoryDebit(
  uid: string,
  historyId: string | undefined,
  cost: number | undefined,
  provider: string,
  operation: string,
  extras: { pricingVersion?: string; meta?: Record<string, any> } = {}
): Promise<'SKIPPED' | 'WRITTEN' | 'NO_COST'> {
  try {
    if (!historyId) return 'SKIPPED';
    if (!cost || cost <= 0) return 'NO_COST';
    const reason = `${provider}.${operation}`; // caller may embed queue.* variants inside operation
    const meta = {
      ...(extras.meta || {}),
      historyId,
      provider,
      pricingVersion: extras.pricingVersion,
    };
    const outcome = await creditsRepository.writeDebitIfAbsent(uid, historyId, cost, reason, meta);
    logger.info({ uid, historyId, cost, reason, outcome }, '[CREDITS] postHistoryDebit');
    return outcome;
  } catch (e) {
    logger.error({ uid, err: e }, '[CREDITS] postHistoryDebit error');
    return 'SKIPPED';
  }
}

/**
 * Issue a refund for a failed operation.
 * Wraps creditsRepository.writeRefund.
 */
export async function issueRefund(
  uid: string,
  requestId: string,
  amount: number,
  reason: string,
  meta?: Record<string, any>
): Promise<'SKIPPED' | 'WRITTEN'> {
  try {
    if (!amount || amount <= 0) return 'SKIPPED';
    const outcome = await creditsRepository.writeRefund(uid, requestId, amount, reason, meta);
    logger.info({ uid, requestId, amount, reason, outcome }, '[CREDITS] issueRefund');
    return outcome;
  } catch (e) {
    logger.error({ uid, err: e }, '[CREDITS] issueRefund error');
    return 'SKIPPED';
  }
}
