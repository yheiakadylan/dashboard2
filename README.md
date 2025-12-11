# 📊 Sales Dashboard

Ứng dụng quản lý bán hàng đa kênh với hiệu suất cao, tích hợp eBay, Etsy và các nền tảng thương mại điện tử.

## ✨ Tính năng chính

### 📈 Tổng quan & Phân tích
- **Dashboard Overview**: Biểu đồ doanh thu, đơn hàng, cases theo thời gian thực
- **Multi-Channel Integration**: Kết nối eBay, Etsy, và các marketplace khác
- **Advanced Analytics**: So sánh period-over-period, phân tích xu hướng
- **Top Products Tracking**: Theo dõi sản phẩm bán chạy

### 🔄 Đồng bộ tự động
- **Email Sync**: Tự động đồng bộ emails từ Gmail
- **Historical Data**: Quét và đồng bộ dữ liệu lịch sử tự động
- **Real-time Updates**: Cập nhật đơn hàng theo thời gian thực
- **Gmail Watch API**: Push notifications cho emails mới

### 📦 Quản lý đơn hàng
- **Order Management**: Quản lý đơn hàng từ nhiều kênh
- **Fulfillment Tracking**: Theo dõi chi phí fulfillment (ShipStation integration)
- **Manual Cost Input**: Nhập chi phí thủ công
- **Order Details**: Xem chi tiết đầy đủ từng đơn hàng

### 👥 Phân quyền người dùng
- **Team Management**: Quản lý nhiều tài khoản trong team
- **Role-based Access**: Owner và User roles với permissions riêng
- **Account Filtering**: Giới hạn truy cập theo tài khoản được phép

### ⚡ Tối ưu hóa hiệu suất
- **10x Faster Loads**: Tải trang nhanh hơn 10 lần nhờ IndexedDB caching
- **Code Splitting**: Lazy loading components để giảm bundle size
- **Offline Support**: Hoạt động offline với cached data
- **PWA Ready**: Progressive Web App với service worker

## 🚀 Hiệu suất

### Thời gian tải
- **Lần đầu tiên**: ~2.5s
- **Lượt truy cập tiếp theo**: ~100-300ms (từ cache)
- **Cải thiện**: 10x nhanh hơn!

### Kích thước Bundle
- **CSS**: 37KB (6.86KB gzipped) - nhỏ hơn 98%
- **JavaScript**: Được chia thành nhiều chunks để tối ưu
- **Total Bundle**: ~1.4MB (optimized & cached)

## 🛠️ Tech Stack

### Frontend
- **React 19.2.1** - Latest UI framework
- **TypeScript** - Type safety
- **TailwindCSS 3.4** - Styling (local build)
- **Recharts** - Data visualization
- **React Window** - Virtualized lists

### Backend & Services
- **Firebase Firestore** - Database
- **Firebase Auth** - Authentication
- **Gmail API** - Email integration
- **Google Gemini AI** - AI features

### Build & Tools
- **Vite 6.4** - Build tool & dev server
- **PostCSS** - CSS processing
- **Terser** - Minification
- **PWA Plugin** - Service worker generation

### Caching & Performance
- **IndexedDB** (idb-keyval) - Client-side caching
- **Stale-while-revalidate** - Caching strategy
- **Code splitting** - Optimal loading

## 📥 Cài đặt

### Yêu cầu
- Node.js 18+
- npm hoặc yarn
- Firebase project
- Google Cloud project (Gmail API)

### Bước 1: Clone repository
```bash
git clone https://github.com/yheiakadylan/dashboardvikcom.git
cd dashboardvikcom
```

### Bước 2: Install dependencies
```bash
npm install
```

### Bước 3: Cấu hình Firebase

#### 3.1. Tạo Firebase Config cho Service Worker
Service worker cần Firebase config để xử lý push notifications:

```bash
```

Sau đó mở `public/firebase-config.js` và điền thông tin Firebase của bạn:
```javascript
self.FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

> **Lưu ý**: File `public/firebase-config.js` đã được thêm vào `.gitignore` để bảo mật.

#### 3.2. Cấu hình Firebase trong Code
Firebase config trong `services/firebaseService.ts` sẽ tự động sử dụng các biến môi trường hoặc fallback values.
Cập nhật Firebase config trong `services/firebaseService.ts`

### Bước 5: Chạy ứng dụng

**Development:**
```bash
npm run dev
```
Mở http://localhost:3000

**Production build:**
```bash
npm run build
npm run preview
```

## 📊 Cấu trúc dự án

```
dashboardvikcom/
├── api/                    # API routes & handlers
│   └── _lib/              # Shared types & utilities
├── components/            # React components
│   ├── Auth.tsx          # Authentication
│   ├── DataTable.tsx     # Virtualized data table
│   ├── AccountManager.tsx # Account management
│   └── charts/           # Chart components
├── contexts/             # React contexts
│   ├── DashboardContext.tsx  # Main dashboard state
│   └── NotificationContext.tsx # Toast notifications
├── services/             # External service integrations
│   ├── firebaseService.ts    # Firebase operations
│   ├── emailService.ts       # Gmail API integration
│   └── fulfillmentService.ts # ShipStation integration
├── utils/                # Utilities
│   ├── cacheService.ts   # IndexedDB caching
│   └── dataProcessing.ts # Data transformation
├── src/
│   └── index.css         # TailwindCSS entry
├── App.tsx               # Main app component
├── index.html            # HTML entry
├── vite.config.ts        # Vite configuration
└── tailwind.config.js    # TailwindCSS config
```

## 🔑 Tính năng nâng cao

### Email Sync System
- Tự động đồng bộ emails từ Gmail theo định kỳ
- Historical sync: Quét ngược lịch sử emails
- Gmail Watch API: Real-time push notifications
- Intelligent parsing: Tự động parse đơn hàng từ email

### Caching Strategy
- **5-minute TTL**: Cache data trong 5 phút
- **Stale-while-revalidate**: Hiển thị data cũ ngay lập tức, refresh background
- **Cache invalidation**: Tự động invalidate khi sync manuallỵ
- **Offline support**: Hoạt động offline với cached data

### Multi-Channel Support
- **eBay**: Orders, cases, tracking
- **Etsy**: Orders, messages
- **Custom parsers**: Dễ dàng thêm marketplace mới

## 🎨 UI/UX Features

- **Dark Mode**: Giao diện tối hiện đại
- **Responsive**: Tối ưu cho mọi kích thước màn hình
- **Virtualized Tables**: Xử lý hàng ngàn records mượt mà
- **Loading States**: Suspense fallbacks cho lazy-loaded components
- **Toast Notifications**: Thông báo real-time cho mọi actions

## 🔒 Bảo mật

- Firebase Authentication với Google Sign-in
- Role-based access control (Owner/User)
- Account-level permissions
- Secure API key management
- Environment variables cho sensitive data

## 📈 Performance Monitoring

### Metrics được theo dõi:
- First Contentful Paint (FCP)
- Time to Interactive (TTI)
- Cache hit rate
- Bundle sizes
- Load times

### Optimization Techniques:
- Code splitting by vendor
- Lazy loading components
- Image optimization
- CSS purging (TailwindCSS)
- Minification & compression

## 🚦 Roadmap

### Upcoming Features
- [ ] More marketplace integrations
- [ ] Advanced reporting & exports
- [ ] Mobile app (React Native)
- [ ] Automated response templates
- [ ] AI-powered insights with Gemini

## 🤝 Contributing

Dự án private. Liên hệ owner để được cấp quyền truy cập.

## 📝 Changelog

### v1.1.0 (2025-12-11)
- 🎨 **UI Enhancements**: Skeleton loading, empty states, enhanced toast notifications
- ⚛️ **React 19.2.1**: Updated to latest React version
- 🔒 **Security**: Firebase config moved to gitignore, no exposed credentials
- 🚀 **Cache UX**: Improved stale-while-revalidate with dimming effect
- ✨ **Toast Notifications**: Progress bars, gradient styling, stacking support
- 📭 **Empty States**: Beautiful icons, messages, and action buttons
- 💀 **Skeleton Loading**: Shimmer animation for better loading experience

### v1.0.0-optimized (2025-12-10)
- ✨ IndexedDB caching với 10x faster loads
- ⚡ TailwindCSS local build (98% smaller)
- 🚀 Code splitting & lazy loading
- 🎯 Stale-while-revalidate strategy
- 📦 PWA support
- 🔧 Build optimizations

### v0.x.x (Previous)
- Initial dashboard implementation
- Multi-channel integration
- Email sync system
- Team management

## 📄 License

Private - All rights reserved © haitrinh

## 👤 Author

**yheiakadylan**
- GitHub: [@yheiakadylan](https://github.com/yheiakadylan)

## 📞 Support

Để được hỗ trợ, vui lòng liên hệ qua:
- Email: haitrinh2605204@gmail.com
- GitHub Issues: https://github.com/yheiakadylan/dashboardvikcom/issues

---

Built with ❤️ for efficient multi-channel sales management
