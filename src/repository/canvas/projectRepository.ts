import { adminDb, admin } from '../../config/firebaseAdmin';
import { CanvasProject, CanvasSnapshot } from '../../types/canvas';

export async function createProject(
  ownerUid: string,
  data: {
    name: string;
    description?: string;
    settings?: CanvasProject['settings'];
  }
): Promise<CanvasProject> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowTimestamp = admin.firestore.Timestamp.now(); // Use actual Timestamp for arrays
  const projectRef = adminDb.collection('canvasProjects').doc();

  // Build project object, excluding undefined values
  // Note: FieldValue.serverTimestamp() cannot be used inside arrays, so we use Timestamp.now() for collaborators
  const projectData: any = {
    id: projectRef.id,
    name: data.name,
    ownerUid,
    collaborators: [{
      uid: ownerUid,
      role: 'owner',
      addedAt: nowTimestamp, // Use actual Timestamp, not FieldValue
    }],
    settings: data.settings || {},
    createdAt: now as any,
    updatedAt: now as any,
  };

  // Only include description if it's provided (not undefined)
  if (data.description !== undefined && data.description !== null) {
    projectData.description = data.description;
  }

  await projectRef.set(projectData);

  // Return with proper typing - read back to get actual timestamps
  const created = await projectRef.get();
  const createdData = created.data();

  const project: CanvasProject = {
    id: created.id,
    name: createdData?.name || data.name,
    description: data.description,
    ownerUid,
    collaborators: createdData?.collaborators || [{
      uid: ownerUid,
      role: 'owner',
      addedAt: nowTimestamp as any,
    }],
    settings: createdData?.settings || {},
    createdAt: createdData?.createdAt || nowTimestamp as any,
    updatedAt: createdData?.updatedAt || nowTimestamp as any,
  };
  return project;
}

export async function getProject(projectId: string): Promise<CanvasProject | null> {
  const projectRef = adminDb.collection('canvasProjects').doc(projectId);
  const snap = await projectRef.get();

  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as CanvasProject;
}

export async function updateProject(
  projectId: string,
  updates: Partial<CanvasProject>
): Promise<CanvasProject> {
  const projectRef = adminDb.collection('canvasProjects').doc(projectId);
  await projectRef.update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const updated = await projectRef.get();
  return { id: updated.id, ...updated.data() } as CanvasProject;
}

export async function deleteProject(projectId: string): Promise<void> {
  const projectRef = adminDb.collection('canvasProjects').doc(projectId);

  // Delete all subcollections (snapshots) - Firestore requires manual deletion of subcollections
  // For now, we'll just delete the main document. A cloud function would be better for cleanup.
  // Or we can list and delete snapshots here if not too many.
  const snapshotsRef = projectRef.collection('snapshots');
  const snapshots = await snapshotsRef.get();

  const batch = adminDb.batch();
  snapshots.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  batch.delete(projectRef);

  await batch.commit();
}

export async function addCollaborator(
  projectId: string,
  uid: string,
  role: 'owner' | 'editor' | 'viewer'
): Promise<void> {
  const projectRef = adminDb.collection('canvasProjects').doc(projectId);
  const project = await getProject(projectId);

  if (!project) throw new Error('Project not found');

  // Use actual Timestamp for arrays (FieldValue.serverTimestamp() cannot be used in arrays)
  const collaborator = {
    uid,
    role,
    addedAt: admin.firestore.Timestamp.now(),
  };

  const existingIndex = project.collaborators.findIndex(c => c.uid === uid);
  if (existingIndex >= 0) {
    // Update existing collaborator
    const collaborators = [...project.collaborators];
    collaborators[existingIndex] = collaborator as any;
    await projectRef.update({ collaborators });
  } else {
    // Add new collaborator
    await projectRef.update({
      collaborators: admin.firestore.FieldValue.arrayUnion(collaborator as any),
    });
  }
}

export async function saveSnapshot(
  projectId: string,
  snapshot: CanvasSnapshot,
  snapshotOpIndex: number
): Promise<void> {
  const batch = adminDb.batch();

  // Save snapshot
  const snapshotRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('snapshots')
    .doc(snapshotOpIndex.toString());
  batch.set(snapshotRef, snapshot);

  // Update project with snapshot info
  const projectRef = adminDb.collection('canvasProjects').doc(projectId);
  batch.update(projectRef, {
    lastSnapshotOpIndex: snapshotOpIndex,
    lastSnapshotAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

// Overwrite-style snapshot (no op index). Stored under a fixed doc id 'current'.
export async function saveCurrentSnapshot(
  projectId: string,
  snapshot: Omit<CanvasSnapshot, 'snapshotOpIndex'> & { snapshotOpIndex?: number }
): Promise<void> {
  const batch = adminDb.batch();

  const snapshotRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('snapshots')
    .doc('current');
  // Ensure a numeric field exists for compatibility, but not used
  const toSave: CanvasSnapshot = {
    projectId,
    snapshotOpIndex: typeof snapshot.snapshotOpIndex === 'number' ? snapshot.snapshotOpIndex : -1,
    elements: snapshot.elements as any,
    metadata: snapshot.metadata as any,
  };
  batch.set(snapshotRef, toSave);

  const projectRef = adminDb.collection('canvasProjects').doc(projectId);
  batch.update(projectRef, {
    lastSnapshotAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

export async function getSnapshot(
  projectId: string,
  snapshotOpIndex: number
): Promise<CanvasSnapshot | null> {
  const snapshotRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('snapshots')
    .doc(snapshotOpIndex.toString());

  const snap = await snapshotRef.get();
  if (!snap.exists) return null;

  return snap.data() as CanvasSnapshot;
}

export async function getLatestSnapshot(projectId: string): Promise<CanvasSnapshot | null> {
  const project = await getProject(projectId);
  if (!project || !project.lastSnapshotOpIndex) return null;

  return getSnapshot(projectId, project.lastSnapshotOpIndex);
}

export async function getCurrentSnapshot(projectId: string): Promise<CanvasSnapshot | null> {
  const snapshotRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('snapshots')
    .doc('current');
  const snap = await snapshotRef.get();
  if (!snap.exists) return null;
  return snap.data() as CanvasSnapshot;
}

export async function listUserProjects(uid: string, limit: number = 20): Promise<CanvasProject[]> {
  const projectsRef = adminDb.collection('canvasProjects');

  try {
    // Query projects where user is owner, ordered by updatedAt
    // Note: This requires a composite index: ownerUid (ascending) + updatedAt (descending)
    // If index doesn't exist, Firestore will throw an error with a link to create it
    const ownerQuery = projectsRef
      .where('ownerUid', '==', uid)
      .orderBy('updatedAt', 'desc')
      .limit(limit);

    const ownerSnap = await ownerQuery.get();
    const ownerProjects = ownerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasProject));

    // Also get projects where user is a collaborator
    // Note: Firestore doesn't support querying array-contains on nested fields easily
    // So we'll get owner projects and filter client-side, or use a separate query
    // For now, return owner projects. Can be enhanced later with composite queries

    return ownerProjects;
  } catch (error: any) {
    // If composite index error, fallback to simple query without orderBy
    if (error.message?.includes('index')) {
      console.warn('Composite index not found, using simple query:', error.message);
      const ownerQuery = projectsRef
        .where('ownerUid', '==', uid)
        .limit(limit);

      const ownerSnap = await ownerQuery.get();
      const ownerProjects = ownerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasProject));

      // Sort client-side by updatedAt
      ownerProjects.sort((a, b) => {
        const aTime = a.updatedAt?.toMillis?.() || 0;
        const bTime = b.updatedAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

      return ownerProjects.slice(0, limit);
    }
    throw error;
  }
}

export const projectRepository = {
  createProject,
  getProject,
  updateProject,
  addCollaborator,
  saveSnapshot,
  saveCurrentSnapshot,
  getSnapshot,
  getLatestSnapshot,
  getCurrentSnapshot,
  listUserProjects,
  deleteProject,
};

