import { adminDb } from '../config/firebaseAdmin';
import { AppUser } from '../types/authTypes';

export async function migrateUidToUsername() {
  console.log('Starting migration: UID documents → Username documents...');
  
  const usersCol = adminDb.collection('users');
  const allDocs = await usersCol.get();
  
  for (const doc of allDocs.docs) {
    const docId = doc.id;
    const userData = doc.data() as AppUser;
    
    // Check if this is a UID document (long random string) vs username document
    const isUidDoc = docId.length > 20 && /^[A-Za-z0-9]+$/.test(docId);
    
    if (isUidDoc && userData.username) {
      console.log(`Migrating UID ${docId} → username ${userData.username}`);
      
      // Create/update username document with all data from UID document
      const usernameRef = usersCol.doc(userData.username);
      const usernameSnap = await usernameRef.get();
      
      if (!usernameSnap.exists) {
        // Copy all data to username document (remove uid field)
        const { uid, ...userDataWithoutUid } = userData;
        await usernameRef.set(userDataWithoutUid);
        console.log(`✓ Created username document: ${userData.username}`);
      } else {
        // Merge data if username document already exists
        const existing = usernameSnap.data() as AppUser;
        const merged = {
          ...existing,
          ...userData,
          lastLoginAt: userData.lastLoginAt || existing.lastLoginAt
        };
        const { uid, ...mergedWithoutUid } = merged;
        await usernameRef.set(mergedWithoutUid);
        console.log(`✓ Merged into existing username document: ${userData.username}`);
      }
      
      // Delete the old UID document
      await doc.ref.delete();
      console.log(`✓ Deleted UID document: ${docId}`);
    }
  }
  
  console.log('Migration completed!');
}
