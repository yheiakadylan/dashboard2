# Dashboard Vikcom

Một ứng dụng dashboard thương mại điện tử hiệu suất cao, toàn diện được xây dựng bằng React, TypeScript và Firebase. Ứng dụng này tổng hợp dữ liệu từ nhiều nguồn (Gmail, eBay, Etsy, v.v.) để cung cấp thông tin chi tiết theo thời gian thực, quản lý đơn hàng và báo cáo tài chính.

**Mục đích**: README này tài liệu hóa tất cả các tính năng, từ kiến trúc cốt lõi đến các chi tiết UI nhỏ nhất, đóng vai trò là tài liệu tham khảo chính thống cho việc kiểm thử (testing) và phát triển sau này.

## 🏗 Kiến trúc Hệ thống

*   **Frontend Framework**: React 18 với TypeScript.
*   **Quản lý State**: Context API (`DashboardContext` cho dữ liệu, `UIContext` cho giao diện, `NotificationContext` cho thông báo).
*   **Hiệu suất**:
    *   **Web Workers**: Sử dụng nhiều (`workers/dataWorker.ts`) để xử lý các tập dữ liệu lớn trên luồng phụ, giữ cho UI luôn phản hồi nhanh.
    *   **Code Splitting**: Tải chậm (Lazy loading) các component nặng (`Suspense`, `React.lazy`).
    *   **Virtualization**: Render hiệu quả các bảng dữ liệu lớn.
*   **Backend / Serverless**:
    *   **Firebase**: Xác thực (Auth), Cơ sở dữ liệu (Firestore), và Cloud Functions.
    *   **Services**: Các dịch vụ dạng module cho việc phân tích Email (`emailService.ts`), Auth, và tương tác Firebase.
*   **Styling**: Tailwind CSS hỗ trợ cả chế độ Sáng/Tối (Dark/Light mode).
*   **PWA**: Tính năng Progressive Web App cho phép cài đặt trên thiết bị di động.

---

## 🚀 Tính năng & Chức năng

### 1. Xác thực & Quản lý Người dùng
*   **Phân quyền dựa trên vai trò (RBAC)**:
    *   **Owner (Chủ sở hữu)**: Toàn quyền truy cập dữ liệu, cài đặt, quản lý team và thanh toán.
    *   **User (Nhân viên)**: Quyền truy cập bị hạn chế dựa trên sự cho phép của Owner.
*   **Quản lý Team (Chỉ Owner)**:
    *   Thêm/Mời thành viên mới.
    *   Quản lý quyền hạn cho từng user (ví dụ: quyền truy cập tab cụ thể, xem doanh thu, xem dữ liệu fulfill).
*   **Thông báo Đăng nhập**:
    *   Hệ thống cảnh báo cho Owner khi có User đăng nhập.
    *   Phân biệt an toàn giữa các vai trò user khi đăng nhập.
*   **Quản lý Phiên làm việc**: Đăng xuất an toàn và duy trì phiên đăng nhập.

### 2. Tích hợp & Đồng bộ Dữ liệu
*   **Hỗ trợ Đa kênh**:
    *   Tích hợp với Gmail để phân tích đơn hàng từ nhiều nền tảng (eBay, Etsy, v.v.).
    *   Hỗ trợ kết nối nhiều tài khoản cùng lúc.
*   **Chiến lược Đồng bộ Dữ liệu**:
    *   **Real-time Sync (Đồng bộ thời gian thực)**: Lắng nghe thay đổi và cập nhật (thông qua Gmail watch).
    *   **Manual Sync (Đồng bộ thủ công)**: Kích hoạt đồng bộ cho các tài khoản cụ thể.
    *   **Quick Sync (Đồng bộ nhanh)**: Kiểm tra nhanh các thay đổi gần đây (7 ngày qua).
    *   **Historical Sync (Đồng bộ lịch sử)**: Quét sâu dữ liệu quá khứ.
    *   **Resync (Đồng bộ lại)**: Khả năng reset hoàn toàn và tải lại dữ liệu cho một tài khoản cụ thể.
*   **Cơ chế Phân tích Email**:
    *   Các quy tắc phức tạp (`rules.ts`) để trích xuất chi tiết đơn hàng từ nhiều định dạng email khác nhau.
    *   Xử lý dữ liệu "Chi tiết" (Details) so với dữ liệu "Đơn hàng" (Order).

### 3. Giao diện Dashboard & Trực quan hóa
*   **Bộ lọc Toàn cục**:
    *   **Chọn Khoảng thời gian**: Tùy chỉnh khoảng ngày hoặc dùng các mốc có sẵn (Hôm nay, Hôm qua, 7/30 ngày qua, v.v.).
    *   **Chọn Múi giờ**: Điều chỉnh hiển thị toàn bộ dữ liệu theo múi giờ cụ thể.
    *   **Lọc Tài khoản**: Xem dữ liệu của "Tất cả tài khoản" hoặc đi sâu vào một tài khoản kết nối cụ thể.
    *   **Tìm kiếm**: Chức năng tìm kiếm toàn cục.
*   **Thẻ KPI**: Các chỉ số cấp cao luôn hiển thị (hoặc phụ thuộc vào tab):
    *   Tổng đơn hàng (Total Orders)
    *   Doanh thu (Revenue - cần quyền)
    *   Chi phí (Costs - cần quyền)
    *   Lợi nhuận ròng (Net Profit)
    *   Biên lợi nhuận (Margins)
*   **Biểu đồ Tương tác**:
    *   **Overview Chart**: Xu hướng đơn hàng/doanh thu theo thời gian.
    *   **Summary Chart**: Tổng hợp các chỉ số hiệu suất.
    *   **Top Products**: Trực quan hóa các sản phẩm bán chạy nhất.
    *   **Fulfillment Charts**: Hiệu suất Merchize / Printway (nếu có).

### 4. Quản lý Đơn hàng (DataGrid)
*   **Bảng Dữ liệu Nâng cao**:
    *   **Sắp xếp**: Sắp xếp theo nhiều cột.
    *   **Phân trang**: Xử lý hiệu quả danh sách lớn.
    *   **Drill-down**: Click để xem **Chi tiết Đơn hàng** đầy đủ.
*   **Thao tác Đơn hàng**:
    *   **Xem Chi tiết**: Modal hiển thị thông tin đầy đủ (khách hàng, vận chuyển, sản phẩm).
    *   **Resync Order**: Hành động cụ thể để phân tích lại/lấy lại dữ liệu cho một đơn hàng bị lỗi.
*   **Chi phí Thủ công (Manual Costs)**:
    *   `ManualCostManager`: Giao diện để nhập thêm các chi phí không được ghi nhận tự động (ví dụ: ads, phần mềm).

### 5. Tabs & Module
Ứng dụng được chia thành các tab có thể cấu hình:
*   **Overview**: Sức khỏe chung của doanh nghiệp, biểu đồ và KPI cấp cao.
*   **Order List**: Danh sách chi tiết tất cả giao dịch.
*   **Products**: Hiệu suất theo SKU/Tên sản phẩm.
*   **Fulfill**: Trạng thái hoàn tất đơn hàng (fulfillment) và tracking.
*   **Case / Help**: (Quản lý tác vụ hoặc vé hỗ trợ).

### 6. Xuất dữ liệu & Báo cáo
*   **Xuất Excel**:
    *   Xuất toàn bộ dữ liệu dashboard ra file `.xlsx`.
    *   **Hỗ trợ Hình ảnh**: Tùy chọn nhúng hình ảnh sản phẩm trực tiếp vào file Excel.
    *   **Theo dõi Tiến độ**: Thanh tiến trình/trạng thái thời gian thực cho các lần xuất dữ liệu lớn.
    *   **Nhận diện Múi giờ**: Tên file bao gồm múi giờ khi xuất.

### 7. Cài đặt & Tùy chỉnh
*   **Quản lý Tab**:
    *   Sắp xếp lại thứ tự tab bằng kéo-thả via drag-and-drop.
    *   Ẩn/Hiện các tab cụ thể.
*   **Quản lý Tài khoản (Account Manager)**:
    *   Thêm/Xóa các tài khoản Gmail kết nối.
    *   Xem trạng thái đồng bộ của từng tài khoản.
*   **Cài đặt Thông báo**:
    *   Cấu hình cảnh báo cho các sự kiện cụ thể.
*   **Giao diện (Theme)**:
    *   Chuyển đổi giữa chế độ Sáng (Light) và Tối (Dark).

### 8. Trải nghiệm Mobile & PWA
*   **Thiết kế Đáp ứng (Responsive)**: UI tương thích hoàn toàn cho mobile, tablet và desktop.
*   **Điều hướng Mobile**: Component `BottomNav` giúp thao tác dễ dàng bằng ngón cái trên điện thoại.
*   **Kéo để làm mới (Pull-to-Refresh)**: Thao tác vuốt tự nhiên để tải lại dữ liệu trên mobile.
*   **Haptics**: Phản hồi rung khi tương tác (ví dụ: cập nhật thành công).
*   **Cài đặt**: Lời nhắc "Cài đặt Ứng dụng" tùy chỉnh cho PWA.

### 9. Chi tiết UX & Hoàn thiện
*   **Skeleton Loading**: Hiệu ứng chờ (`SidebarSkeleton`, `SkeletonLoader`) để tránh giật bố cục (CLS) khi đang tải dữ liệu.
*   **Toasts**: Thông báo pop-up không xâm lấn cho các tin nhắn thành công/lỗi.
*   **Error Boundaries**: Xử lý mượt mà các trường hợp crash component để tránh màn hình trắng.
*   **Quản lý Modal**: Xử lý `ClickOutside` để dễ dàng đóng các modal cài đặt/tài khoản.

---

## 🛠 Hướng dẫn Phát triển

### Yêu cầu tiên quyết
*   Node.js (Khuyên dùng bản LTS)
*   npm hoặc yarn

### Cài đặt
```bash
# Clone repository
git clone <repository-url>

# Cài đặt dependencies
npm install
```

### Chạy trên máy cục bộ
```bash
# Khởi động development server
npm start
# HOẶC nếu dùng Vercel
vercel dev
```

### Cấu trúc Dự án
```text
src/
├── api/            # Serverless functions / Backend API handlers
├── components/     # React components (UI)
│   ├── datatable/  # Các component riêng cho bảng dữ liệu
│   ├── tabs/       # Các view tab chính (Overview, Orders, v.v.)
│   └── ...         # Các thành phần chung (Header, Sidebar, Modals)
├── contexts/       # Global State (Dashboard, UI, Notification)
├── hooks/          # Custom React Hooks (DataSync, Auth, v.v.)
├── services/       # Business Logic & External API wrappers (Firebase, Email)
├── utils/          # Các hàm hỗ trợ (Formatting, Export, Permissions)
├── workers/        # Web Workers để xử lý nền
├── types.ts        # Định nghĩa TypeScript
└── App.tsx         # Component gốc & Logic định tuyến
```

### Chiến lược Test (Tương lai)
README này đóng vai trò là cơ sở để bao phủ test case. Các khu vực chính cần test:
1.  **Unit Tests**:
    *   `services/emailService.ts`: Test các quy tắc phân tích (rules) với các mẫu email.
    *   `utils/`: Test các hàm hỗ trợ (định dạng ngày, logic phân quyền).
2.  **Integration Tests**:
    *   **Data Sync**: Xác minh `useDataSync` cập nhật chuẩn xác `DashboardContext`.
    *   **Export**: Xác minh việc tạo file Excel ra đúng định dạng.
3.  **E2E Tests (Cypress/Playwright)**:
    *   **Luồng Auth**: Đăng nhập -> Dashboard -> Đăng xuất.
    *   **CRUD**: Thêm chi phí thủ công -> Kiểm tra hiển thị trong bảng.
    *   **Điều hướng**: Chuyển tab, Bật/tắt menu mobile.
    *   **Export**: Chạy luồng xuất dữ liệu.
