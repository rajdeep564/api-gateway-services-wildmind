/**
 * Reset User Credits
 * 
 * Completely resets a user's credit balance and deletes all ledger entries.
 * Can reset a single user by email OR a batch of users created after a specific date.
 * 
 * Usage:
 *   npx ts-node scripts/resetUserCredits.ts <email>
 *   npx ts-node scripts/resetUserCredits.ts --date <YYYY-MM-DD>
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { creditsRepository } from '../src/repository/creditsRepository';
import { authRepository } from '../src/repository/auth/authRepository';
import { creditsService } from '../src/services/creditsService';
import { adminDb, admin } from '../src/config/firebaseAdmin';

// Helper to validate date string
function isValidDate(dateString: string) {
  const regEx = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateString.match(regEx)) return false;
  const d = new Date(dateString);
  const dNum = d.getTime();
  if (!dNum && dNum !== 0) return false;
  return d.toISOString().slice(0, 10) === dateString;
}

// Core reset function reused for both single and batch operations
async function performResetForUser(userId: string, username: string | undefined, targetBalance: number = 2000) {
  console.log(`\n� Processing user: ${userId} (${username || 'No username'})`);

  try {
    // Ensure user is initialized
    await creditsService.ensureUserInit(userId);

    // Get current balance and ledger info for logging
    const beforeReconciled = await creditsRepository.reconcileBalanceFromLedgers(userId);
    console.log(`   Current: ${beforeReconciled.calculatedBalance} credits, ${beforeReconciled.ledgerCount} ledger entries`);

    // Delete all ledger entries
    const userRef = adminDb.collection('users').doc(userId);
    const ledgersCol = userRef.collection('ledgers');

    // Get all ledger documents
    const allLedgersSnap = await ledgersCol.get();
    const totalLedgers = allLedgersSnap.docs.length;

    if (totalLedgers > 0) {
      console.log(`   Deleting ${totalLedgers} ledger entries...`);
      // Delete in batches of 500
      const BATCH_SIZE = 500;
      const batches: FirebaseFirestore.WriteBatch[] = [];
      let currentBatch = adminDb.batch();
      let operationsInBatch = 0;

      for (const doc of allLedgersSnap.docs) {
        currentBatch.delete(doc.ref);
        operationsInBatch++;

        if (operationsInBatch >= BATCH_SIZE) {
          batches.push(currentBatch);
          currentBatch = adminDb.batch();
          operationsInBatch = 0;
        }
      }

      if (operationsInBatch > 0) {
        batches.push(currentBatch);
      }

      for (const batch of batches) {
        await batch.commit();
      }
      console.log(`   ✅ Ledgers deleted`);
    } else {
      console.log('   ℹ️  No ledger entries to delete');
    }

    // Reset credit balance and set plan
    // Defaulting to 2000 credits (Launch Plan / Free Tier fix)
    console.log(`   Setting balance to ${targetBalance} credits...`);
    await userRef.update({
      creditBalance: targetBalance,
      planCode: 'FREE', // Ensuring consistent plan
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Create a fresh grant ledger entry for the reset credits
    const resetGrantId = `RESET_BATCH_${new Date().toISOString().split('T')[0]}_${userId}`;
    await creditsRepository.writeGrantAndSetPlanIfAbsent(
      userId,
      resetGrantId,
      targetBalance,
      'FREE',
      'Batch reset: Initialization fix'
    );

    console.log(`   ✅ User reset complete: Balance ${targetBalance}, Ledgers cleared & re-seeded`);
    return true;

  } catch (error) {
    console.error(`   ❌ Error processing user ${userId}:`, error);
    return false;
  }
}

async function start() {
  const args = process.argv.slice(2);

  // Mode 1: Batch Reset by Date
  if (args.includes('--date')) {
    const dateIndex = args.indexOf('--date');
    const dateValue = args[dateIndex + 1];

    if (!dateValue || !isValidDate(dateValue)) {
      console.error('❌ Error: Please provide a valid date in YYYY-MM-DD format.');
      console.error('Usage: npx ts-node scripts/resetUserCredits.ts --date 2026-01-04');
      process.exit(1);
    }

    const startDate = new Date(dateValue);
    // Set to beginning of that day in UTC? Or local?
    // Let's assume input is UTC date, so we want users created >= this date.
    // Making it start of day UTC
    startDate.setUTCHours(0, 0, 0, 0);
    const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);

    console.log('\n📅 ==== Batch Reset User Credits ====\n');
    console.log(`Target Date: ${dateValue} (>= ${startTimestamp.toDate().toISOString()})`);
    console.log(`Target Balance: 2000 credits`);
    console.log('-----------------------------------\n');

    try {
      // Find users created after the date
      console.log('🔍 Searching for users...');

      // Strategy 1: Search by Timestamp (for standard Firestore usage)
      const usersSnapTimestamp = await adminDb.collection('users')
        .where('createdAt', '>=', startTimestamp)
        .get();

      // Strategy 2: Search by String (for authRepository usage which uses ISO strings)
      // Note: Lexicographical comparison works for ISO strings (YYYY-MM-DD...)
      const startIso = startTimestamp.toDate().toISOString();
      const usersSnapString = await adminDb.collection('users')
        .where('createdAt', '>=', startIso)
        .get();

      // Merge results
      const foundUsers = new Map();

      usersSnapTimestamp.docs.forEach(doc => foundUsers.set(doc.id, doc));
      usersSnapString.docs.forEach(doc => foundUsers.set(doc.id, doc));

      if (foundUsers.size === 0) {
        console.log('ℹ️  No users found created on or after this date (checked both Timestamp and ISO String formats).');
        process.exit(0);
      }

      console.log(`📋 Found ${foundUsers.size} users to process.`);
      console.log('-----------------------------------');

      let successCount = 0;
      let failCount = 0;

      for (const doc of foundUsers.values()) {
        const userData = doc.data();
        const success = await performResetForUser(doc.id, userData.username || userData.email);
        if (success) successCount++;
        else failCount++;
      }

      console.log('\n===================================');
      console.log(`✅ Batch complete: ${successCount} processed, ${failCount} failed`);

    } catch (error) {
      console.error('\n❌ Batch processing error:', error);
      process.exit(1);
    }

  } else {
    // Mode 2: Single User Reset by Email
    const email = args[0];

    if (!email || email.startsWith('-')) {
      console.error('❌ Usage: npx ts-node scripts/resetUserCredits.ts <email>');
      console.error('       OR');
      console.error('       npx ts-node scripts/resetUserCredits.ts --date <YYYY-MM-DD>');
      process.exit(1);
    }

    console.log('\n👤 ==== Single User Reset ====\n');
    console.log(`Target Email: ${email}`);

    try {
      const userResult = await authRepository.getUserByEmail(email);
      if (!userResult) {
        console.error('❌ User not found with email:', email);
        process.exit(1);
      }

      await performResetForUser(userResult.uid, userResult.user.username);
      console.log('\n✅ Single user reset complete');

    } catch (error) {
      console.error('\n❌ Single reset failed:', error);
      process.exit(1);
    }
  }
}

// Run the script
start()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  });

