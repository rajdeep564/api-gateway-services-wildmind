import { adminDb, admin } from '../../config/firebaseAdmin';
import { CanvasElement } from '../../types/canvas';

export async function upsertElement(
  projectId: string,
  element: Omit<CanvasElement, 'projectId' | 'createdAt' | 'updatedAt'>
): Promise<CanvasElement> {
  const elementRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('elements')
    .doc(element.id);
  
  const now = admin.firestore.FieldValue.serverTimestamp();
  const existing = await elementRef.get();
  
  if (existing.exists) {
    await elementRef.update({
      ...element,
      updatedAt: now,
    });
  } else {
    await elementRef.set({
      ...element,
      projectId,
      createdAt: now,
      updatedAt: now,
    });
  }

  const updated = await elementRef.get();
  return { id: updated.id, ...updated.data() } as CanvasElement;
}

export async function getElement(
  projectId: string,
  elementId: string
): Promise<CanvasElement | null> {
  const elementRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('elements')
    .doc(elementId);
  
  const snap = await elementRef.get();
  if (!snap.exists) return null;
  
  return { id: snap.id, ...snap.data() } as CanvasElement;
}

export async function deleteElement(
  projectId: string,
  elementId: string
): Promise<void> {
  const elementRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('elements')
    .doc(elementId);
  
  await elementRef.delete();
}

export async function queryElementsInRegion(
  projectId: string,
  region: { x: number; y: number; width: number; height: number }
): Promise<CanvasElement[]> {
  // Firestore doesn't support geometric queries, so we fetch all and filter client-side
  // For better performance, consider using a spatial index or Geohash
  const elementsRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('elements');
  
  const snap = await elementsRef.get();
  const elements = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasElement));
  
  // Filter elements that intersect with region
  return elements.filter(el => {
    if (!el.width || !el.height) return false;
    return !(
      el.x + el.width < region.x ||
      el.x > region.x + region.width ||
      el.y + el.height < region.y ||
      el.y > region.y + region.height
    );
  });
}

export async function queryElementsByAnchors(
  projectId: string,
  point: { x: number; y: number },
  tolerance: number = 20
): Promise<Array<{ element: CanvasElement; anchor: { id: string; x: number; y: number } }>> {
  const elementsRef = adminDb
    .collection('canvasProjects')
    .doc(projectId)
    .collection('elements');
  
  const snap = await elementsRef.get();
  const elements = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CanvasElement));
  
  const results: Array<{ element: CanvasElement; anchor: { id: string; x: number; y: number } }> = [];
  
  for (const element of elements) {
    if (element.meta?.anchors) {
      for (const anchor of element.meta.anchors) {
        const anchorX = element.x + anchor.x;
        const anchorY = element.y + anchor.y;
        const distance = Math.sqrt(
          Math.pow(anchorX - point.x, 2) + Math.pow(anchorY - point.y, 2)
        );
        
        if (distance <= tolerance) {
          results.push({ element, anchor });
        }
      }
    }
  }
  
  return results;
}

export async function batchUpsertElements(
  projectId: string,
  elements: Array<Omit<CanvasElement, 'projectId' | 'createdAt' | 'updatedAt'>>
): Promise<void> {
  const batch = adminDb.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();
  
  for (const element of elements) {
    const elementRef = adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('elements')
      .doc(element.id);
    
    const existing = await elementRef.get();
    if (existing.exists) {
      batch.update(elementRef, {
        ...element,
        updatedAt: now,
      });
    } else {
      batch.set(elementRef, {
        ...element,
        projectId,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  
  await batch.commit();
}

export const elementRepository = {
  upsertElement,
  getElement,
  deleteElement,
  queryElementsInRegion,
  queryElementsByAnchors,
  batchUpsertElements,
};

