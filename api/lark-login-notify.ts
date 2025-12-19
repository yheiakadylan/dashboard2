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

  // 2. Lấy URL bí mật từ server environment (KHÔNG có VITE_)
  const LARK_URL = process.env.LARK_LOGIN_WEBHOOK_URL;

  // 3. Chuẩn bị nội dung
  const userEmail = email || 'Không rõ email';
  const content = `🔔 User Login: Tài khoản ${userEmail} vừa đăng nhập vào dashboard.`;

  const payload = {
    msg_type: "text",
    content: { text: content },
  };

  // 4. Gửi Lark notification (giữ nguyên)
  if (LARK_URL) {
    try {
      await fetch(LARK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.error('[api/lark-login-notify] Failed to send Lark notification:', err);
    }
  }

  // 5. Gửi FCM Push Notification (NEW!)
  try {
    if (teamId) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dashboardvikcom.vercel.app/';

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
