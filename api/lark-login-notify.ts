// File: api/lark-login-notify.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendPushNotificationToUsers } from './_lib/fcmHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed.' });
  }

  const { email, role, teamId } = req.body;

  // 1. Chỉ gửi nếu là 'user'
  if (role !== 'user') {
    return res.status(200).json({ message: 'Notification skipped for owner.' });
  }

  // 2. Chuẩn bị nội dung
  const userEmail = email || 'Không rõ email';

  // 3. Gửi FCM Push Notification
  try {
    if (teamId) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboard2-alpha-bay.vercel.app/';

      // Create notification document first
      const { createNotificationDocument } = await import('./_lib/notificationHelper.js');
      const notificationId = await createNotificationDocument({
        teamId,
        type: 'LOGIN',
        title: 'Team Member Login',
        content: `${userEmail} logged into the dashboard`,
        metadata: {
          login_info: {
            user_email: userEmail,
            user_role: role,
            timestamp: new Date().toISOString(),
          },
        },
      });

      await sendPushNotificationToUsers(teamId, 'login', {
        title: '🔔 User Login',
        body: `${userEmail} đã đăng nhập vào dashboard`,
        url: `${appUrl}?notification=${notificationId}` // Deep link to notification detail
      });
      console.log('[api/lark-login-notify] FCM notification sent successfully');
    } else {
      console.warn('[api/lark-login-notify] No teamId provided, skipping FCM notification');
    }
  } catch (err: any) {
    console.error('[api/lark-login-notify] Failed to send FCM notification:', err);
  }

  return res.status(200).json({ message: 'Notifications sent.' });
}
