"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditsService = void 0;
exports.ensureFreePlan = ensureFreePlan;
exports.ensurePlansSeeded = ensurePlansSeeded;
exports.ensureUserInit = ensureUserInit;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
const creditDistribution_1 = require("../data/creditDistribution");
const creditsRepository_1 = require("../repository/creditsRepository");
const FREE_PLAN_CODE = 'FREE';
async function ensureFreePlan() {
    const ref = firebaseAdmin_1.adminDb.collection('plans').doc(FREE_PLAN_CODE);
    const snap = await ref.get();
    if (!snap.exists) {
        const doc = {
            code: FREE_PLAN_CODE,
            name: 'Free',
            credits: 4120,
            priceInPaise: 0,
            active: true,
            sort: 0,
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        };
        await ref.set(doc);
        return doc;
    }
    return snap.data();
}
async function ensurePlansSeeded() {
    const plans = [
        { code: 'FREE', name: 'Free', credits: 4120, priceInPaise: 0, active: true, sort: 0 },
        { code: 'PLAN_A', name: 'Plan A', credits: creditDistribution_1.PLAN_CREDITS.PLAN_A, priceInPaise: 0, active: false, sort: 1 },
        { code: 'PLAN_B', name: 'Plan B', credits: creditDistribution_1.PLAN_CREDITS.PLAN_B, priceInPaise: 0, active: false, sort: 2 },
        { code: 'PLAN_C', name: 'Plan C', credits: creditDistribution_1.PLAN_CREDITS.PLAN_C, priceInPaise: 0, active: false, sort: 3 },
        { code: 'PLAN_D', name: 'Plan D', credits: creditDistribution_1.PLAN_CREDITS.PLAN_D, priceInPaise: 0, active: false, sort: 4 },
    ];
    const batch = firebaseAdmin_1.adminDb.batch();
    for (const p of plans) {
        const ref = firebaseAdmin_1.adminDb.collection('plans').doc(p.code);
        batch.set(ref, {
            ...p,
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    await batch.commit();
}
async function ensureUserInit(uid) {
    const userRef = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const snap = await userRef.get();
    const plan = await ensureFreePlan();
    if (!snap.exists) {
        const doc = {
            uid,
            creditBalance: plan.credits,
            planCode: plan.code,
            createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        };
        await userRef.set(doc, { merge: true });
        return doc;
    }
    const data = snap.data();
    let creditBalance = Number(data.creditBalance);
    let planCode = data.planCode || FREE_PLAN_CODE;
    // If fields are missing, backfill them atomically
    if (!(data && typeof creditBalance === 'number' && !Number.isNaN(creditBalance))) {
        await userRef.set({
            creditBalance: plan.credits,
            planCode: plan.code,
            updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
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
exports.creditsService = {
    ensureFreePlan,
    ensurePlansSeeded,
    ensureUserInit,
    async switchPlan(uid, newPlanCode) {
        const credits = newPlanCode === 'FREE'
            ? 4120
            : newPlanCode === 'PLAN_A' ? creditDistribution_1.PLAN_CREDITS.PLAN_A
                : newPlanCode === 'PLAN_B' ? creditDistribution_1.PLAN_CREDITS.PLAN_B
                    : newPlanCode === 'PLAN_C' ? creditDistribution_1.PLAN_CREDITS.PLAN_C
                        : creditDistribution_1.PLAN_CREDITS.PLAN_D;
        const reqId = `PLAN_SWITCH_${newPlanCode}`; // deterministic idempotency key per target plan
        await creditsRepository_1.creditsRepository.writeGrantAndSetPlanIfAbsent(uid, reqId, credits, newPlanCode, 'plan.switch', { pricingVersion: 'plans-v1' });
        return { planCode: newPlanCode, creditBalance: credits };
    }
};
