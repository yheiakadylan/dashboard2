import { Buffer } from 'buffer';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { getAccessTokenFromRefreshToken } from './_lib/googleAuthHelper.js';
import { parseMessage, RULES } from '../src/services/rules.js';
import { getHtmlFromGmailPayload, getPlainTextFromGmailPayload } from './_lib/gmailHelper.js';
import { SHARED_USER_ID } from '../src/constants.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js';
import { processTeamSync } from './_lib/syncService.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).send('Method Not Allowed');
  }

  const { token } = req.query;
  if (token !== process.env.WEBHOOK_SECRET_TOKEN) {
    console.warn('[gmail-webhook] Unauthorized webhook call attempt');
    return res.status(401).send('Unauthorized');
  }

  const db = getDb();
  try {
    const pubSubMessage = (req.body && (req.body as any).message) || null;
    if (!pubSubMessage || !pubSubMessage.data) {
      console.warn('[gmail-webhook] Invalid Pub/Sub message received:', req.body);
      return res.status(400).send('Invalid Pub/Sub message');
    }

    const data = JSON.parse(Buffer.from(pubSubMessage.data, 'base64').toString('utf-8'));
    const userEmail: string | undefined = data.emailAddress;
    const newHistoryId: string | undefined = data.historyId;

    if (!userEmail || !newHistoryId) {
      return res.status(400).send('Missing emailAddress or historyId');
    }

    // 1. Lấy thông tin Account để biết Label (Tên Shop)
    const accountsRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
    const accountSnapshot = await accountsRef.where('email', '==', userEmail).limit(1).get();

    if (accountSnapshot.empty) {
      return res.status(204).send('');
    }

    const accountDoc = accountSnapshot.docs[0];
    const accountData = accountDoc.data();

    // --- LẤY TÊN SHOP ---
    const shopName = accountData.label || userEmail;
    // --------------------

    const effectiveUserId = (accountData.userId || accountData.ownerUserId || SHARED_USER_ID).trim();
    const refreshToken = accountData.token;
    const lastKnownHistoryId = accountData.lastKnownHistoryId;

    if (!lastKnownHistoryId) {
      await accountDoc.ref.update({ lastKnownHistoryId: newHistoryId });
      return res.status(204).send('');
    }

    const accessToken = await getAccessTokenFromRefreshToken(refreshToken);
    const historyUrl = `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${lastKnownHistoryId}&historyTypes=messageAdded`;

    const historyResponse = await fetch(historyUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!historyResponse.ok) {
      const errorText = await historyResponse.text();
      if (historyResponse.status === 404 && /HistoryId .* too old/i.test(errorText)) {
        await accountDoc.ref.update({ lastKnownHistoryId: newHistoryId });
        return res.status(204).send('');
      }
      return res.status(204).send('');
    }

    const historyData = await historyResponse.json();

    if (!historyData.history || historyData.history.length === 0) {
      await accountDoc.ref.update({ lastKnownHistoryId: newHistoryId });
      return res.status(204).send('');
    }

    const newRecords: any[] = [];
    const notificationEvents: { type: 'order' | 'refund' | 'funds' | 'case' | 'help', text: string }[] = [];

    for (const item of historyData.history as any[]) {
      if (item.messagesAdded) {
        for (const msgHeader of item.messagesAdded) {
          if (!msgHeader.message.labelIds?.includes('INBOX')) continue;

          const msgId = msgHeader.message.id as string;
          const msgUrl = `https://www.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`;

          const msgResponse = await fetch(msgUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (!msgResponse.ok) continue;

          const msgData = await msgResponse.json();
          const subject = msgData.payload?.headers?.find((h: any) => (h.name || '').toLowerCase() === 'subject')?.value || '';
          const htmlBody = getHtmlFromGmailPayload(msgData.payload);
          const plainBody = getPlainTextFromGmailPayload(msgData.payload);
          const bodyForParsing = htmlBody || plainBody || '';

          for (const rule of RULES) {
            const parsedData = parseMessage(rule, subject, msgData.snippet || '', bodyForParsing);
            if (parsedData) {
              const newRecord = {
                ...parsedData,
                email_id: msgData.id,
                dt_local: new Date(parseInt(msgData.internalDate, 10)).toISOString(),
                account: userEmail,
                source: rule.name,
              };
              newRecords.push(newRecord);

              // 2. Tạo nội dung thông báo với Shop Name
              if (newRecord.kind === 'order') {
                const isRefund = newRecord.source === 'Etsy_Refunded';
                if (isRefund) {
                  notificationEvents.push({
                    type: 'refund',
                    text: `Refund: #${newRecord.order_id || 'Unknown'} - $${Math.abs(newRecord.amount || 0)} (${shopName})`
                  });
                } else {
                  notificationEvents.push({
                    type: 'order',
                    text: `New Order: #${newRecord.order_id || 'Unknown'} - $${newRecord.amount} (${shopName})`
                  });
                }
              } else if (newRecord.kind === 'Funds') {
                notificationEvents.push({
                  type: 'funds',
                  text: `Funds Received: $${newRecord.amount} ${newRecord.currency} (${shopName})`
                });
              } else if (newRecord.kind === 'case') {
                notificationEvents.push({
                  type: 'case',
                  text: `Case Opened: Order #${newRecord.order_id} (${shopName})`
                });
              } else if (newRecord.kind === 'help') {
                notificationEvents.push({
                  type: 'help',
                  text: `Help Request: Order #${newRecord.order_id} - ${newRecord.help_kind || 'General'} (${shopName})`
                });
              }
              break;
            }
          }
        }
      }
    }

    // Lưu vào DB (logic cũ giữ nguyên)
    const recordsCollection = db.collection('user').doc(effectiveUserId).collection('records');
    const batch = db.batch();

    if (newRecords.length > 0) {
      let saveCount = 0;
      for (const record of newRecords) {
        const docRef = record.email_id
          ? recordsCollection.doc(record.email_id)
          : recordsCollection.doc();
        const { id, ...recordData } = record;
        batch.set(docRef, recordData);
        saveCount++;
      }
      if (saveCount > 0) {
        await batch.commit();
        console.log(`[Webhook] Processed ${saveCount} records.`);

        // 🟢 TRIGGER SHEET SYNC IMMEDIATELY
        processTeamSync(effectiveUserId).catch(err => console.error('[Webhook] Sheet sync failed:', err));
      }
    } else {
      await batch.commit();
    }

    // Cập nhật history ID
    await accountDoc.ref.update({ lastKnownHistoryId: newHistoryId });

    // 3. Gửi Thông báo
    if (notificationEvents.length > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboardvikcom.vercel.app';

      const createDeepLink = (tabName: string) => {
        try {
          const url = new URL(baseUrl);
          url.searchParams.set('tab', tabName);
          return url.toString();
        } catch (e) {
          console.error('[webhook] Error creating deep link:', e);
          return baseUrl;
        }
      };

      if (notificationEvents.length === 1) {
        // Gửi 1 tin duy nhất
        const evt = notificationEvents[0];
        let deepLink = baseUrl;

        if (evt.type === 'order' || evt.type === 'refund') deepLink = createDeepLink('Order List');
        else if (evt.type === 'funds') deepLink = createDeepLink('Overview');
        else if (evt.type === 'case' || evt.type === 'help') deepLink = createDeepLink('Support');

        let title = 'Notification';
        if (evt.type === 'order') title = 'New Order!';
        else if (evt.type === 'refund') title = 'Refund Processed';
        else if (evt.type === 'funds') title = 'Funds Received!';
        else if (evt.type === 'case') title = 'Case Alert!';
        else if (evt.type === 'help') title = 'Help Request!';

        await sendPushNotificationToUsers(effectiveUserId, evt.type === 'refund' ? 'order' : evt.type, {
          title: title,
          body: evt.text,
          url: deepLink
        });
      } else {
        // Gửi tổng hợp nếu nhiều tin
        const orders = notificationEvents.filter(e => e.type === 'order');
        const refunds = notificationEvents.filter(e => e.type === 'refund');
        const funds = notificationEvents.filter(e => e.type === 'funds');
        const tasks = notificationEvents.filter(e => e.type === 'case' || e.type === 'help'); // Shared 'Support'

        if (orders.length > 0) {
          const deepLink = createDeepLink('Order List');
          await sendPushNotificationToUsers(effectiveUserId, 'order', {
            title: 'New Orders Arrived',
            body: `You have ${orders.length} new orders.`,
            url: deepLink
          });
        }
        if (refunds.length > 0) {
          const deepLink = createDeepLink('Order List');
          await sendPushNotificationToUsers(effectiveUserId, 'order', {
            title: 'Refunds Processed',
            body: `You have ${refunds.length} successful refunds.`,
            url: deepLink
          });
        }
        if (funds.length > 0) {
          const deepLink = createDeepLink('Overview');
          await sendPushNotificationToUsers(effectiveUserId, 'funds', {
            title: 'New Funds Received',
            body: `You have ${funds.length} new payout updates.`,
            url: deepLink
          });
        }
        if (tasks.length > 0) {
          const deepLink = createDeepLink('Support');
          // Determine if it's mostly cases or help
          const caseCount = tasks.filter(t => t.type === 'case').length;
          const helpCount = tasks.filter(t => t.type === 'help').length;

          await sendPushNotificationToUsers(effectiveUserId, caseCount > 0 ? 'case' : 'help', {
            title: 'New Support Issues',
            body: `You have ${caseCount} cases and ${helpCount} help requests.`,
            url: deepLink
          });
        }
      }
    }

    return res.status(204).send('');
  } catch (error: any) {
    console.error('[API /gmail-webhook Error]', error);
    return res.status(500).send(error?.message || 'Internal Server Error');
  }
}
