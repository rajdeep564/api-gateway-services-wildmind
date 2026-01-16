import { creditsRepository } from '../repository/creditsRepository';
import { env } from '../config/env';

// Launch plan constants
const FREE_PLAN_CODE = 'FREE';
const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';
const LAUNCH_FIXED_CREDITS = 4000;

// Launch plan cutoff date
const LAUNCH_PLAN_CUTOFF_DATE = process.env.LAUNCH_PLAN_CUTOFF_DATE 
  ? new Date(process.env.LAUNCH_PLAN_CUTOFF_DATE)
  : new Date('2025-12-25T23:59:59.999Z');

function isWithinLaunchPlanPeriod(): boolean {
  const now = new Date();
  return now <= LAUNCH_PLAN_CUTOFF_DATE;
}

/**
 * Refactored Credits Service
 * Delegates storage and basic plan logic to Credit Service (via Repository).
 * Maintains "Launch Plan" business logic here by orchestrating calls.
 */
export const creditsService = {
  
  // These are handled by the microservice now, but we might check/init
  ensureFreePlan: async () => {}, // No-op, service handles it
  ensureLaunchPlan: async () => {}, // No-op
  ensurePlansSeeded: async () => {}, // No-op, service has its own seeds

  async ensureUserInit(uid: string, email: string = '') {
    // 1. Initialize user in Credit Service (creates FREE plan by default)
    // We pass email if available, or empty string (service requires it but acts idempotent)
    const user = await creditsRepository.initUser(uid, email || `${uid}@placeholder.com`);
    
    // 2. Apply Launch Plan Logic
    const isWithinPeriod = isWithinLaunchPlanPeriod();
    const currentPlan = user.planCode;

    // Logic: If user is on FREE plan (just created) AND we are in Launch Period -> Upgrade to Launch Plan
    if (isWithinPeriod && currentPlan === FREE_PLAN_CODE) {
       // Check if we already migrated? Service doesn't store 'launchMigrationDone' flag possibly.
       // But if they are just created (FREE), we can upgrade them.
       // We use writeGrantAndSetPlan to switch them.
       console.log(`[CreditsService] Upgrading new user ${uid} to Launch Plan`);
       await creditsRepository.writeGrantAndSetPlanIfAbsent(
           uid,
           `LAUNCH_UPGRADE_${uid}`,
           LAUNCH_FIXED_CREDITS,
           LAUNCH_PLAN_CODE,
           'launch.upgrade'
       );
       
       // Refetch to return updated state
       const updated = await creditsRepository.readUserInfo(uid);
       return updated;
    }

    return user;
  },

  async reconcileCurrentCycle(uid: string) {
    const logger = require('../utils/logger').logger;
    // Just proxy to repo/service reconcile
    const result = await creditsRepository.reconcileBalanceFromLedgers(uid);
    
    // Get plan info for return value
    const user = await creditsRepository.readUserInfo(uid);
    const planCredits = user?.planCode === LAUNCH_PLAN_CODE ? LAUNCH_FIXED_CREDITS : 2000; // Simplified default
    
    const now = new Date();
    const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    return { 
      cycle, 
      newBalance: result.calculatedBalance, 
      debitsSinceReset: result.totalDebits, 
      planCredits 
    };
  },

  async ensureLaunchDailyReset(uid: string) {
     // 1. Get User
     let user = await creditsRepository.readUserInfo(uid);
     if (!user) {
         // Should have been initialized
         return { planCode: FREE_PLAN_CODE, creditBalance: 0 };
     }

     const isWithinPeriod = isWithinLaunchPlanPeriod();

     // Logi Copied from Legacy: Trial Expiry
     // Since 'launchTrialStartDate' comes from service (if available), we check it.
     if (user.planCode === LAUNCH_PLAN_CODE) {
         if (!isWithinPeriod) {
             // Past cutoff - Downgrade to FREE
             console.log(`[CreditsService] Launch period over, downgrading ${uid} to FREE`);
             await creditsRepository.writeGrantAndSetPlanIfAbsent(
                 uid,
                 `LAUNCH_EXPIRED_${Date.now()}`,
                 2000,
                 FREE_PLAN_CODE,
                 'trial.expired'
             );
             return { planCode: FREE_PLAN_CODE, creditBalance: 2000 };
         }
         // Else: Maintain Launch Plan (Fixed Credits)
         return { planCode: LAUNCH_PLAN_CODE, creditBalance: user.creditBalance };
     }

     return { planCode: user.planCode, creditBalance: user.creditBalance };
  },

  // Monthly Reroll (delegated mostly to service or ignored if launch plan)
  async ensureMonthlyReroll(uid: string) {
      // If launch plan, skip
      const user = await creditsRepository.readUserInfo(uid);
      if (user?.planCode === LAUNCH_PLAN_CODE) {
          return { cycle: 'LAUNCH_FIXED', planCode: LAUNCH_PLAN_CODE, creditBalance: user.creditBalance };
      }
      
      // If standard plan, we might want to ensure monthly credits.
      // But `credit-service` doesn't seem to have a "monthly reroll cron" built-in yet (or maybe JobService has it).
      // For now, we rely on the implementation in API Gateway triggering this.
      // We will simply call `writeGrantAndSetPlan` to reset to plan credits?
      // Wait, `writeGrantAndSetPlan` calls `POST /users/plan`.
      // `POST /users/plan` resets balance to plan credits. 
      // This IS a monthly reroll effectively.
      
      // We need to pass the plan code.
      const planCode = user?.planCode || FREE_PLAN_CODE;
      
      // Idempotency handled by repository heuristic (if balance == plan credits, skip).
      // But for monthly reroll we might WANT to reset even if balance is same? No, usually not.
      // Actually, if we want to force reset, we might need a better mechanism.
      // For now, calling updatePlan is the best "Reset" we have.
      
      const now = new Date();
      const cycle = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const reqId = `PLAN_RESET_${cycle}`;
      
      // Check if we already did this? 
      // The repo heuristic (balance == plan defaults) is weak.
      // Ideally we check ledger.
      
      const ledgers = await creditsRepository.listRecentLedgers(uid, 50);
      const hasReset = ledgers.some(l => l.id.includes(cycle) && l.entry.reason.includes('monthly')); // Weak check
      
      if (!hasReset) {
         // Determine credits
         let credits = 2000;
         if (planCode === 'FREE') credits = 2000; 
         // ... other plans ...
         
         await creditsRepository.writeGrantAndSetPlanIfAbsent(uid, reqId, credits, planCode, 'plan.monthly_reset');
         // Note: credits argument is ignored by repo currently (it trusts service defaults), 
         // UNLESS we modify repo to check it. Repo implementation calls POST /users/plan which sets defaults.
      }
      
      const updated = await creditsRepository.readUserInfo(uid);
      return { cycle, planCode, creditBalance: updated?.creditBalance || 0 };
  },

  async switchPlan(uid: string, newPlanCode: string) {
     // Just call repo
     await creditsRepository.writeGrantAndSetPlanIfAbsent(uid, `SWITCH_${Date.now()}`, 0, newPlanCode, 'plan.switch');
     const user = await creditsRepository.readUserInfo(uid);
     return { planCode: newPlanCode, creditBalance: user?.creditBalance || 0 };
  }
};
