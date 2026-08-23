// File: api/daily-summary.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getReportDataForDate } from './_lib/larkHelper.js';
import { SHARED_USER_ID } from '../src/constants.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js'; // <-- Import
import { createNotificationDocument } from './_lib/notificationHelper.js';

const getYesterdayUTCMinus7Date = (): string => {
  const now = new Date();
  const timeOffsetMs = (7 + 24) * 60 * 60 * 1000;
  const targetDate = new Date(now.getTime() - timeOffsetMs);
  return targetDate.toISOString().split('T')[0];
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }

  try {
    const yesterdayISO = getYesterdayUTCMinus7Date();
    const timeZoneOffset = '-07:00';

    console.log(`[daily-summary] Generating report for ${yesterdayISO} (UTC-7)`);

    const summaryData = await getReportDataForDate(yesterdayISO, timeZoneOffset);

    // 1. Create Notification Document in Firestore (to get ID for deep link)
    const notificationId = await createNotificationDocument({
      teamId: SHARED_USER_ID,
      type: 'SUMMARY',
      title: 'Daily Sales Summary',
      content: `${summaryData.totalOrders} orders processed on ${yesterdayISO}. Tap to view full report.`,
      metadata: {
        summary_data: {
          date: yesterdayISO,
          totalOrders: summaryData.totalOrders,
          totalRevenue: summaryData.totalRevenue,
          totalFunds: summaryData.totalFunds,
          shops: summaryData.shops,
        },
      },
    });

    // 2. Send Push Notification with deep link to notification detail
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard2-alpha-bay.vercel.app/';
    let deepLink = baseUrl;
    try {
      const u = new URL(baseUrl);
      u.searchParams.set('notification', notificationId);
      deepLink = u.toString();
    } catch (e) {
      console.error('[daily-summary] URL Error:', e);
      // Fallback to simple concatenation if URL class fails (unlikely)
      deepLink = `${baseUrl}?notification=${notificationId}`;
    }

    await sendPushNotificationToUsers(SHARED_USER_ID, 'summary', {
      title: 'Daily Summary Report',
      body: `📅 ${yesterdayISO}\nOrders: ${summaryData.totalOrders}\nTap to view full report.`,
      url: deepLink // Deep link to notification detail modal
    });

    res.status(200).send(`Summary for ${yesterdayISO} (UTC-7) sent successfully.`);
  } catch (error: any) {
    console.error('[API /daily-summary Error]', error);
    res.status(500).send(error.message || 'Failed to generate summary.');
  }
}