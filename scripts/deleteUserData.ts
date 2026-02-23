import { config } from 'dotenv';
config();
import { admin, adminDb } from '../src/config/firebaseAdmin';
import { s3, ZATA_BUCKET } from '../src/utils/storage/zataClient';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import axios from 'axios';
import { env } from '../src/config/env';

const inputIdentifier = process.argv[2];

if (!inputIdentifier) {
    console.error('Please provide a UID, Email, or Username to delete: ts-node scripts/deleteUserData.ts <identifier>');
    process.exit(1);
}

async function deleteUserZataFiles(username: string) {
    if (!username) {
        console.log(`\nSkipping Zata (S3) files deletion: No username provided.`);
        return;
    }
    console.log(`\nDeleting Zata (S3) files for username: ${username}...`);
    try {
        // We delete everything under the prefix users/<username>/
        const prefix = `users/${username}/`;
        let continuationToken: string | undefined = undefined;
        let totalDeleted = 0;

        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: ZATA_BUCKET,
                Prefix: prefix,
                ContinuationToken: continuationToken,
            });

            const listResponse: any = await s3.send(listCommand);

            if (!listResponse.Contents || listResponse.Contents.length === 0) {
                break;
            }

            const keysToDelete = (listResponse.Contents as any[])
                .filter((item: any) => item.Key !== undefined)
                .map((item: any) => ({ Key: item.Key as string }));

            // Delete in batches of 1000 (S3 API limit per request)
            for (let i = 0; i < keysToDelete.length; i += 1000) {
                const batch = keysToDelete.slice(i, i + 1000);
                await s3.send(new DeleteObjectsCommand({
                    Bucket: ZATA_BUCKET,
                    Delete: { Objects: batch }
                }));
                totalDeleted += batch.length;
            }

            continuationToken = listResponse.NextContinuationToken;
        } while (continuationToken);

        if (totalDeleted === 0) {
            console.log(`No Zata files found under prefix: ${prefix}`);
        } else {
            console.log(`Deleted ${totalDeleted} files from Zata under prefix: ${prefix}`);
        }
    } catch (error) {
        console.error('Failed to delete S3 files:', error);
    }
}

async function deleteFirestoreCollections(uid: string) {
    console.log(`\nDeleting Firestore collections for user ${uid}...`);

    // 1. Generation history items
    const itemsRef = adminDb.collection('generationHistory').doc(uid).collection('items');
    const items = await itemsRef.get();
    if (!items.empty) {
        const batch = adminDb.batch();
        let count = 0;
        items.forEach(doc => {
            batch.delete(doc.ref);
            count++;
        });
        // Committing a single batch (limit 500). If user has more, we should chunk, but this script is a starting point.
        // Chunking to handle > 500 documents:
        const docs = items.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const chunk = docs.slice(i, i + 500);
            const chunkBatch = adminDb.batch();
            chunk.forEach(doc => chunkBatch.delete(doc.ref));
            await chunkBatch.commit();
        }
        console.log(`Deleted ${docs.length} generation items.`);
    }

    // Delete the root document for generationHistory
    await adminDb.collection('generationHistory').doc(uid).delete();

    // 2. Characters
    const charRef = adminDb.collection('characters').doc(uid).collection('items');
    const chars = await charRef.get();
    if (!chars.empty) {
        const docs = chars.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const chunk = docs.slice(i, i + 500);
            const chunkBatch = adminDb.batch();
            chunk.forEach(doc => chunkBatch.delete(doc.ref));
            await chunkBatch.commit();
        }
        console.log(`Deleted ${docs.length} characters.`);
    }
    await adminDb.collection('characters').doc(uid).delete();

    // 3. User Audio
    const audioRef = adminDb.collection('userAudio').doc(uid).collection('items');
    const audio = await audioRef.get();
    if (!audio.empty) {
        const docs = audio.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const chunk = docs.slice(i, i + 500);
            const chunkBatch = adminDb.batch();
            chunk.forEach(doc => chunkBatch.delete(doc.ref));
            await chunkBatch.commit();
        }
        console.log(`Deleted ${docs.length} audio items.`);
    }
    await adminDb.collection('userAudio').doc(uid).delete();

    // 4. Engagement (Likes)
    const engagementRef = adminDb.collection('engagement').where('uid', '==', uid);
    const engagements = await engagementRef.get();
    if (!engagements.empty) {
        const docs = engagements.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const chunk = docs.slice(i, i + 500);
            const chunkBatch = adminDb.batch();
            chunk.forEach(doc => chunkBatch.delete(doc.ref));
            await chunkBatch.commit();
        }
        console.log(`Deleted ${docs.length} engagement records.`);
    }

    // 5. User Ledgers
    const ledgersRef = adminDb.collection('users').doc(uid).collection('ledgers');
    const ledgers = await ledgersRef.get();
    if (!ledgers.empty) {
        const docs = ledgers.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const chunk = docs.slice(i, i + 500);
            const chunkBatch = adminDb.batch();
            chunk.forEach(doc => chunkBatch.delete(doc.ref));
            await chunkBatch.commit();
        }
        console.log(`Deleted ${docs.length} ledger entries.`);
    }

    // 6. User Profile (Root user document)
    await adminDb.collection('users').doc(uid).delete().catch(() => { });
    console.log(`Deleted user profile document.`);
}

async function removePublicGenerations(uid: string) {
    console.log(`\nRemoving from public generations mirror...`);
    const publicSnap = await adminDb.collection('publicGenerations').where('uid', '==', uid).get();
    if (!publicSnap.empty) {
        const docs = publicSnap.docs;
        for (let i = 0; i < docs.length; i += 500) {
            const chunk = docs.slice(i, i + 500);
            const chunkBatch = adminDb.batch();
            chunk.forEach(doc => chunkBatch.delete(doc.ref));
            await chunkBatch.commit();
        }
        console.log(`Deleted ${docs.length} public generations.`);
    }
}

import { execSync } from 'child_process';
import path from 'path';

async function deleteFromCreditService(uid: string) {
    console.log(`\nCalling Credit Service script to wipe user data...`);
    try {
        const creditServiceDir = path.resolve(__dirname, '../../credit-service');
        console.log(`Executing deletion script in: ${creditServiceDir}`);
        const output = execSync(`npx ts-node delete-specific-user.ts ${uid}`, { cwd: creditServiceDir, encoding: 'utf-8' });
        console.log(output);
        console.log(`Successfully wiped user from credit-service postgres database.`);
    } catch (error: any) {
        console.warn(`Could not wipe from credit-service. Detailed Error Log:`);
        if (error.stdout) console.log(error.stdout);
        if (error.stderr) console.error(error.stderr);
        console.error(`Error Message:`, error.message);
    }
}

async function deleteFirebaseAuth(uid: string) {
    console.log(`\nDeleting Firebase Auth record...`);
    try {
        await admin.auth().deleteUser(uid);
        console.log(`Successfully deleted Firebase Auth user ${uid}.`);
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            console.log(`User ${uid} not found in Firebase Auth.`);
        } else {
            console.error('Failed to delete Firebase Auth user:', error);
        }
    }
}

async function fetchAndLogUserInfo(uid: string): Promise<string | null> {
    let username: string | null = null;
    let email: string = 'N/A';
    let name: string = 'N/A';

    try {
        const userRecord = await admin.auth().getUser(uid);
        email = userRecord.email || 'N/A';
        name = userRecord.displayName || 'N/A';
    } catch (error: any) {
        if (error.code === 'auth/user-not-found') {
            console.log(`\nUser Info: User ${uid} not found in Firebase Auth.`);
        } else {
            console.log(`\nCould not fetch user info for ${uid} from Auth:`, error.message);
        }
    }

    try {
        const userDoc = await adminDb.collection('users').doc(uid).get();
        if (userDoc.exists) {
            const data = userDoc.data();
            username = data?.username || null;
            if (email === 'N/A' && data?.email) email = data.email;
            if (name === 'N/A' && data?.displayName) name = data.displayName;
        }
    } catch (error: any) {
        console.log(`\nCould not fetch user info for ${uid} from Firestore:`, error.message);
    }

    console.log(`\nUser Info:`);
    console.log(`  - UID      : ${uid}`);
    console.log(`  - Username : ${username || 'N/A'}`);
    console.log(`  - Email    : ${email}`);
    console.log(`  - Name     : ${name}`);

    return username;
}

async function resolveUid(input: string): Promise<string | null> {
    console.log(`\nResolving identifier: ${input}...`);

    // 1. Is it an email?
    if (input.includes('@')) {
        try {
            const userRecord = await admin.auth().getUserByEmail(input);
            return userRecord.uid;
        } catch (e) { }

        // Fallback to firestore check if auth was deleted
        const usersByEmail = await adminDb.collection('users').where('email', '==', input).limit(1).get();
        if (!usersByEmail.empty) return usersByEmail.docs[0].id;

        return null;
    }

    // 2. Is it a Username? Look up in Firestore
    const usersByUsername = await adminDb.collection('users').where('username', '==', input).limit(1).get();
    if (!usersByUsername.empty) return usersByUsername.docs[0].id;

    // 3. Fallback: Assume it's a UID
    return input;
}

async function main() {
    const uid = await resolveUid(inputIdentifier);
    if (!uid) {
        console.error(`❌ Could not resolve "${inputIdentifier}" to a valid User ID.`);
        process.exit(1);
    }

    console.log(`\n===== Starting deletion process for UID: ${uid} =====`);

    // 0. Fetch and log basic user details
    const username = await fetchAndLogUserInfo(uid);

    // 1. Storage files first (before we lose the pointers in Firestore)
    await deleteUserZataFiles(username || '');

    // 2. Public Generation mirrors
    await removePublicGenerations(uid);

    // 3. Main Firestore collections
    await deleteFirestoreCollections(uid);

    // 4. Wipe from microservices
    await deleteFromCreditService(uid);

    // 5. Auth layer last
    await deleteFirebaseAuth(uid);

    console.log(`\n✅ Deletion process complete for ${uid}.`);
    process.exit(0);
}

main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
