import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';

export const config = { maxDuration: 300 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed.' });
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const { teamId, runId, deleteAll = false } = req.body || {};
  if (!token || !teamId) return res.status(400).json({ message: 'Missing token or teamId.' });

  const app = initFirebaseAdmin();
  const decoded = await getAuth(app).verifyIdToken(token);
  const db = getDb();
  const roleDoc = await db.collection('user_roles').doc(decoded.uid).get();
  const profile = roleDoc.data();
  if (!roleDoc.exists || profile?.teamId !== teamId) return res.status(403).json({ message: 'Forbidden.' });
  const hasFullAccess = profile?.role === 'owner' || profile?.permissions?.canManageSettings === true;

  if (deleteAll) {
    if (!hasFullAccess) return res.status(403).json({ message: 'Chỉ owner hoặc người quản lý cài đặt được xóa toàn bộ.' });
    const teamRef = db.collection('user').doc(teamId);
    const [jobs, runs] = await Promise.all([
      teamRef.collection('evaluation_jobs').get(),
      teamRef.collection('evaluation_runs').get(),
    ]);
    for (const document of jobs.docs) await db.recursiveDelete(document.ref);
    for (const document of runs.docs) await db.recursiveDelete(document.ref);
    return res.status(200).json({ success: true, jobsDeleted: jobs.size, runsDeleted: runs.size });
  }

  if (!runId) return res.status(400).json({ message: 'Missing runId.' });
  const runRef = db.collection('user').doc(teamId).collection('evaluation_runs').doc(String(runId));
  const runDoc = await runRef.get();
  if (!runDoc.exists) return res.status(200).json({ success: true, alreadyDeleted: true });
  const run = runDoc.data() || {};
  const allowed = new Set(Array.isArray(profile?.allowedAccounts) ? profile.allowedAccounts.map(String) : []);
  if (!hasFullAccess && !allowed.has(String(run.accountId)) && !allowed.has(String(run.shopLabel))) {
    return res.status(403).json({ message: 'Không có quyền xóa run của shop này.' });
  }
  await db.recursiveDelete(runRef);
  if (run.jobId) await db.recursiveDelete(db.collection('user').doc(teamId).collection('evaluation_jobs').doc(String(run.jobId)));
  const linkedJobs = await db.collection('user').doc(teamId).collection('evaluation_jobs').where('runId', '==', String(runId)).get();
  for (const job of linkedJobs.docs) await db.recursiveDelete(job.ref);
  return res.status(200).json({ success: true });
}
