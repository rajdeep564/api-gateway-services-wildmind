import { adminDb, admin } from '../config/firebaseAdmin';
import { PlanDoc, UserCreditsDoc } from '../types/credits';
import { PLAN_CREDITS } from '../data/creditDistribution';
import { creditsRepository } from '../repository/creditsRepository';

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
   * Ensure a monthly reroll to the user's current plan credits.
   * Idempotent per user per YYYY-MM cycle using a deterministic requestId.
   * Overwrites balance to plan credits regardless of leftover.
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


