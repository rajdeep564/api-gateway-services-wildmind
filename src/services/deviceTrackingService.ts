import { adminDb } from "../config/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

export interface DeviceRecord {
  deviceHash: string;
  userCount: number;
  uids: string[];
  firstSeenAt: string;
  lastSeenAt: string;
}

/**
 * Tracks a device hash mapping to a specific UID.
 * Updates the Firestore `devices` collection, keeping a count of unique users on this device.
 */
export async function trackDevice(
  uid: string,
  deviceHash: string,
  ip: string,
): Promise<DeviceRecord> {
  if (!uid || !deviceHash) {
    throw new Error("UID and DeviceHash are required for tracking");
  }

  const deviceRef = adminDb.collection("devices").doc(deviceHash);

  try {
    const result = await adminDb.runTransaction(async (transaction) => {
      const doc = await transaction.get(deviceRef);
      const now = new Date().toISOString();

      if (!doc.exists) {
        const newDevice: DeviceRecord = {
          deviceHash,
          userCount: 1,
          uids: [uid],
          firstSeenAt: now,
          lastSeenAt: now,
        };
        transaction.set(deviceRef, newDevice);

        // Also update user's known devices list safely
        const userRef = adminDb.collection("users").doc(uid);
        transaction.set(
          userRef,
          {
            knownDeviceHashes: FieldValue.arrayUnion(deviceHash),
          },
          { merge: true },
        );

        return newDevice;
      }

      const existing = doc.data() as DeviceRecord;
      const uids = existing.uids || [];

      const isNewUserForDevice = !uids.includes(uid);
      const newUids = isNewUserForDevice ? [...uids, uid] : uids;

      const updateData: Partial<DeviceRecord> = {
        lastSeenAt: now,
      };

      if (isNewUserForDevice) {
        updateData.uids = newUids;
        updateData.userCount = newUids.length;
      }

      transaction.update(deviceRef, updateData);

      // Add to user's known devices
      if (isNewUserForDevice) {
        const userRef = adminDb.collection("users").doc(uid);
        transaction.set(
          userRef,
          {
            knownDeviceHashes: FieldValue.arrayUnion(deviceHash),
          },
          { merge: true },
        );
      }

      return {
        ...existing,
        ...updateData,
      } as DeviceRecord;
    });

    // Fire-and-forget Risk Evaluation
    // This runs asynchronously so it doesn't block the auth flow
    import("./moderationService").then((mod) => {
      mod.evaluateUserRiskAndFlag(uid, deviceHash, ip).catch((err) => {
        console.error("[DeviceTracker] Risk engine failed:", err);
      });
    });

    return result;
  } catch (error) {
    console.error(
      `[DeviceTracker] Failed to track device ${deviceHash} for uid ${uid}:`,
      error,
    );
    // Suppress error so auth flow is not interrupted by tracking failure
    throw error;
  }
}
