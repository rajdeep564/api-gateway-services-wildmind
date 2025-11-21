/**
 * Grant Test Credits
 * 
 * Safely add credits to a user account through the ledger system
 * This maintains consistency between balance and ledger history
 * 
 * Usage:
 *   npx ts-node scripts/grantTestCredits.ts <email> <amount>
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { creditsRepository } from '../src/repository/creditsRepository';
import { authRepository } from '../src/repository/auth/authRepository';
import { creditsService } from '../src/services/creditsService';

type ResolveUserInput =
  | { type: 'email'; value: string }
  | { type: 'username'; value: string };

type ResolvedUser = { uid: string; user: any };

async function resolveUserIdentifier(input: ResolveUserInput): Promise<ResolvedUser> {
  if (input.type === 'email') {
    const userResult = await authRepository.getUserByEmail(input.value);
    if (!userResult) throw new Error(`User not found with email ${input.value}`);
    return userResult;
  }

  if (typeof authRepository.getUserByUsername === 'function') {
    const user = await authRepository.getUserByUsername(input.value);
    if (!user) throw new Error(`User not found with username ${input.value}`);
    return { uid: user.uid, user };
  }

  throw new Error('Username lookup is not supported in authRepository.');
}

async function grantTestCredits(userInput: ResolveUserInput, amount: number) {
  console.log('\n💰 ==== Grant Test Credits ====\n');
  console.log(userInput.type === 'email' ? `Email: ${userInput.value}` : `Username: ${userInput.value}`);
  console.log(`Amount: ${amount} credits`);
  console.log('-----------------------------------\n');

  try {
    const userResult = await resolveUserIdentifier(userInput);

    const userId = userResult.uid;
    console.log(`User ID: ${userId}`);
    console.log(`Username: ${userResult.user.username || 'N/A'}`);
    console.log('');

    // Ensure user is initialized
    await creditsService.ensureUserInit(userId);

    // Get current balance
    const beforeInfo = await creditsRepository.readUserInfo(userId);
    if (!beforeInfo) {
      console.error('❌ User credits info not found');
      process.exit(1);
    }

    // Reconcile balance from ledger entries to check for discrepancies
    console.log(`🔍 Reconciling balance from ledger entries...`);
    const reconciled = await creditsRepository.reconcileBalanceFromLedgers(userId);
    console.log(`   Calculated from ledgers: ${reconciled.calculatedBalance} credits`);
    console.log(`   Total Grants: ${reconciled.totalGrants} credits`);
    console.log(`   Total Debits: ${reconciled.totalDebits} credits`);
    console.log(`   Ledger entries: ${reconciled.ledgerCount}`);
    
    const balanceMismatch = Math.abs(beforeInfo.creditBalance - reconciled.calculatedBalance) >= 1;
    if (balanceMismatch) {
      console.log(`   ⚠️  MISMATCH DETECTED!`);
      console.log(`   Stored balance: ${beforeInfo.creditBalance}`);
      console.log(`   Calculated balance: ${reconciled.calculatedBalance}`);
      console.log(`   Difference: ${reconciled.calculatedBalance - beforeInfo.creditBalance}`);
      console.log(`   🔧 Fixing balance mismatch...`);
      
      // Fix the balance to match ledger
      const { adminDb, admin } = await import('../src/config/firebaseAdmin');
      const userRef = adminDb.collection('users').doc(userId);
      await userRef.update({
        creditBalance: reconciled.calculatedBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`   ✅ Balance corrected to ${reconciled.calculatedBalance} credits`);
      console.log('');
    } else {
      console.log(`   ✅ Balance matches ledger entries`);
      console.log('');
    }

    // Re-read balance after reconciliation
    const currentInfo = await creditsRepository.readUserInfo(userId);
    const currentBalance = currentInfo?.creditBalance || 0;

    console.log(`📊 Before Grant:`);
    console.log(`   Balance: ${currentBalance} credits`);
    console.log(`   Plan: ${currentInfo?.planCode || 'FREE'}`);
    console.log('');

    // Grant credits through ledger system
    const requestId = `TEST_GRANT_${Date.now()}`;
    console.log(`🔄 Granting ${amount} credits...`);
    console.log(`   Request ID: ${requestId}`);
    console.log('');

    // Calculate new balance (add to current reconciled balance)
    const newBalance = currentBalance + amount;
    
    const result = await creditsRepository.writeGrantAndSetPlanIfAbsent(
      userId,
      requestId,
      newBalance, // Set to new balance (current + grant amount)
      currentInfo?.planCode || 'FREE',
      'testing.manual_grant',
      { 
        grantedAmount: amount,
        previousBalance: currentBalance,
        reconciledBalance: reconciled.calculatedBalance,
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
    const afterReconciled = await creditsRepository.reconcileBalanceFromLedgers(userId);
    
    console.log(`📊 After:`);
    console.log(`   Balance: ${afterInfo?.creditBalance} credits`);
    console.log(`   Plan: ${afterInfo?.planCode}`);
    console.log(`   Change: +${(afterInfo?.creditBalance || 0) - currentBalance} credits`);
    console.log('');
    
    // Verify balance matches ledger
    const afterMismatch = Math.abs((afterInfo?.creditBalance || 0) - afterReconciled.calculatedBalance) >= 1;
    if (afterMismatch) {
      console.log(`   ⚠️  WARNING: Balance mismatch after grant!`);
      console.log(`   Stored: ${afterInfo?.creditBalance}`);
      console.log(`   Calculated: ${afterReconciled.calculatedBalance}`);
      console.log(`   🔧 Auto-fixing...`);
      
      const { adminDb, admin } = await import('../src/config/firebaseAdmin');
      const userRef = adminDb.collection('users').doc(userId);
      await userRef.update({
        creditBalance: afterReconciled.calculatedBalance,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`   ✅ Balance corrected to ${afterReconciled.calculatedBalance} credits`);
      console.log('');
    } else {
      console.log(`   ✅ Balance verified: Matches ledger entries`);
      console.log('');
    }

    // Check recent ledger entries to verify
    console.log(`📋 Recent Ledger Entries (last 5):`);
    const recentLedgers = await creditsRepository.listRecentLedgers(userId, 5);
    if (recentLedgers.length === 0) {
      console.log('   ⚠️  No ledger entries found!');
    } else {
      recentLedgers.forEach((ledger, idx) => {
        const entry = ledger.entry;
        const createdAt = entry.createdAt 
          ? (entry.createdAt.toDate ? entry.createdAt.toDate().toISOString() : String(entry.createdAt))
          : 'N/A';
        console.log(`   ${idx + 1}. [${entry.type}] ${entry.amount > 0 ? '+' : ''}${entry.amount} credits`);
        console.log(`      Reason: ${entry.reason}`);
        console.log(`      Status: ${entry.status}`);
        console.log(`      Created: ${createdAt}`);
        console.log(`      ID: ${ledger.id}`);
        if (ledger.id === requestId) {
          console.log(`      ✅ This is the grant we just created!`);
        }
        console.log('');
      });
    }

    console.log('✅ Transaction complete! Balance and ledger are synchronized.');

  } catch (error) {
    console.error('\n❌ Error granting credits:', error);
    throw error;
  }

  console.log('\n===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
let identifier: ResolveUserInput | null = null;
let amount = 0;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '-u' || arg === '--username') {
    const value = args[i + 1];
    if (!value) {
      console.error('❌ Missing value for --username');
      process.exit(1);
    }
    identifier = { type: 'username', value };
    i++;
  } else if (!identifier) {
    identifier = { type: 'email', value: arg };
  } else if (!amount) {
    amount = parseInt(arg, 10);
  }
}

if (!identifier || !amount || amount <= 0) {
  console.error('❌ Usage: npx ts-node scripts/grantTestCredits.ts [--username <username> | <email>] <amount>');
  console.error('\nExamples:');
  console.error('  npx ts-node scripts/grantTestCredits.ts user@example.com 10000');
  console.error('  npx ts-node scripts/grantTestCredits.ts --username jane_doe 5000');
  process.exit(1);
}

// Run the script
grantTestCredits(identifier, amount)
  .then(() => {
    console.log('✅ Grant complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Grant failed:', error);
    process.exit(1);
  });
