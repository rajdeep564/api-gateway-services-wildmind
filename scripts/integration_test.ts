
import { creditServiceClient } from '../src/clients/creditServiceClient';

async function runTest() {
    const testUserId = `test-user-${Date.now()}`;
    const email = `test-${Date.now()}@example.com`;

    console.log(`\n🚀 Starting Integration Test for User: ${testUserId}\n`);

    try {
        // 1. Init User
        console.log('1. Testing initUser...');
        const user = await creditServiceClient.initUser(testUserId, email);
        console.log('   ✅ User initialized:', { 
            id: user.id, 
            plan: user.planCode, 
            credits: user.creditBalance 
        });

        // 2. Get Balance
        console.log('\n2. Testing getBalance...');
        const balance = await creditServiceClient.getBalance(testUserId);
        console.log('   ✅ Balance fetched:', balance.creditBalance);

        // 3. Get Storage Info
        console.log('\n3. Testing getStorageInfo...');
        const storage = await creditServiceClient.getStorageInfo(testUserId);
        console.log('   ✅ Storage info:', {
            quota: storage?.quotaBytes,
            used: storage?.usedBytes,
            available: storage?.availableBytes
        });

        // 4. Debit Credits
        console.log('\n4. Testing debit (100 credits)...');
        await creditServiceClient.debit(testUserId, `tx-debit-${Date.now()}`, 100, 'test.debit');
        const afterDebit = await creditServiceClient.getBalance(testUserId);
        console.log('   ✅ Balance after debit:', afterDebit.creditBalance);

        // 5. Grant Credits
        console.log('\n5. Testing grant (500 credits)...');
        await creditServiceClient.grant(testUserId, `tx-grant-${Date.now()}`, 500, 'test.grant');
        const afterGrant = await creditServiceClient.getBalance(testUserId);
        console.log('   ✅ Balance after grant:', afterGrant.creditBalance);

        // 6. Switch Plan
        console.log('\n6. Testing switchPlan (to LAUNCH_4000_FIXED)...');
        // Note: Ensure LAUNCH_4000_FIXED exists in DB
        const planSwitch = await creditServiceClient.updatePlan(testUserId, 'LAUNCH_4000_FIXED');
        console.log('   ✅ Plan switched:', {
            plan: planSwitch.planCode,
            credits: planSwitch.creditBalance
        });

        // 7. Re-check Storage
        console.log('\n7. Re-checking Storage for new plan...');
        const finalStorage = await creditServiceClient.getStorageInfo(testUserId);
        console.log('   ✅ Final Storage info:', {
             quota: finalStorage?.quotaBytes,
             limitGB: Number(finalStorage?.quotaBytes) / (1024*1024*1024)
        });

        console.log('\n✨ All tests passed successfully!');

    } catch (error: any) {
        console.error('\n❌ Test Failed:', error.message || error);
        process.exit(1);
    }
}

runTest();
