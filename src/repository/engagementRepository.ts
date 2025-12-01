import { admin, adminDb } from '../config/firebaseAdmin';

type EngagementType = 'like' | 'bookmark';

interface BulkStatusItem {
  id: string;
  likesCount: number;
  bookmarksCount: number;
  likedByCurrentUser: boolean;
  bookmarkedByCurrentUser: boolean;
}

const COLLECTION_LIKES = 'generationLikes';
const COLLECTION_BOOKMARKS = 'generationBookmarks';
const COLLECTION_USER_ENGAGEMENT = 'userEngagement';
const COLLECTION_NOTIFICATIONS = 'notifications';
const COLLECTION_USER_DEVICES = 'userDevices';

function getEngagementCollections(type: EngagementType) {
  const colName = type === 'like' ? COLLECTION_LIKES : COLLECTION_BOOKMARKS;
  return {
    root: adminDb.collection(colName),
  };
}

export async function toggleEngagement(
  type: EngagementType,
  uid: string,
  generationId: string,
  action: 'add' | 'remove'
): Promise<void> {
  const { root } = getEngagementCollections(type);
  const docRef = root.doc(generationId);
  const userRef = docRef.collection('users').doc(uid);
  const userEngagementRef = adminDb
    .collection(COLLECTION_USER_ENGAGEMENT)
    .doc(uid)
    .collection(type === 'like' ? 'likes' : 'bookmarks')
    .doc(generationId);

  await adminDb.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    const exists = userSnap.exists;

    if (action === 'add') {
      if (!exists) {
        tx.set(userRef, { createdAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        tx.set(
          docRef,
          {
            [`${type}sCount`]: admin.firestore.FieldValue.increment(1),
          },
          { merge: true }
        );
        tx.set(
          userEngagementRef,
          {
            generationId,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } else {
      if (exists) {
        tx.delete(userRef);
        tx.set(
          docRef,
          {
            [`${type}sCount`]: admin.firestore.FieldValue.increment(-1),
          },
          { merge: true }
        );
        tx.delete(userEngagementRef);
      }
    }
  });

  // After the engagement transaction, create a lightweight notification
  // for the generation owner (if someone else liked/bookmarked it).
  try {
    if (action === 'add') {
      await createEngagementNotification(type, uid, generationId);
    }
  } catch (err) {
    // Non-fatal: logging only, engagement succeeded
    console.warn('[engagementRepository] Failed to create engagement notification', {
      type,
      uid,
      generationId,
      error: (err as any)?.message || err,
    });
  }
}

async function createEngagementNotification(
  type: EngagementType,
  actorUid: string,
  generationId: string
): Promise<void> {
  // Look up the actor to get a nice display name / username for the notification
  let actorDisplayName: string | undefined;
  let actorUsername: string | undefined;
  try {
    const actorSnap = await adminDb.collection('users').doc(actorUid).get();
    if (actorSnap.exists) {
      const actorData = actorSnap.data() as any;
      actorDisplayName =
        actorData?.displayName ||
        actorData?.username ||
        actorData?.email ||
        undefined;
      actorUsername = actorData?.username || undefined;
    }
  } catch (e) {
    console.warn('[engagementRepository] Failed to fetch actor user for notification', {
      actorUid,
      error: (e as any)?.message || e,
    });
  }

  // Look up the generation to find the owner/creator
  const genRef = adminDb.collection('generations').doc(generationId);
  const genSnap = await genRef.get();
  if (!genSnap.exists) return;

  const data = genSnap.data() as any;
  const ownerUid: string | undefined = data?.createdBy?.uid || data?.uid;

  // Skip if we can't determine an owner or the actor is the owner
  if (!ownerUid || ownerUid === actorUid) return;

  const notifRef = adminDb
    .collection(COLLECTION_NOTIFICATIONS)
    .doc(ownerUid)
    .collection('items')
    .doc();
  const payload: any = {
    type,
    generationId,
    actorUid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    read: false,
  };
  if (actorDisplayName) {
    payload.actorDisplayName = actorDisplayName;
  }
  if (actorUsername) {
    payload.actorUsername = actorUsername;
  }

  await notifRef.set(payload);

  // Also attempt to send an FCM push notification to the owner's devices (web/mobile)
  // This is best-effort and non-blocking for the main engagement flow.
  try {
    const devicesSnap = await adminDb
      .collection(COLLECTION_USER_DEVICES)
      .doc(ownerUid)
      .collection('tokens')
      .get();

    if (devicesSnap.empty) {
      return;
    }

    const tokens: string[] = [];
    devicesSnap.forEach((doc) => {
      const d = doc.data() as any;
      const token = d?.token;
      if (typeof token === 'string' && token.trim().length > 0) {
        tokens.push(token.trim());
      }
    });

    if (!tokens.length) return;

    const actorLabel = actorDisplayName || actorUsername || 'Someone';

    const title =
      type === 'like'
        ? `${actorLabel} liked your generation`
        : `${actorLabel} bookmarked your generation`;

    const body =
      type === 'like'
        ? 'Your public generation just received a new like.'
        : 'Your public generation was saved by a user.';

    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: {
        title,
        body,
      },
      data: {
        type,
        generationId,
        actorUid,
        actorDisplayName: actorDisplayName || '',
        actorUsername: actorUsername || '',
      },
    });

    console.log('[engagementRepository] Sent FCM push notification', {
      ownerUid,
      type,
      generationId,
      tokensCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
    });
  } catch (err) {
    console.warn('[engagementRepository] Failed to send FCM push for engagement notification', {
      type,
      actorUid,
      generationId,
      error: (err as any)?.message || err,
    });
  }
}

export async function getBulkStatus(
  uid: string,
  generationIds: string[]
): Promise<BulkStatusItem[]> {
  if (!generationIds.length) return [];

  const likeRoot = adminDb.collection(COLLECTION_LIKES);
  const bookmarkRoot = adminDb.collection(COLLECTION_BOOKMARKS);

  const likeDocRefs = generationIds.map((id) => likeRoot.doc(id));
  const bookmarkDocRefs = generationIds.map((id) => bookmarkRoot.doc(id));

  const likeUserRefs = generationIds.map((id) => likeRoot.doc(id).collection('users').doc(uid));
  const bookmarkUserRefs = generationIds.map((id) => bookmarkRoot.doc(id).collection('users').doc(uid));

  const [likeDocs, bookmarkDocs, likeUserDocs, bookmarkUserDocs] = await Promise.all([
    adminDb.getAll(...likeDocRefs),
    adminDb.getAll(...bookmarkDocRefs),
    adminDb.getAll(...likeUserRefs),
    adminDb.getAll(...bookmarkUserRefs),
  ]);

  const result: BulkStatusItem[] = [];

  generationIds.forEach((id, index) => {
    const likeDoc = likeDocs[index];
    const bookmarkDoc = bookmarkDocs[index];
    const likeUserDoc = likeUserDocs[index];
    const bookmarkUserDoc = bookmarkUserDocs[index];

    const likesCount = (likeDoc?.exists && (likeDoc.data() as any)?.likesCount) || 0;
    const bookmarksCount = (bookmarkDoc?.exists && (bookmarkDoc.data() as any)?.bookmarksCount) || 0;

    result.push({
      id,
      likesCount,
      bookmarksCount,
      likedByCurrentUser: !!likeUserDoc?.exists,
      bookmarkedByCurrentUser: !!bookmarkUserDoc?.exists,
    });
  });

  return result;
}

export async function listUserEngagement(
  type: EngagementType,
  uid: string,
  limit: number,
  cursor?: string
): Promise<{ items: { generationId: string; createdAt: any }[]; nextCursor?: string }> {
  const colRef = adminDb
    .collection(COLLECTION_USER_ENGAGEMENT)
    .doc(uid)
    .collection(type === 'like' ? 'likes' : 'bookmarks');

  const col = colRef.orderBy('createdAt', 'desc');

  let q: FirebaseFirestore.Query = col;
  if (cursor) {
    const cursorSnap = await colRef.doc(cursor).get();
    if (cursorSnap.exists) {
      q = q.startAfter(cursorSnap);
    }
  }

  const snap = await q.limit(limit).get();
  const items: { generationId: string; createdAt: any }[] = [];

  snap.forEach((doc) => {
    const data = doc.data() as any;
    items.push({
      generationId: data.generationId || doc.id,
      createdAt: data.createdAt,
    });
  });

  let nextCursor: string | undefined;
  if (snap.docs.length === limit) {
    nextCursor = snap.docs[snap.docs.length - 1].id;
  }

  return { items, nextCursor };
}

export const engagementRepository = {
  toggleEngagement,
  getBulkStatus,
  listUserEngagement,
};


