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

    // DEDUPLICATION GATEWAY: Prevent creating identical notifications within 2 minutes.
    // This stops "rác" (garbage) right at the backend source before it even reaches Firestore.
    try {
        const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const recentDocs = await notificationsRef
            .where('type', '==', type)
            .where('createdAt', '>=', twoMinsAgo)
            .get();

        for (const doc of recentDocs.docs) {
            const data = doc.data();
            if (data.title === title && data.content === content) {
                console.log(`[Notification] 🛡️ Backend Deduplication Blocked Duplicate Event: ${title}`);
                return doc.id; // Return the existing ID to fake success, but don't duplicate
            }
        }
    } catch (err) {
        console.error('[Notification] Error checking duplicates:', err);
        // If query fails (e.g., missing index), fall through to just add the notification
    }

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
