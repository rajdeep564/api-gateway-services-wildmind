import { adminDb, admin } from '../../config/firebaseAdmin';
import { CanvasProject, CanvasSnapshot, CanvasInvitation } from '../../types/canvas';

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
    collaboratorUids: [ownerUid],
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
    collaboratorUids: createdData?.collaboratorUids || [ownerUid],
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
  const project = { id: snap.id, ...snap.data() } as CanvasProject;
  return ensureProjectThumbnail(project);
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
  const invitationsRef = adminDb.collection('canvasInvitations');
  const invitations = await invitationsRef
    .where('projectId', '==', projectId)
    .get();

  const batch = adminDb.batch();
  snapshots.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  invitations.docs.forEach(doc => {
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
    await projectRef.update({
      collaborators,
      collaboratorUids: admin.firestore.FieldValue.arrayUnion(uid),
    });
  } else {
    // Add new collaborator
    await projectRef.update({
      collaborators: admin.firestore.FieldValue.arrayUnion(collaborator as any),
      collaboratorUids: admin.firestore.FieldValue.arrayUnion(uid),
    });
  }
}

export async function removeCollaborator(
  projectId: string,
  uid: string
): Promise<void> {
  const projectRef = adminDb.collection('canvasProjects').doc(projectId);
  const project = await getProject(projectId);

  if (!project) throw new Error('Project not found');

  const collaborators = project.collaborators.filter((collaborator) => collaborator.uid !== uid);
  const collaboratorUids = collaborators.map((collaborator) => collaborator.uid);

  await projectRef.update({
    collaborators,
    collaboratorUids,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

export async function createInvitation(
  invitation: Omit<CanvasInvitation, 'id' | 'createdAt' | 'updatedAt' | 'status'> & { status?: CanvasInvitation['status'] }
): Promise<CanvasInvitation> {
  const invitationRef = adminDb.collection('canvasInvitations').doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  const status = invitation.status || 'pending';

  await invitationRef.set({
    ...invitation,
    status,
    createdAt: now,
    updatedAt: now,
  });

  const created = await invitationRef.get();
  return { id: created.id, ...created.data() } as CanvasInvitation;
}

export async function getInvitation(invitationId: string): Promise<CanvasInvitation | null> {
  const invitationRef = adminDb.collection('canvasInvitations').doc(invitationId);
  const snap = await invitationRef.get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data() } as CanvasInvitation;
}

export async function findPendingInvitation(projectId: string, recipientUid: string): Promise<CanvasInvitation | null> {
  const snap = await adminDb
    .collection('canvasInvitations')
    .where('projectId', '==', projectId)
    .where('recipientUid', '==', recipientUid)
    .where('status', '==', 'pending')
    .limit(1)
    .get();

  if (snap.empty) return null;
  const doc = snap.docs[0];
  return { id: doc.id, ...doc.data() } as CanvasInvitation;
}

export async function updateInvitation(
  invitationId: string,
  updates: Partial<CanvasInvitation>
): Promise<CanvasInvitation> {
  const invitationRef = adminDb.collection('canvasInvitations').doc(invitationId);
  await invitationRef.update({
    ...updates,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const updated = await invitationRef.get();
  return { id: updated.id, ...updated.data() } as CanvasInvitation;
}

export async function listInvitationsForRecipient(recipientUid: string): Promise<CanvasInvitation[]> {
  const invitationsRef = adminDb.collection('canvasInvitations');

  try {
    const snap = await invitationsRef
      .where('recipientUid', '==', recipientUid)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as CanvasInvitation));
  } catch (error: any) {
    if (error.message?.includes('index')) {
      const snap = await invitationsRef
        .where('recipientUid', '==', recipientUid)
        .get();
      return snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as CanvasInvitation))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    }
    throw error;
  }
}

export async function listInvitationsForSender(senderUid: string): Promise<CanvasInvitation[]> {
  const invitationsRef = adminDb.collection('canvasInvitations');

  try {
    const snap = await invitationsRef
      .where('senderUid', '==', senderUid)
      .orderBy('createdAt', 'desc')
      .get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() } as CanvasInvitation));
  } catch (error: any) {
    if (error.message?.includes('index')) {
      const snap = await invitationsRef
        .where('senderUid', '==', senderUid)
        .get();
      return snap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() } as CanvasInvitation))
        .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    }
    throw error;
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

/**
 * Helper to ensure a project has a thumbnail by checking its current snapshot
 */
async function ensureProjectThumbnail(p: CanvasProject): Promise<CanvasProject> {
  if (p.thumbnail) return p;

  try {
    const snapshotRef = adminDb
      .collection('canvasProjects')
      .doc(p.id)
      .collection('snapshots')
      .doc('current');
    const snapDoc = await snapshotRef.get();
    if (snapDoc.exists) {
      const snap = snapDoc.data() as CanvasSnapshot;
      const imageUrls: string[] = [];

      if (snap.metadata?.['stitched-image']) {
        const url = typeof snap.metadata['stitched-image'] === 'string'
          ? snap.metadata['stitched-image']
          : (snap.metadata['stitched-image'] as any).url;
        if (url) imageUrls.push(url);
      }

      if (snap.elements) {
        for (const elId in snap.elements) {
          const el = snap.elements[elId];
          const url = el.meta?.url || (el as any).generatedImageUrl || (el as any).generatedVideoUrl;
          if (url && typeof url === 'string') {
            imageUrls.push(url);
            if (imageUrls.length >= 5) break;
          }
        }
      }

      if (imageUrls.length > 0) {
        p.thumbnail = imageUrls[0];
        p.previewImages = imageUrls;
        adminDb.collection('canvasProjects').doc(p.id).update({
          thumbnail: p.thumbnail,
          previewImages: p.previewImages,
        }).catch(e => console.error('Failed to auto-update project thumbnail:', e));
      }
    }
  } catch (e) {
    console.error('Failed to backfill project thumbnail:', e);
  }
  return p;
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
    const ownerProjects = await Promise.all(
      ownerSnap.docs.map(doc => ensureProjectThumbnail({ id: doc.id, ...doc.data() } as CanvasProject))
    );

    const collaboratorQuery = projectsRef
      .where('collaboratorUids', 'array-contains', uid)
      .limit(limit);
    const collaboratorSnap = await collaboratorQuery.get();
    const collaboratorProjects = await Promise.all(
      collaboratorSnap.docs
        .filter(doc => doc.data()?.ownerUid !== uid)
        .map(doc => ensureProjectThumbnail({ id: doc.id, ...doc.data() } as CanvasProject))
    );

    const deduped = new Map<string, CanvasProject>();
    [...ownerProjects, ...collaboratorProjects].forEach((project) => {
      deduped.set(project.id, project);
    });

    return Array.from(deduped.values())
      .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
      .slice(0, limit);
  } catch (error: any) {
    // If composite index error, fallback to simple query without orderBy
    if (error.message?.includes('index')) {
      console.warn('Composite index not found, using simple query:', error.message);
      const ownerQuery = projectsRef
        .where('ownerUid', '==', uid)
        .limit(limit);

      const ownerSnap = await ownerQuery.get();
      const ownerProjects = await Promise.all(
        ownerSnap.docs.map(doc => ensureProjectThumbnail({ id: doc.id, ...doc.data() } as CanvasProject))
      );

      let collaboratorProjects: CanvasProject[] = [];
      try {
        const collaboratorSnap = await projectsRef
          .where('collaboratorUids', 'array-contains', uid)
          .get();
        collaboratorProjects = await Promise.all(
          collaboratorSnap.docs
            .filter(doc => doc.data()?.ownerUid !== uid)
            .map(doc => ensureProjectThumbnail({ id: doc.id, ...doc.data() } as CanvasProject))
        );
      } catch {}

      const mergedProjects = [...ownerProjects, ...collaboratorProjects];
      const deduped = new Map<string, CanvasProject>();
      mergedProjects.forEach((project) => deduped.set(project.id, project));

      const allProjects = Array.from(deduped.values());
      allProjects.sort((a, b) => {
        const aTime = a.updatedAt?.toMillis?.() || 0;
        const bTime = b.updatedAt?.toMillis?.() || 0;
        return bTime - aTime;
      });

      return allProjects.slice(0, limit);
    }
    throw error;
  }
}

export const projectRepository = {
  createProject,
  getProject,
  updateProject,
  addCollaborator,
  removeCollaborator,
  createInvitation,
  getInvitation,
  findPendingInvitation,
  updateInvitation,
  listInvitationsForRecipient,
  listInvitationsForSender,
  saveSnapshot,
  saveCurrentSnapshot,
  getSnapshot,
  getLatestSnapshot,
  getCurrentSnapshot,
  listUserProjects,
  deleteProject,
};
