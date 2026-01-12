
import * as dotenv from 'dotenv';
dotenv.config();
import { creditServiceClient } from '../src/clients/creditServiceClient';
import { v4 as uuidv4 } from 'uuid';

async function runTests() {
    console.log('🧪 Starting Comprehensive Credit Deduction Tests...');
    
    // 1. Setup Dummy User
    const userId = `test_user_dummy_${Date.now()}`;
    const email = `dummy_${Date.now()}@test.com`;
    
    console.log(`\n[SETUP] Creating dummy user: ${userId}`);
    const serviceUrl = process.env.CREDIT_SERVICE_URL || 'http://127.0.0.1:3001';
    console.log(`[DEBUG] Connecting to Credit Service at: ${serviceUrl}`);

    // Probe
    try {
        const probe = await import('axios').then(a => a.default.get(`${serviceUrl}/users/test`));
        console.log(`[DEBUG] Probe /users/test status: ${probe.status}`);
    } catch (e: any) {
        console.log(`[DEBUG] Probe failed: ${e.message}`);
        console.log(`[DEBUG] Response Body:`, e.response?.data);
    }

    await creditServiceClient.initUser(userId, email);

    let balanceObj = await creditServiceClient.getBalance(userId);
    console.log(`[SETUP] Initial Balance: ${balanceObj.creditBalance} (Expected ~2000)`);

    let currentBalance = balanceObj.creditBalance;
    const initialBalance = currentBalance;

    // ---------------------------------------------------------
    // SCENARIO 1: Successful Deduction (Standard)
    // ---------------------------------------------------------
    console.log('\n[TEST 1] Standard Deduction (Cost: 100)');
    const txId1 = uuidv4();
    try {
        // Correct Sig: (userId, transactionId, amount, reason, meta)
        await creditServiceClient.debit(userId, txId1, 100, 'model-gen', { model: 'test-model-1' });
        const bal = await creditServiceClient.getBalance(userId);
        currentBalance -= 100;
        console.log(`✅ Success. New Balance: ${bal.creditBalance} (Expected: ${currentBalance})`);
        if (bal.creditBalance !== currentBalance) throw new Error(`Balance mismatch. Expected ${currentBalance}, got ${bal.creditBalance}`);
    } catch (e: any) {
        console.error('❌ Failed:', e.message);
    }

    // ---------------------------------------------------------
    // SCENARIO 2: Idempotency (Replay same transaction ID)
    // ---------------------------------------------------------
    console.log('\n[TEST 2] Idempotency Check (Replaying TEST 1 txId)');
    try {
        await creditServiceClient.debit(userId, txId1, 100, 'model-gen', { model: 'test-model-1' });
        const bal = await creditServiceClient.getBalance(userId);
        console.log(`✅ Success (No double charge). Balance: ${bal.creditBalance} (Expected: ${currentBalance})`);
         if (bal.creditBalance !== currentBalance) throw new Error('Idempotency failed, balance changed');
    } catch (e: any) {
        console.log(`ℹ️ Idempotency result: ${e.message}`); 
    }

    // ---------------------------------------------------------
    // SCENARIO 3: Insufficient Funds
    // ---------------------------------------------------------
    console.log('\n[TEST 3] Insufficient Funds (Cost: 100,000)');
    try {
        await creditServiceClient.debit(userId, uuidv4(), 100000, 'model-gen-heavy', { model: 'heavy-model' });
        console.error('❌ FAILED: Should have thrown error but succeeded.');
    } catch (e: any) {
        console.log(`✅ Pass. Correctly threw error: "${e.response?.data?.message || e.message}"`);
    }

    // ---------------------------------------------------------
    // SCENARIO 4: Edge Case - Exact Balance Deduction
    // ---------------------------------------------------------
    console.log(`\n[TEST 4] Exact Balance Deduction (Draining remaining ${currentBalance})`);
    try {
        const bal = await creditServiceClient.getBalance(userId);
        await creditServiceClient.debit(userId, uuidv4(), bal.creditBalance, 'drain-pool', { model: 'drainer' });
        const finalBal = await creditServiceClient.getBalance(userId);
        currentBalance = 0;
        console.log(`✅ Success. Zero Balance: ${finalBal.creditBalance}`);
        if (finalBal.creditBalance !== 0) throw new Error('Balance should be 0');
    } catch (e: any) {
        console.error('❌ Failed to drain exact balance:', e.message);
    }

    // ---------------------------------------------------------
    // SCENARIO 5: Deduction on Zero Balance
    // ---------------------------------------------------------
    console.log('\n[TEST 5] Deduction on Zero Balance (Cost: 1)');
    try {
        await creditServiceClient.debit(userId, uuidv4(), 1, 'fail-test', { model: 'fail-mode' });
        console.error('❌ FAILED: Should have thrown error.');
    } catch (e: any) {
        console.log(`✅ Pass. Correctly threw error: "${e.response?.data?.message || e.message}"`);
    }

    // ---------------------------------------------------------
    // SCENARIO 6: Refund / Grant Logic (Simulate failed generation refund)
    // ---------------------------------------------------------
    console.log('\n[TEST 6] Refund/Grant Logic (Refunding 100)');
    try {
        // Grant back 100 credits
        await creditServiceClient.grant(userId, uuidv4(), 100, 'refund.generation_failed', { originalTxId: txId1 });
        const bal = await creditServiceClient.getBalance(userId);
        currentBalance += 100;
        console.log(`✅ Refund Success. New Balance: ${bal.creditBalance} (Expected: ${currentBalance})`);
        if (bal.creditBalance !== currentBalance) throw new Error(`Balance mismatch after refund. Expected ${currentBalance}, got ${bal.creditBalance}`);
    } catch (e: any) {
        console.error('❌ Refund Failed:', e.message);
    }

    console.log('\n✨ ALL SCENARIOS COMPLETED');
}

runTests().catch(console.error);
