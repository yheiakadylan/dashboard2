# Performance Baseline Automation

## Mục đích

Baseline KPI cá nhân là dữ liệu output đã tổng hợp theo từng tháng của quý trước. Frontend chỉ đọc các bucket này thay vì query lại toàn bộ `tasks`, `ideas` và `listings` mỗi lần mở trang KPI.

Baseline không phải điểm đánh giá. Đây là dữ liệu tham khảo để Leader đề xuất target quý cho từng nhân sự.

## Lịch tự động

Vercel Cron gọi endpoint sau mỗi ngày lúc `20:30 UTC`, tương ứng `03:30` sáng hôm sau tại Việt Nam:

```text
/api/refresh-performance-baseline
```

Cron mặc định:

- Tính lại đúng quý trước theo múi giờ `Asia/Ho_Chi_Minh`.
- Chỉ query dữ liệu nằm trong quý cần tính.
- Ghi bucket theo tháng và giữ lịch sử của các quý cũ.
- Xóa bucket cũ bị dư trong chính range đang refresh.
- Dùng lease 15 phút để hai request không chạy trùng.
- Bỏ qua quý đã được chốt, trừ khi chạy thủ công với `force=true`.

Vercel phải có các environment variable:

```text
CRON_SECRET
FIREBASE_PROJECT_ID
FIREBASE_CLIENT_EMAIL
FIREBASE_PRIVATE_KEY
```

## Collection

Bucket output:

```text
user/{teamId}/performance_baseline_buckets/{sectionId}__monthly__{YYYY-MM}__{uid}
```

Trạng thái một lần tổng hợp:

```text
user/{teamId}/performance_baseline_buckets/_run__{from}__{to}
```

Document trạng thái lưu `status`, `runId`, range, phiên bản công thức, thời gian cập nhật, thống kê nguồn và lỗi gần nhất. Các trạng thái gồm:

- `running`: đang tổng hợp.
- `ready`: đã cập nhật và cron vẫn được phép làm mới.
- `failed`: lần cập nhật gần nhất lỗi; bucket tốt trước đó vẫn được giữ để hiển thị.
- `finalized`: quý đã chốt; cron không tự sửa lại lịch sử.

## Nguồn dữ liệu

- Designer Fulfillment: `tasks.design_submitted_at`, ưu tiên `templatePointsSnapshot`, sau đó dùng `settings/templates`.
- Designer Idea: `ideas.design_submitted_at`, ưu tiên `templatePointsSnapshot`, sau đó dùng `settings/templates`.
- Customer Service: ưu tiên `tasks.submitted_to_new_at`; dữ liệu cũ thiếu field này dùng `created_at` khi status hợp lệ.
- Fulfillment: `tasks.fulfilled_at` với `status = done`.
- R&D và Scale: Active Listing có `create_date` trong quý và empID trong SKU map đúng nhân sự.
- Nhân sự: chỉ dùng hồ sơ active trong `authentication` và đúng `teamId`.

## Chạy kiểm tra không ghi dữ liệu

```bash
npm run backfill:performance-baseline
```

Chọn range cụ thể:

```bash
npm run backfill:performance-baseline -- --from=2026-04-01 --to=2026-06-30
```

## Ghi dữ liệu thủ công

```bash
npm run backfill:performance-baseline -- --write
```

Chốt quý sau khi đã kiểm tra dữ liệu:

```bash
npm run backfill:performance-baseline -- --write --finalize
```

Sửa lại một quý đã chốt khi có dữ liệu điều chỉnh được phê duyệt:

```bash
npm run backfill:performance-baseline -- --write --force --from=2026-04-01 --to=2026-06-30
```

## Kiểm tra sau deploy

1. Mở Vercel Logs và xác nhận `/api/refresh-performance-baseline` trả `200`.
2. Kiểm tra document `_run__{from}__{to}` có `status = ready` và `lastError = null`.
3. Mở `Performance & KPI > Cấu hình KPI & công thức` và xác nhận badge hiển thị `Tự động tổng hợp mỗi đêm`.
4. So sánh tổng output trên UI với kết quả dry-run cùng range.
5. Chỉ chốt quý sau khi điểm template, mapping nhân sự và dữ liệu Operations đã được kiểm tra.

Không chạy lệnh có `--write` trên production nếu chưa xem kết quả dry-run.
