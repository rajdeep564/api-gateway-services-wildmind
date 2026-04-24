/**
 * Increase User Storage Quota
 * 
 * Usage:
 *   npx ts-node scripts/increase-storage.ts <email|uid|username> <storageGB>
 */

import dotenv from 'dotenv';
import path from 'path';
import axios from 'axios';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { authRepository } from '../src/repository/auth/authRepository';

const CREDIT_SERVICE_URL = process.env.CREDIT_SERVICE_URL || 'http://127.0.0.1:5001';

async function resolveUser(identifier: string) {
    // 1. Try by Email
    if (identifier.includes('@')) {
        const result = await authRepository.getUserByEmail(identifier);
        if (result) return result.uid;
    }

    // 2. Try by UID directly (if it looks like a UID)
    const userById = await authRepository.getUserById(identifier);
    if (userById) return identifier;

    // 3. Try by Username
    const userByUsername = await authRepository.getUserByUsername(identifier);
    if (userByUsername) return userByUsername.uid;

    throw new Error(`Could not find user with identifier: ${identifier}`);
}

async function increaseStorage() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('❌ Usage: npx ts-node scripts/increase-storage.ts <email|uid|username> <storageGB>');
        process.exit(1);
    }

    const identifier = args[0];
    const storageGB = parseInt(args[1], 10);

    if (isNaN(storageGB)) {
        console.error('❌ Invalid storage amount. Please provide a number in GB.');
        process.exit(1);
    }

    console.log('\n📦 ==== Increase User Storage ====');
    console.log(`Target: ${identifier}`);
    console.log(`New Quota: ${storageGB} GB`);
    console.log('----------------------------------\n');

    try {
        console.log(`🔍 Resolving user ${identifier}...`);
        const userId = await resolveUser(identifier);
        console.log(`✅ Resolved to UID: ${userId}`);

        console.log(`\n🚀 Sending update request to Credit Service (${CREDIT_SERVICE_URL})...`);
        
        const response = await axios.post(`${CREDIT_SERVICE_URL}/users/storage/quota`, {
            userId,
            storageGB
        });

        if (response.data.success) {
            const data = response.data.data;
            const quotaGB = (BigInt(data.storageQuotaBytes) / BigInt(1024 * 1024 * 1024)).toString();
            
            console.log('\n✅ SUCCESS!');
            console.log(`User: ${data.email}`);
            console.log(`New Storage Quota: ${quotaGB} GB`);
            console.log(`Plan: ${data.planCode}`);
        } else {
            console.error('\n❌ Update failed:', response.data.message || 'Unknown error');
        }

    } catch (error: any) {
        console.error('\n❌ Error:', error.response?.data?.message || error.message);
        process.exit(1);
    }

    console.log('\n==================================\n');
}

increaseStorage();
