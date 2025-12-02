// services/notificationService.ts

export const sendLarkLoginNotification = (
  email: string | null, 
  role: string
): void => {
  
  // 1. Chỉ gửi thông báo nếu là 'user' (kiểm tra ở đây để đỡ tốn 1 API call)
  if (role !== 'user') {
    return; 
  }

  // 2. GỌI TỚI API ROUTE CỦA BẠN, KHÔNG GỌI LARK TRỰC TIẾP
  // Đây là "fire-and-forget", không cần await
  fetch('/api/lark-login-notify', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, role }),
  }).catch(err => {
    // Log lỗi ở client, không ảnh hưởng user
    console.error('Failed to trigger login notification:', err);
  });
};