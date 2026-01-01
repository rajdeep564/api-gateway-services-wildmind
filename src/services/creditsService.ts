
import { admin } from '../config/firebaseAdmin';
import { PlanDoc, UserCreditsDoc } from '../types/credits';
import { creditServiceClient } from '../clients/creditServiceClient';

// No-op for plan management as it's now handled by credit-service
export async function ensureFreePlan(): Promise<PlanDoc> {
  console.log('[Deprecation] ensureFreePlan called - no-op');
  return {} as any;
}

export async function ensureLaunchPlan(): Promise<PlanDoc> {
  console.log('[Deprecation] ensureLaunchPlan called - no-op');
  return {} as any;
}

export async function ensurePlansSeeded(): Promise<void> {
  console.log('[Deprecation] ensurePlansSeeded called - no-op');
}

/**
 * Helper to convert ISO strings to Firestore Timestamps for compatibility
 */
function toTimestamp(date: string | Date | null | undefined): any {
  if (!date) return null;
  const d = new Date(date);
  return admin.firestore.Timestamp.fromDate(d);
}

export async function ensureUserInit(uid: string): Promise<UserCreditsDoc> {
  try {
    // 1. Try to get balance/user from credit-service
    let user = await creditServiceClient.getBalance(uid);

    // 2. If user doesn't exist (balance 0, no plan, no createdAt), try to init
    if (!user || (!user.createdAt && user.creditBalance === 0)) {
      console.log(`[creditsService] User ${uid} not found in credit-service, initializing...`);
      try {
        const firebaseUser = await admin.auth().getUser(uid);
        const email = firebaseUser.email;
        if (email) {
            user = await creditServiceClient.initUser(uid, email);
        } else {
            console.error(`[creditsService] Cannot init user ${uid}: No email found in Firebase Auth`);
        }
      } catch (authError) {
        console.error(`[creditsService] Failed to fetch Firebase user ${uid}:`, authError);
      }
    }

    // 3. Map to UserCreditsDoc
    return {
      uid: user.id || uid,
      creditBalance: user.creditBalance ?? 0,
      planCode: user.planCode || 'FREE',
      // Map dates to Timestamps
      createdAt: toTimestamp(user.createdAt),
      updatedAt: toTimestamp(user.updatedAt),
      launchTrialStartDate: toTimestamp(user.createdAt), // fallback for compatibility
      launchMigrationDone: true, 
    };
  } catch (error) {
    console.error(`[creditsService] ensureUserInit failed for ${uid}:`, error);
    // Fallback? Or throw?
    // Returning a safe default to prevent crashing
    return {
        uid,
        creditBalance: 0,
        planCode: 'FREE',
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now(),
    };
  }
}

export const creditsService = {
  ensureFreePlan,
  ensureLaunchPlan,
  ensurePlansSeeded,
  ensureUserInit,

  async reconcileCurrentCycle(uid: string) {
    try {
        const result = await creditServiceClient.reconcile(uid);
        // Map result to expected format
        // result from credit-service: { cycle, newBalance, debitsSinceReset, planCredits }
        const now = new Date();
        const fallbackCycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

        return {
            cycle: result.cycle || fallbackCycle,
            newBalance: result.newBalance ?? result.creditBalance ?? 0,
            debitsSinceReset: result.debitsSinceReset ?? 0,
            planCredits: result.planCredits ?? 0
        };
    } catch (e) {
        console.error(`[creditsService] reconcileCurrentCycle failed for ${uid}:`, e);
        throw e;
    }
  },

  async ensureLaunchDailyReset(uid: string) {
     const user = await ensureUserInit(uid);
     return {
         planCode: user.planCode,
         creditBalance: user.creditBalance
     };
  },

  async ensureMonthlyReroll(uid: string) {
      // Delegated to reconcile/scheduler
      return this.reconcileCurrentCycle(uid);
  },

  async switchPlan(uid: string, newPlanCode: 'FREE' | 'PLAN_A' | 'PLAN_B' | 'PLAN_C' | 'PLAN_D') {
      const result = await creditServiceClient.updatePlan(uid, newPlanCode);
      return {
          planCode: result.planCode,
          creditBalance: result.creditBalance
      };
  }
};
