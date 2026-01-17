import { Request, Response, NextFunction } from 'express';
import '../types/http';
import { creditsRepository } from '../repository/creditsRepository';
import { creditsService } from '../services/creditsService';
import { formatApiResponse } from '../utils/formatApiResponse';
import { logger } from '../utils/logger';

async function me(req: Request, res: Response, next: NextFunction) {
  const uid = req.uid;
  const startTime = Date.now();

  try {
    logger.info({ uid }, '[CREDITS_CONTROLLER] /api/credits/me - Starting request');

    // Initialize user in credit-service if needed
    logger.info({ uid }, '[CREDITS_CONTROLLER] Reading user info from credit-service...');
    const info = await creditsRepository.readUserInfo(uid);
    logger.info({ uid, info: { creditBalance: info?.creditBalance, planCode: info?.planCode } }, '[CREDITS_CONTROLLER] User info read');

    // Get recent ledgers from credit-service
    const recentLedgers = await creditsRepository.listRecentLedgers(uid, 10);
    logger.info({ uid, ledgerCount: recentLedgers.length }, '[CREDITS_CONTROLLER] Recent ledgers fetched');

    // Reconcile if needed (let credit-service handle this)
    let autoReconciled: any = null;
    try {
      const reconResult = await creditsRepository.reconcileBalanceFromLedgers(uid);
      if (reconResult) {
        autoReconciled = reconResult;
        // Refresh info after reconciliation
        const fresh = await creditsRepository.readUserInfo(uid);
        if (fresh) {
          logger.info({ uid, oldBalance: info?.creditBalance, newBalance: fresh.creditBalance }, '[CREDITS_CONTROLLER] Balance updated after reconciliation');
        }
      }
    } catch (reconcileError: any) {
      logger.error({ uid, error: reconcileError?.message }, '[CREDITS_CONTROLLER] Reconciliation failed (non-fatal)');
    }

    // Get storage info from credit-service
    let storageInfo: any = {};
    try {
      const storageData = await creditsRepository.readUserInfo(uid) as any;
      if (storageData) {
        storageInfo = {
          storageUsedBytes: storageData.storageUsedBytes?.toString() || '0',
          storageQuotaBytes: storageData.storageQuotaBytes?.toString() || '0',
          username: storageData.username || null
        };
      }
    } catch (storageError: any) {
      logger.error({ uid, error: storageError?.message }, '[CREDITS_CONTROLLER] Failed to fetch storage info');
    }

    const finalBalance = info?.creditBalance || 0;
    const responseTime = Date.now() - startTime;

    logger.info({
      uid,
      finalBalance,
      planCode: info?.planCode,
      responseTime,
      autoReconciled: !!autoReconciled
    }, '[CREDITS_CONTROLLER] /api/credits/me - Request completed successfully');

    return res.json(
      formatApiResponse('success', 'Credits fetched', {
        planCode: info?.planCode || 'FREE',
        creditBalance: finalBalance,
        storageUsedBytes: storageInfo.storageUsedBytes,
        storageQuotaBytes: storageInfo.storageQuotaBytes,
        username: storageInfo.username,
        recentLedgers,
        autoReconciled,
      })
    );
  } catch (err: any) {
    const responseTime = Date.now() - startTime;
    logger.error({
      uid,
      error: err?.message,
      stack: err?.stack,
      responseTime
    }, '[CREDITS_CONTROLLER] /api/credits/me - Request failed');
    next(err);
  }
}

async function reconcile(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    const result = await creditsService.reconcileCurrentCycle(uid);
    return res.json(formatApiResponse('success', 'Reconciled', result));
  } catch (err) { next(err); }
}

export const creditsController = { me, reconcile };


