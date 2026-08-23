# Dashboard

Dashboard nội bộ cho vận hành shop thương mại điện tử. Ứng dụng gom dữ liệu order/review/cost từ Gmail, Outlook, Firestore, supplier API và Lark để theo dõi doanh thu, sản phẩm, fulfillment, support, review và báo cáo tuần.

Mục tiêu chính của dự án là dữ liệu phải đúng, load nhanh trên range dài, và hạn chế đọc Firestore không cần thiết.

## Tech Stack

- Frontend: React 19, TypeScript, Vite, Tailwind CSS.
- Backend: Vercel Serverless Functions trong thư mục `api/`.
- Database: Firebase Auth, Firestore, Storage, FCM.
- Data processing: Web Worker `src/workers/dataWorker.ts`.
- Tables: `react-window` virtualization.
- Charts: Recharts, lazy loaded theo tab.
- Export: ExcelJS, lazy imported khi xuất file.
- PWA: `vite-plugin-pwa`.

## Chức Năng Chính

- Dashboard KPI: orders, shops, revenue, funds, cost, earn.
- Order List: danh sách order, refund, case/help, search/filter, lazy load order detail.
- Products: product summary, top products, SKU cleanup, grouping theo name/SKU/shop/mockup image.
- Fulfill: fulfillment records, cost, refunded products, supplier view.
- Reviews: lọc rating theo từng sao, filter shop dùng chung header.
- Report: weekly operations report, revenue/top SKU/review/operation data, có phân quyền riêng.
- Export Excel: product summary, top products by shop/category, staff summary bằng formula để sửa sheet gốc thì summary đổi theo.
- Cost sync: fetch cost từ Merchize/Printway theo batch, có progress UI.
- Notification Center: lazy Firestore listener, mở panel mới tải list nặng.
- Lark integration: daily summary, order detail, trigger SKU fetch, sync SKU to tasks.

## Data Flow

```text
Gmail / Outlook
  -> api/gmail-webhook.ts hoặc api/sync-outlook.ts
  -> parse bằng src/services/rules.ts
  -> user/{teamId}/records
  -> tạo sku_jobs và tasks nếu là order hợp lệ
  -> mark daily_cache dirty cho ngày bị ảnh hưởng

Dashboard UI
  -> src/hooks/useDataSync.ts
  -> src/services/firebaseService.ts
  -> daily cache hoặc live query
  -> src/workers/dataWorker.ts
  -> tab hiện tại render phần cần thiết trước
```

Các record order dùng `dt_local` dạng ISO 8601 string. Không tự ý đổi sang Firestore Timestamp trong UI logic.

## Daily Cache

Cache nằm ở:

```text
user/{teamId}/daily_cache/{collection}__{offsetKey}__{yyyy-mm-dd}
```

Offset được cache:

- `p7`: UTC+07:00
- `m7`: UTC-07:00
- `m8`: UTC-08:00

Nguyên tắc:

- Ngày hiện tại theo offset đang xem luôn query live từ Firestore.
- Ngày cũ ưu tiên đọc `daily_cache`.
- Nếu cache miss/dirty/unsupported timezone thì fallback live query.
- Sau live query, hệ thống có thể ghi cache lại ở background.
- Khi record thay đổi sau order như cost, refund, help, case, review, SKU/task sync, code phải mark cache dirty cho các ngày liên quan.

Cron backfill:

```json
{
  "path": "/api/backfill-daily-cache",
  "schedule": "30 7,8,17 * * *"
}
```

Tương ứng sau khi ngày vừa kết thúc ở các offset `-7`, `-8`, `+7`.

Backfill thủ công:

```bash
curl "https://<app>/api/backfill-daily-cache?secret=<CRON_SECRET>&from=2026-06-01&to=2026-06-30&offsets=p7,m7,m8&collections=records,reviews&force=true"
```

Mỗi request giới hạn 45 ngày, cần chia nhỏ nếu range dài hơn.

## Sync Mail

Gmail:

- OAuth callback lưu refresh token trong `account.token`.
- Realtime Gmail watch gọi `api/gmail-webhook.ts`.
- Webhook dùng `getAccessTokenFromRefreshToken(account.token)` để lấy access token tạm thời.
- Không đổi format token cũ.

Outlook:

- Cron gọi `api/sync-outlook.ts`.
- Hàm `getMicrosoftAccessToken(refreshToken)` dùng refresh token trong account.
- Cron hiện tại chạy `0 7 * * *`.

Lưu ý khi sửa:

- Không overwrite `account.token` nếu chỉ sửa label/order/status.
- Không xóa account nếu user không chủ động remove.
- Không đổi OAuth scope/refresh-token flow nếu không test lại login Gmail/Outlook.

## Export Excel

Logic export nằm ở `src/utils/excelExport.ts`.

Các điểm cần giữ đúng:

- Revenue product dùng cùng công thức với Product Summary.
- SKU xuất ra không fallback qua product name nếu SKU trống hoặc `"NULL"`.
- SKU được tách thêm prefix trong export, ví dụ:

```text
TAPEL01-I023-OXIT9X7ANL-RE
-> Product Code: TAPEL01
-> Staff Code: I023
-> Listing Code: OXIT9X7ANL-RE
```

- Staff Summary dùng formula dựa trên Product Summary để user sửa staff code/revenue/quantity trong sheet gốc thì sheet summary cập nhật theo.
- Revenue trong sheet nên làm tròn số hiển thị, không để lẻ quá dài.

## SKU Cleanup

SKU cleanup nằm trong `src/components/tabs/ProductsTab.tsx`.

Chỉ hiển thị nhóm cần sửa:

- Trùng product title nhưng SKU thiếu/ngắn/khác thường.
- Cùng shop, cùng title, cùng mockup image có thể auto-safe.
- Có mockup images theo từng SKU variant để dễ chọn SKU đúng.
- User có thể chọn SKU có sẵn hoặc nhập custom SKU.

Khi update SKU:

- Update theo chunk để tránh Firestore write queue exhausted.
- Update UI local ngay sau batch thành công để không phải F5/query lại.
- Mark daily cache dirty cho các record bị ảnh hưởng.

## Performance

Các tối ưu chính:

- Web Worker xử lý theo scope của tab: overview, orders, products, fulfill, support.
- Report không trigger worker dashboard chung để tránh lag khi query date riêng.
- Lazy load tab/component nặng: Products, Report, Fulfill, Account Manager, charts, Excel export.
- DataTable dùng virtualization và cache height.
- Date range query dùng chunking cân bằng theo độ dài range.
- Daily cache giảm số read cho ngày cũ.
- Dev-only performance marks bật bằng localStorage.

Bật log debug trong dev:

```js
localStorage.setItem('dailyCacheVerbose', '1')
localStorage.setItem('reportVerbose', '1')
localStorage.setItem('performanceVerbose', '1')
localStorage.setItem('notificationVerbose', '1')
localStorage.setItem('rulesVerbose', '1')
```

## Cấu Trúc Thư Mục

```text
api/
  _lib/                     helper dùng cho serverless API
  backfill-daily-cache.ts   build daily cache cho ngày cũ
  daily-summary.ts          gửi Lark daily summary
  get-costs-mz.ts           cost API Merchize
  get-costs-pw.ts           cost API Printway
  gmail-webhook.ts          nhận Gmail Pub/Sub webhook
  lark-events.ts            Lark actions/webhooks
  oauth-callback.ts         OAuth callback Gmail/Outlook
  oauth-token.ts            đổi refresh token -> access token
  sync-outlook.ts           cron sync Outlook

src/
  components/               layout, tabs, tables, modals, chart components
  contexts/                 DashboardContext, UIContext, NotificationContext
  features/                 accounts, auth, costs, notifications, settings, users
  hooks/                    data sync, local storage, exchange rates
  services/                 Firebase, email, report, daily cache, cost sync
  utils/                    data processing, export, timezone, permissions
  workers/                  dataWorker xử lý aggregate

extension-sku-worker/       Chrome extension hỗ trợ fetch SKU/listing
scripts/                    generate firebase config cho service worker
```

## Chạy Local

Cài dependencies:

```bash
npm install
```

Chạy Vite:

```bash
npm run dev
```

Hoặc chạy qua Vercel CLI để test API route:

```bash
vc dev
```

Build production:

```bash
npm run build
```

Preview build:

```bash
npm run preview
```

## Environment Variables

Không commit `.env.local`.

Firebase client:

```text
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
```

Firebase admin:

```text
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

OAuth:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
MSAL_CLIENT_ID
MICROSOFT_CLIENT_SECRET
```

Cron/webhook:

```text
CRON_SECRET
CRON_SECRET2
WEBHOOK_SECRET_TOKEN
NEXT_PUBLIC_APP_URL
```

Supplier/Lark:

```text
MERCHIZE_ACCESS_TOKEN
PRINTWAY_ACCESS_TOKEN
LARK_WEBHOOK_URL
LARK_LOGIN_WEBHOOK_URL
LARK_APP_ID
LARK_APP_SECRET
LARK_VERIFICATION_TOKEN
LARK_CARD_VERIFY_TOKEN
```

## Deploy

Production chạy trên Vercel.

Checklist trước khi push production:

```bash
npm run build
```

Nên kiểm thêm:

- Query cùng timezone/range với production để so số order/revenue.
- Test Gmail/Outlook sync nếu chạm `api/gmail-webhook.ts`, `api/sync-outlook.ts`, OAuth hoặc account save logic.
- Test cost sync nếu chạm fulfillment/cost files.
- Test export Excel nếu chạm `dataProcessing`, worker hoặc `excelExport`.

## Quy Tắc Khi Sửa Code

- Dữ liệu thống kê quan trọng hơn UI đẹp. Không đổi công thức doanh thu nếu chưa đối chiếu production.
- `dt_local`, `fulfill_date`, `create_date` trong UI/service nên chuẩn hóa ISO string.
- Khi update/delete/add record ngày cũ phải mark daily cache dirty.
- Không query task/operation report từ header nếu tab Report không mở.
- Không load toàn bộ order detail khi chưa mở modal.
- Không tạo nhiều listener Firestore ở header nếu chỉ cần count hoặc chưa mở panel.
- Không dùng `limit` âm thầm cho dữ liệu thống kê thật, trừ UI preview có ghi rõ.
- Commit lớn nên tách theo rủi ro: UI/performance riêng, DB/sync/order/cost riêng.

## Git

Commit gần nhất sau đợt tối ưu:

```text
9ca67ad Optimize dashboard performance and daily cache workflow
```
