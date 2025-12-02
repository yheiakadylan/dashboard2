// File: api/lark-login-notify.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed.' });
  }

  const { email, role } = req.body;
  
  // 1. Chỉ gửi nếu là 'user'
  if (role !== 'user') {
    return res.status(200).json({ message: 'Notification skipped for owner.' });
  }

  // 2. Lấy URL bí mật từ server environment (KHÔNG có VITE_)
  const LARK_URL = process.env.LARK_LOGIN_WEBHOOK_URL;

  if (!LARK_URL) {
    console.warn('[api/lark-login-notify] LARK_LOGIN_WEBHOOK_URL is not set on the server.');
    // Trả về 200 để client không bị lỗi, nhưng log lỗi ở server
    return res.status(200).json({ message: 'Notification skipped, server not configured.' });
  }

  // 3. Chuẩn bị nội dung
  const userEmail = email || 'Không rõ email';
  const content = `🔔 User Login: Tài khoản ${userEmail} vừa đăng nhập vào dashboard.`;
  
  const payload = {
    msg_type: "text",
    content: { text: content },
  };

  // 4. Gửi request từ server
  try {
    await fetch(LARK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return res.status(200).json({ message: 'Notification sent.' });
  } catch (err: any) {
    console.error('[api/lark-login-notify] Failed to send Lark notification:', err);
    return res.status(500).json({ message: 'Failed to send notification.' });
  }
}