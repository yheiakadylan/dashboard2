// File: api/design-overdue-check.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/firebaseAdminHelper.js";

const OVERDUE_STATUSES = ["new", "todo", "in_review", "need_fix"];
const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();
    const threshold = new Date(Date.now() - THREE_DAYS_MS);
    const now = new Date();

    // Query all teams, then scan design_tasks per team
    // (safer than collectionGroup which requires explicit index setup)
    const usersSnap = await db.collection("user").get();

    const toUpdate: FirebaseFirestore.DocumentReference[] = [];

    for (const userDoc of usersSnap.docs) {
      const teamId = userDoc.id;
      const snap = await db
        .collection("user")
        .doc(teamId)
        .collection("design_tasks")
        .where("createdAt", "<=", threshold)
        .get();

      snap.docs.forEach((docSnap) => {
        const status = docSnap.data().status;
        if (OVERDUE_STATUSES.includes(status)) {
          toUpdate.push(docSnap.ref);
        }
      });
    }

    if (toUpdate.length === 0) {
      console.log("[design-overdue-check] No tasks to mark as overdue");
      return res.status(200).json({ updated: 0 });
    }

    // Batch write in chunks of 500 (Firestore limit)
    const BATCH_SIZE = 500;
    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = db.batch();
      toUpdate.slice(i, i + BATCH_SIZE).forEach((ref) => {
        batch.update(ref, { status: "overdue", overdueAt: now });
      });
      await batch.commit();
    }

    console.log(
      `[design-overdue-check] Marked ${toUpdate.length} tasks as overdue`,
    );
    return res.status(200).json({ updated: toUpdate.length });
  } catch (error: any) {
    console.error("[design-overdue-check] Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
