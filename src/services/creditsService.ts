import { adminDb, admin } from '../config/firebaseAdmin';
import { PlanDoc, UserCreditsDoc } from '../types/credits';
import { PLAN_CREDITS } from '../data/creditDistribution';
import { creditsRepository, LedgerEntry } from '../repository/creditsRepository';

const FREE_PLAN_CODE = 'FREE';
// New launch offer fixed plan (4000 credits for 15 days, no daily reset)
const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';
const LAUNCH_FIXED_CREDITS = 4000;

// Launch plan cutoff date: December 18, 2025 (end of day UTC)
// Users signing up on or before this date get launch plan, after this date get FREE plan
// Can be overridden via LAUNCH_PLAN_CUTOFF_DATE environment variable (ISO string format)
const LAUNCH_PLAN_CUTOFF_DATE = process.env.LAUNCH_PLAN_CUTOFF_DATE 
  ? new Date(process.env.LAUNCH_PLAN_CUTOFF_DATE)
  : new Date('2025-12-18T23:59:59.999Z');

/**
 * Check if the current date is on or before the launch plan cutoff date
 */
function isWithinLaunchPlanPeriod(): boolean {
  const now = new Date();
  return now <= LAUNCH_PLAN_CUTOFF_DATE;
}

export async function ensureFreePlan(): Promise<PlanDoc> {
  const ref = adminDb.collection('plans').doc(FREE_PLAN_CODE);
  const snap = await ref.get();
  if (!snap.exists) {
    const doc: PlanDoc = {
      code: FREE_PLAN_CODE,
      name: 'Free',
      credits: 2000,
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

export async function ensureLaunchPlan(): Promise<PlanDoc> {
  const ref = adminDb.collection('plans').doc(LAUNCH_PLAN_CODE);
  const snap = await ref.get();
  if (!snap.exists) {
    const doc: PlanDoc = {
      code: LAUNCH_PLAN_CODE,
      name: 'Launch Offer (4000 credits)',
      credits: LAUNCH_FIXED_CREDITS,
      priceInPaise: 0,
      active: true,
      sort: -1,
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
    { code: LAUNCH_PLAN_CODE, name: 'Launch Offer (4000 credits)', credits: LAUNCH_FIXED_CREDITS, priceInPaise: 0, active: true, sort: -1 } as any,
    { code: 'FREE', name: 'Free', credits: 2000, priceInPaise: 0, active: false, sort: 0 } as any,
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
  
  // Determine which plan to use based on cutoff date
  const isWithinPeriod = isWithinLaunchPlanPeriod();
  const defaultPlan = isWithinPeriod 
    ? await ensureLaunchPlan() 
    : await ensureFreePlan();

  if (!snap.exists) {
    // New user - assign plan based on cutoff date
    const doc: UserCreditsDoc = {
      uid,
      creditBalance: defaultPlan.credits,
      planCode: defaultPlan.code,
      launchMigrationDone: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } as any;
    
    // If within launch period and on launch plan, set trial start date and mark as migrated
    if (isWithinPeriod && defaultPlan.code === LAUNCH_PLAN_CODE) {
      (doc as any).launchTrialStartDate = admin.firestore.FieldValue.serverTimestamp();
      (doc as any).launchMigrationDone = true; // Mark as migrated for new launch plan users
      console.log(`[LaunchOffer] New user ${uid} assigned to launch plan with trial start date`);
    }
    
    await userRef.set(doc, { merge: true });
    
    // Return the document with all fields including launchTrialStartDate
    const createdDoc = await userRef.get();
    const createdData = createdDoc.data() as any;
    return {
      uid,
      creditBalance: createdData.creditBalance || defaultPlan.credits,
      planCode: createdData.planCode || defaultPlan.code,
      launchTrialStartDate: createdData.launchTrialStartDate,
      createdAt: createdData.createdAt,
      updatedAt: createdData.updatedAt,
    };
  }

  const data = snap.data() as any;
  let creditBalance = Number(data.creditBalance);
  let planCode = (data.planCode as string) || FREE_PLAN_CODE;

  // If fields are missing, backfill them atomically
  // Use FREE plan if we're past the cutoff date, otherwise use the default
  if (!(data && typeof creditBalance === 'number' && !Number.isNaN(creditBalance))) {
    const backfillPlan = isWithinPeriod ? defaultPlan : await ensureFreePlan();
    await userRef.set(
      {
        creditBalance: backfillPlan.credits,
        planCode: backfillPlan.code,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    creditBalance = backfillPlan.credits;
    planCode = backfillPlan.code;
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
  ensureLaunchPlan,
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
      planCredits = 2000;
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
   * Launch offer: ensure user is on launch plan with 4000 fixed credits (no daily reset).
   * - One-time migration: clear all ledgers and move user to launch plan with 0 -> 4000 credits.
   * - No daily reset: credits are fixed for the 15-day period.
   * - Only works until December 18, 2025 cutoff date. After that, users get FREE plan.
   */
  async ensureLaunchDailyReset(uid: string): Promise<{ planCode: string; creditBalance: number }> {
    const userRef = adminDb.collection('users').doc(uid);
    const snap = await userRef.get();
    
    // Check if we're past the cutoff date
    const isWithinPeriod = isWithinLaunchPlanPeriod();
    
    if (!snap.exists) {
      // New user – let ensureUserInit handle default (it will check cutoff date and set trial start date)
      await ensureUserInit(uid);
      const userData = (await userRef.get()).data() as any;
      
      // Ensure launchTrialStartDate is set if user is on launch plan
      if (userData?.planCode === LAUNCH_PLAN_CODE && !userData?.launchTrialStartDate && isWithinPeriod) {
        await userRef.set(
          {
            launchTrialStartDate: admin.firestore.FieldValue.serverTimestamp(),
            launchMigrationDone: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        // Re-fetch to get updated data
        const updatedData = (await userRef.get()).data() as any;
        return { 
          planCode: updatedData?.planCode || FREE_PLAN_CODE, 
          creditBalance: updatedData?.creditBalance || LAUNCH_FIXED_CREDITS 
        };
      }
      
      return { 
        planCode: userData?.planCode || FREE_PLAN_CODE, 
        creditBalance: userData?.creditBalance || (userData?.planCode === LAUNCH_PLAN_CODE ? LAUNCH_FIXED_CREDITS : 2000)
      };
    }
    
    // If we're past the cutoff date, don't assign launch plan to existing users either
    if (!isWithinPeriod) {
      const data = snap.data() as any;
      const currentPlan = data?.planCode || FREE_PLAN_CODE;
      
      // If user is on launch plan but we're past cutoff, switch them to FREE
      if (currentPlan === LAUNCH_PLAN_CODE) {
        await userRef.set(
          {
            planCode: FREE_PLAN_CODE,
            creditBalance: 2000,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        return { planCode: FREE_PLAN_CODE, creditBalance: 2000 };
      }
      
      // User is already on FREE or another plan
      return { 
        planCode: currentPlan, 
        creditBalance: Number(data?.creditBalance || 2000) 
      };
    }

    const data = snap.data() as any;
    const planCode: string = data.planCode || FREE_PLAN_CODE;
    const migrated: boolean = Boolean(data.launchMigrationDone);
    const trialStartDate = data.launchTrialStartDate;

    // Check if trial has expired (15 days OR past cutoff date)
    if (planCode === LAUNCH_PLAN_CODE && trialStartDate) {
      const startDate = trialStartDate.toDate ? trialStartDate.toDate() : new Date(trialStartDate);
      const now = new Date();
      const daysSinceStart = Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Trial expires if: 15 days have passed OR we're past the cutoff date
      const isPastCutoff = now > LAUNCH_PLAN_CUTOFF_DATE;
      const is15DaysPassed = daysSinceStart >= 15;
      
      if (is15DaysPassed || isPastCutoff) {
        // Trial expired - switch to FREE plan
        const reason = isPastCutoff 
          ? `cutoff date reached (${daysSinceStart} days since start)` 
          : `15 days expired (${daysSinceStart} days since start)`;
        console.log(`[LaunchOffer] Trial expired for user ${uid}, switching to FREE plan - ${reason}`);
        await userRef.set(
          {
            planCode: FREE_PLAN_CODE,
            creditBalance: 2000, // FREE plan credits
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        // Create grant ledger entry for FREE plan credits
        const requestId = `TRIAL_EXPIRED_TO_FREE_${Date.now()}`;
        await creditsRepository.writeGrantAndSetPlanIfAbsent(
          uid,
          requestId,
          2000,
          FREE_PLAN_CODE,
          'trial.expired_to_free',
          { previousPlan: LAUNCH_PLAN_CODE, trialDays: daysSinceStart, reason: isPastCutoff ? 'cutoff_date' : '15_days' }
        );
        return { planCode: FREE_PLAN_CODE, creditBalance: 2000 };
      }
    }

    // One-time migration: clear ledgers, zero out, then set launch plan and 4000 credits
    // Only if we're within the launch period
    if (!migrated && isWithinPeriod) {
      try {
        await creditsRepository.clearAllLedgersForUser(uid);
      } catch (e) {
        console.error('[LaunchOffer] Failed to clear ledgers for user', uid, e);
      }

      const now = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(
        {
          planCode: LAUNCH_PLAN_CODE,
          creditBalance: LAUNCH_FIXED_CREDITS,
          launchMigrationDone: true,
          launchTrialStartDate: now, // Set trial start date on migration
          updatedAt: now,
        },
        { merge: true }
      );

      return { planCode: LAUNCH_PLAN_CODE, creditBalance: LAUNCH_FIXED_CREDITS };
    }
    
    // If not migrated and past cutoff, assign to FREE plan
    if (!migrated && !isWithinPeriod) {
      await userRef.set(
        {
          planCode: FREE_PLAN_CODE,
          creditBalance: 2000,
          launchMigrationDone: true, // Mark as migrated so we don't try again
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return { planCode: FREE_PLAN_CODE, creditBalance: 2000 };
    }

    // Already migrated – ensure plan is launch and trial start date is set (only if within period)
    if (planCode !== LAUNCH_PLAN_CODE && isWithinPeriod) {
      const now = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(
        {
          planCode: LAUNCH_PLAN_CODE,
          launchTrialStartDate: now, // Set trial start date if moving to launch plan
          updatedAt: now,
        },
        { merge: true }
      );
    } else if (planCode === LAUNCH_PLAN_CODE && !trialStartDate && isWithinPeriod) {
      // User is on launch plan but missing trial start date - set it now (only if within period)
      // This handles cases where user was created before trial start date logic was added
      const now = admin.firestore.FieldValue.serverTimestamp();
      await userRef.set(
        {
          launchTrialStartDate: now,
          launchMigrationDone: true, // Also mark as migrated
          updatedAt: now,
        },
        { merge: true }
      );
      console.log(`[LaunchOffer] Set missing launchTrialStartDate for user ${uid}`);
      console.log(`[LaunchOffer] Set missing launchTrialStartDate for user ${uid}`);
    }

    // Ensure trial start date is set for users on launch plan (final check)
    if (planCode === LAUNCH_PLAN_CODE && isWithinPeriod) {
      const finalData = (await userRef.get()).data() as any;
      if (!finalData?.launchTrialStartDate) {
        // Last resort: set trial start date if still missing
        await userRef.set(
          {
            launchTrialStartDate: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        console.log(`[LaunchOffer] Final check: Set launchTrialStartDate for user ${uid}`);
      }
    }

    // No daily reset - return current balance
    const currentBalance = Number(data.creditBalance || 0);
    return { planCode: LAUNCH_PLAN_CODE, creditBalance: currentBalance };
  },
  /**
   * Ensure a monthly reroll to the user's current plan credits.
   * Idempotent per user per YYYY-MM cycle using a deterministic requestId.
   * IMPORTANT: Only resets if no manual grants exist this month to preserve test credits.
   */
  async ensureMonthlyReroll(uid: string) {
    // For launch plan we skip monthly reset (fixed credits, no reset)
    const info = await creditsRepository.readUserInfo(uid);
    if (info?.planCode === LAUNCH_PLAN_CODE) {
      return { cycle: 'LAUNCH_FIXED', planCode: LAUNCH_PLAN_CODE, creditBalance: info.creditBalance };
    }
    // Ensure user exists and has a plan
    const user = await creditsRepository.readUserInfo(uid);
    const planCode = (user?.planCode as any) || 'FREE';
    // Determine credits for the current plan from seeded plans
    let planCredits: number;
    if (planCode === 'FREE') {
      planCredits = 2000;
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
      ? 2000
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


