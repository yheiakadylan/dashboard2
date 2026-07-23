// File: api/design-overdue-check.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDb } from "./_lib/firebaseAdminHelper.js";

const OVERDUE_STATUSES = ["new", "todo", "in_review", "need_fix"];

// Minimum calendar days before any task can be overdue by working-days logic.
// Mon created → overdue Thu = 3 calendar days. Used only as a Firestore pre-filter.
const MIN_CALENDAR_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

function isWeekend(date: Date): boolean {
  const day = date.getDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

// If createdAt is a weekend, return the following Monday at the same time.
// Otherwise return createdAt unchanged.
function getEffectiveStart(createdAt: Date): Date {
  if (!isWeekend(createdAt)) return createdAt;
  const d = new Date(createdAt);
  while (d.getDay() !== 1) {
    // 1 = Monday
    d.setDate(d.getDate() + 1);
  }
  return d;
}

// Add n working days (Mon–Fri) to start, preserving the time-of-day.
function addWorkingDays(start: Date, days: number): Date {
  const result = new Date(start);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (!isWeekend(result)) added++;
  }
  return result;
}

// Returns the exact moment a task becomes overdue under the working-days rule.
function getOverdueThreshold(createdAt: Date): Date {
  return addWorkingDays(getEffectiveStart(createdAt), 3);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = getDb();
    const now = new Date();

    // Pre-filter: only fetch tasks older than 3 calendar days.
    // No task created within 3 calendar days can be overdue by the working-days rule.
    const preFilterThreshold = new Date(now.getTime() - MIN_CALENDAR_DAYS_MS);

    const usersSnap = await db.collection("user").get();

    const toUpdate: FirebaseFirestore.DocumentReference[] = [];

    for (const userDoc of usersSnap.docs) {
      const teamId = userDoc.id;
      const snap = await db
        .collection("user")
        .doc(teamId)
        .collection("design_tasks")
        .where("createdAt", "<=", preFilterThreshold)
        .get();

      snap.docs.forEach((docSnap) => {
        const data = docSnap.data();
        if (!OVERDUE_STATUSES.includes(data.status)) return;

        const createdAt: Date = data.createdAt?.toDate?.() ?? new Date(0);
        const overdueAt = getOverdueThreshold(createdAt);

        if (now >= overdueAt) {
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
