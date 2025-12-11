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

    // Ensure user is initialized and launch plan migration is done (this will set launchTrialStartDate if missing)
    logger.info({ uid }, '[CREDITS_CONTROLLER] Ensuring user init...');
    await creditsService.ensureUserInit(uid);
    logger.info({ uid }, '[CREDITS_CONTROLLER] Ensuring launch daily reset...');
    await creditsService.ensureLaunchDailyReset(uid);

    logger.info({ uid }, '[CREDITS_CONTROLLER] Reading user info...');
    const info = await creditsRepository.readUserInfo(uid);
    logger.info({ uid, info: { creditBalance: info?.creditBalance, planCode: info?.planCode } }, '[CREDITS_CONTROLLER] User info read');

    const recentLedgers = await creditsRepository.listRecentLedgers(uid, 10);
    logger.info({ uid, ledgerCount: recentLedgers.length }, '[CREDITS_CONTROLLER] Recent ledgers fetched');

    // Opportunistic auto-reconcile if mismatch detected
    // CRITICAL: Skip auto-reconcile for LAUNCH_4000_FIXED plan users - they have fixed credits and no monthly reset
    let autoReconciled: any = null;
    try {
      if (info && info.planCode !== 'LAUNCH_4000_FIXED') {
        logger.info({ uid, currentBalance: info.creditBalance, planCode: info.planCode }, '[CREDITS_CONTROLLER] Starting auto-reconcile check...');

        const now = new Date();
        const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        const resetId = `PLAN_MONTHLY_RESET_${cycle}`;
        const { adminDb } = require('../config/firebaseAdmin');
        const userRef = adminDb.collection('users').doc(uid);
        const ledgerRef = userRef.collection('ledgers').doc(resetId);
        const grantSnap = await ledgerRef.get();

        // FIX: For non-FREE plans, we should get plan credits from the plan document, not from current balance
        let planCredits = 0;
        if (info.planCode === 'FREE') {
          planCredits = 2000;
        } else {
          // Get plan credits from plan document
          const planSnap = await adminDb.collection('plans').doc(info.planCode).get();
          if (planSnap.exists) {
            const planData = planSnap.data() as any;
            planCredits = Number(planData?.credits ?? 0) || 0;
            logger.info({ uid, planCode: info.planCode, planCredits }, '[CREDITS_CONTROLLER] Found plan credits from plan document');
          } else {
            // Fallback: use current balance if plan not found (shouldn't happen)
            planCredits = info.creditBalance;
            logger.warn({ uid, planCode: info.planCode }, '[CREDITS_CONTROLLER] Plan document not found, using current balance as fallback');
          }
        }

        // Override with monthly reset grant if it exists
        if (grantSnap.exists) {
          const g = grantSnap.data() as any;
          if (typeof g?.amount === 'number' && g.amount > 0) {
            planCredits = g.amount;
            logger.info({ uid, resetId, planCredits }, '[CREDITS_CONTROLLER] Found monthly reset grant, overriding plan credits');
          }
        } else {
          logger.info({ uid, resetId, planCredits }, '[CREDITS_CONTROLLER] No monthly reset grant found, using plan credits');
        }

        let q: FirebaseFirestore.Query = userRef.collection('ledgers').where('type', '==', 'DEBIT').where('status', '==', 'CONFIRMED');
        if (grantSnap.exists) {
          const grantTime = (grantSnap.data() as any)?.createdAt;
          q = q.where('createdAt', '>=', grantTime);
          logger.info({ uid, grantTime }, '[CREDITS_CONTROLLER] Filtering debits since grant');
        }
        const snap = await q.get();
        let debits = 0;
        snap.forEach((doc: any) => {
          const amt = Number((doc.data() as any)?.amount || 0);
          debits += Math.abs(amt);
        });

        const expected = Math.max(0, planCredits - debits);
        const currentBalance = info?.creditBalance || 0;
        const difference = Math.abs(expected - currentBalance);

        logger.info({
          uid,
          planCredits,
          debits,
          expected,
          currentBalance,
          difference
        }, '[CREDITS_CONTROLLER] Auto-reconcile calculation');

        if (difference >= 1) {
          logger.warn({
            uid,
            expected,
            currentBalance,
            difference
          }, '[CREDITS_CONTROLLER] Mismatch detected, triggering reconciliation');

          autoReconciled = await creditsService.reconcileCurrentCycle(uid);
          logger.info({ uid, autoReconciled }, '[CREDITS_CONTROLLER] Reconciliation completed');

          // Refresh info after reconciliation
          const fresh = await creditsRepository.readUserInfo(uid);
          if (fresh) {
            logger.info({ uid, oldBalance: info.creditBalance, newBalance: fresh.creditBalance }, '[CREDITS_CONTROLLER] Balance updated after reconciliation');
            info.creditBalance = fresh.creditBalance;
          } else {
            logger.error({ uid }, '[CREDITS_CONTROLLER] Failed to read fresh user info after reconciliation');
          }
        } else {
          logger.info({ uid, difference }, '[CREDITS_CONTROLLER] No reconciliation needed, balance matches');
        }
      } else if (info?.planCode === 'LAUNCH_4000_FIXED') {
        logger.info({ uid, currentBalance: info.creditBalance }, '[CREDITS_CONTROLLER] Skipping auto-reconcile for LAUNCH_4000_FIXED plan (fixed credits, no monthly reset)');

        // For LAUNCH plan, if balance is 0 but there are no debits or debits are less than 4000, 
        // this might indicate missing GRANT ledger entry from migration
        const { adminDb } = require('../config/firebaseAdmin');
        const userRef = adminDb.collection('users').doc(uid);
        const ledgersSnap = await userRef.collection('ledgers')
          .where('status', '==', 'CONFIRMED')
          .get();

        let totalGrants = 0;
        let totalDebits = 0;
        ledgersSnap.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
          const entry = doc.data() as any;
          const amount = Math.abs(Number(entry.amount || 0));
          if (entry.type === 'GRANT' || entry.type === 'REFUND') {
            totalGrants += amount;
          } else if (entry.type === 'DEBIT' || entry.type === 'HOLD') {
            totalDebits += amount;
          }
        });

        const calculatedBalance = totalGrants - totalDebits;

        logger.info({
          uid,
          currentBalance: info.creditBalance,
          totalGrants,
          totalDebits,
          calculatedBalance
        }, '[CREDITS_CONTROLLER] LAUNCH plan ledger check');

        // If balance is 0 but calculated balance should be positive, create missing GRANT
        if (info.creditBalance === 0 && calculatedBalance === 0 && totalDebits < 4000) {
          logger.warn({
            uid,
            totalDebits
          }, '[CREDITS_CONTROLLER] LAUNCH plan user has 0 balance but no GRANT ledger entry - creating migration grant');

          // Create a GRANT ledger entry for the launch plan migration
          const migrationGrantId = `LAUNCH_MIGRATION_GRANT_${uid}`;
          await creditsRepository.writeGrantIncrement(uid, migrationGrantId, 4000, 'Launch plan migration grant', {
            planCode: 'LAUNCH_4000_FIXED',
            migration: true
          });

          // Refresh info after grant
          const fresh = await creditsRepository.readUserInfo(uid);
          if (fresh) {
            logger.info({ uid, oldBalance: info.creditBalance, newBalance: fresh.creditBalance }, '[CREDITS_CONTROLLER] Created migration grant, balance updated');
            info.creditBalance = fresh.creditBalance;
          }
        }
      } else {
        logger.warn({ uid }, '[CREDITS_CONTROLLER] User info is null, skipping auto-reconcile');
      }
    } catch (reconcileError: any) {
      logger.error({ uid, error: reconcileError?.message, stack: reconcileError?.stack }, '[CREDITS_CONTROLLER] Auto-reconcile error (non-fatal)');
    }

    // Get full user document to include launchTrialStartDate
    const { adminDb } = require('../config/firebaseAdmin');
    const userRef = adminDb.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() as any;

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
        launchTrialStartDate: userData?.launchTrialStartDate || null,
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


