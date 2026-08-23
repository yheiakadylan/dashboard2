import type { MetricHelpContent } from './types';

type MetricHelpDefinition = Omit<MetricHelpContent, 'currentSummary' | 'scope'>;

type MetricHelpContext = {
  currentSummary?: string;
  dateFrom: string;
  dateTo: string;
  timeZone: string;
  accessLabel: string;
  podLabel: string;
};

const definitions: Record<string, MetricHelpDefinition> = {};

const define = (codes: string[], definition: MetricHelpDefinition) => {
  codes.forEach(code => { definitions[code] = definition; });
};

define(['COMPANY_IDEA_NEW'], {
  summary: 'Số listing mới được đưa lên trong phạm vi ngày đang xem.',
  calculation: [
    'Lọc listing có create_date nằm trong phạm vi query theo múi giờ đang chọn.',
    'Dedupe theo listing_id nên mỗi listing chỉ được tính một lần.',
  ],
  sources: [
    'Firestore user/{teamId}/listings.',
    'Các field chính: listing_id, create_date, shop_id, employee_id và sku.',
  ],
  rules: [
    'Trạng thái hiện tại của listing không làm thay đổi việc listing đã được tạo trong phạm vi.',
    'Dữ liệu được giới hạn theo POD/account trước khi tổng hợp.',
  ],
});

define(['COMPANY_DS_IDEA_SUBMITTED'], {
  summary: 'Số task Designer Idea đã submit trong phạm vi.',
  calculation: [
    'Đếm document trong collection ideas có design_submitted_at nằm trong phạm vi query.',
    'Mỗi task được tính một lần, không quy đổi theo điểm template tại Company Overview.',
  ],
  sources: ['Firestore root collection ideas, fields design_submitted_at, designerId và designerName.'],
  rules: ['Chỉ lấy document có mốc design_submitted_at nằm trong khoảng query.'],
});

define(['COMPANY_DS_FULFILL_SUBMITTED'], {
  summary: 'Số task Designer Fulfillment đã submit trong phạm vi.',
  calculation: [
    'Đếm document trong collection tasks có design_submitted_at nằm trong phạm vi query.',
    'Mỗi task được tính một lần, không dedupe theo order vì một order có thể có nhiều task thiết kế.',
  ],
  sources: ['Firestore root collection tasks, fields design_submitted_at, designerId và designerName.'],
  rules: ['Không gộp chung với Designer Idea để tránh nhầm output giữa hai board.'],
});

define(['COMPANY_DS_TIME'], {
  summary: 'Thời gian Designer xử lý trung bình từ lúc nhận task đến khi submit file.',
  calculation: [
    'Gộp task đã submit trong Idea Board và Fulfillment Board.',
    'Với từng task: lấy khoảng assigned_to_designer_at → design_submitted_at rồi chỉ cộng phần nằm trong giờ làm việc.',
    'Kết quả card = tổng thời gian hợp lệ / số task có đủ hai mốc; không dedupe theo order.',
  ],
  sources: [
    'Firestore root collections ideas và tasks.',
    'Các field chính: assigned_to_designer_at và design_submitted_at.',
    'Firestore user/{teamId}/settings/performance_calendar.',
  ],
  rules: [
    'Loại task thiếu mốc, mốc không parse được hoặc submit sớm hơn thời điểm nhận.',
    'Chỉ cộng thời gian trong ca 09:00–12:00 và 13:30–18:00 theo UTC+7 Việt Nam.',
    'Loại Chủ nhật, holiday và thứ Bảy nghỉ theo lịch làm việc cách tuần.',
  ],
});

define(['COMPANY_CS_CLOSED'], {
  summary: 'Số order duy nhất được CS chuyển từ Draft sang New trong phạm vi.',
  calculation: [
    'Chỉ lấy task có submitted_to_new_at trong kỳ.',
    'Dedupe theo orderId, sau đó taskId hoặc document id.',
  ],
  sources: [
    'Firestore root collection tasks.',
    'Các field chính: submitted_to_new_at, created_at, status, orderId, taskId.',
  ],
  rules: ['Dữ liệu lịch sử thiếu submitted_to_new_at không được gán đại vào ngày created_at.'],
});

define(['FF_READY'], {
  summary: 'Số order duy nhất đã có file thiết kế và sẵn sàng chuyển sang Fulfillment.',
  calculation: ['Lấy task có design_submitted_at trong kỳ rồi dedupe theo orderId/taskId/document id.'],
  sources: ['Firestore root collection tasks, field design_submitted_at và orderId/taskId.'],
  rules: ['Ở phạm vi cá nhân, card này có thể bị ẩn vì đây là backlog đầu vào của team.'],
});

define(['COMPANY_FULFILLED', 'FF_DONE'], {
  summary: 'Số order duy nhất đã Fulfill hoàn tất trong kỳ.',
  calculation: [
    'Lấy task có fulfilled_at trong kỳ và status = done.',
    'Dedupe theo orderId/taskId/document id.',
    'Thẻ tổng không loại order chỉ vì chưa map được nhân sự hoặc nhà cung cấp.',
  ],
  sources: [
    'Firestore root collection tasks, fields fulfilled_at, status, fulfilled_by, supplier, sku, variant1, variant2, cs_id và createdBy.',
    'Firestore root collection sku_mappings để fallback supplier cho task cũ hoặc task auto-done.',
  ],
  rules: [
    'Không đếm task chưa có fulfilled_at hoặc status khác done.',
    'Bảng nhân sự ưu tiên fulfilled_by; dữ liệu cũ chỉ fallback cs_id hoặc createdBy.',
    'Ưu tiên mapping đúng SKU và variant, sau đó fallback task.supplier; thiếu cả hai được hiển thị là Thiếu mapping supplier.',
    'Nhiều supplier trên cùng order được gom thành Nhiều supplier.',
  ],
});

define(['COMPANY_FF_TIME', 'FF_AVERAGE_PROCESS_TIME'], {
  summary: 'Thời gian xử lý Fulfillment trung bình trên các order có đủ hai mốc.',
  calculation: [
    'Với mỗi order: bắt đầu = design_submitted_at mới nhất, kết thúc = fulfilled_at muộn nhất.',
    'Chỉ cộng phần thời gian nằm trong giờ làm việc của từng ngày.',
    'Kết quả card = tổng số giờ hợp lệ / số order có đủ hai mốc.',
    'Ở phạm vi quản lý, phép tính dùng toàn bộ order trong thẻ tổng và không phụ thuộc việc map nhân sự.',
  ],
  sources: [
    'Firestore root collection tasks, fields design_submitted_at, fulfilled_at và orderId/taskId.',
    'Firestore user/{teamId}/settings/performance_calendar.',
  ],
  rules: [
    'Loại order thiếu mốc, mốc không parse được hoặc fulfilled_at sớm hơn design_submitted_at.',
    'Chỉ cộng thời gian trong ca 09:00–12:00 và 13:30–18:00 theo UTC+7 Việt Nam.',
    'Loại Chủ nhật, holiday và thứ Bảy nghỉ theo lịch làm việc cách tuần.',
  ],
});

define(['COMPANY_RATING', 'CS_CUSTOMER_REVIEWS'], {
  summary: 'Rating trung bình trong kỳ và mức thay đổi so với rating toàn shop.',
  calculation: [
    'Rating trong kỳ = tổng rating hợp lệ / số review hợp lệ trong khoảng query.',
    'Chỉ nhận rating từ 1 đến 5.',
    'Rating toàn shop lấy từ account.etsy_review_average; nếu có review count thì bình quân gia quyền theo etsy_review_count.',
    'Mức tăng/giảm = rating trong kỳ - rating toàn shop.',
  ],
  sources: [
    'Firestore user/{teamId}/reviews, query theo create_date.',
    'Firestore user/{teamId}/accounts, fields etsy_review_average và etsy_review_count.',
  ],
  rules: ['Review được ghép shop bằng shop_id và các shop identifier của account.'],
});

define(['DS_IDEA_RECEIVED'], {
  summary: 'Số file Idea đã được giao cho Designer trong kỳ.',
  calculation: ['Đếm document ideas có assigned_to_designer_at trong khoảng query.'],
  sources: ['Firestore root collection ideas, fields assigned_to_designer_at, designerId, designerName.'],
  rules: ['Gán nhân sự bằng UID, empID, email hoặc displayName đã chuẩn hóa.'],
});

define(['DS_FF_RECEIVED'], {
  summary: 'Số file Fulfillment đã được giao cho Designer trong kỳ.',
  calculation: ['Đếm document tasks có assigned_to_designer_at trong khoảng query.'],
  sources: ['Firestore root collection tasks, fields assigned_to_designer_at, designerId, designerName.'],
  rules: ['Gán nhân sự bằng UID, empID, email hoặc displayName đã chuẩn hóa.'],
});

define(['DS_IDEA_COMPLETED'], {
  summary: 'Số file Idea đã được Designer submit hoàn tất trong kỳ.',
  calculation: ['Đếm document ideas có design_submitted_at trong khoảng query.'],
  sources: ['Firestore root collection ideas, fields design_submitted_at, designerId, designerName.'],
  rules: ['Một document hoàn thành được tính một file.'],
});

define(['DS_FF_COMPLETED'], {
  summary: 'Số file Fulfillment đã được Designer submit hoàn tất trong kỳ.',
  calculation: ['Đếm document tasks có design_submitted_at trong khoảng query.'],
  sources: ['Firestore root collection tasks, fields design_submitted_at, designerId, designerName.'],
  rules: ['Một document hoàn thành được tính một file.'],
});

define(['DS_IDEA_POINTS', 'DS_FF_POINTS'], {
  summary: 'Tổng điểm độ khó của các file Designer đã hoàn thành.',
  calculation: [
    'Ưu tiên templatePointsSnapshot đã lưu trên task tại thời điểm hoàn thành.',
    'Nếu chưa có snapshot: lấy các templateId duy nhất và cộng points tương ứng trong settings/templates.',
    'Template chưa cấu hình dùng fallback: Idea 3 điểm/template, Fulfillment 1 điểm/template.',
    'Task không có templateId nhận 0 điểm.',
  ],
  sources: [
    'Firestore root collections ideas hoặc tasks.',
    'Firestore settings/templates, fields points và boardType.',
    'Các field task: templateId, templatePointsSnapshot, design_submitted_at.',
  ],
  rules: ['Card tổng hợp theo board; bảng nhân sự còn cộng cả điểm support từ board còn lại.'],
});

define(['IDEA_SALES'], {
  summary: 'Số SKU Idea có phát sinh sale và tổng số lượt task sale khớp SKU.',
  calculation: [
    'Chuẩn hóa SKU thành chữ hoa và loại SKU rỗng/NULL.',
    'Từ task sale trong kỳ, đếm số task theo SKU.',
    'Query ideas có SKU tương ứng; SKU có ít nhất một task sale được tính là một SKU Idea có sale.',
    'Lượt sale là số task khớp SKU, không phải quantity item.',
  ],
  sources: [
    'Firestore root collection tasks, fields created_at và sku.',
    'Firestore root collection ideas, query theo sku.',
  ],
  rules: ['SKU được dedupe cho chỉ số số SKU, nhưng số lượt vẫn cộng theo task.'],
});

define(['DS_WRONG_TEMPLATE_RATE'], {
  summary: 'Chỉ số chưa hoạt động vì dữ liệu reject chưa có chuẩn chung.',
  calculation: ['Dự kiến = số file bị reject với reason WRONG_TEMPLATE / tổng file đã submit × 100%.'],
  sources: ['Cần field rejectReason chuẩn hóa trên tasks/ideas và lịch sử reject đáng tin cậy.'],
  rules: ['Hiện card luôn hiển thị chờ dữ liệu và không tham gia tính KPI.'],
});

define(['RND_LISTINGS_CREATED', 'SCALE_LISTINGS_CREATED'], {
  summary: 'Số Active Listing được nhân sự R&D hoặc Scale đưa lên trong kỳ.',
  calculation: [
    'Lọc listing có state = 0 hoặc state = active và create_date nằm trong khoảng query.',
    'Bóc empID từ employee_id hoặc phần thứ hai của SKU dạng productType-empID-...',
    'Map empID sang nhân sự active trong authentication rồi cộng số listing của các nhân sự đang hiển thị.',
  ],
  sources: [
    'Firestore user/{teamId}/listings.',
    'Các field chính: listing_id, state, create_date, sku, employee_id, shop_id, shop_label.',
    'Firestore authentication để map empID, role và trạng thái nhân sự.',
  ],
  rules: ['Listing không map được nhân sự vẫn tồn tại trong dữ liệu nhưng không cộng vào KPI cá nhân.'],
});

define(['RND_SOLD_SKUS', 'SCALE_SOLD_SKUS'], {
  summary: 'Số SKU duy nhất thuộc nhân sự R&D/Scale có phát sinh sale trong kỳ.',
  calculation: [
    'Lấy order hợp lệ, duyệt từng items[].sku và bóc empID từ phần thứ hai của SKU.',
    'Map empID sang nhân sự; mỗi SKU chuẩn hóa chỉ được tính một lần trên từng nhân sự.',
    'Tỷ lệ 7/14/30 ngày chỉ tính listing đã đủ tuổi tương ứng; sale đầu lấy first_sale_date hoặc order hợp lệ sớm nhất.',
  ],
  sources: [
    'Firestore user/{teamId}/records: dt_local, order_id, items[].sku, items[].quantity.',
    'Firestore user/{teamId}/listings: sku, create_date, first_sale_date.',
  ],
  rules: ['Loại order refund và SKU rỗng, NULL hoặc không bóc được empID.'],
});

define(['RND_SALE_QUANTITY', 'SCALE_SALE_QUANTITY'], {
  summary: 'Tổng quantity bán được của các SKU thuộc nhân sự R&D/Scale.',
  calculation: [
    'Lọc order kind = order, loại refund và dedupe order_id.',
    'Với từng item có SKU hợp lệ, bóc empID và cộng quantity vào đúng nhân sự.',
    'Card tổng = tổng quantity của các nhân sự đang nằm trong phạm vi hiển thị.',
  ],
  sources: ['Firestore user/{teamId}/records và user/{teamId}/listings.'],
  rules: ['Chỉ tính item có SKU map được đúng nhân sự; không dùng quantity để suy ra chất lượng listing.'],
});

define(['RND_SALE_REVENUE', 'SCALE_SALE_REVENUE'], {
  summary: 'Doanh thu net quy đổi USD của các item có SKU thuộc nhân sự R&D/Scale.',
  calculation: [
    'Item gross = price × quantity.',
    'Discount và shipping cấp order được phân bổ xuống item theo tỷ trọng doanh thu.',
    'Item net = gross - discount phân bổ + shipping phân bổ.',
    'Item net được quy đổi từ currency của order sang USD bằng exchange rate hiện tại rồi cộng theo nhân sự.',
  ],
  sources: [
    'Firestore user/{teamId}/records: items, financials, currency, order_id, status, source.',
    'Exchange rate từ DashboardContext.',
  ],
  rules: ['Loại refund và item không có SKU/empID hợp lệ. Tax hiện không được cộng vào công thức net item.'],
});

define(['CS_ORDERS_CREATED'], {
  summary: 'Số order mới đi vào CS theo ngày tạo, chưa thuộc về một nhân sự cụ thể.',
  calculation: [
    'Lấy task có created_at trong kỳ.',
    'Dedupe theo orderId/taskId/document id trước khi cộng.',
    'Đã chuyển New = order trong tập đầu vào có submitted_to_new_at không muộn hơn ngày kết thúc phạm vi.',
    'Chưa chuyển New = tổng đầu vào - số đã chuyển New; phần chi tiết nhóm số còn lại theo ngày created_at.',
  ],
  sources: ['Firestore root collection tasks, fields created_at, submitted_to_new_at, orderId và taskId.'],
  rules: [
    'Đơn vào CS không gán cho nhân sự vì lúc tạo order vẫn ở Draft.',
    'Không loại trạng thái cancel nên đơn khách đã cancel vẫn nằm trong tổng đầu vào và có thể nằm trong nhóm chưa chuyển New.',
  ],
});

define(['CS_CUSTOM_ORDERS_CLOSED', 'CS_NON_CUSTOM_ORDERS_CLOSED'], {
  summary: 'Số order CS đã chuyển New để đưa cho Designer xử lý, tách theo custom và non-custom.',
  calculation: [
    'Chỉ lấy order có submitted_to_new_at trong phạm vi đang xem, dù order được tạo từ ngày trước.',
    'Một order là custom nếu có ít nhất một task cùng order có personalization không rỗng.',
    'Custom và non-custom đều dedupe theo orderId/taskId/document id.',
    'Cùng ngày = ngày created_at trùng ngày submitted_to_new_at; Từ ngày trước = ngày tạo sớm hơn ngày chuyển New.',
    'Thời gian TB tính từ created_at đến submitted_to_new_at và chỉ cộng giờ làm việc thực tế.',
  ],
  sources: [
    'Firestore root collection tasks, fields submitted_to_new_at, created_at, personalization và orderId.',
    'Firestore user/{teamId}/settings/performance_calendar.',
  ],
  rules: [
    'Một order có nhiều task chỉ được tính một lần; chỉ cần một task có personalization thì cả order thuộc nhóm custom.',
    'Thời gian TB loại giờ nghỉ trưa, ngoài ca, Chủ nhật, holiday và thứ Bảy nghỉ cách tuần.',
  ],
});

define(['CS_PENDING_NEW'], {
  summary: 'Số order đi vào CS trong phạm vi nhưng chưa được chuyển New để đưa cho Designer xử lý.',
  calculation: [
    'Bắt đầu từ tập order có created_at trong phạm vi.',
    'Tính là đã xử lý nếu submitted_to_new_at không muộn hơn cuối ngày kết thúc phạm vi.',
    'Phần chi tiết nhóm các order còn lại theo ngày created_at.',
  ],
  sources: ['Firestore root collection tasks, fields created_at, submitted_to_new_at, orderId và taskId.'],
  rules: [
    'Đơn cancel vẫn thuộc đầu vào; nếu chưa có submitted_to_new_at thì vẫn nằm trong nhóm chưa chuyển New.',
    'Không gán nhân sự cho chỉ số này vì order còn ở giai đoạn Draft.',
  ],
});

define(['FF_TIME_COVERAGE'], {
  summary: 'Tỷ lệ order Fulfillment có đủ design_submitted_at và fulfilled_at để tính thời gian.',
  calculation: ['Coverage = số order tạo được duration hợp lệ / số order fulfilled duy nhất × 100%.'],
  sources: ['Firestore root collection tasks, fields design_submitted_at, fulfilled_at và orderId/taskId.'],
  rules: ['Order thiếu một trong hai mốc hoặc có thời gian âm bị loại khỏi tử số.'],
});

define(['FF_SUPPLIER_COVERAGE'], {
  summary: 'Tỷ lệ order Fulfillment đã xác định được nhà cung cấp.',
  calculation: [
    'Coverage nhà cung cấp = số order fulfilled xác định được supplier / tổng order fulfilled × 100%.',
    'Order được dedupe theo orderId/taskId/document id trước khi tính tỷ lệ.',
  ],
  sources: [
    'Firestore root collection tasks: fulfilled_at, supplier, sku, variant1 và variant2.',
    'Firestore user/{teamId}/records: order_id, fulfill_provider và ff_code.',
    'Firestore root collection sku_mappings và field supplier trên task.',
  ],
  rules: [
    'Ưu tiên fulfill_provider/ff_code thực tế trên order; sau đó fallback mapping SKU/variant và supplier trên task.',
    'Order không xác định được supplier được liệt kê trong phần Xem order thiếu supplier.',
  ],
});

const fallbackDefinition: MetricHelpDefinition = {
  summary: 'Chỉ số hiệu suất được tổng hợp từ dữ liệu thật trong phạm vi đang xem.',
  calculation: ['Giá trị được tính theo logic của metric code và các bộ lọc hiện tại.'],
      sources: ['Nguồn dữ liệu Operations và KPI của Dashboard.'],
  rules: [],
};

export const buildPerformanceMetricHelp = (
  code: string,
  context: MetricHelpContext
): MetricHelpContent => {
  const definition = definitions[code] || fallbackDefinition;
  return {
    ...definition,
    currentSummary: context.currentSummary,
    scope: [
      `Khoảng dữ liệu: ${context.dateFrom} → ${context.dateTo}, quy đổi theo múi giờ ${context.timeZone}.`,
      `Phạm vi POD: ${context.podLabel}.`,
      `Phạm vi quyền: ${context.accessLabel}.`,
    ],
  };
};
