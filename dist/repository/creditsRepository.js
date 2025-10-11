"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.creditsRepository = void 0;
exports.readUserCredits = readUserCredits;
exports.readUserInfo = readUserInfo;
exports.listRecentLedgers = listRecentLedgers;
exports.writeDebitIfAbsent = writeDebitIfAbsent;
exports.writeGrantAndSetPlanIfAbsent = writeGrantAndSetPlanIfAbsent;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
const logger_1 = require("../utils/logger");
async function readUserCredits(uid) {
    const ref = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists)
        return 0;
    const data = snap.data();
    return Number(data.creditBalance || 0);
}
async function readUserInfo(uid) {
    const ref = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const snap = await ref.get();
    if (!snap.exists)
        return null;
    const data = snap.data();
    return {
        creditBalance: Number(data.creditBalance || 0),
        planCode: data.planCode || 'FREE',
    };
}
async function listRecentLedgers(uid, limit = 10) {
    const col = firebaseAdmin_1.adminDb
        .collection('users')
        .doc(uid)
        .collection('ledgers')
        .orderBy('createdAt', 'desc')
        .limit(limit);
    const snap = await col.get();
    return snap.docs.map((d) => ({ id: d.id, entry: d.data() }));
}
async function writeDebitIfAbsent(uid, requestId, amount, reason, meta) {
    const userRef = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const ledgerRef = userRef.collection('ledgers').doc(requestId);
    let outcome = 'SKIPPED';
    try {
        logger_1.logger.info({ uid, requestId, amount, reason }, '[CREDITS] Transaction start');
        const sanitize = (obj) => {
            if (obj == null || typeof obj !== 'object')
                return obj;
            if (Array.isArray(obj))
                return obj.map((v) => sanitize(v)).filter((v) => v !== undefined);
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
                if (v === undefined)
                    continue;
                const sv = sanitize(v);
                if (sv !== undefined)
                    out[k] = sv;
            }
            return out;
        };
        const metaClean = sanitize(meta || {});
        await firebaseAdmin_1.adminDb.runTransaction(async (tx) => {
            const existing = await tx.get(ledgerRef);
            if (existing.exists) {
                const data = existing.data();
                if (data.type === 'DEBIT' && data.status === 'CONFIRMED') {
                    logger_1.logger.info({ uid, requestId }, '[CREDITS] Ledger already exists (idempotent)');
                    return;
                }
            }
            tx.set(ledgerRef, {
                type: 'DEBIT',
                amount: -Math.abs(amount),
                reason,
                status: 'CONFIRMED',
                meta: metaClean,
                createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
            tx.update(userRef, {
                creditBalance: firebaseAdmin_1.admin.firestore.FieldValue.increment(-Math.abs(amount)),
                updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
            outcome = 'WRITTEN';
        });
        const verify = await ledgerRef.get();
        logger_1.logger.info({ uid, requestId, exists: verify.exists, outcome }, '[CREDITS] Transaction complete, ledger verification');
    }
    catch (e) {
        logger_1.logger.error({ uid, requestId, err: e }, '[CREDITS] Transaction error');
        throw e;
    }
    return outcome;
}
async function writeGrantAndSetPlanIfAbsent(uid, requestId, credits, newPlanCode, reason, meta) {
    const userRef = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const ledgerRef = userRef.collection('ledgers').doc(requestId);
    let outcome = 'SKIPPED';
    try {
        logger_1.logger.info({ uid, requestId, credits, newPlanCode }, '[CREDITS] Plan switch transaction start');
        const sanitize = (obj) => {
            if (obj == null || typeof obj !== 'object')
                return obj;
            if (Array.isArray(obj))
                return obj.map((v) => sanitize(v)).filter((v) => v !== undefined);
            const out = {};
            for (const [k, v] of Object.entries(obj)) {
                if (v === undefined)
                    continue;
                const sv = sanitize(v);
                if (sv !== undefined)
                    out[k] = sv;
            }
            return out;
        };
        const metaClean = sanitize(meta || {});
        await firebaseAdmin_1.adminDb.runTransaction(async (tx) => {
            const existing = await tx.get(ledgerRef);
            if (existing.exists) {
                const data = existing.data();
                if (data.type === 'GRANT' && data.status === 'CONFIRMED') {
                    logger_1.logger.info({ uid, requestId }, '[CREDITS] Plan switch grant already exists (idempotent)');
                    // Still ensure user doc reflects target plan and credits (idempotent set)
                    tx.set(userRef, {
                        planCode: newPlanCode,
                        creditBalance: credits,
                        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
                    }, { merge: true });
                    return;
                }
            }
            tx.set(ledgerRef, {
                type: 'GRANT',
                amount: Math.abs(credits),
                reason,
                status: 'CONFIRMED',
                meta: { ...metaClean, planCode: newPlanCode },
                createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            });
            // OVERWRITE balance, do not carryforward
            tx.set(userRef, {
                planCode: newPlanCode,
                creditBalance: credits,
                updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
            }, { merge: true });
            outcome = 'WRITTEN';
        });
        const verify = await ledgerRef.get();
        logger_1.logger.info({ uid, requestId, exists: verify.exists, outcome }, '[CREDITS] Plan switch transaction complete');
    }
    catch (e) {
        logger_1.logger.error({ uid, requestId, err: e }, '[CREDITS] Plan switch transaction error');
        throw e;
    }
    return outcome;
}
exports.creditsRepository = {
    readUserCredits,
    readUserInfo,
    listRecentLedgers,
    writeDebitIfAbsent,
    writeGrantAndSetPlanIfAbsent,
};
