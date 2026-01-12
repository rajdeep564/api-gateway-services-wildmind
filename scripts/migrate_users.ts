
import * as dotenv from 'dotenv';
dotenv.config();
import { admin } from '../src/config/firebaseAdmin';
import { creditServiceClient } from '../src/clients/creditServiceClient';

async function migrateUsers() {
    console.log('🚀 Starting User Migration to Credit Service...');
    
    let nextPageToken;
    let totalMigrated = 0;
    let errors = 0;

    try {
        do {
            const listUsersResult = await admin.auth().listUsers(100, nextPageToken);
            const users = listUsersResult.users;

            console.log(`Processing batch of ${users.length} users...`);

            const promises = users.map(async (user) => {
                if (!user.email) {
                    console.warn(`⚠️ User ${user.uid} has no email, skipping.`);
                    return;
                }

                try {
                    await creditServiceClient.initUser(user.uid, user.email);
                    // console.log(`✅ Migrated: ${user.email} (${user.uid})`);
                } catch (err: any) {
                    console.error(`❌ Failed to migrate ${user.email}:`, err.message);
                    errors++;
                }
            });

            await Promise.all(promises);
            totalMigrated += users.length;
            nextPageToken = listUsersResult.pageToken;

        } while (nextPageToken);

        console.log('\n✨ MIGRATION COMPLETE');
        console.log(`✅ Total Users Processed: ${totalMigrated}`);
        console.log(`❌ Errors: ${errors}`);

    } catch (error) {
        console.error('Fatal Migration Error:', error);
    }
}

migrateUsers()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
