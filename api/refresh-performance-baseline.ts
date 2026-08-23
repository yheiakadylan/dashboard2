import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SHARED_USER_ID } from '../src/constants.js';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { refreshPerformanceBaseline } from './_lib/performanceBaselineAdmin.js';

export const config = { maxDuration: 300 };

const isAuthorized = (req: VercelRequest) => {
  const authHeader = req.headers.authorization;
  const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
  return authHeader === `Bearer ${process.env.CRON_SECRET}`
    || Boolean(secret && secret === process.env.CRON_SECRET);
};

const parseBool = (value: unknown) => value === true || value === 'true' || value === '1';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) return res.status(401).send('Unauthorized');
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method Not Allowed');
  }

  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : SHARED_USER_ID;
  const rangeFrom = typeof req.query.from === 'string' ? req.query.from : undefined;
  const rangeTo = typeof req.query.to === 'string' ? req.query.to : undefined;

  try {
    const result = await refreshPerformanceBaseline(getDb(), {
      teamId,
      rangeFrom,
      rangeTo,
      dryRun: parseBool(req.query.dryRun),
      force: parseBool(req.query.force),
      finalize: parseBool(req.query.finalize),
      trigger: 'cron',
    });
    console.log('[refresh-performance-baseline]', result);
    return res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('[refresh-performance-baseline] Failed:', error);
    return res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Failed to refresh performance baseline.',
    });
  }
}
