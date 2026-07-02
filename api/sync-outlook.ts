// File: api/sync-outlook.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDb } from './_lib/firebaseAdminHelper.js';
import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from './_lib/microsoftConfig.js';
import { SHARED_USER_ID } from '../src/constants.js';
import { RULES, parseMessage } from '../src/services/rules.js';
import type { Account, Record } from './_lib/types.js';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js';
import { applyCategoryMappings } from './_lib/mappingHelper.js';
import { processNewOrder } from './_lib/orderService.js';
import { markDailyCacheDirtyForISOValues } from './_lib/dailyCacheAdmin.js';

// --- Helpers ---
/*
 * Lấy Access Token mới từ Refresh Token
 */
async function getMicrosoftAccessToken(refreshToken: string): Promise<string | null> {
  if (!MICROSOFT_CLIENT_ID || !MICROSOFT_CLIENT_SECRET) {
    console.error('[sync-outlook] Missing MSAL client ID or secret');
    return null;
  }
  try {
    const tokenParams = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      scope: 'openid profile email Mail.Read User.Read offline_access',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      client_secret: MICROSOFT_CLIENT_SECRET,
    });
    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString(),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error(`[sync-outlook] Failed to refresh token for account: ${data.error_description}`);
      return null;
    }
    return data.access_token;
  } catch (error) {
    console.error('[sync-outlook] Exception refreshing token:', error);
    return null;
  }
}

/**
 * Lấy email cho 1 tài khoản Outlook
 */
async function fetchMessagesForAccount(account: Account, accessToken: string, dateRange: { from: string, to: string }): Promise<(Partial<Record> & { account: string; source: string; })[]> {

  const records: (Partial<Record> & { account: string; source: string; })[] = [];

  const fromISO = new Date(dateRange.from).toISOString();
  const toISO = new Date(dateRange.to).toISOString();

  for (const rule of RULES) {
    // Chỉ chạy các rule liên quan đến email, bỏ qua rule không có query
    const subjectQuery = rule.query.match(/subject:"([^"]+)"/i)?.[1] || '';
    const fromQueryMatch = rule.query.match(/from:([\w@.-]+)/i);
    if (!subjectQuery && !fromQueryMatch) {
      continue;
    }

    let filterParts = [`receivedDateTime ge ${fromISO}`, `receivedDateTime lt ${toISO}`];
    if (subjectQuery) filterParts.push(`contains(subject, '${subjectQuery.replace(/'/g, "''")}')`);
    if (fromQueryMatch?.[1]) filterParts.push(`startsWith(from/emailAddress/address, '${fromQueryMatch[1]}')`);

    const filter = filterParts.join(' and ');
    let url: string | undefined =
      `https://graph.microsoft.com/v1.0/me/messages?$filter=${encodeURIComponent(filter)}&$select=id,receivedDateTime,subject,bodyPreview,body,from&$orderby=receivedDateTime desc&$top=100`;

    while (url) {
      try {
        const response = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
        if (!response.ok) {
          console.error(`[sync-outlook] MS Graph API error for ${account.email}, rule ${rule.name}: ${response.statusText}`);
          break; // Lỗi, dừng vòng lặp này
        }
        const data = await response.json();
        const messages = data.value || [];
        if (messages.length === 0) break;

        for (const message of messages) {
          // IMPORTANT: Use raw content (HTML) if available, otherwise fallback.
          // Do NOT strip HTML here, as parsing rules might rely on HTML tags (e.g. Etsy).
          const body = message.body?.content || '';

          const parsedData = parseMessage(rule, message.subject || '', message.bodyPreview || '', body);
          if (parsedData) {
            records.push({
              ...parsedData,
              email_id: message.id,
              dt_local: new Date(message.receivedDateTime).toISOString(),
              account: account.email, // Thêm email tài khoản
              source: rule.name,      // Thêm nguồn rule
            });
          }
        }
        url = data['@odata.nextLink'];
      } catch (e) {
        console.error(`[sync-outlook] Failed to process message chunk for ${account.email}:`, e);
        url = undefined; // Dừng nếu có lỗi
      }
    }
  }
  return records;
}

/**
 * Helper chia mảng (để check duplicate)
 */
const chunkArray = <T>(array: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
};

const SAFE_BATCH_WRITE_LIMIT = 450;

function isTaskEligibleOrder(record: Partial<Record> & { source?: string; account?: string }): boolean {
  const itemCount = record.details?.items?.length || 0;
  return (
    (record.source === 'Etsy_Sales' || record.source === 'Ebay_Sales') &&
    Boolean(record.order_id) &&
    Boolean(record.account) &&
    itemCount > 0
  );
}

function getExpectedTaskIds(record: Partial<Record>): string[] {
  const orderId = record.order_id;
  const items = record.details?.items || [];
  if (!orderId || items.length === 0) return [];
  return items.map((_, index) => items.length > 1 ? `${orderId}-${index + 1}` : orderId);
}

function estimateRecordWrites(record: Partial<Record> & { source?: string; account?: string }): number {
  // 1 record write + optional sku_job + one task per item.
  return 1 + (isTaskEligibleOrder(record) ? 1 + (record.details?.items?.length || 0) : 0);
}

function estimatePostOrderWrites(record: Partial<Record> & { source?: string; account?: string }): number {
  return isTaskEligibleOrder(record) ? 1 + (record.details?.items?.length || 0) : 0;
}

function createBatchWriter(db: any, limit: number = SAFE_BATCH_WRITE_LIMIT) {
  let batch = db.batch();
  let writeCount = 0;
  let commitCount = 0;

  const commit = async () => {
    if (writeCount === 0) return;
    await batch.commit();
    commitCount++;
    batch = db.batch();
    writeCount = 0;
  };

  const ensureCapacity = async (additionalWrites: number = 1) => {
    if (writeCount > 0 && writeCount + additionalWrites > limit) {
      await commit();
    }
  };

  return {
    async ensureCapacity(additionalWrites: number = 1) {
      await ensureCapacity(additionalWrites);
    },
    set(ref: any, data: any, options?: any) {
      if (options) batch.set(ref, data, options);
      else batch.set(ref, data);
      writeCount++;
      return this;
    },
    update(ref: any, data: any) {
      batch.update(ref, data);
      writeCount++;
      return this;
    },
    delete(ref: any) {
      batch.delete(ref);
      writeCount++;
      return this;
    },
    async commit() {
      await commit();
    },
    getCommitCount() {
      return commitCount;
    }
  };
}

// --- Main Handler ---

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Bảo mật Cron Job
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).send('Unauthorized');
  }

  const db = getDb();
  const syncStartTime = new Date().toISOString();
  let totalNewRecords = 0;
  let totalTaskBackfills = 0;

  try {
    // 2. Lấy tất cả tài khoản Outlook
    const accountsRef = db.collection('user').doc(SHARED_USER_ID).collection('accounts');
    const snapshot = await accountsRef.where('provider', '==', 'outlook').get();
    if (snapshot.empty) {
      return res.status(200).json({ message: 'No Outlook accounts configured.' });
    }

    // Map account để lấy thông tin (Label/Tên Shop)
    const outlookAccounts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account));
    // Tạo Map: Email -> {id, label}
    const accountInfoMap = new Map(outlookAccounts.map(acc => [acc.email, { id: acc.id, label: acc.label || acc.email }]));

    console.log(`[sync-outlook] Found ${outlookAccounts.length} Outlook account(s) to sync.`);

    let allNewRecords: (Partial<Record> & { account: string; source: string; })[] = [];

    // 3. Lặp qua từng tài khoản để lấy email
    for (const account of outlookAccounts) {
      const accessToken = await getMicrosoftAccessToken(account.token);
      if (!accessToken) {
        console.warn(`[sync-outlook] Skipping account ${account.email} (failed to get token).`);
        continue;
      }

      // Sync 2 ngày gần nhất để tránh bỏ sót
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 7);

      const dateRange = {
        from: account.last_synced_at || twoDaysAgo.toISOString(),
        to: syncStartTime,
      };

      const accountRecords = await fetchMessagesForAccount(account, accessToken, dateRange);
      allNewRecords.push(...accountRecords);
    }

    if (allNewRecords.length === 0) {
      console.log('[sync-outlook] No new records found across all accounts.');
    } else {
      // 4. Lọc bỏ các email đã tồn tại (Copy logic từ firebaseService)
      const emailIdsToCheck = allNewRecords.map(r => r.email_id).filter(id => !!id) as string[];
      const existingEmailIds = new Set<string>();
      const existingRecordsByEmailId = new Map<string, any>();

      if (emailIdsToCheck.length > 0) {
        const recordsRef = db.collection('user').doc(SHARED_USER_ID).collection('records');
        const idChunks = chunkArray(emailIdsToCheck, 30); // Giới hạn 'in' của Firestore là 30
        for (const chunk of idChunks) {
          const q = recordsRef.where('email_id', 'in', chunk);
          const qSnapshot = await q.get();
          qSnapshot.forEach(doc => {
            const data = doc.data();
            if (data.email_id) {
              existingEmailIds.add(data.email_id);
              existingRecordsByEmailId.set(data.email_id, data);
            }
          });
        }
      }

      const recordsToAdd = allNewRecords.filter(
        r => !r.email_id || !existingEmailIds.has(r.email_id)
      );
      const existingRecordsToCheck = allNewRecords.filter(
        r => r.email_id && existingEmailIds.has(r.email_id) && isTaskEligibleOrder(r)
      );
      totalNewRecords = recordsToAdd.length;
      console.log(`[sync-outlook] Found ${allNewRecords.length} total, ${existingEmailIds.size} existing, ${totalNewRecords} new records to add.`);

      // 5. Lưu record mới và cập nhật timestamp
      if (totalNewRecords > 0 || existingRecordsToCheck.length > 0) {
        // 🟢 APPLY CATEGORY MAPPING
        const mappedRecords = await applyCategoryMappings(SHARED_USER_ID, recordsToAdd);

        const batchWriter = createBatchWriter(db);
        const recordsRef = db.collection('user').doc(SHARED_USER_ID).collection('records');

        // --- CHUẨN BỊ THÔNG BÁO ---
        const notificationEvents: { type: 'order' | 'refund' | 'funds', text: string }[] = [];

        for (const record of mappedRecords) {
          await batchWriter.ensureCapacity(estimateRecordWrites(record as any));
          const docRef = record.email_id
            ? recordsRef.doc(record.email_id)
            : recordsRef.doc();
          // Xóa id ảo nếu có trong object record
          const { id, ...recordData } = record as any;
          batchWriter.set(docRef, recordData);

          // --- TRIGGER SKU JOB & TASK CREATION ---
          await processNewOrder(db, batchWriter, SHARED_USER_ID, record as any, accountInfoMap);

          // --- TẠO NỘI DUNG THÔNG BÁO ---
          // Lấy tên Shop từ Map
          const shopName = accountInfoMap.get(record.account)?.label || record.account;

          if (record.kind === 'order') {
            const isRefund = record.source === 'Etsy_Refunded';
            if (isRefund) {
              notificationEvents.push({
                type: 'refund',
                text: `Refund: #${record.order_id || 'Unknown'} - $${Math.abs(record.refund_details.refundAmount)} ${record.refund_details.refundCurrency} (${shopName})`
              });
            } else {
              notificationEvents.push({
                type: 'order',
                text: `New Order: #${record.order_id || 'Unknown'} - $${record.amount} ${record.currency} (${shopName})`
              });
            }
          } else if (record.kind === 'Funds') {
            notificationEvents.push({
              type: 'funds',
              text: `Funds Received: $${record.amount} ${record.currency} (${shopName})`
            });
          }
        }

        // Cập nhật last_synced_at cho các tài khoản đã sync
        if (existingRecordsToCheck.length > 0) {
          const taskIdsToCheck = Array.from(new Set(existingRecordsToCheck.flatMap(getExpectedTaskIds)));
          const existingTaskIds = new Set<string>();

          for (const chunk of chunkArray(taskIdsToCheck, 30)) {
            if (chunk.length === 0) continue;
            const taskSnap = await db.collection('tasks').where('id', 'in', chunk).get();
            taskSnap.forEach((doc: any) => existingTaskIds.add(doc.id));
          }

          for (const parsedRecord of existingRecordsToCheck) {
            const expectedTaskIds = getExpectedTaskIds(parsedRecord);
            const hasMissingTask = expectedTaskIds.some(taskId => !existingTaskIds.has(taskId));
            if (!hasMissingTask) continue;

            const storedRecord = parsedRecord.email_id
              ? existingRecordsByEmailId.get(parsedRecord.email_id)
              : null;
            const recordForTaskSync = {
              ...(storedRecord || {}),
              ...parsedRecord,
            };

            await batchWriter.ensureCapacity(estimatePostOrderWrites(recordForTaskSync as any));
            await processNewOrder(db, batchWriter, SHARED_USER_ID, recordForTaskSync as any, accountInfoMap);
            expectedTaskIds.forEach(taskId => existingTaskIds.add(taskId));
            totalTaskBackfills++;
          }
        }

        for (const account of outlookAccounts) {
          await batchWriter.ensureCapacity(1);
          const accRef = accountsRef.doc(account.id);
          batchWriter.update(accRef, { last_synced_at: syncStartTime });
        }

        await batchWriter.commit();
        console.log(`[sync-outlook] Committed writes in ${batchWriter.getCommitCount()} batch(es). Backfilled ${totalTaskBackfills} order task set(s).`);

        await markDailyCacheDirtyForISOValues(
          db,
          SHARED_USER_ID,
          ['records'],
          mappedRecords.map(record => record.dt_local),
          'outlook-sync'
        ).catch(error => console.warn('[sync-outlook] Failed to mark daily cache dirty:', error));

        // --- GỮI THÔNG BÁO PUSH (SAU KHI LƯU DB THÀNH CÔNG) ---
        if (notificationEvents.length > 0) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboardvikcom.vercel.app/';
          const orders = notificationEvents.filter(e => e.type === 'order');
          const refunds = notificationEvents.filter(e => e.type === 'refund');
          const funds = notificationEvents.filter(e => e.type === 'funds');

          // Gửi thông báo Order
          if (orders.length > 0) {
            if (orders.length === 1) {
              // Nếu chỉ có 1 đơn, hiện chi tiết
              await sendPushNotificationToUsers(SHARED_USER_ID, 'order', {
                title: 'New Order',
                body: orders[0].text,
                url: `${appUrl}/?tab=Order+List`
              });
            } else {
              // Nếu có nhiều đơn, hiện tổng quan
              await sendPushNotificationToUsers(SHARED_USER_ID, 'order', {
                title: 'New Orders',
                body: `You have ${orders.length} new orders.`,
                url: `${appUrl}/?tab=Order+List`
              });
            }
          }

          // Gửi thông báo Refund
          if (refunds.length > 0) {
            if (refunds.length === 1) {
              await sendPushNotificationToUsers(SHARED_USER_ID, 'order', {
                title: 'Refund Processed',
                body: refunds[0].text,
                url: `${appUrl}/?tab=Order+List`
              });
            } else {
              await sendPushNotificationToUsers(SHARED_USER_ID, 'order', {
                title: 'Refunds Processed',
                body: `You have ${refunds.length} successful refunds.`,
                url: `${appUrl}/?tab=Order+List`
              });
            }
          }

          // Gửi thông báo Funds
          if (funds.length > 0) {
            if (funds.length === 1) {
              await sendPushNotificationToUsers(SHARED_USER_ID, 'funds', {
                title: 'Funds Received',
                body: funds[0].text,
                url: `${appUrl}/?tab=Overview`
              });
            } else {
              await sendPushNotificationToUsers(SHARED_USER_ID, 'funds', {
                title: 'New Funds',
                body: `You have ${funds.length} new payout updates.`,
                url: `${appUrl}/?tab=Overview`
              });
            }
          }
        }
      }
    }

    res.status(200).json({
      message: 'Outlook sync complete.',
      accounts_synced: outlookAccounts.length,
      new_records_added: totalNewRecords,
      task_backfills: totalTaskBackfills
    });

  } catch (error: any) {
    console.error('[API /sync-outlook Error]', error);
    res.status(500).send(error.message || 'Failed to sync Outlook data.');
  }
}
