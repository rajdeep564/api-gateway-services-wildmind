#!/usr/bin/env node

/**
 * Quick Migration Runner
 * 
 * This is a simplified wrapper for the image optimization migration.
 * 
 * Usage:
 *   node scripts/runMigration.js [options]
 * 
 * Examples:
 *   node scripts/runMigration.js                    # Run with defaults
 *   node scripts/runMigration.js --dry-run          # Preview only
 *   node scripts/runMigration.js --batch-size=5     # Smaller batches
 */

require('dotenv').config();

const { execSync } = require('child_process');
const args = process.argv.slice(2).join(' ');

console.log('\n🚀 Starting Image Optimization Migration\n');

try {
  // Run the TypeScript migration script
  execSync(`npx ts-node scripts/migrateImageOptimization.ts ${args}`, {
    stdio: 'inherit',
    env: process.env,
  });
} catch (error) {
  console.error('\n❌ Migration failed. Check the error above.\n');
  process.exit(1);
}
