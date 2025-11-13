import { adminDb, admin } from '../config/firebaseAdmin';

/**
 * Generation Stats Repository
 * 
 * Maintains denormalized counters per user for fast totalCount queries.
 * Document path: generationStats/{uid}
 * 
 * Structure:
 * {
 *   total: number,
 *   byStatus: { generating: number, completed: number, failed: number },
 *   byType: { 'text-to-image': number, 'text-to-video': number, ... },
 *   updatedAt: timestamp
 * }
 */

export interface GenerationStats {
  total: number;
  byStatus: {
    generating: number;
    completed: number;
    failed: number;
  };
  byType: Record<string, number>;
  updatedAt: FirebaseFirestore.Timestamp;
}

/**
 * Initialize stats document for a user if it doesn't exist.
 */
export async function initializeStats(uid: string): Promise<void> {
  const ref = adminDb.collection('generationStats').doc(uid);
  await ref.set({
    total: 0,
    byStatus: { generating: 0, completed: 0, failed: 0 },
    byType: {},
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Increment counters for a new generation.
 */
export async function incrementOnCreate(uid: string, generationType: string): Promise<void> {
  const ref = adminDb.collection('generationStats').doc(uid);
  await ref.set({
    total: admin.firestore.FieldValue.increment(1),
    byStatus: { generating: admin.firestore.FieldValue.increment(1) } as any,
    [`byType.${generationType}`]: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Update counters when status changes (e.g., generating -> completed).
 */
export async function updateOnStatusChange(
  uid: string,
  oldStatus: 'generating' | 'completed' | 'failed',
  newStatus: 'generating' | 'completed' | 'failed'
): Promise<void> {
  if (oldStatus === newStatus) return;
  
  const ref = adminDb.collection('generationStats').doc(uid);
  await ref.set({
    byStatus: {
      [oldStatus]: admin.firestore.FieldValue.increment(-1),
      [newStatus]: admin.firestore.FieldValue.increment(1),
    } as any,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Decrement counters on soft delete.
 */
export async function decrementOnDelete(uid: string, status: string, generationType: string): Promise<void> {
  const ref = adminDb.collection('generationStats').doc(uid);
  await ref.set({
    total: admin.firestore.FieldValue.increment(-1),
    [`byStatus.${status}`]: admin.firestore.FieldValue.increment(-1),
    [`byType.${generationType}`]: admin.firestore.FieldValue.increment(-1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

/**
 * Get stats for a user.
 */
export async function getStats(uid: string): Promise<GenerationStats | null> {
  const ref = adminDb.collection('generationStats').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  return snap.data() as GenerationStats;
}

/**
 * Get total count (with optional filters).
 */
export async function getTotalCount(uid: string, filters?: {
  status?: 'generating' | 'completed' | 'failed';
  generationType?: string;
}): Promise<number> {
  const stats = await getStats(uid);
  if (!stats) return 0;
  
  if (filters?.status && filters?.generationType) {
    // Can't provide both filters with this simple counter structure
    // Fallback to status filter only
    return stats.byStatus[filters.status] || 0;
  }
  
  if (filters?.status) {
    return stats.byStatus[filters.status] || 0;
  }
  
  if (filters?.generationType) {
    return stats.byType[filters.generationType] || 0;
  }
  
  return stats.total;
}

export const generationStatsRepository = {
  initializeStats,
  incrementOnCreate,
  updateOnStatusChange,
  decrementOnDelete,
  getStats,
  getTotalCount,
};
