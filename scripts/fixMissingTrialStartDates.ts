/**
 * Fix Missing Trial Start Dates
 * 
 * This script finds all users on LAUNCH_4000_FIXED plan who have launchTrialStartDate: null
 * and sets it to their createdAt date (or current date if createdAt is missing).
 * 
 * Usage:
 *   npx ts-node scripts/fixMissingTrialStartDates.ts [--dry-run] [--limit=N]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';

const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';

interface FixStats {
  totalUsers: number;
  fixed: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ uid: string; email?: string; error: string }>;
}

async function fixMissingTrialStartDates(options: { dryRun?: boolean; limit?: number } = {}): Promise<FixStats> {
  const { dryRun = false, limit } = options;
  
  console.log('\n🔧 ==== Fix Missing Trial Start Dates ====\n');
  console.log('📋 Strategy:');
  console.log('  - Find all users on LAUNCH_4000_FIXED plan');
  console.log('  - Check if launchTrialStartDate is null or missing');
  console.log('  - Set launchTrialStartDate to createdAt date (or current date if missing)');
  console.log(`  - Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  if (limit) {
    console.log(`  - Limit: Processing first ${limit} users`);
  }
  console.log('='.repeat(60) + '\n');

  const stats: FixStats = {
    totalUsers: 0,
    fixed: 0,
    skipped: 0,
    errors: 0,
    errorDetails: []
  };

  try {
    // Fetch all users on launch plan
    let usersQuery = adminDb.collection('users')
      .where('planCode', '==', LAUNCH_PLAN_CODE);
    
    if (limit) {
      usersQuery = usersQuery.limit(limit) as any;
    }
    
    const usersSnapshot = await usersQuery.get();
    stats.totalUsers = usersSnapshot.size;

    console.log(`📥 Found ${stats.totalUsers} users on ${LAUNCH_PLAN_CODE} plan\n`);

    if (dryRun) {
      console.log('🔍 DRY RUN MODE - No changes will be made\n');
    }

    // Process users in batches
    const batchSize = 10;
    const userDocs = usersSnapshot.docs;
    
    for (let i = 0; i < userDocs.length; i += batchSize) {
      const batch = userDocs.slice(i, i + batchSize);
      console.log(`\n📦 Processing batch ${Math.floor(i / batchSize) + 1} (users ${i + 1}-${Math.min(i + batchSize, userDocs.length)})...`);

      await Promise.all(
        batch.map(async (userDoc) => {
          const uid = userDoc.id;
          const userData = userDoc.data();
          const email = userData.email || 'N/A';
          const trialStartDate = userData.launchTrialStartDate;
          const createdAt = userData.createdAt;

          try {
            // Check if trial start date is missing
            if (trialStartDate !== null && trialStartDate !== undefined) {
              console.log(`  ⏭️  ${email} (${uid}): Already has launchTrialStartDate`);
              stats.skipped++;
              return;
            }

            if (dryRun) {
              console.log(`  🔍 [DRY RUN] Would fix: ${email} (${uid})`);
              console.log(`     Current: launchTrialStartDate=${trialStartDate}`);
              if (createdAt) {
                const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
                console.log(`     Would set: launchTrialStartDate=${createdDate.toISOString()}`);
              } else {
                console.log(`     Would set: launchTrialStartDate=<current timestamp>`);
              }
              stats.fixed++;
              return;
            }

            // Determine the trial start date
            let trialStartTimestamp: any;
            if (createdAt) {
              // Use createdAt if available
              const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
              trialStartTimestamp = admin.firestore.Timestamp.fromDate(createdDate);
              console.log(`  🔧 ${email} (${uid}): Setting launchTrialStartDate to createdAt (${createdDate.toISOString()})`);
            } else {
              // Use current timestamp if createdAt is missing
              trialStartTimestamp = admin.firestore.FieldValue.serverTimestamp();
              console.log(`  🔧 ${email} (${uid}): Setting launchTrialStartDate to current timestamp (createdAt missing)`);
            }

            // Update user
            await adminDb.collection('users').doc(uid).update({
              launchTrialStartDate: trialStartTimestamp,
              launchMigrationDone: true, // Also ensure this is set
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            console.log(`  ✅ Fixed: ${email} (${uid})`);
            stats.fixed++;

          } catch (error: any) {
            const errorMsg = error.message || String(error);
            console.error(`  ❌ Error fixing ${email} (${uid}): ${errorMsg}`);
            stats.errors++;
            stats.errorDetails.push({ uid, email, error: errorMsg });
          }
        })
      );
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Fix Summary:');
    console.log(`   Total users on launch plan: ${stats.totalUsers}`);
    console.log(`   ✅ Fixed: ${stats.fixed}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log(`   ❌ Errors: ${stats.errors}`);
    console.log('='.repeat(60) + '\n');

    if (stats.errorDetails.length > 0) {
      console.log('❌ Error Details:');
      stats.errorDetails.forEach(({ uid, email, error }) => {
        console.log(`   ${email} (${uid}): ${error}`);
      });
      console.log('');
    }

    if (dryRun) {
      console.log('🔍 This was a DRY RUN. No changes were made.');
      console.log('   Run without --dry-run to apply changes.\n');
    } else {
      console.log('✅ Fix complete!\n');
    }

  } catch (error) {
    console.error('\n❌ Fatal error during fix:', error);
    throw error;
  }

  return stats;
}

// Parse command line arguments
const args = process.argv.slice(2);
let dryRun = false;
let limit: number | undefined;

for (const arg of args) {
  if (arg === '--dry-run' || arg === '-d') {
    dryRun = true;
  } else if (arg.startsWith('--limit=')) {
    limit = parseInt(arg.split('=')[1], 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('❌ Invalid limit value');
      process.exit(1);
    }
  } else if (arg === '--help' || arg === '-h') {
    console.log('Usage: npx ts-node scripts/fixMissingTrialStartDates.ts [--dry-run] [--limit=N]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d    Run without making changes');
    console.log('  --limit=N         Process only first N users');
    console.log('  --help, -h        Show this help message');
    process.exit(0);
  }
}

// Run fix
fixMissingTrialStartDates({ dryRun, limit })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  });

