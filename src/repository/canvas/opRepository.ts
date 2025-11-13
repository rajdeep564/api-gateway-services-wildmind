import { adminDb, admin } from '../../config/firebaseAdmin';
import { CanvasOp } from '../../types/canvas';

export async function appendOp(
  projectId: string,
  op: Omit<CanvasOp, 'id' | 'opIndex' | 'createdAt'>
): Promise<{ opId: string; opIndex: number }> {
  return adminDb.runTransaction(async (transaction) => {
    // Get or create counter
    const counterRef = adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('counters')
      .doc('opIndex');
    
    const counterSnap = await transaction.get(counterRef);
    let opIndex: number;
    
    if (!counterSnap.exists) {
      opIndex = 0;
      transaction.set(counterRef, { value: 1 });
    } else {
      const currentValue = counterSnap.data()?.value || 0;
      opIndex = currentValue;
      transaction.update(counterRef, { value: admin.firestore.FieldValue.increment(1) });
    }

    // Create op document
    const opRef = adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('ops')
      .doc();
    
    const opDoc = {
      id: opRef.id,
      projectId,
      opIndex,
      type: op.type,
      elementId: op.elementId,
      elementIds: op.elementIds,
      data: op.data,
      inverse: op.inverse,
      actorUid: op.actorUid,
      requestId: op.requestId,
      clientTs: op.clientTs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    } as any;

    transaction.set(opRef, opDoc);

    return { opId: opRef.id, opIndex };
  });
}

export async function listOps(
  projectId: string,
  fromIndex: number,
  limit: number = 100
): Promise<CanvasOp[]> {
  const opsRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('ops');
  
  const query = opsRef
    .where('opIndex', '>=', fromIndex)
    .orderBy('opIndex', 'asc')
    .limit(limit);
  
  const snap = await query.get();
  return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasOp));
}

export async function getOp(projectId: string, opId: string): Promise<CanvasOp | null> {
  const opRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('ops')
    .doc(opId);
  
  const snap = await opRef.get();
  if (!snap.exists) return null;
  
  return { id: snap.id, ...snap.data() } as CanvasOp;
}

export async function getOpsByRequestId(
  projectId: string,
  requestId: string
): Promise<CanvasOp | null> {
  const opsRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('ops');
  
  const query = opsRef.where('requestId', '==', requestId).limit(1);
  const snap = await query.get();
  
  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() } as CanvasOp;
}

export const opRepository = {
  appendOp,
  listOps,
  getOp,
  getOpsByRequestId,
};

