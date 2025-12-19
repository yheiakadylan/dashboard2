// File: api/daily-summary.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getReportDataForDate, sendLarkDailySummary } from './_lib/larkHelper.js';
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

    // 1. Send Lark
    await sendLarkDailySummary(summaryData);

    // 2. Create Notification Document in Firestore (to get ID for deep link)
    const revenueUSD = summaryData.totalRevenue['USD'] || 0;
    const notificationId = await createNotificationDocument({
      teamId: SHARED_USER_ID,
      type: 'SUMMARY',
      title: 'Daily Sales Summary',
      content: `${summaryData.totalOrders} orders totaling $${revenueUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })} for ${yesterdayISO}`,
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

    // 3. Send Push Notification with deep link to notification detail
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboardvikcom.vercel.app/';
    await sendPushNotificationToUsers(SHARED_USER_ID, 'summary', {
      title: 'Daily Summary Report',
      body: `📅 ${yesterdayISO}\nOrders: ${summaryData.totalOrders}\nRevenue: $${revenueUSD.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
      url: `${appUrl}?notification=${notificationId}` // Deep link to notification detail modal
    });

    res.status(200).send(`Summary for ${yesterdayISO} (UTC-7) sent successfully.`);
  } catch (error: any) {
    console.error('[API /daily-summary Error]', error);
    res.status(500).send(error.message || 'Failed to generate summary.');
  }
}