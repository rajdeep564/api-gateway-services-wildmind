/**
 * Snapshot Worker - Creates snapshots of Canvas projects
 * 
 * This worker can be run:
 * - As a scheduled Cloud Function (every N hours)
 * - As a manual API endpoint
 * - As a background job
 * 
 * Snapshots are created when:
 * - A project has accumulated N ops since last snapshot (default: 100)
 * - A certain time has passed since last snapshot (default: 24 hours)
 */

import { adminDb, admin } from '../../config/firebaseAdmin';
import { projectRepository } from '../../repository/canvas/projectRepository';
import { opRepository } from '../../repository/canvas/opRepository';
import { elementRepository } from '../../repository/canvas/elementRepository';
import { CanvasSnapshot } from '../../types/canvas';

interface SnapshotConfig {
  maxOpsSinceSnapshot?: number; // Create snapshot after N ops (default: 100)
  maxTimeSinceSnapshot?: number; // Create snapshot after N hours (default: 24)
  batchSize?: number; // Number of projects to process per run (default: 50)
}

const DEFAULT_CONFIG: Required<SnapshotConfig> = {
  maxOpsSinceSnapshot: 100,
  maxTimeSinceSnapshot: 24,
  batchSize: 50,
};

/**
 * Create snapshot for a single project
 */
export async function createSnapshotForProject(
  projectId: string,
  config: SnapshotConfig = {}
): Promise<{ created: boolean; snapshotOpIndex?: number; reason?: string }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  try {
    const project = await projectRepository.getProject(projectId);
    if (!project) {
      return { created: false, reason: 'Project not found' };
    }

    // Check if snapshot is needed
    const lastSnapshotOpIndex = project.lastSnapshotOpIndex || -1;
    const lastSnapshotAt = project.lastSnapshotAt?.toMillis?.() || 0;
    const now = Date.now();
    const hoursSinceSnapshot = (now - lastSnapshotAt) / (1000 * 60 * 60);

    // Get current op count by checking the op counter
    const counterRef = adminDb
      .collection('canvasProjects')
      .doc(projectId)
      .collection('counters')
      .doc('opIndex');
    const counterSnap = await counterRef.get();
    const currentOpIndex = counterSnap.exists ? (counterSnap.data()?.value || 0) : 0;

    // Get current op count
    const ops = await opRepository.listOps(projectId, lastSnapshotOpIndex + 1, 1);
    const hasNewOps = ops.length > 0;

    if (!hasNewOps) {
      return { created: false, reason: 'No new operations' };
    }

    // Check if we should create snapshot
    const opsSinceSnapshot = currentOpIndex - lastSnapshotOpIndex;
    const shouldCreateSnapshot =
      opsSinceSnapshot >= cfg.maxOpsSinceSnapshot ||
      hoursSinceSnapshot >= cfg.maxTimeSinceSnapshot;

    if (!shouldCreateSnapshot) {
      return {
        created: false,
        reason: `Not enough ops (${opsSinceSnapshot}/${cfg.maxOpsSinceSnapshot}) or time (${hoursSinceSnapshot.toFixed(1)}h/${cfg.maxTimeSinceSnapshot}h)`,
      };
    }

    // Get all elements for snapshot
    const elements = await elementRepository.queryElementsInRegion(projectId, {
      x: -Infinity,
      y: -Infinity,
      width: Infinity,
      height: Infinity,
    });

    // Build snapshot
    const snapshot: CanvasSnapshot = {
      projectId,
      snapshotOpIndex: currentOpIndex,
      elements: {},
      metadata: {
        version: '1.0',
        createdAt: admin.firestore.Timestamp.now(),
      },
    };

    // Convert elements array to object keyed by element ID
    for (const element of elements) {
      snapshot.elements[element.id] = element;
    }

    // Save snapshot
    await projectRepository.saveSnapshot(projectId, snapshot, snapshot.snapshotOpIndex);

    return {
      created: true,
      snapshotOpIndex: snapshot.snapshotOpIndex,
      reason: `Created snapshot at op ${snapshot.snapshotOpIndex} with ${elements.length} elements`,
    };
  } catch (error: any) {
    console.error(`Failed to create snapshot for project ${projectId}:`, error);
    return { created: false, reason: error.message };
  }
}

/**
 * Process multiple projects and create snapshots where needed
 */
export async function processSnapshots(
  config: SnapshotConfig = {}
): Promise<{
  processed: number;
  created: number;
  skipped: number;
  errors: number;
  results: Array<{ projectId: string; created: boolean; reason?: string }>;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const results: Array<{ projectId: string; created: boolean; reason?: string }> = [];

  try {
    // Get projects that might need snapshots
    // Query projects updated in last 7 days (to avoid processing old projects)
    const sevenDaysAgo = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    );
    const projectsRef = adminDb.collection('canvasProjects');
    
    // Note: This query requires an index on updatedAt
    // For now, we'll limit to recent projects
    const projectsSnap = await projectsRef
      .orderBy('updatedAt', 'desc')
      .limit(cfg.batchSize)
      .get();

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const doc of projectsSnap.docs) {
      const projectId = doc.id;
      try {
        const result = await createSnapshotForProject(projectId, cfg);
        results.push({
          projectId,
          created: result.created,
          reason: result.reason,
        });

        if (result.created) {
          created++;
        } else {
          skipped++;
        }
      } catch (error: any) {
        console.error(`Error processing project ${projectId}:`, error);
        results.push({
          projectId,
          created: false,
          reason: error.message,
        });
        errors++;
      }
    }

    return {
      processed: projectsSnap.size,
      created,
      skipped,
      errors,
      results,
    };
  } catch (error: any) {
    console.error('Failed to process snapshots:', error);
    throw error;
  }
}

/**
 * Manual trigger endpoint (can be called via API)
 */
export async function triggerSnapshotWorker(
  projectId?: string,
  config: SnapshotConfig = {}
): Promise<any> {
  if (projectId) {
    // Create snapshot for specific project
    return await createSnapshotForProject(projectId, config);
  } else {
    // Process all projects
    return await processSnapshots(config);
  }
}

