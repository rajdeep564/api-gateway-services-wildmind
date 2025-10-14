"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRepository = void 0;
const firebaseAdmin_1 = require("../../config/firebaseAdmin");
async function upsertUser(uid, userData) {
    if (!userData.email) {
        throw new Error('Email is required');
    }
    // Use 'users' as collection name and UID as document ID
    const ref = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const snap = await ref.get();
    console.log(`[REPO] Using collection: users/${uid}`);
    const nowIso = new Date().toISOString();
    if (!snap.exists) {
        // Create new user with comprehensive data
        const newUser = {
            uid,
            email: userData.email || '',
            username: userData.username || '',
            provider: userData.provider || 'unknown',
            emailVerified: true,
            isActive: true,
            createdAt: nowIso,
            lastLoginAt: nowIso,
            loginCount: 1,
            metadata: {
                accountStatus: 'active',
                roles: ['user']
            },
            preferences: {
                theme: 'light',
                language: 'en'
            }
        };
        if (userData.displayName !== undefined) {
            newUser.displayName = userData.displayName;
        }
        if (userData.photoURL !== undefined) {
            newUser.photoURL = userData.photoURL;
        }
        await ref.set(newUser);
        console.log(`[REPO] Created new user document: users/${uid}`);
        return newUser;
    }
    else {
        // Update existing user with login tracking
        const existing = snap.data();
        // Don't overwrite username if it already exists and is not empty
        const updatesRaw = {
            lastLoginAt: nowIso,
            loginCount: (existing.loginCount || 0) + 1
        };
        // Only include userData fields that don't overwrite existing username
        Object.entries(userData).forEach(([key, value]) => {
            if (key === 'username' && existing.username && existing.username.trim() !== '') {
                console.log(`[REPO] Skipping username update - keeping existing: ${existing.username}`);
                return; // Skip username update if it already exists
            }
            if (value !== undefined) {
                updatesRaw[key] = value;
            }
        });
        const updates = Object.entries(updatesRaw).reduce((acc, [k, v]) => {
            if (v !== undefined)
                acc[k] = v;
            return acc;
        }, {});
        await ref.update(updates);
        console.log(`[REPO] Updated existing user document: users/${uid}, login count: ${updates.loginCount}`);
        return { ...existing, ...updates };
    }
}
async function getUserById(uid) {
    // Direct lookup using UID as document ID in users collection
    const ref = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const snap = await ref.get();
    if (snap.exists) {
        const data = snap.data();
        console.log(`[REPO] Found user by UID: ${uid} in users collection`);
        return data;
    }
    console.log(`[REPO] No user found for UID: ${uid}`);
    return null;
}
async function getUserByUsername(username) {
    // Search for user by username field in users collection
    const usersRef = firebaseAdmin_1.adminDb.collection('users');
    const querySnapshot = await usersRef.where('username', '==', username).get();
    if (querySnapshot.empty) {
        console.log(`[REPO] No user found for username: ${username}`);
        return null;
    }
    const doc = querySnapshot.docs[0];
    const data = doc.data();
    console.log(`[REPO] Found user by username: ${username} with UID: ${data.uid}`);
    return data;
}
async function getUserByEmail(email) {
    // Search for user by email field in users collection
    const usersRef = firebaseAdmin_1.adminDb.collection('users');
    const querySnapshot = await usersRef.where('email', '==', email).get();
    if (querySnapshot.empty) {
        console.log(`[REPO] No user found for email: ${email}`);
        return null;
    }
    const doc = querySnapshot.docs[0];
    const data = doc.data();
    console.log(`[REPO] Found user by email: ${email} with UID: ${data.uid}`);
    return { uid: data.uid, user: data };
}
async function getEmailByUsername(username) {
    // Search for user by username field in users collection
    const usersRef = firebaseAdmin_1.adminDb.collection('users');
    const querySnapshot = await usersRef.where('username', '==', username).get();
    if (querySnapshot.empty) {
        console.log(`[REPO] No email found for username: ${username}`);
        return null;
    }
    const doc = querySnapshot.docs[0];
    const data = doc.data();
    console.log(`[REPO] Found email for username ${username}: ${data.email}`);
    return data.email || null;
}
async function updateUser(uid, updates) {
    console.log(`[REPO] Updating user by UID: ${uid}`);
    console.log(`[REPO] Updates to apply:`, updates);
    // Direct update using UID as document ID in users collection
    const ref = firebaseAdmin_1.adminDb.collection('users').doc(uid);
    const filteredUpdates = Object.entries(updates).reduce((acc, [k, v]) => {
        if (v !== undefined)
            acc[k] = v;
        return acc;
    }, {});
    console.log(`[REPO] Filtered updates:`, filteredUpdates);
    // Use merge: true to update only the specified fields
    await ref.update(filteredUpdates);
    console.log(`[REPO] Updated user document: users/${uid}`);
    // Return updated user
    const updatedSnap = await ref.get();
    const updatedUser = updatedSnap.data();
    console.log(`[REPO] Updated user data:`, updatedUser);
    return updatedUser;
}
async function updateUserByEmail(email, updates) {
    console.log(`[REPO] Updating user by email: ${email}`);
    console.log(`[REPO] Updates to apply:`, updates);
    // Find user by email first
    const userResult = await getUserByEmail(email);
    if (!userResult) {
        throw new Error('User not found');
    }
    console.log(`[REPO] Found user for email update:`, userResult);
    // Update using UID as document ID in users collection
    const ref = firebaseAdmin_1.adminDb.collection('users').doc(userResult.uid);
    const filteredUpdates = Object.entries(updates).reduce((acc, [k, v]) => {
        if (v !== undefined)
            acc[k] = v;
        return acc;
    }, {});
    console.log(`[REPO] Filtered updates for email:`, filteredUpdates);
    await ref.update(filteredUpdates);
    console.log(`[REPO] Updated user document: users/${userResult.uid}`);
    // Return updated user
    const updatedSnap = await ref.get();
    return updatedSnap.data();
}
// In-memory OTP store to avoid persisting in Firestore
const otpStore = new Map();
async function saveOtp(email, code, ttlSeconds) {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    console.log(`[OTP] Saving OTP for ${email}: ${code}, expires at ${new Date(expiresAt).toISOString()}`);
    otpStore.set(email, { code, expiresAt });
    console.log(`[OTP] OTP store size: ${otpStore.size}`);
}
async function verifyAndConsumeOtp(email, code) {
    console.log(`[OTP] Verifying OTP for ${email}: ${code}`);
    const record = otpStore.get(email);
    if (!record) {
        console.log(`[OTP] No OTP record found for ${email}`);
        return false;
    }
    console.log(`[OTP] Found OTP record - stored: ${record.code}, provided: ${code}`);
    if (record.code !== code) {
        console.log(`[OTP] OTP code mismatch for ${email}`);
        return false;
    }
    const now = Date.now();
    if (now > record.expiresAt) {
        console.log(`[OTP] OTP expired for ${email}. Now: ${now}, Expires: ${record.expiresAt}`);
        otpStore.delete(email);
        return false;
    }
    console.log(`[OTP] OTP verification successful for ${email}`);
    otpStore.delete(email);
    console.log(`[OTP] OTP consumed and removed from store`);
    return true;
}
exports.authRepository = {
    upsertUser,
    getUserById,
    getUserByUsername,
    updateUser,
    updateUserByEmail,
    getUserByEmail,
    getEmailByUsername,
    saveOtp,
    verifyAndConsumeOtp
};
