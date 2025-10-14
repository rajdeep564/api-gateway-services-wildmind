"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redeemCodeRepository = void 0;
exports.createRedeemCode = createRedeemCode;
exports.getRedeemCode = getRedeemCode;
exports.validateRedeemCode = validateRedeemCode;
exports.useRedeemCode = useRedeemCode;
exports.listRedeemCodes = listRedeemCodes;
exports.getRedeemCodeUsages = getRedeemCodeUsages;
const firebaseAdmin_1 = require("../config/firebaseAdmin");
const errorHandler_1 = require("../utils/errorHandler");
async function createRedeemCode(code, type, planCode, maxUses = 1, validUntil, createdBy) {
    const redeemCodeRef = firebaseAdmin_1.adminDb.collection('redeemCodes').doc(code);
    // Check if code already exists
    const existingCode = await redeemCodeRef.get();
    if (existingCode.exists) {
        throw new errorHandler_1.ApiError('Redeem code already exists', 400);
    }
    const redeemCodeDoc = {
        code,
        type,
        planCode,
        status: 'ACTIVE',
        maxUses,
        currentUses: 0,
        validUntil,
        createdAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp(),
        usedBy: [],
        ...(createdBy && { createdBy }) // Only include createdBy if it has a value
    };
    await redeemCodeRef.set(redeemCodeDoc);
    return redeemCodeDoc;
}
async function getRedeemCode(code) {
    const redeemCodeRef = firebaseAdmin_1.adminDb.collection('redeemCodes').doc(code);
    const snap = await redeemCodeRef.get();
    if (!snap.exists)
        return null;
    return snap.data();
}
async function validateRedeemCode(code, uid) {
    const redeemCode = await getRedeemCode(code);
    if (!redeemCode) {
        return { valid: false, error: 'Invalid redeem code' };
    }
    if (redeemCode.status !== 'ACTIVE') {
        return { valid: false, error: 'Redeem code is not active' };
    }
    if (redeemCode.currentUses >= redeemCode.maxUses) {
        return { valid: false, error: 'Redeem code has reached maximum uses' };
    }
    if (redeemCode.validUntil) {
        // Convert Firestore Timestamp to JavaScript Date
        let expiryDate;
        if (redeemCode.validUntil && typeof redeemCode.validUntil.toDate === 'function') {
            // It's a Firestore Timestamp
            expiryDate = redeemCode.validUntil.toDate();
        }
        else {
            // It's already a Date object or timestamp
            expiryDate = new Date(redeemCode.validUntil);
        }
        const now = new Date();
        if (now > expiryDate) {
            const expiredHoursAgo = Math.floor((now.getTime() - expiryDate.getTime()) / (1000 * 60 * 60));
            let errorMessage;
            if (expiredHoursAgo < 24) {
                errorMessage = `Redeem code expired ${expiredHoursAgo} hour${expiredHoursAgo === 1 ? '' : 's'} ago (${expiryDate.toLocaleString()})`;
            }
            else {
                const expiredDaysAgo = Math.floor(expiredHoursAgo / 24);
                errorMessage = `Redeem code expired ${expiredDaysAgo} day${expiredDaysAgo === 1 ? '' : 's'} ago (${expiryDate.toLocaleString()})`;
            }
            return { valid: false, error: errorMessage };
        }
    }
    // Check if user has already used this code
    if (redeemCode.usedBy && redeemCode.usedBy.includes(uid)) {
        return { valid: false, error: 'You have already used this redeem code' };
    }
    return { valid: true, redeemCode };
}
async function useRedeemCode(code, uid, username, email, planCodeAssigned, creditsGranted) {
    const batch = firebaseAdmin_1.adminDb.batch();
    const redeemCodeRef = firebaseAdmin_1.adminDb.collection('redeemCodes').doc(code);
    const usageRef = firebaseAdmin_1.adminDb.collection('redeemCodeUsages').doc();
    // Update redeem code usage
    batch.update(redeemCodeRef, {
        currentUses: firebaseAdmin_1.admin.firestore.FieldValue.increment(1),
        usedBy: firebaseAdmin_1.admin.firestore.FieldValue.arrayUnion(uid),
        updatedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp()
    });
    // Create usage record
    const usage = {
        redeemCode: code,
        uid,
        username,
        email,
        planCodeAssigned,
        creditsGranted,
        usedAt: firebaseAdmin_1.admin.firestore.FieldValue.serverTimestamp()
    };
    batch.set(usageRef, usage);
    await batch.commit();
}
async function listRedeemCodes(limit = 50, type, status) {
    let query = firebaseAdmin_1.adminDb.collection('redeemCodes').orderBy('createdAt', 'desc');
    if (type) {
        query = query.where('type', '==', type);
    }
    if (status) {
        query = query.where('status', '==', status);
    }
    const snap = await query.limit(limit).get();
    return snap.docs.map(doc => doc.data());
}
async function getRedeemCodeUsages(code, limit = 50) {
    const snap = await firebaseAdmin_1.adminDb
        .collection('redeemCodeUsages')
        .where('redeemCode', '==', code)
        .orderBy('usedAt', 'desc')
        .limit(limit)
        .get();
    return snap.docs.map(doc => doc.data());
}
exports.redeemCodeRepository = {
    createRedeemCode,
    getRedeemCode,
    validateRedeemCode,
    useRedeemCode,
    listRedeemCodes,
    getRedeemCodeUsages
};
