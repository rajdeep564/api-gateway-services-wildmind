/**
 * Grant Test Credits
 * 
 * Safely add credits to a user account through the ledger system
 * This maintains consistency between balance and ledger history
 * 
 * Usage:
 *   npx ts-node scripts/grantTestCredits.ts <userId> <amount>
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { creditsRepository } from '../src/repository/creditsRepository';

async function grantTestCredits(userId: string, amount: number) {
  console.log('\n💰 ==== Grant Test Credits ====\n');
  console.log(`User ID: ${userId}`);
  console.log(`Amount: ${amount} credits`);
  console.log('-----------------------------------\n');

  try {
    // Get current balance
    const beforeInfo = await creditsRepository.readUserInfo(userId);
    if (!beforeInfo) {
      console.error('❌ User not found');
      process.exit(1);
    }

    console.log(`📊 Before:`);
    console.log(`   Balance: ${beforeInfo.creditBalance} credits`);
    console.log(`   Plan: ${beforeInfo.planCode}`);
    console.log('');

    // Grant credits through ledger system
    const requestId = `TEST_GRANT_${Date.now()}`;
    console.log(`🔄 Granting ${amount} credits...`);
    console.log(`   Request ID: ${requestId}`);
    console.log('');

    const result = await creditsRepository.writeGrantAndSetPlanIfAbsent(
      userId,
      requestId,
      beforeInfo.creditBalance + amount, // Add to current balance
      beforeInfo.planCode,
      'testing.manual_grant',
      { 
        grantedAmount: amount,
        previousBalance: beforeInfo.creditBalance,
        reason: 'Testing purposes'
      }
    );

    if (result === 'WRITTEN') {
      console.log('✅ Credits granted successfully!');
    } else {
      console.log('⚠️  Transaction was skipped (idempotency)');
    }
    console.log('');

    // Verify new balance
    const afterInfo = await creditsRepository.readUserInfo(userId);
    console.log(`📊 After:`);
    console.log(`   Balance: ${afterInfo?.creditBalance} credits`);
    console.log(`   Plan: ${afterInfo?.planCode}`);
    console.log(`   Change: +${(afterInfo?.creditBalance || 0) - beforeInfo.creditBalance} credits`);
    console.log('');

    console.log('✅ Transaction complete! Balance and ledger are synchronized.');

  } catch (error) {
    console.error('\n❌ Error granting credits:', error);
    throw error;
  }

  console.log('\n===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
const userId = args[0];
const amount = parseInt(args[1] || '0', 10);

if (!userId || !amount || amount <= 0) {
  console.error('❌ Usage: npx ts-node scripts/grantTestCredits.ts <userId> <amount>');
  console.error('\nExample:');
  console.error('  npx ts-node scripts/grantTestCredits.ts sCr9uFD8F5Yt2HhuUXq6Epb3rWk2 10000');
  process.exit(1);
}

// Run the script
grantTestCredits(userId, amount)
  .then(() => {
    console.log('✅ Grant complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Grant failed:', error);
    process.exit(1);
  });
