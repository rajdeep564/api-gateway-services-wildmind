/**
 * Fix Missing Launch Plan GRANT Entries
 * 
 * This script finds all users on LAUNCH_4000_FIXED plan who are missing
 * the GRANT ledger entry and creates it for them.
 * 
 * Usage:
 *   npx ts-node scripts/fixMissingLaunchGrants.ts [--dry-run] [--limit=N]
 */

import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { adminDb, admin } from '../src/config/firebaseAdmin';
import { creditsRepository } from '../src/repository/creditsRepository';

const LAUNCH_PLAN_CODE = 'LAUNCH_4000_FIXED';
const LAUNCH_FIXED_CREDITS = 4000;

interface FixStats {
  totalUsers: number;
  fixed: number;
  skipped: number;
  errors: number;
  errorDetails: Array<{ uid: string; email?: string; error: string }>;
}

async function fixMissingLaunchGrants(options: { dryRun?: boolean; limit?: number } = {}): Promise<FixStats> {
  const { dryRun = false, limit } = options;
  
  console.log('\n🔧 ==== Fix Missing Launch Plan GRANT Entries ====\n');
  console.log('📋 Strategy:');
  console.log('  - Find all users on LAUNCH_4000_FIXED plan');
  console.log('  - Check if they have a GRANT ledger entry');
  console.log('  - Create missing GRANT entry if needed');
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
    // Fetch all users on LAUNCH plan
    let usersQuery = adminDb.collection('users')
      .where('planCode', '==', LAUNCH_PLAN_CODE);
    
    if (limit) {
      usersQuery = usersQuery.limit(limit) as any;
    }
    
    const usersSnapshot = await usersQuery.get();
    stats.totalUsers = usersSnapshot.size;

    console.log(`📥 Found ${stats.totalUsers} users on LAUNCH_4000_FIXED plan\n`);

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
          const currentBalance = userData.creditBalance || 0;

          try {
            // Check if user has any GRANT ledger entries
            const userRef = adminDb.collection('users').doc(uid);
            const ledgersSnap = await userRef.collection('ledgers')
              .where('type', '==', 'GRANT')
              .where('status', '==', 'CONFIRMED')
              .get();

            const hasGrant = ledgersSnap.docs.length > 0;
            
            if (hasGrant) {
              console.log(`  ✅ ${email} (${uid}): Already has GRANT entry, skipping`);
              stats.skipped++;
              return;
            }

            if (dryRun) {
              console.log(`  🔍 [DRY RUN] Would create GRANT for: ${email} (${uid})`);
              console.log(`     Current balance: ${currentBalance}`);
              console.log(`     Would create: GRANT of ${LAUNCH_FIXED_CREDITS} credits`);
              stats.fixed++;
              return;
            }

            // Create GRANT ledger entry
            console.log(`  💰 Creating GRANT entry for ${email} (${uid})...`);
            const migrationGrantId = `LAUNCH_MIGRATION_GRANT_${uid}`;
            const grantResult = await creditsRepository.writeGrantIncrement(
              uid,
              migrationGrantId,
              LAUNCH_FIXED_CREDITS,
              'Launch plan migration grant (retroactive fix)',
              {
                planCode: LAUNCH_PLAN_CODE,
                migration: true,
                retroactive: true,
                timestamp: new Date().toISOString()
              }
            );

            if (grantResult === 'WRITTEN') {
              // Verify the balance was updated
              const updatedUser = await userRef.get();
              const newBalance = updatedUser.data()?.creditBalance || 0;
              
              console.log(`  ✅ Created GRANT entry: ${email} (${uid})`);
              console.log(`     Balance: ${currentBalance} → ${newBalance}`);
              stats.fixed++;
            } else {
              console.log(`  ⚠️  ${email} (${uid}): GRANT entry already exists (idempotent)`);
              stats.skipped++;
            }

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
    console.log(`   Total users: ${stats.totalUsers}`);
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
    console.log('Usage: npx ts-node scripts/fixMissingLaunchGrants.ts [--dry-run] [--limit=N]');
    console.log('\nOptions:');
    console.log('  --dry-run, -d    Run without making changes');
    console.log('  --limit=N         Process only first N users');
    console.log('  --help, -h        Show this help message');
    process.exit(0);
  }
}

// Run fix
fixMissingLaunchGrants({ dryRun, limit })
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Fix failed:', error);
    process.exit(1);
  });

