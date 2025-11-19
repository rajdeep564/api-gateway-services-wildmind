/**
 * Reset User Credits
 * 
 * Completely resets a user's credit balance to 0 and deletes all ledger entries
 * WARNING: This is a destructive operation - use with caution!
 * 
 * Usage:
 *   npx ts-node scripts/resetUserCredits.ts <email>
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { creditsRepository } from '../src/repository/creditsRepository';
import { authRepository } from '../src/repository/auth/authRepository';
import { creditsService } from '../src/services/creditsService';
import { adminDb, admin } from '../src/config/firebaseAdmin';

async function resetUserCredits(email: string) {
  console.log('\n🔄 ==== Reset User Credits ====\n');
  console.log(`Email: ${email}`);
  console.log('⚠️  WARNING: This will delete ALL ledger entries and reset balance to 0!');
  console.log('-----------------------------------\n');

  try {
    // Find user by email
    const userResult = await authRepository.getUserByEmail(email);
    if (!userResult) {
      console.error('❌ User not found with email:', email);
      process.exit(1);
    }

    const userId = userResult.uid;
    console.log(`User ID: ${userId}`);
    console.log(`Username: ${userResult.user.username || 'N/A'}`);
    console.log('');

    // Ensure user is initialized
    await creditsService.ensureUserInit(userId);

    // Get current balance and ledger info
    const beforeInfo = await creditsRepository.readUserInfo(userId);
    if (!beforeInfo) {
      console.error('❌ User credits info not found');
      process.exit(1);
    }

    const beforeReconciled = await creditsRepository.reconcileBalanceFromLedgers(userId);
    const recentLedgers = await creditsRepository.listRecentLedgers(userId, 10);

    console.log(`📊 Current State:`);
    console.log(`   Balance: ${beforeInfo.creditBalance} credits`);
    console.log(`   Plan: ${beforeInfo.planCode}`);
    console.log(`   Calculated from ledgers: ${beforeReconciled.calculatedBalance} credits`);
    console.log(`   Total Grants: ${beforeReconciled.totalGrants} credits`);
    console.log(`   Total Debits: ${beforeReconciled.totalDebits} credits`);
    console.log(`   Ledger entries: ${beforeReconciled.ledgerCount}`);
    console.log('');

    // Confirm deletion
    console.log(`🗑️  Preparing to delete ${beforeReconciled.ledgerCount} ledger entries...`);
    console.log('');

    // Delete all ledger entries
    const userRef = adminDb.collection('users').doc(userId);
    const ledgersCol = userRef.collection('ledgers');
    
    let deletedCount = 0;
    let batchCount = 0;
    const BATCH_SIZE = 500; // Firestore batch limit is 500 operations

    // Get all ledger documents
    const allLedgersSnap = await ledgersCol.get();
    const totalLedgers = allLedgersSnap.docs.length;

    console.log(`📋 Found ${totalLedgers} ledger entries to delete`);
    console.log('');

    if (totalLedgers > 0) {
      // Delete in batches
      const batches: FirebaseFirestore.WriteBatch[] = [];
      let currentBatch = adminDb.batch();
      let operationsInBatch = 0;

      for (const doc of allLedgersSnap.docs) {
        currentBatch.delete(doc.ref);
        operationsInBatch++;
        deletedCount++;

        // Commit batch when it reaches the limit
        if (operationsInBatch >= BATCH_SIZE) {
          batches.push(currentBatch);
          currentBatch = adminDb.batch();
          operationsInBatch = 0;
          batchCount++;
        }
      }

      // Add the last batch if it has operations
      if (operationsInBatch > 0) {
        batches.push(currentBatch);
        batchCount++;
      }

      // Execute all batches
      console.log(`🔄 Executing ${batchCount} batch(es) to delete ledger entries...`);
      for (let i = 0; i < batches.length; i++) {
        await batches[i].commit();
        console.log(`   ✅ Batch ${i + 1}/${batchCount} committed`);
      }
      console.log(`   ✅ Deleted ${deletedCount} ledger entries`);
      console.log('');
    } else {
      console.log('   ℹ️  No ledger entries to delete');
      console.log('');
    }

    // Reset credit balance to 0
    console.log(`🔄 Resetting credit balance to 0...`);
    await userRef.update({
      creditBalance: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`   ✅ Credit balance reset to 0`);
    console.log('');

    // Verify reset
    const afterInfo = await creditsRepository.readUserInfo(userId);
    const afterReconciled = await creditsRepository.reconcileBalanceFromLedgers(userId);
    const afterLedgers = await creditsRepository.listRecentLedgers(userId, 5);

    console.log(`📊 After Reset:`);
    console.log(`   Balance: ${afterInfo?.creditBalance || 0} credits`);
    console.log(`   Plan: ${afterInfo?.planCode || 'FREE'}`);
    console.log(`   Calculated from ledgers: ${afterReconciled.calculatedBalance} credits`);
    console.log(`   Remaining ledger entries: ${afterReconciled.ledgerCount}`);
    console.log('');

    if (afterReconciled.ledgerCount > 0) {
      console.log(`   ⚠️  WARNING: ${afterReconciled.ledgerCount} ledger entries still exist!`);
      console.log(`   This might indicate a deletion issue.`);
      console.log('');
    } else {
      console.log(`   ✅ All ledger entries deleted successfully`);
      console.log('');
    }

    if (afterInfo?.creditBalance !== 0) {
      console.log(`   ⚠️  WARNING: Balance is not 0! Current: ${afterInfo?.creditBalance}`);
      console.log(`   Attempting to fix...`);
      await userRef.update({
        creditBalance: 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const fixedInfo = await creditsRepository.readUserInfo(userId);
      console.log(`   ✅ Balance fixed to: ${fixedInfo?.creditBalance || 0}`);
      console.log('');
    } else {
      console.log(`   ✅ Balance verified: 0 credits`);
      console.log('');
    }

    console.log('✅ Reset complete! User credits and ledger entries have been cleared.');

  } catch (error) {
    console.error('\n❌ Error resetting credits:', error);
    throw error;
  }

  console.log('\n===================================\n');
}

// Parse command line arguments
const args = process.argv.slice(2);
const email = args[0];

if (!email) {
  console.error('❌ Usage: npx ts-node scripts/resetUserCredits.ts <email>');
  console.error('\nExample:');
  console.error('  npx ts-node scripts/resetUserCredits.ts user@example.com');
  console.error('\n⚠️  WARNING: This will permanently delete all ledger entries and reset balance to 0!');
  process.exit(1);
}

// Run the script
resetUserCredits(email)
  .then(() => {
    console.log('✅ Reset complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Reset failed:', error);
    process.exit(1);
  });

