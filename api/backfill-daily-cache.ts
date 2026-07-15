import type { VercelRequest, VercelResponse } from '@vercel/node';
import { SHARED_USER_ID } from '../src/constants.js';
import { getDb } from './_lib/firebaseAdminHelper.js';
import {
  buildDailyCacheForDay,
  getDueOffsetsForCurrentUtcHour,
  getJustEndedDateForOffset,
  listDates,
  parseOffsetKeys,
  type DailyCacheCollection,
  type DailyCacheOffsetKey,
} from './_lib/dailyCacheAdmin.js';

const MAX_DAYS_PER_REQUEST = 45;
const DEFAULT_COLLECTIONS: DailyCacheCollection[] = ['records', 'reviews'];

const isAuthorized = (req: VercelRequest) => {
  const authHeader = req.headers.authorization;
  const secret = typeof req.query.secret === 'string' ? req.query.secret : '';
  return authHeader === `Bearer ${process.env.CRON_SECRET}` || Boolean(secret && secret === process.env.CRON_SECRET);
};

const parseCollections = (raw?: string | string[]): DailyCacheCollection[] => {
  const values = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const parsed = values
    .map(value => value.trim())
    .filter((value): value is DailyCacheCollection => value === 'records' || value === 'reviews');
  return parsed.length > 0 ? Array.from(new Set(parsed)) : DEFAULT_COLLECTIONS;
};

const parseBool = (raw: unknown): boolean => {
  return raw === true || raw === 'true' || raw === '1';
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) {
    return res.status(401).send('Unauthorized');
  }

  const db = getDb();
  const force = parseBool(req.query.force);
  const collections = parseCollections(req.query.collections);
  const requestedOffsets = parseOffsetKeys(req.query.offsets);
  const teamId = typeof req.query.teamId === 'string' ? req.query.teamId : SHARED_USER_ID;

  try {
    let jobs: Array<{ date: string; offsetKey: DailyCacheOffsetKey; collectionName: DailyCacheCollection }> = [];

    const from = typeof req.query.from === 'string' ? req.query.from : '';
    const to = typeof req.query.to === 'string' ? req.query.to : '';
    const isScheduledRun = !from && !to;
    const effectiveForce = force || isScheduledRun;

    if (from && to) {
      const dates = listDates(from, to);
      if (dates.length > MAX_DAYS_PER_REQUEST) {
        return res.status(400).json({
          ok: false,
          error: `Backfill toi da ${MAX_DAYS_PER_REQUEST} ngay moi request. Hay chia nho range.`,
        });
      }

      jobs = dates.flatMap(date =>
        requestedOffsets.flatMap(offsetKey =>
          collections.map(collectionName => ({ date, offsetKey, collectionName }))
        )
      );
    } else {
      const dueOffsets = getDueOffsetsForCurrentUtcHour();
      jobs = dueOffsets.flatMap(offsetKey => {
        const date = getJustEndedDateForOffset(offsetKey);
        return collections.map(collectionName => ({ date, offsetKey, collectionName }));
      });
    }

    console.log(`[backfill-daily-cache] team=${teamId} jobs=${jobs.length} force=${effectiveForce} collections=${collections.join(',')}`);

    const results = [];
    for (const job of jobs) {
      try {
        results.push(await buildDailyCacheForDay(db, { teamId, ...job, force: effectiveForce }));
      } catch (error: any) {
        console.error('[backfill-daily-cache] Job failed:', job, error);
        results.push({
          ...job,
          cacheKey: `${job.collectionName}__${job.offsetKey}__${job.date}`,
          status: 'failed',
          itemCount: 0,
          pageCount: 0,
          reason: error?.message || 'unknown-error',
        });
      }
    }

    const summary = results.reduce((acc, item) => {
      acc[item.status] = (acc[item.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    console.log('[backfill-daily-cache] summary', summary);

    return res.status(200).json({
      ok: true,
      teamId,
      force: effectiveForce,
      jobCount: jobs.length,
      summary,
      results,
    });
  } catch (error: any) {
    console.error('[API /backfill-daily-cache Error]', error);
    return res.status(500).json({ ok: false, error: error?.message || 'Failed to backfill daily cache.' });
  }
}
