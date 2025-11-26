import { adminDb, admin } from '../config/firebaseAdmin';
import { logger } from '../utils/logger';

export interface UserAudioDoc {
  uid: string;
  fileName: string;
  url: string;
  storagePath: string;
  createdAt: FirebaseFirestore.FieldValue | Date;
  updatedAt: FirebaseFirestore.FieldValue | Date;
}

/**
 * Create a new user audio file entry
 */
export async function createUserAudio(
  uid: string,
  data: {
    fileName: string;
    url: string;
    storagePath: string;
  }
): Promise<{ audioId: string }> {
  try {
    const col = adminDb.collection('users').doc(uid).collection('audioFiles');
    const docRef = await col.add({
      uid,
      fileName: data.fileName,
      url: data.url,
      storagePath: data.storagePath,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } as UserAudioDoc);
    
    logger.info({ uid, audioId: docRef.id, fileName: data.fileName }, '[UserAudio] Audio file created');
    return { audioId: docRef.id };
  } catch (err: any) {
    logger.error({ uid, err }, '[UserAudio] Failed to create audio file');
    throw err;
  }
}

/**
 * Check if a file name already exists for a user
 */
export async function checkFileNameExists(uid: string, fileName: string): Promise<boolean> {
  try {
    const col = adminDb.collection('users').doc(uid).collection('audioFiles');
    const snapshot = await col
      .where('fileName', '==', fileName)
      .limit(1)
      .get();
    
    return !snapshot.empty;
  } catch (err: any) {
    logger.error({ uid, fileName, err }, '[UserAudio] Failed to check file name existence');
    throw err;
  }
}

/**
 * Get all audio files for a user
 */
export async function getUserAudioFiles(uid: string): Promise<UserAudioDoc[]> {
  try {
    const col = adminDb.collection('users').doc(uid).collection('audioFiles');
    const snapshot = await col
      .orderBy('createdAt', 'desc')
      .get();
    
    const audioFiles: UserAudioDoc[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as UserAudioDoc;
      audioFiles.push({
        ...data,
        id: doc.id,
      } as any);
    });
    
    logger.info({ uid, count: audioFiles.length }, '[UserAudio] Retrieved audio files');
    return audioFiles;
  } catch (err: any) {
    logger.error({ uid, err }, '[UserAudio] Failed to get audio files');
    throw err;
  }
}

/**
 * Delete a user audio file
 */
export async function deleteUserAudio(uid: string, audioId: string): Promise<void> {
  try {
    const docRef = adminDb.collection('users').doc(uid).collection('audioFiles').doc(audioId);
    await docRef.delete();
    
    logger.info({ uid, audioId }, '[UserAudio] Audio file deleted');
  } catch (err: any) {
    logger.error({ uid, audioId, err }, '[UserAudio] Failed to delete audio file');
    throw err;
  }
}

/**
 * Get a specific audio file by ID
 */
export async function getUserAudioById(uid: string, audioId: string): Promise<(UserAudioDoc & { id: string }) | null> {
  try {
    const docRef = adminDb.collection('users').doc(uid).collection('audioFiles').doc(audioId);
    const snapshot = await docRef.get();
    
    if (!snapshot.exists) {
      return null;
    }
    
    const data = snapshot.data() as UserAudioDoc;
    return {
      ...data,
      id: snapshot.id,
    } as any;
  } catch (err: any) {
    logger.error({ uid, audioId, err }, '[UserAudio] Failed to get audio file by ID');
    throw err;
  }
}

export const userAudioRepository = {
  createUserAudio,
  getUserAudioFiles,
  deleteUserAudio,
  getUserAudioById,
  checkFileNameExists,
};

