// File: api/gmail-webhook.ts
import { Buffer } from 'buffer';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { getAccessTokenFromRefreshToken } from './_lib/googleAuthHelper.js';
import { parseMessage, RULES } from '../services/rules.js';
import { getHtmlFromGmailPayload, getPlainTextFromGmailPayload } from './_lib/gmailHelper.js';
import { SHARED_USER_ID } from '../constants.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js'; // <-- Import

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

    const accountsRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
    const accountSnapshot = await accountsRef.where('email', '==', userEmail).limit(1).get();

    if (accountSnapshot.empty) {
      return res.status(204).send('');
    }

    const accountDoc = accountSnapshot.docs[0];
    const account = accountDoc.data();
    const effectiveUserId = (account.userId || account.ownerUserId || SHARED_USER_ID).trim();
    const refreshToken = account.token;
    const lastKnownHistoryId = account.lastKnownHistoryId;

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
    const notificationEvents: { type: 'order' | 'funds', text: string }[] = [];

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
              
              // Prepare Notification Logic
              if (newRecord.kind === 'order') {
                notificationEvents.push({ 
                    type: 'order', 
                    text: `New Order: ${newRecord.order_id || 'Unknown'} - $${newRecord.amount} (${userEmail})` 
                });
              } else if (newRecord.kind === 'Funds') {
                notificationEvents.push({ 
                    type: 'funds', 
                    text: `Funds Received: $${newRecord.amount} ${newRecord.currency} (${userEmail})` 
                });
              }
              break; 
            }
          }
        }
      }
    }

    const batch = db.batch();
    const recordsCollection = db.collection('user').doc(effectiveUserId).collection('records');

    if (newRecords.length > 0) {
      for (const record of newRecords) {
        const docRef = recordsCollection.doc();
        batch.set(docRef, record);
      }
    }

    batch.update(accountDoc.ref, { lastKnownHistoryId: newHistoryId });
    await batch.commit();

    // === TRIGGER NOTIFICATIONS ===
    if (notificationEvents.length > 0) {
        // Send individually or batched. For simplicity, sending the first one or a generic "X new updates"
        // To avoid spamming, if multiple events, send one summary.
        if (notificationEvents.length === 1) {
            const evt = notificationEvents[0];
            await sendPushNotificationToUsers(effectiveUserId, evt.type, {
                title: evt.type === 'order' ? 'New Order!' : 'Funds Received!',
                body: evt.text
            });
        } else {
            const orders = notificationEvents.filter(e => e.type === 'order');
            const funds = notificationEvents.filter(e => e.type === 'funds');
            
            if (orders.length > 0) {
                await sendPushNotificationToUsers(effectiveUserId, 'order', {
                    title: 'New Orders Arrived',
                    body: `You have ${orders.length} new orders.`
                });
            }
            if (funds.length > 0) {
                await sendPushNotificationToUsers(effectiveUserId, 'funds', {
                    title: 'New Funds Received',
                    body: `You have ${funds.length} new payout updates.`
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