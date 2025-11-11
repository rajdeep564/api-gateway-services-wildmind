import { adminDb } from '../config/firebase';
import { logger } from '../utils/logger';

export interface CharacterDoc {
  uid: string;
  characterName: string;
  historyId: string;
  frontImageUrl: string;
  frontImageStoragePath?: string;
  leftImageUrl?: string;
  leftImageStoragePath?: string;
  rightImageUrl?: string;
  rightImageStoragePath?: string;
  createdAt: FirebaseFirestore.FieldValue | Date;
  updatedAt: FirebaseFirestore.FieldValue | Date;
}

export async function createCharacter(
  uid: string,
  data: {
    characterName: string;
    historyId: string;
    frontImageUrl: string;
    frontImageStoragePath?: string;
    leftImageUrl?: string;
    leftImageStoragePath?: string;
    rightImageUrl?: string;
    rightImageStoragePath?: string;
  }
): Promise<{ characterId: string }> {
  try {
    const col = adminDb.collection('users').doc(uid).collection('characters');
    const docRef = await col.add({
      uid,
      characterName: data.characterName,
      historyId: data.historyId,
      frontImageUrl: data.frontImageUrl,
      frontImageStoragePath: data.frontImageStoragePath || null,
      leftImageUrl: data.leftImageUrl || null,
      leftImageStoragePath: data.leftImageStoragePath || null,
      rightImageUrl: data.rightImageUrl || null,
      rightImageStoragePath: data.rightImageStoragePath || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    } as CharacterDoc);
    
    logger.info({ uid, characterId: docRef.id, characterName: data.characterName }, '[Character] Character created');
    return { characterId: docRef.id };
  } catch (err: any) {
    logger.error({ uid, err }, '[Character] Failed to create character');
    throw err;
  }
}

export async function getCharacter(uid: string, characterId: string): Promise<CharacterDoc | null> {
  try {
    const doc = await adminDb.collection('users').doc(uid).collection('characters').doc(characterId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() } as any as CharacterDoc;
  } catch (err: any) {
    logger.error({ uid, characterId, err }, '[Character] Failed to get character');
    return null;
  }
}

export async function listCharacters(uid: string, limit: number = 50): Promise<Array<{ id: string; data: CharacterDoc }>> {
  try {
    const snap = await adminDb
      .collection('users')
      .doc(uid)
      .collection('characters')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    
    return snap.docs.map((d) => ({ id: d.id, data: d.data() as CharacterDoc }));
  } catch (err: any) {
    logger.error({ uid, err }, '[Character] Failed to list characters');
    return [];
  }
}

export const characterRepository = {
  createCharacter,
  getCharacter,
  listCharacters,
};

