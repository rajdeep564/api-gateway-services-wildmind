import { adminDb, admin } from '../config/firebaseAdmin';
import { PlanDoc, UserCreditsDoc } from '../types/credits';
import { PLAN_CREDITS } from '../data/creditDistribution';
import { creditsRepository, LedgerEntry } from '../repository/creditsRepository';

const FREE_PLAN_CODE = 'FREE';

export async function ensureFreePlan(): Promise<PlanDoc> {
  const ref = adminDb.collection('plans').doc(FREE_PLAN_CODE);
  const snap = await ref.get();
  if (!snap.exists) {
    const doc: PlanDoc = {
      code: FREE_PLAN_CODE,
      name: 'Free',
      credits: 4120,
      priceInPaise: 0,
      active: true,
      sort: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } as any;
    await ref.set(doc);
    return doc;
  }
  return snap.data() as PlanDoc;
}

export async function ensurePlansSeeded(): Promise<void> {
  const plans: Array<PlanDoc> = [
    { code: 'FREE', name: 'Free', credits: 4120, priceInPaise: 0, active: true, sort: 0 } as any,
    { code: 'PLAN_A', name: 'Plan A', credits: PLAN_CREDITS.PLAN_A, priceInPaise: 0, active: false, sort: 1 } as any,
    { code: 'PLAN_B', name: 'Plan B', credits: PLAN_CREDITS.PLAN_B, priceInPaise: 0, active: false, sort: 2 } as any,
    { code: 'PLAN_C', name: 'Plan C', credits: PLAN_CREDITS.PLAN_C, priceInPaise: 0, active: false, sort: 3 } as any,
    { code: 'PLAN_D', name: 'Plan D', credits: PLAN_CREDITS.PLAN_D, priceInPaise: 0, active: false, sort: 4 } as any,
  ];
  const batch = adminDb.batch();
  for (const p of plans) {
    const ref = adminDb.collection('plans').doc(p.code);
    batch.set(ref, {
      ...p,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

export async function ensureUserInit(uid: string): Promise<UserCreditsDoc> {
  const userRef = adminDb.collection('users').doc(uid);
  const snap = await userRef.get();
  const plan = await ensureFreePlan();

  if (!snap.exists) {
    const doc: UserCreditsDoc = {
      uid,
      creditBalance: plan.credits,
      planCode: plan.code,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } as any;
    await userRef.set(doc, { merge: true });
    return doc;
  }

  const data = snap.data() as any;
  let creditBalance = Number(data.creditBalance);
  let planCode = (data.planCode as string) || FREE_PLAN_CODE;

  // If fields are missing, backfill them atomically
  if (!(data && typeof creditBalance === 'number' && !Number.isNaN(creditBalance))) {
    await userRef.set(
      {
        creditBalance: plan.credits,
        planCode: plan.code,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    creditBalance = plan.credits;
    planCode = plan.code;
  }

  return {
    uid,
    creditBalance,
    planCode,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

export const creditsService = {
  ensureFreePlan,
  ensurePlansSeeded,
  ensureUserInit,
  /**
   * Recompute and correct user's creditBalance for current cycle.
   * Uses the monthly reset grant timestamp as the lower bound and subtracts all confirmed debits since then.
   * IMPORTANT: Now includes ALL grants (not just monthly reset) to preserve manual grants.
   */
  async reconcileCurrentCycle(uid: string): Promise<{ cycle: string; newBalance: number; debitsSinceReset: number; planCredits: number }> {
    // Use the new reconcileBalanceFromLedgers which calculates from ALL ledger entries
    const reconciled = await creditsRepository.reconcileBalanceFromLedgers(uid);
    
    // Update balance to match calculated value
    const userRef = adminDb.collection('users').doc(uid);
    await userRef.set({ 
      creditBalance: reconciled.calculatedBalance, 
      updatedAt: admin.firestore.FieldValue.serverTimestamp() 
    }, { merge: true });
    
    // Get plan info for return value
    const user = await creditsRepository.readUserInfo(uid);
    const planCode = (user?.planCode as any) || 'FREE';
    const now = new Date();
    const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    
    let planCredits = 0;
    if (planCode === 'FREE') {
      planCredits = 4120;
    } else {
      const planSnap = await adminDb.collection('plans').doc(planCode).get();
      const pdata = planSnap.data() as any;
      planCredits = Number(pdata?.credits ?? 0) || 0;
    }
    
    return { 
      cycle, 
      newBalance: reconciled.calculatedBalance, 
      debitsSinceReset: reconciled.totalDebits, 
      planCredits 
    };
  },
  /**
   * Ensure a monthly reroll to the user's current plan credits.
   * Idempotent per user per YYYY-MM cycle using a deterministic requestId.
   * IMPORTANT: Only resets if no manual grants exist this month to preserve test credits.
   */
  async ensureMonthlyReroll(uid: string) {
    // Ensure user exists and has a plan
    const user = await creditsRepository.readUserInfo(uid);
    const planCode = (user?.planCode as any) || 'FREE';
    // Determine credits for the current plan from seeded plans
    let planCredits: number;
    if (planCode === 'FREE') {
      planCredits = 4120;
    } else {
      const planSnap = await adminDb.collection('plans').doc(planCode).get();
      const data = planSnap.data() as any;
      planCredits = Number(data?.credits ?? 0);
      if (!planSnap.exists || !planCredits) {
        // Fallback to distribution map if plan doc missing
        planCredits = (PLAN_CREDITS as any)[planCode] ?? 0;
      }
    }

    // Compute current cycle key in UTC (YYYY-MM)
    const now = new Date();
    const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const reqId = `PLAN_MONTHLY_RESET_${cycle}`;

    // Check if monthly reset already done this month
    const userRef = adminDb.collection('users').doc(uid);
    const ledgerRef = userRef.collection('ledgers').doc(reqId);
    const existingReset = await ledgerRef.get();
    
    if (existingReset.exists) {
      // Monthly reset already done - don't overwrite (preserves manual grants)
      return { cycle, planCode, creditBalance: user?.creditBalance || 0 };
    }

    // Check if there are any manual grants this month (TEST_GRANT, etc.)
    // If yes, we should NOT overwrite the balance
    const ledgersCol = userRef.collection('ledgers');
    const monthStart = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1);
    const monthStartTimestamp = admin.firestore.Timestamp.fromDate(monthStart);
    
    // Check for manual grants this month (excluding monthly reset)
    // Query without createdAt filter first to avoid index requirement, then filter in memory
    const allGrantsSnap = await ledgersCol
      .where('type', '==', 'GRANT')
      .where('status', '==', 'CONFIRMED')
      .get();
    
    const hasManualGrants = allGrantsSnap.docs.some(doc => {
      const entry = doc.data() as LedgerEntry;
      const reason = entry.reason || '';
      const createdAt = entry.createdAt;
      
      // Check if it's within this month
      const isThisMonth = createdAt && createdAt.toMillis && createdAt.toMillis() >= monthStart.getTime();
      
      // Check if it's a manual grant (not monthly reroll)
      return doc.id !== reqId && isThisMonth && (
        reason.includes('testing') || 
        reason.includes('manual') || 
        reason.includes('grant') ||
        doc.id.startsWith('TEST_GRANT_')
      );
    });
    
    if (hasManualGrants) {
      // User has manual grants this month - reconcile balance instead of resetting
      const reconciled = await creditsRepository.reconcileBalanceFromLedgers(uid);
      await userRef.set({ 
        creditBalance: reconciled.calculatedBalance, 
        updatedAt: admin.firestore.FieldValue.serverTimestamp() 
      }, { merge: true });
      return { cycle, planCode, creditBalance: reconciled.calculatedBalance };
    }

    // No manual grants - safe to execute monthly reset
    // Execute idempotent GRANT that overwrites balance to the plan credits
    await creditsRepository.writeGrantAndSetPlanIfAbsent(
      uid,
      reqId,
      planCredits,
      planCode,
      'plan.monthly_reroll',
      { cycle, pricingVersion: 'plans-v1' }
    );

    return { cycle, planCode, creditBalance: planCredits };
  },
  async switchPlan(uid: string, newPlanCode: 'FREE' | 'PLAN_A' | 'PLAN_B' | 'PLAN_C' | 'PLAN_D') {
    const credits = newPlanCode === 'FREE'
      ? 4120
      : newPlanCode === 'PLAN_A' ? PLAN_CREDITS.PLAN_A
      : newPlanCode === 'PLAN_B' ? PLAN_CREDITS.PLAN_B
      : newPlanCode === 'PLAN_C' ? PLAN_CREDITS.PLAN_C
      : PLAN_CREDITS.PLAN_D;
    const reqId = `PLAN_SWITCH_${newPlanCode}`; // deterministic idempotency key per target plan
    await creditsRepository.writeGrantAndSetPlanIfAbsent(
      uid,
      reqId,
      credits,
      newPlanCode,
      'plan.switch',
      { pricingVersion: 'plans-v1' }
    );
    return { planCode: newPlanCode, creditBalance: credits };
  }
};


