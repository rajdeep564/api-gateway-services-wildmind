import { adminDb } from "../config/firebaseAdmin";
import { DeviceRecord } from "./deviceTrackingService";

/**
 * Moderation Service
 * Responsible for async risk scoring of users based on device, IP, and behavioral fingerprints.
 * Prevents automated account creation and restricts abuse without immediate hard bans.
 */

const RISK_THRESHOLDS = {
  UNDER_REVIEW: 60,
  AUTO_BAN: 100, // Reserved for future use
};

export async function evaluateUserRiskAndFlag(
  uid: string,
  deviceHash: string,
  ip: string,
): Promise<number> {
  if (!uid) return 0;
  let riskScore = 0;

  try {
    // 1. Evaluate Device Risk
    if (deviceHash) {
      const deviceDoc = await adminDb
        .collection("devices")
        .doc(deviceHash)
        .get();
      if (deviceDoc.exists) {
        const deviceData = deviceDoc.data() as DeviceRecord;
        const uidsCount = deviceData.uids?.length || deviceData.userCount || 1;

        // If more than 2 accounts have been used on this exact hardware footprint
        if (uidsCount > 2) {
          console.log(
            `[RiskEngine] ${uid} gained +50 risk: High device sharing (${uidsCount} accounts on ${deviceHash})`,
          );
          riskScore += 50;
        } else if (uidsCount === 2) {
          // Moderate sharing
          riskScore += 10;
        }
      }
    }

    // 2. Evaluate IP Risk
    if (ip) {
      // Find how many distinct active users share this IP.
      // We only look at recent users or users whose lastLoginIP is this.
      const usersWithIp = await adminDb
        .collection("users")
        .where("lastLoginIP", "==", ip)
        .get();
      const ipCount = usersWithIp.size;

      if (ipCount > 3) {
        console.log(
          `[RiskEngine] ${uid} gained +20 risk: High IP sharing (${ipCount} accounts on ${ip})`,
        );
        riskScore += 20;
      }
    }

    // 3. Optional: Temporary / Disposable Email check could go here
    // Example: if (isDisposable(email)) riskScore += 30

    // Apply Threshold Logic
    if (riskScore >= RISK_THRESHOLDS.UNDER_REVIEW) {
      const userRef = adminDb.collection("users").doc(uid);
      const userDoc = await userRef.get();

      if (userDoc.exists) {
        const userData = userDoc.data();
        // Do not downgrade a suspended/banned user
        if (
          !userData?.isBanned &&
          !userData?.isSuspended &&
          !userData?.isUnderReview
        ) {
          console.warn(
            `[RiskEngine] 🚩 User ${uid} flagged as under_review. Risk Score: ${riskScore}`,
          );
          await userRef.update({
            isUnderReview: true,
            riskScore: riskScore,
            lastFlaggedAt: new Date().toISOString(),
          });
        }
      }
    } else {
      // Optional: Clear under review if score drops? Usually we leave it for human review.
      // But we can log safe.
      console.log(
        `[RiskEngine] User ${uid} passed risk check with score ${riskScore}`,
      );
    }

    return riskScore;
  } catch (err) {
    console.error(`[RiskEngine] Failed to evaluate risk for ${uid}:`, err);
    return 0; // Fail open
  }
}

