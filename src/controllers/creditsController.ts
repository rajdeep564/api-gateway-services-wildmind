import { Request, Response, NextFunction } from 'express';
import { creditsRepository } from '../repository/creditsRepository';
import { creditsService } from '../services/creditsService';
import { formatApiResponse } from '../utils/formatApiResponse';

async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const uid = req.uid;
    
    // Ensure user is initialized and launch plan migration is done (this will set launchTrialStartDate if missing)
    await creditsService.ensureUserInit(uid);
    await creditsService.ensureLaunchDailyReset(uid);
    
    const info = await creditsRepository.readUserInfo(uid);
    const recentLedgers = await creditsRepository.listRecentLedgers(uid, 10);
    // Opportunistic auto-reconcile if mismatch detected
    let autoReconciled: any = null;
    try {
      if (info) {
        const now = new Date();
        const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        const resetId = `PLAN_MONTHLY_RESET_${cycle}`;
        const { adminDb } = require('../config/firebaseAdmin');
        const userRef = adminDb.collection('users').doc(uid);
        const ledgerRef = userRef.collection('ledgers').doc(resetId);
        const grantSnap = await ledgerRef.get();
        let planCredits = info.planCode === 'FREE' ? 2000 : info.creditBalance; // fallback to current balance if non-FREE
        if (grantSnap.exists) {
          const g = grantSnap.data() as any;
          if (typeof g?.amount === 'number' && g.amount > 0) planCredits = g.amount;
        }
        let q: FirebaseFirestore.Query = userRef.collection('ledgers').where('type', '==', 'DEBIT').where('status', '==', 'CONFIRMED');
        if (grantSnap.exists) q = q.where('createdAt', '>=', (grantSnap.data() as any)?.createdAt);
        const snap = await q.get();
        let debits = 0;
        snap.forEach((doc: any) => { const amt = Number((doc.data() as any)?.amount || 0); debits += Math.abs(amt); });
        const expected = Math.max(0, planCredits - debits);
        if (Math.abs(expected - (info?.creditBalance || 0)) >= 1) {
          autoReconciled = await creditsService.reconcileCurrentCycle(uid);
          // Refresh info after reconciliation
          const fresh = await creditsRepository.readUserInfo(uid);
          if (fresh) info.creditBalance = fresh.creditBalance;
        }
      }
    } catch (_) {}
    // Get full user document to include launchTrialStartDate
    const { adminDb } = require('../config/firebaseAdmin');
    const userRef = adminDb.collection('users').doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data() as any;
    
    return res.json(
      formatApiResponse('success', 'Credits fetched', {
        planCode: info?.planCode || 'FREE',
        creditBalance: info?.creditBalance || 0,
        launchTrialStartDate: userData?.launchTrialStartDate || null,
        recentLedgers,
        autoReconciled,
      })
    );
  } catch (err) {
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


