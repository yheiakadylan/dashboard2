// api/_lib/notificationHelper.ts
import { getDb } from './firebaseAdminHelper.js';

export interface CreateNotificationParams {
    teamId: string;
    type: 'NEW_ORDER' | 'FUND' | 'SUMMARY' | 'LOGIN' | 'CASE_HELP';
    title: string;
    content: string;
    metadata: Record<string, any>;
}

/**
 * Tạo notification document trong Firestore và trả về ID
 * Dùng để có notification ID trước khi gửi FCM push
 */
export async function createNotificationDocument(params: CreateNotificationParams): Promise<string> {
    const { teamId, type, title, content, metadata } = params;

    const db = getDb();
    const notificationsRef = db.collection('user').doc(teamId).collection('notifications');

    const notificationDoc = await notificationsRef.add({
        type,
        title,
        content,
        metadata,
        createdAt: new Date().toISOString(),
        isRead: false,
    });

    console.log(`[Notification] Created notification document: ${notificationDoc.id}`);
    return notificationDoc.id;
}
