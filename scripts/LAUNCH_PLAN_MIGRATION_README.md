# Launch Plan Bulk Migration Script

## Overview

This script performs a **one-time bulk migration** to:
- ✅ Clear **all ledger entries** for every user
- ✅ Set all users to **LAUNCH_4000_FIXED** plan
- ✅ Set all users' credit balance to **4000 credits** (fixed, no daily reset)
- ✅ Mark `launchMigrationDone = true` to prevent re-migration

## Prerequisites

1. Ensure Firebase Admin SDK is configured in `.env`
2. Ensure the launch plan exists (it will be auto-created if missing)

## Usage

### 1. Dry Run (Test First!)

Test with a small number of users first:

```bash
cd api-gateway-services-wildmind
npx ts-node scripts/migrateAllUsersToLaunchPlan.ts --dry-run --limit=10
```

This will show you what would happen **without making any changes**.

### 2. Full Migration

Once you're confident, run the full migration:

```bash
npx ts-node scripts/migrateAllUsersToLaunchPlan.ts
```

### 3. Options

- `--dry-run` or `-d`: Run without making changes (recommended first!)
- `--limit=N`: Process only the first N users (useful for testing)
- `--help` or `-h`: Show help message

## What Gets Changed

### For Each User:
- ✅ **All ledger entries deleted** (clean slate)
- ✅ **planCode** → `LAUNCH_4000_FIXED`
- ✅ **creditBalance** → `4000`
- ✅ **launchMigrationDone** → `true`

### What Stays Unchanged:
- ✅ Generation history (images, videos, etc.)
- ✅ User profile data
- ✅ Authentication data
- ✅ All other user metadata

## Safety Features

1. **Idempotent**: Safe to re-run (skips already migrated users)
2. **Dry-run mode**: Test before applying changes
3. **Batch processing**: Processes 10 users at a time to avoid overwhelming Firestore
4. **Error handling**: Continues processing even if individual users fail
5. **Detailed logging**: Shows progress and errors for each user

## Test Credit Script Compatibility

The `grantTestCredits.ts` script **works perfectly** with the launch plan:

- ✅ It preserves the current plan code (won't change launch plan users)
- ✅ It adds credits on top of the current balance
- ✅ It works with any plan including `LAUNCH_4000_FIXED`

### Example: Grant test credits to a launch plan user

```bash
npx ts-node scripts/grantTestCredits.ts user@example.com 10000
```

This will:
- Keep the user on `LAUNCH_4000_FIXED` plan
- Add 10000 credits to their current balance (4000 → 14000)
- Create a proper ledger entry for the grant

## Migration Flow

```
1. Fetch all users from Firestore
2. For each user:
   a. Clear all ledger entries (batches of 500)
   b. Update user document:
      - planCode = LAUNCH_4000_FIXED
      - creditBalance = 4000
      - launchMigrationDone = true
3. Report summary (migrated, skipped, errors)
```

## Post-Migration

After migration:
- All users will have 4000 credits
- All users will be on the launch plan
- No daily reset will occur (fixed credits)
- Users can still receive test credits via `grantTestCredits.ts`

## Troubleshooting

### If migration fails for some users:
- Check the error details in the summary
- Re-run the script (it will skip already migrated users)
- Failed users can be manually migrated using the same logic

### If you need to rollback:
- The migration only affects Firestore `users` collection
- Generation history is untouched
- You can manually change plan codes back if needed

## Example Output

```
🚀 ==== Launch Plan Bulk Migration ====

📋 Strategy:
  - All users → LAUNCH_4000_FIXED plan
  - All users → 4000 credits (fixed, no daily reset)
  - Clear ALL ledger history for each user
  - Mark launchMigrationDone = true
  - Mode: LIVE
============================================================

📦 Ensuring launch plan exists...
✅ Launch plan ready

📥 Found 150 users to process

📦 Processing batch 1 (users 1-10)...
  🗑️  Clearing ledgers for user1@example.com (uid1)...
     ✅ Cleared 25 ledger entries
  🔄 Setting user1@example.com to launch plan...
  ✅ Migrated: user1@example.com (uid1)
     Plan: FREE → LAUNCH_4000_FIXED
     Balance: 1200 → 4000
     Ledgers cleared: 25
  ...

============================================================
📊 Migration Summary:
   Total users: 150
   ✅ Migrated: 148
   ⏭️  Skipped: 0
   ❌ Errors: 2
============================================================

✅ Migration complete!
```

