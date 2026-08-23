import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowPathIcon, CheckCircleIcon, ChevronDownIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, PlayIcon, StopIcon, TrashIcon } from '@heroicons/react/24/outline';
import { useDashboard } from '../../contexts/DashboardContext';
import { useNotification } from '../../contexts/NotificationContext';
import { analyzeEvaluationRun, cancelEvaluationAnalysis, cancelEvaluationJob, collectPublicEvaluationWithoutExtension, createAgentEvaluationJob, deleteAllEvaluationData, deleteEvaluationRun, getEvaluationLogs, getEvaluationRawData, listenForEvaluationJobs, listenForEvaluationLogs, listenForEvaluationRuns, queueEvaluationAnalysis, reconcileEvaluationJob } from '../../services/evaluationService';
import type { Account, EvaluationCrawlLimits, EvaluationJob, EvaluationListingRow, EvaluationLogEntry, EvaluationRawData, EvaluationRawDocument, EvaluationRun, EvaluationScope, EvaluationTool, EvaluationToolNotes } from '../../types';

const LISTING_PAGE_SIZE = 50;
const SCOPE_LABELS: Record<EvaluationScope, string> = {
  listings: 'Chỉ listing public',
  reviews: 'Chỉ review public',
  seller: 'Chỉ dữ liệu seller',
  full: 'Toàn bộ shop',
  custom: 'Theo prompt tùy chỉnh',
};
const EVALUATION_TOOL_OPTIONS: Array<{ tool: EvaluationTool; group: 'public' | 'seller'; label: string; description: string; defaultPrompt: string }> = [
  { tool: 'collect_shop_overview', group: 'public', label: 'Shop Overview', description: 'Tổng quan public của shop.', defaultPrompt: 'Mở đúng URL shop public, đọc và lưu một snapshot tổng quan gồm tên shop, mô tả, announcement, rating, review count, sales count và các tín hiệu trust nhìn thấy; sau đó kết thúc tool.' },
  { tool: 'collect_public_listings', group: 'public', label: 'Listings', description: 'Listing card theo từng trang public.', defaultPrompt: 'Crawl listing public từ trang mới nhất, extract từng trang rồi bấm đúng Next page. Dừng ngay khi đạt giới hạn trang hoặc số listing. Giữ nguyên listing ID, title, URL, price, ảnh, badge và trang nguồn; không mở hành động chỉnh sửa.' },
  { tool: 'collect_listing_details', group: 'public', label: 'Chi tiết listing', description: 'Mở từng listing đã thu thập để lấy dữ liệu chi tiết.', defaultPrompt: 'Dùng URL thật từ kết quả Listings, mở lần lượt từng listing public theo giới hạn đã chọn và extract description, materials, variations, personalization instructions, shipping/returns, ảnh và video. Không thêm giỏ hàng, mua hàng hoặc mở bất kỳ hành động chỉnh sửa nào.' },
  { tool: 'collect_public_reviews', group: 'public', label: 'Reviews', description: 'Review public và phân trang review.', defaultPrompt: 'Mở trang /reviews, extract review thật gồm rating, nội dung, ngày và listing liên quan, sau đó bấm Next page để crawl tiếp. Dừng khi đạt giới hạn trang/review hoặc không còn Next page; ẩn PII và không phản hồi review.' },
  { tool: 'collect_seller_stats', group: 'seller', label: 'Seller Stats', description: 'Shop Manager Stats theo kỳ đã chọn.', defaultPrompt: 'Mở Shop Manager Stats, chọn đúng kỳ thời gian yêu cầu nếu có, đọc KPI, headings, cards và tables đang hiển thị rồi lưu một snapshot. Không thay đổi bất kỳ thiết lập shop nào.' },
  { tool: 'collect_seller_ads', group: 'seller', label: 'Etsy Ads', description: 'KPI quảng cáo và sản phẩm chạy Ads.', defaultPrompt: 'Mở Etsy Ads, kiểm tra date menu và chọn đúng kỳ yêu cầu trước khi extract. Thu thập KPI tổng và bảng từng listing như impressions, clicks, CTR, orders, spend, revenue, ROAS nếu có; tuyệt đối không đổi budget, bật/tắt hay pause Ads.' },
  { tool: 'collect_seller_orders', group: 'seller', label: 'Orders', description: 'Đơn đã bán, chỉ đọc.', defaultPrompt: 'Mở trang sold orders và chỉ đọc các order cards/tables cần cho đánh giá vận hành. Thu thập trạng thái, thời gian, sản phẩm và tín hiệu xử lý ở dạng đã ẩn PII; không refund, cancel, mark shipped hoặc liên hệ buyer.' },
  { tool: 'collect_seller_messages', group: 'seller', label: 'Messages', description: 'Hội thoại đã ẩn PII, chỉ đọc.', defaultPrompt: 'Mở Messages ở chế độ chỉ đọc, thu thập snapshot về unread/help requests, chủ đề và tín hiệu thời gian phản hồi sau khi ẩn PII. Không mở compose, reply, send, archive hoặc thay đổi trạng thái hội thoại.' },
];

const SCOPE_TOOLS: Record<EvaluationScope, EvaluationTool[]> = {
  listings: ['collect_shop_overview', 'collect_public_listings', 'collect_listing_details'],
  reviews: ['collect_shop_overview', 'collect_public_reviews'],
  seller: ['collect_seller_stats', 'collect_seller_ads', 'collect_seller_orders', 'collect_seller_messages'],
  full: EVALUATION_TOOL_OPTIONS.map(option => option.tool),
  custom: [],
};

function inferEvaluationScope(tools: EvaluationTool[]): EvaluationScope {
  const selected = new Set(tools);
  const matches = (scope: Exclude<EvaluationScope, 'custom'>) => SCOPE_TOOLS[scope].length === selected.size && SCOPE_TOOLS[scope].every(tool => selected.has(tool));
  if (matches('full')) return 'full';
  if (matches('listings')) return 'listings';
  if (matches('reviews')) return 'reviews';
  if (matches('seller')) return 'seller';
  return 'custom';
}

const ListingDataTable: React.FC<{ rows: EvaluationListingRow[]; page: number; onPageChange: (page: number) => void }> = ({ rows, page, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(rows.length / LISTING_PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleRows = rows.slice((safePage - 1) * LISTING_PAGE_SIZE, safePage * LISTING_PAGE_SIZE);
  const hasAudit = rows.some(row => row.analysis || row.risk || row.seo);
  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 dark:bg-gray-900/40 text-xs text-gray-600 dark:text-gray-300">
        <span>{rows.length} listing · Trang {safePage}/{totalPages}</span>
        <div className="flex gap-2"><button type="button" disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)} className="px-2 py-1 rounded border disabled:opacity-40">Trước</button><button type="button" disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)} className="px-2 py-1 rounded border disabled:opacity-40">Sau</button></div>
      </div>
      <div className="overflow-x-auto max-h-[65vh]">
        <table className="min-w-[72rem] w-full table-auto text-xs">
          <thead className="sticky top-0 z-10 bg-gray-100 dark:bg-gray-900 text-left text-gray-600 dark:text-gray-300"><tr>
            <th className="p-2">#</th><th className="p-2">Listing ID</th><th className="p-2 min-w-72">Tiêu đề (bấm mở)</th><th className="p-2">Giá</th><th className="p-2">Ảnh</th>
            {hasAudit && <><th className="p-2 min-w-40">Rủi ro</th><th className="p-2 min-w-48">Hành động</th><th className="p-2 min-w-80">Phân tích</th><th className="p-2 min-w-80">Cải thiện / phát triển</th><th className="p-2 min-w-72">Căn cứ / chất liệu</th><th className="p-2 min-w-64">Cờ chính sách</th><th className="p-2 min-w-80">SEO</th></>}
          </tr></thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {visibleRows.map((row, index) => <tr key={row.listingId} className="align-top hover:bg-gray-50 dark:hover:bg-gray-900/30">
              <td className="p-2">{(safePage - 1) * LISTING_PAGE_SIZE + index + 1}</td>
              <td className="p-2 font-mono">{row.listingId}</td>
              <td className="p-2 max-w-80 [overflow-wrap:anywhere]"><a href={row.url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">{row.title || row.url}</a></td>
              <td className="p-2 whitespace-nowrap">{row.price || '—'}</td>
              <td className="p-2">{row.imageUrl ? <img src={row.imageUrl} alt="" className="w-12 h-12 rounded object-cover" loading="lazy" /> : '—'}</td>
              {hasAudit && <><td className="p-2 max-w-52 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.risk || '—'}</td><td className="p-2 max-w-64 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.action || '—'}</td><td className="p-2 max-w-96 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.analysis || '—'}</td><td className="p-2 max-w-96 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.improvement || '—'}</td><td className="p-2 max-w-80 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.evidenceMaterials || '—'}</td><td className="p-2 max-w-72 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.policyFlags || '—'}</td><td className="p-2 max-w-96 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.seo || '—'}</td></>}
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>
  );
};

type ReportColumn = { key: string; label: string; className?: string; render?: (row: any) => React.ReactNode };

const ReportTable: React.FC<{ columns: ReportColumn[]; rows: any[]; emptyText?: string }> = ({ columns, rows, emptyText = 'Không có dữ liệu.' }) => (
  <div className={`${columns.length > 2 ? 'overflow-x-auto' : 'overflow-x-hidden'} min-w-0 rounded-lg border border-gray-200 dark:border-gray-700`}>
    <table className={`${columns.length > 2 ? 'min-w-[48rem] table-auto' : 'table-fixed'} w-full text-xs`}>
      <thead className="bg-gray-100 dark:bg-gray-900 text-left text-gray-600 dark:text-gray-300"><tr>{columns.map(column => <th key={column.key} className={`p-2 max-w-[28rem] whitespace-normal break-words ${column.className || ''}`}>{column.label}</th>)}</tr></thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
        {rows.map((row, index) => <tr key={`${row.listingId || row.title || row.name || row.axis || row.issue || row.theme || row.priority || 'row'}-${index}`} className="align-top hover:bg-gray-50 dark:hover:bg-gray-900/30">{columns.map(column => <td key={column.key} className={`p-2 max-w-[28rem] whitespace-pre-wrap [overflow-wrap:anywhere] ${column.className || ''}`}>{column.render ? column.render(row) : String(row?.[column.key] ?? '—')}</td>)}</tr>)}
        {rows.length === 0 && <tr><td colSpan={columns.length} className="p-5 text-center text-gray-500">{emptyText}</td></tr>}
      </tbody>
    </table>
  </div>
);

const ReportSection: React.FC<{ id: string; title: string; children: React.ReactNode; active: boolean }> = ({ id, title, children, active }) => (
  <section id={id} className={`${active ? 'block' : 'hidden'} rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden`}>
    <div className="px-3 py-2.5 font-semibold text-sm bg-gray-50 dark:bg-gray-900/50">{title}</div>
    <div className="p-3">{children}</div>
  </section>
);

const AnalysisReportTables: React.FC<{ result: any }> = ({ result }) => {
  const [activeSheet, setActiveSheet] = useState('report-executive');
  const report = result?.report;
  if (!report) return <div className="py-6 text-center text-gray-500">Báo cáo chưa sẵn sàng. Với run mới, agent sẽ tự phân tích ngay sau khi crawl xong.</div>;
  const list = (value: unknown) => Array.isArray(value) ? value : [];
  const textList = (value: unknown) => list(value).map(String).join('\n• ');
  const roadmapRows = list(report.sellerCapability?.roadmap).map((row: any) => ({ ...row, actions: textList(row.actions), kpis: textList(row.kpis) }));
  const developmentPlans = list(report.developmentPlans);
  const listingAudit = list(result.listingAudit);
  const sheets = [
    ['report-executive', 'Executive Overview'],
    ['report-kpi-risk', 'KPI & Risk'],
    ['report-immediate-plan', '30-day Plan'],
    ['report-seller', 'Seller Capability'],
    ['report-customer-care', 'Customer Care'],
    ['report-operations', 'Orders & Messages'],
    ['report-reviews', 'Review Insights'],
    ['report-ads', 'Ads Audit'],
    ['report-development', 'Product Plans'],
    ['report-listings', `Listing Audit (${listingAudit.length})`],
    ['report-findings', 'Findings & Actions'],
  ];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-20 flex flex-wrap gap-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 p-2 shadow-sm backdrop-blur">
        {sheets.map(([id, label]) => <button key={id} type="button" onClick={() => setActiveSheet(id)} className={`min-h-9 max-w-36 flex-auto whitespace-normal border-b-2 px-3 py-2 text-center text-xs font-semibold leading-4 ${activeSheet === id ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-transparent bg-gray-50 text-gray-600 hover:border-gray-300 dark:bg-gray-800 dark:text-gray-300'}`}>{label}</button>)}
      </div>

      <ReportSection id="report-executive" active={activeSheet === 'report-executive'} title="Executive Overview · Nhận định điều hành">
        <div className="rounded-lg border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20 p-3 text-sm whitespace-pre-wrap text-gray-800 dark:text-gray-100">{report.executiveAssessment || result.summary || 'Không đủ dữ liệu'}</div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <ReportTable columns={[{ key: 'value', label: 'Điểm mạnh', className: 'w-full' }]} rows={list(result.strengths).map((value: string) => ({ value }))} emptyText="Không đủ dữ liệu về điểm mạnh." />
          <ReportTable columns={[{ key: 'value', label: 'Điểm yếu / cơ hội cải thiện', className: 'w-full' }]} rows={list(result.weaknesses).map((value: string) => ({ value }))} emptyText="Không đủ dữ liệu về điểm yếu." />
        </div>
      </ReportSection>

      <ReportSection id="report-kpi-risk" active={activeSheet === 'report-kpi-risk'} title="KPI & Risk · Tổng quan chỉ số và rủi ro">
        <div className="grid gap-3 xl:grid-cols-2">
          <ReportTable columns={[{ key: 'name', label: 'Chỉ số', className: 'min-w-44' }, { key: 'value', label: 'Giá trị', className: 'min-w-28 font-semibold' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-80' }]} rows={list(report.metrics)} />
          <ReportTable columns={[{ key: 'level', label: 'Mức rủi ro' }, { key: 'count', label: 'Số lượng' }, { key: 'percentage', label: 'Tỷ lệ' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-64' }]} rows={list(report.riskDistribution)} />
        </div>
        <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-2 text-center text-xs">
          {[['Tích cực', report.sentiment?.positive], ['Trung lập', report.sentiment?.neutral], ['Tiêu cực', report.sentiment?.negative], ['Tổng review', report.sentiment?.total], ['Nhận định', report.sentiment?.assessment]].map(([label, value]) => <div key={label} className="rounded-lg bg-gray-50 dark:bg-gray-900 p-2"><div className="text-gray-500">{label}</div><div className="mt-1 font-semibold whitespace-pre-wrap">{String(value ?? '—')}</div></div>)}
        </div>
      </ReportSection>

      <ReportSection id="report-immediate-plan" active={activeSheet === 'report-immediate-plan'} title="Immediate 30-day Plan · Kế hoạch cần làm ngay">
        <ReportTable columns={[{ key: 'priority', label: '# / Ưu tiên' }, { key: 'action', label: 'Việc cần làm', className: 'min-w-80' }, { key: 'reason', label: 'Vì sao', className: 'min-w-80' }, { key: 'kpi', label: 'KPI', className: 'min-w-48' }, { key: 'deadline', label: 'Hạn' }]} rows={list(report.immediatePlan)} />
      </ReportSection>

      <ReportSection id="report-seller" active={activeSheet === 'report-seller'} title={`Seller Capability · ${report.sellerCapability?.level || '—'} · ${report.sellerCapability?.score ?? 0}/10`}>
        <p className="mb-3 text-sm whitespace-pre-wrap text-gray-600 dark:text-gray-300">{report.sellerCapability?.assessment || '—'}</p>
        <ReportTable columns={[{ key: 'axis', label: 'Trục năng lực', className: 'min-w-44' }, { key: 'score', label: 'Điểm /10' }, { key: 'assessment', label: 'Nhận định', className: 'min-w-80' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-72' }]} rows={list(report.sellerCapability?.axes)} />
        <div className="mt-3"><ReportTable columns={[{ key: 'phase', label: 'Lộ trình', className: 'min-w-32' }, { key: 'actions', label: 'Hành động', className: 'min-w-96' }, { key: 'kpis', label: 'KPI', className: 'min-w-64' }]} rows={roadmapRows} /></div>
      </ReportSection>

      <ReportSection id="report-customer-care" active={activeSheet === 'report-customer-care'} title={`Customer Care · ${report.customerCare?.level || '—'} · ${report.customerCare?.score ?? 0}/10`}>
        <p className="mb-3 text-sm whitespace-pre-wrap">{report.customerCare?.assessment || '—'}</p>
        <div className="grid gap-3 lg:grid-cols-2 mb-3"><div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-3 text-xs whitespace-pre-wrap"><strong>Điểm mạnh</strong>{list(report.customerCare?.strengths).map((item: string, index: number) => <div key={index} className="mt-1">• {item}</div>)}</div><div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 p-3 text-xs whitespace-pre-wrap"><strong>Lỗ hổng</strong>{list(report.customerCare?.gaps).map((item: string, index: number) => <div key={index} className="mt-1">• {item}</div>)}</div></div>
        <ReportTable columns={[{ key: 'rating', label: 'Sao' }, { key: 'product', label: 'Sản phẩm', className: 'min-w-64' }, { key: 'issue', label: 'Vấn đề', className: 'min-w-80' }, { key: 'sentiment', label: 'Cảm xúc', className: 'min-w-44' }, { key: 'recovery', label: 'Cách cứu/giữ khách', className: 'min-w-80' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-72' }]} rows={list(report.customerCare?.cases)} />
      </ReportSection>

      <ReportSection id="report-operations" active={activeSheet === 'report-operations'} title={`Orders & Messages · ${report.operations?.level || '—'} · ${report.operations?.score ?? 0}/10`}>
        <div className="grid gap-3 md:grid-cols-2 mb-3 text-sm"><div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3"><strong>Đơn hàng</strong><div className="mt-1 whitespace-pre-wrap">{report.operations?.ordersAssessment || '—'}</div></div><div className="rounded-lg bg-gray-50 dark:bg-gray-900 p-3"><strong>Tin nhắn</strong><div className="mt-1 whitespace-pre-wrap">{report.operations?.messagesAssessment || '—'}</div></div></div>
        <ReportTable columns={[{ key: 'customer', label: 'Khách (ẩn danh)', className: 'min-w-44' }, { key: 'topic', label: 'Chủ đề', className: 'min-w-64' }, { key: 'currentHandling', label: 'Cách xử lý hiện tại', className: 'min-w-72' }, { key: 'improvement', label: 'Cách cải thiện', className: 'min-w-80' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-64' }]} rows={list(report.operations?.cases)} />
      </ReportSection>

      <ReportSection id="report-reviews" active={activeSheet === 'report-reviews'} title="Review Insights · Vấn đề và lời khen">
        <div className="space-y-3"><ReportTable columns={[{ key: 'issue', label: 'Vấn đề lặp', className: 'min-w-72' }, { key: 'count', label: 'Số lần' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-80' }, { key: 'rootCause', label: 'Nguyên nhân gốc', className: 'min-w-72' }, { key: 'action', label: 'Cách xử lý', className: 'min-w-72' }]} rows={list(report.reviewInsights?.repeatedIssues)} /><ReportTable columns={[{ key: 'theme', label: 'Điểm khách khen', className: 'min-w-64' }, { key: 'count', label: 'Số lần' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-80' }, { key: 'howToUse', label: 'Cách tận dụng', className: 'min-w-80' }]} rows={list(report.reviewInsights?.praisedThemes)} /></div>
      </ReportSection>

      <ReportSection id="report-ads" active={activeSheet === 'report-ads'} title={`Ads Audit · ${list(report.adsAudit).length} sản phẩm`}>
        <ReportTable columns={[{ key: 'title', label: 'Sản phẩm', className: 'min-w-72' }, { key: 'impressions', label: 'Hiển thị' }, { key: 'clicks', label: 'Click' }, { key: 'ctr', label: 'CTR' }, { key: 'orders', label: 'Đơn' }, { key: 'conversionRate', label: 'CR' }, { key: 'spend', label: 'Chi' }, { key: 'revenue', label: 'Doanh thu' }, { key: 'roas', label: 'ROAS' }, { key: 'decision', label: 'Phán quyết', className: 'font-semibold' }, { key: 'diagnosis', label: 'Agent chẩn đoán', className: 'min-w-96' }, { key: 'action', label: 'Hướng xử lý', className: 'min-w-80' }]} rows={list(report.adsAudit)} />
      </ReportSection>

      <ReportSection id="report-development" active={activeSheet === 'report-development'} title={`Product Development Plans · ${developmentPlans.length} sản phẩm`}>
        <ReportTable columns={[{ key: 'index', label: '#' }, { key: 'title', label: 'Sản phẩm', className: 'min-w-56' }, { key: 'whyInvest', label: 'Vì sao đầu tư', className: 'min-w-72' }, { key: 'strengthsText', label: 'Điểm mạnh', className: 'min-w-64' }, { key: 'risksText', label: 'Rủi ro', className: 'min-w-64' }, { key: 'direction', label: 'Hướng phát triển', className: 'min-w-72' }, { key: 'milestonesText', label: 'Kế hoạch theo mốc', className: 'min-w-96' }, { key: 'expected30Days', label: 'Kỳ vọng 30 ngày', className: 'min-w-64' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-64' }]} rows={developmentPlans.map((plan: any, index: number) => ({ ...plan, index: index + 1, strengthsText: textList(plan.strengths) || '—', risksText: textList(plan.risks) || '—', milestonesText: list(plan.milestones).map((milestone: any) => `${milestone.timeframe || 'Mốc'}: ${milestone.action || '—'}${milestone.kpi ? ` · KPI: ${milestone.kpi}` : ''}`).join('\n') || '—' }))} />
      </ReportSection>

      <ReportSection id="report-listings" active={activeSheet === 'report-listings'} title={`Listing Audit · ${listingAudit.length} listing`}>
        <ReportTable columns={[{ key: 'listingId', label: 'ID' }, { key: 'title', label: 'Listing', className: 'min-w-72' }, { key: 'price', label: 'Giá' }, { key: 'risk', label: 'Rủi ro', className: 'min-w-40' }, { key: 'action', label: 'Hành động', className: 'min-w-64' }, { key: 'analysis', label: 'Phân tích tốt / yếu / nguyên nhân', className: 'min-w-96' }, { key: 'improvement', label: 'Cải thiện / phát triển', className: 'min-w-96' }, { key: 'evidenceMaterials', label: 'Căn cứ / chất liệu', className: 'min-w-72' }, { key: 'policyFlags', label: 'Cờ chính sách', className: 'min-w-64' }, { key: 'seo', label: 'SEO', className: 'min-w-80' }]} rows={listingAudit} emptyText="Không đủ dữ liệu để tạo Listing Audit." />
      </ReportSection>

      <ReportSection id="report-findings" active={activeSheet === 'report-findings'} title="Findings & Actions · Sổ phát hiện và hành động">
        <div className="space-y-3"><ReportTable columns={[{ key: 'severity', label: 'Mức độ' }, { key: 'title', label: 'Phát hiện', className: 'min-w-64' }, { key: 'evidence', label: 'Căn cứ', className: 'min-w-80' }, { key: 'recommendation', label: 'Khuyến nghị', className: 'min-w-80' }, { key: 'listingIds', label: 'Listing IDs', render: row => list(row.listingIds).join(', ') || '—' }]} rows={list(result.findings)} /><ReportTable columns={[{ key: 'priority', label: 'Ưu tiên' }, { key: 'title', label: 'Hành động', className: 'min-w-80' }, { key: 'deadlineDays', label: 'Hạn (ngày)' }, { key: 'kpi', label: 'KPI', className: 'min-w-64' }]} rows={list(result.actions)} /></div>
      </ReportSection>
    </div>
  );
};

type RawSheetKey = 'overview' | 'listings' | 'details' | 'reviews' | 'stats' | 'ads' | 'orders' | 'messages' | 'logs';

const RawJsonBlock: React.FC<{ value: unknown; label?: string }> = ({ value, label = 'JSON đầy đủ' }) => (
  <details className="mt-3 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold bg-gray-50 dark:bg-gray-900/50">{label}</summary>
    <pre className="max-h-[55vh] overflow-auto p-3 text-[11px] leading-5 whitespace-pre-wrap break-words bg-slate-950 text-slate-100">{JSON.stringify(value, null, 2)}</pre>
  </details>
);

function sellerPageKind(page: EvaluationRawDocument): 'stats' | 'ads' | 'orders' | 'messages' | 'other' {
  const id = page.id.toLowerCase();
  const url = String(page.url || '').toLowerCase();
  if (id.startsWith('stats') || url.includes('/stats')) return 'stats';
  if (id.startsWith('ads') || url.includes('/advertising')) return 'ads';
  if (id.startsWith('orders') || url.includes('/orders')) return 'orders';
  if (id.startsWith('messages') || url.includes('/messages')) return 'messages';
  return 'other';
}

function sellerTables(page: EvaluationRawDocument): Array<{ headers: string[]; rows: string[][] }> {
  if (Array.isArray(page.tables) && page.tables.length > 0) return page.tables;
  try {
    const parsed = JSON.parse(String(page.tablesJson || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const SellerRawSheet: React.FC<{ pages: EvaluationRawDocument[]; emptyLabel: string }> = ({ pages, emptyLabel }) => {
  if (pages.length === 0) return <div className="py-8 text-center text-sm text-gray-500">{emptyLabel}</div>;
  return <div className="space-y-4">{pages.map((page, pageIndex) => {
    const tables = sellerTables(page);
    return <section key={page.id} className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div><div className="font-semibold text-sm">Trang {pageIndex + 1}: {page.title || page.id}</div><a href={String(page.url || '#')} target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline break-all">{String(page.url || '')}</a></div>
        <div className="text-xs text-gray-500">Kỳ lọc: {page.periodFilterSupported ? (page.periodFilterApplied ? 'Đã áp dụng' : 'Chưa xác minh') : 'Không hỗ trợ'}</div>
      </div>
      {Array.isArray(page.headings) && page.headings.length > 0 && <div className="mb-3 flex flex-wrap gap-1">{page.headings.map((heading: string, index: number) => <span key={index} className="rounded bg-gray-100 dark:bg-gray-900 px-2 py-1 text-[11px]">{heading}</span>)}</div>}
      <div className="space-y-3">{tables.map((table, tableIndex) => {
        const width = Math.max(table.headers?.length || 0, ...((table.rows || []).map(row => row.length)), 1);
        const headers = Array.from({ length: width }, (_, index) => table.headers?.[index] || `Cột ${index + 1}`);
        const rows = (table.rows || []).map(row => Object.fromEntries(headers.map((_, index) => [`c${index}`, row[index] || '—'])));
        return <div key={tableIndex}><div className="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-300">Bảng {tableIndex + 1} · {rows.length} dòng</div><ReportTable columns={headers.map((header, index) => ({ key: `c${index}`, label: header, className: 'min-w-32' }))} rows={rows} /></div>;
      })}</div>
      {tables.length === 0 && Array.isArray(page.cards) && page.cards.length > 0 && <ReportTable columns={[{ key: 'content', label: 'Nội dung card', className: 'min-w-[48rem]' }]} rows={page.cards.map((content: string) => ({ content }))} />}
      {tables.length === 0 && (!Array.isArray(page.cards) || page.cards.length === 0) && <pre className="max-h-80 overflow-auto rounded-lg bg-gray-50 dark:bg-gray-900 p-3 text-xs whitespace-pre-wrap">{String(page.visibleText || 'Không có nội dung text.')}</pre>}
      <RawJsonBlock value={page} label={`JSON trang ${pageIndex + 1}`} />
    </section>;
  })}</div>;
};

const RawDataSheets: React.FC<{
  data: EvaluationRawData;
  listingPage: number;
  onListingPageChange: (page: number) => void;
  onDownload: () => void;
}> = ({ data, listingPage, onListingPageChange, onDownload }) => {
  const [activeSheet, setActiveSheet] = useState<RawSheetKey>('overview');
  const seller = (kind: Exclude<RawSheetKey, 'overview' | 'listings' | 'details' | 'reviews' | 'logs'>) => data.sellerPages.filter(page => sellerPageKind(page) === kind);
  const sheets: Array<{ key: RawSheetKey; label: string; count: number }> = [
    { key: 'overview', label: 'Overview', count: data.publicPages.length },
    { key: 'listings', label: 'Listings', count: data.listings.length },
    { key: 'details', label: 'Listing Details', count: data.listingDetails.length },
    { key: 'reviews', label: 'Reviews', count: data.reviews.length },
    { key: 'stats', label: 'Stats', count: seller('stats').length },
    { key: 'ads', label: 'Ads', count: seller('ads').length },
    { key: 'orders', label: 'Orders', count: seller('orders').length },
    { key: 'messages', label: 'Messages', count: seller('messages').length },
    { key: 'logs', label: 'Agent Logs', count: data.logs.length },
  ];
  return <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 p-2">
      <div className="flex flex-wrap gap-1">{sheets.map(sheet => <button key={sheet.key} type="button" onClick={() => setActiveSheet(sheet.key)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${activeSheet === sheet.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700'}`}>{sheet.label} <span className="opacity-70">({sheet.count})</span></button>)}</div>
      <button type="button" onClick={onDownload} className="rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs font-semibold">Tải toàn bộ JSON</button>
    </div>
    <div className="p-3">
      {activeSheet === 'overview' && <><ReportTable columns={[{ key: 'id', label: 'Page' }, { key: 'pageType', label: 'Loại' }, { key: 'title', label: 'Tiêu đề', className: 'min-w-64' }, { key: 'shopName', label: 'Shop' }, { key: 'rating', label: 'Rating' }, { key: 'reviewCount', label: 'Reviews' }, { key: 'salesCount', label: 'Sales' }, { key: 'url', label: 'URL', className: 'min-w-80', render: row => <a href={row.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{row.url}</a> }]} rows={data.publicPages} /><RawJsonBlock value={data.publicPages} /></>}
      {activeSheet === 'listings' && <><ListingDataTable rows={data.listings} page={listingPage} onPageChange={onListingPageChange} /><RawJsonBlock value={data.listings} /></>}
      {activeSheet === 'details' && <><ReportTable columns={[{ key: 'primaryImageUrl', label: 'Ảnh', render: row => { const imageUrl = row.primaryImageUrl || row.images?.[0]; return imageUrl ? <a href={imageUrl} target="_blank" rel="noreferrer"><img src={imageUrl} alt={row.primaryImageAlt || row.title || 'Listing'} className="h-20 w-20 rounded-md object-cover" loading="lazy" /></a> : '—'; } }, { key: 'listingId', label: 'ID' }, { key: 'title', label: 'Tiêu đề', className: 'min-w-72' }, { key: 'price', label: 'Giá' }, { key: 'sellerName', label: 'Shop' }, { key: 'materials', label: 'Chất liệu', className: 'min-w-56', render: row => Array.isArray(row.materials) && row.materials.length ? row.materials.join(', ') : '—' }, { key: 'variations', label: 'Phân loại', className: 'min-w-72 whitespace-pre-line', render: row => Array.isArray(row.variations) && row.variations.length ? row.variations.map((item: any) => `${item.name}: ${(item.options || []).join(', ')}`).join('\n') : '—' }, { key: 'personalization', label: 'Cá nhân hóa', className: 'min-w-64' }, { key: 'shippingAndReturns', label: 'Shipping/Returns', className: 'min-w-72' }, { key: 'description', label: 'Mô tả', className: 'min-w-[36rem]' }, { key: 'url', label: 'URL', className: 'min-w-72', render: row => <a href={row.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Mở listing</a> }]} rows={data.listingDetails} /><RawJsonBlock value={data.listingDetails} /></>}
      {activeSheet === 'reviews' && <><ReportTable columns={[{ key: 'rating', label: 'Sao' }, { key: 'date', label: 'Ngày' }, { key: 'text', label: 'Nội dung review', className: 'min-w-[36rem]' }, { key: 'listingUrl', label: 'Listing', className: 'min-w-64', render: row => row.listingUrl ? <a href={row.listingUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">Mở listing</a> : '—' }, { key: 'sourcePage', label: 'Trang' }]} rows={data.reviews} /><RawJsonBlock value={data.reviews} /></>}
      {activeSheet === 'stats' && <SellerRawSheet pages={seller('stats')} emptyLabel="Agent chưa thu được Stats." />}
      {activeSheet === 'ads' && <SellerRawSheet pages={seller('ads')} emptyLabel="Agent chưa thu được Ads." />}
      {activeSheet === 'orders' && <SellerRawSheet pages={seller('orders')} emptyLabel="Agent chưa thu được Orders." />}
      {activeSheet === 'messages' && <SellerRawSheet pages={seller('messages')} emptyLabel="Agent chưa thu được Messages." />}
      {activeSheet === 'logs' && <><ReportTable columns={[{ key: 'timestamp', label: 'Thời gian' }, { key: 'level', label: 'Mức' }, { key: 'stage', label: 'Stage', className: 'min-w-48' }, { key: 'message', label: 'Nội dung', className: 'min-w-[40rem]' }]} rows={data.logs} /><RawJsonBlock value={data.logs} /></>}
    </div>
  </div>;
};

function workerState(account: Account): { label: string; color: string } {
  const status = account.evaluation_worker_status;
  if (!status?.workerId && !status?.lastHeartbeat) return { label: 'Chưa cài extension', color: 'text-gray-500 bg-gray-100 dark:bg-gray-700' };
  if (!status?.lastHeartbeat) return { label: 'Extension đã cài · Chưa online', color: 'text-slate-600 bg-slate-100 dark:text-slate-300 dark:bg-slate-800' };
  const heartbeatAge = Date.now() - Date.parse(status.lastHeartbeat);
  if (!Number.isFinite(heartbeatAge) || heartbeatAge > 150_000) return { label: 'Extension đã cài · Offline', color: 'text-slate-600 bg-slate-100 dark:text-slate-300 dark:bg-slate-800' };
  if (status.status === 'processing') return { label: 'Extension online · Agent đang chạy', color: 'text-blue-700 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30' };
  if (status.status === 'auth-required') return { label: 'Extension online · Cần xác minh Etsy', color: 'text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30' };
  if (status.status === 'error') return { label: 'Extension lỗi', color: 'text-red-700 bg-red-100 dark:text-red-300 dark:bg-red-900/30' };
  return { label: 'Extension online', color: 'text-green-700 bg-green-100 dark:text-green-300 dark:bg-green-900/30' };
}

function isWorkerOnline(account: Account): boolean {
  const status = account.evaluation_worker_status;
  if (!status?.lastHeartbeat) return false;
  const heartbeatAge = Date.now() - Date.parse(status.lastHeartbeat);
  return Number.isFinite(heartbeatAge) && heartbeatAge <= 150_000 && !['error', 'offline'].includes(status.status);
}

function evaluationAccountRank(account: Account): number {
  if (account.evaluation_worker_status?.status === 'processing' && isWorkerOnline(account)) return 0;
  if (isWorkerOnline(account)) return 1;
  if (account.evaluation_worker_status?.workerId || account.evaluation_worker_status?.lastHeartbeat) return 2;
  return 3;
}

function compareEvaluationAccounts(left: Account, right: Account): number {
  return evaluationAccountRank(left) - evaluationAccountRank(right) || left.label.localeCompare(right.label);
}

const ShopPicker: React.FC<{
  accounts: Account[];
  selectedAccountId: string;
  onSelect: (accountId: string) => void;
}> = ({ accounts, selectedAccountId, onSelect }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = accounts.find(account => account.id === selectedAccountId);
  const sortedAccounts = useMemo(() => [...accounts].sort(compareEvaluationAccounts), [accounts]);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredAccounts = sortedAccounts.filter(account => !normalizedSearch || [account.label, account.email, account.id, account.evaluation_worker_status?.workerId]
    .some(value => String(value || '').toLowerCase().includes(normalizedSearch)));
  const onlineCount = accounts.filter(isWorkerOnline).length;
  const installedCount = accounts.filter(account => account.evaluation_worker_status?.workerId || account.evaluation_worker_status?.lastHeartbeat).length;

  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, []);

  return <div ref={containerRef} className="relative">
    <div onClick={() => setOpen(true)} className="flex items-center gap-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500">
      <MagnifyingGlassIcon className="h-4 w-4 flex-none text-gray-400" />
      <input
        type="text"
        value={open ? search : selected?.label || ''}
        onFocus={() => { setSearch(''); setOpen(true); }}
        onChange={event => { setSearch(event.target.value); setOpen(true); }}
        placeholder="Gõ tên hoặc email shop..."
        className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-gray-900 dark:text-white outline-none placeholder:font-normal placeholder:text-gray-400"
      />
      {selected && !open && <span className={`hidden sm:inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${workerState(selected).color}`}>{workerState(selected).label}</span>}
      <ChevronDownIcon className={`h-4 w-4 flex-none text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
    </div>
    {open && <div className="absolute z-40 mt-1 w-full sm:min-w-[22rem] overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 dark:border-gray-700 px-3 py-2 text-[11px] text-gray-500">
        <span>{filteredAccounts.length}/{accounts.length} shop</span>
        <span><strong className="text-green-600">{onlineCount} extension online</strong> · {installedCount} đã cài</span>
      </div>
      <div className="max-h-72 overflow-y-auto p-1.5">
        {filteredAccounts.map(account => {
          const state = workerState(account);
          const online = isWorkerOnline(account);
          return <button
            key={account.id}
            type="button"
            onMouseDown={event => event.preventDefault()}
            onClick={() => { onSelect(account.id); setSearch(''); setOpen(false); }}
            className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/70 ${account.id === selectedAccountId ? 'bg-blue-50 dark:bg-blue-950/30' : ''}`}
          >
            <span className="min-w-0">
              <span className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white"><span className={`h-2 w-2 flex-none rounded-full ${online ? 'bg-green-500' : account.evaluation_worker_status ? 'bg-slate-400' : 'bg-gray-300'}`} /> <span className="truncate">{account.label}</span></span>
              <span className="mt-0.5 block truncate pl-4 text-[11px] text-gray-500">{account.email || account.id}</span>
            </span>
            <span className={`flex-none rounded-full px-2 py-1 text-[10px] font-semibold ${state.color}`}>{state.label}</span>
          </button>;
        })}
        {filteredAccounts.length === 0 && <div className="px-3 py-8 text-center text-sm text-gray-500">Không tìm thấy shop phù hợp.</div>}
      </div>
    </div>}
  </div>;
};

const EvaluationLogCard: React.FC<{ log: EvaluationLogEntry }> = ({ log }) => {
  const context = log.context as any;
  const isAgentDecision = log.stage.endsWith('-decision') && context?.action;
  return <div className={`p-3 text-xs ${isAgentDecision ? 'bg-cyan-50/60 dark:bg-cyan-950/15' : ''}`}>
    <div className="flex flex-wrap gap-2 items-center">
      <span className={`font-semibold ${log.level === 'error' ? 'text-red-600' : log.level === 'warn' ? 'text-amber-600' : 'text-green-600'}`}>{log.level.toUpperCase()}</span>
      <span className="font-mono text-gray-500">{log.timestamp || '—'}</span>
      <span className="font-semibold">{log.source} · {log.stage}</span>
      {isAgentDecision && <span className="rounded-full bg-cyan-600 px-2 py-0.5 font-semibold text-white">BROWSER AGENT · {String(context.action).toUpperCase()}</span>}
    </div>
    <div className="mt-1 text-gray-800 dark:text-gray-200">{log.message}</div>
    {isAgentDecision && <div className="mt-2 rounded-lg border border-cyan-200 dark:border-cyan-900 bg-white dark:bg-gray-900 p-2.5">
      <div className="font-semibold text-cyan-700 dark:text-cyan-300">Agent trả lời: {context.reason || 'Không có lý do.'}</div>
      <div className="mt-1 grid gap-1 text-gray-500 sm:grid-cols-2">
        <div>Tool: <span className="font-mono text-gray-700 dark:text-gray-300">{context.tool}</span></div>
        <div>Model: <span className="font-mono text-gray-700 dark:text-gray-300">{context.model || '—'}</span></div>
        <div className="sm:col-span-2 break-all">Snapshot URL: {context.observation?.url || '—'}</div>
        <div className="sm:col-span-2">Snapshot: {context.observation?.title || '—'} · {JSON.stringify(context.observation?.signals || {})}</div>
      </div>
    </div>}
    {log.request && <div className="mt-1 font-mono text-gray-500">{log.request.method || 'GET'} {log.request.status || '—'} · {log.request.durationMs ?? '—'}ms · {log.request.url || '—'}</div>}
    {log.error && <pre className="mt-2 p-2 rounded bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 whitespace-pre-wrap break-words">{log.error.name}: {log.error.message}\n{log.error.stack}</pre>}
    {log.context && <details className="mt-2"><summary className="cursor-pointer text-gray-500 hover:text-blue-600">Xem snapshot/context đầy đủ</summary><pre className="mt-1 p-2 rounded bg-gray-50 dark:bg-gray-900 whitespace-pre-wrap break-words text-gray-600 dark:text-gray-300">{JSON.stringify(log.context, null, 2)}</pre></details>}
  </div>;
};

function formatDate(value: unknown): string {
  if (!value) return '—';
  if (typeof value === 'object' && value && 'toDate' in value && typeof (value as { toDate: () => Date }).toDate === 'function') return (value as { toDate: () => Date }).toDate().toLocaleString();
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function runCompletesJob(run: EvaluationRun, job: EvaluationJob): boolean {
  if (run.status === 'failed' || run.status === 'cancelled') return true;
  if (run.status !== 'collected' && run.status !== 'partial') return false;
  if (job.type !== 'agent-evaluation' || job.autoAnalyze === false) return true;
  return run.analysis?.status === 'completed' || run.analysis?.status === 'failed';
}

const ShopEvaluationTab: React.FC = () => {
  const { teamId, accounts, role, permissions } = useDashboard();
  const { addNotification } = useNotification();
  const [runs, setRuns] = useState<EvaluationRun[]>([]);
  const [jobs, setJobs] = useState<EvaluationJob[]>([]);
  const [creatingAccountId, setCreatingAccountId] = useState<string | null>(null);
  const [provider, setProvider] = useState<'anthropic' | '9router'>('9router');
  const [nineRouterModel, setNineRouterModel] = useState('cc/claude-fable-5');
  const [periodDays, setPeriodDays] = useState<1 | 7 | 14 | 30>(1);
  const [requestedTools, setRequestedTools] = useState<EvaluationTool[]>(SCOPE_TOOLS.full);
  const [crawlLimits, setCrawlLimits] = useState<EvaluationCrawlLimits>({ listingPages: 5, listings: 100, listingDetails: 20, reviewPages: 5, reviews: 100 });
  const [extraPrompts, setExtraPrompts] = useState<EvaluationToolNotes>({});
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [publicTestAccountId, setPublicTestAccountId] = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null);
  const [expandedReportRunId, setExpandedReportRunId] = useState<string | null>(null);
  const [rawDataByRun, setRawDataByRun] = useState<Record<string, EvaluationRawData>>({});
  const [listingPageByRun, setListingPageByRun] = useState<Record<string, number>>({});
  const [loadingRawRunId, setLoadingRawRunId] = useState<string | null>(null);
  const [aiStreamByRun, setAiStreamByRun] = useState<Record<string, { text: string; stage: string; model?: string; progress?: { current: number; total: number; stage: string; listingStart?: number; listingEnd?: number; listingTotal?: number }; error?: string }>>({});
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [cancellingJobId, setCancellingJobId] = useState<string | null>(null);
  const [deletingRunId, setDeletingRunId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [expandedLogRunId, setExpandedLogRunId] = useState<string | null>(null);
  const [logsByRun, setLogsByRun] = useState<Record<string, EvaluationLogEntry[]>>({});
  const [loadingLogRunId, setLoadingLogRunId] = useState<string | null>(null);
  const [loadingMoreLogRunId, setLoadingMoreLogRunId] = useState<string | null>(null);
  const [hasMoreLogsByRun, setHasMoreLogsByRun] = useState<Record<string, boolean>>({});
  const autoOpenedReports = useRef(new Set<string>());
  const reconcilingJobs = useRef(new Set<string>());
  const latestLiveOutputRef = useRef<HTMLPreElement | null>(null);
  const [followLatestLive, setFollowLatestLive] = useState(true);

  useEffect(() => {
    const unsubscribeRuns = listenForEvaluationRuns(teamId, setRuns);
    const unsubscribeJobs = listenForEvaluationJobs(teamId, setJobs);
    return () => { unsubscribeRuns(); unsubscribeJobs(); };
  }, [teamId]);

  useEffect(() => {
    if (accounts.length === 0) {
      if (selectedAccountId) setSelectedAccountId('');
      return;
    }
    if (!accounts.some(account => account.id === selectedAccountId)) {
      setSelectedAccountId([...accounts].sort(compareEvaluationAccounts)[0].id);
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    const completed = runs.find(run => run.accountId === selectedAccountId && run.analysis?.status === 'completed' && !autoOpenedReports.current.has(run.id));
    if (!completed) return;
    autoOpenedReports.current.add(completed.id);
    setExpandedRunId(null);
    setExpandedLogRunId(null);
    setExpandedReportRunId(completed.id);
  }, [runs]);

  useEffect(() => {
    setExpandedRunId(null);
    setExpandedReportRunId(null);
    setExpandedLogRunId(null);
  }, [selectedAccountId]);

  useEffect(() => {
    if (!expandedLogRunId) return;
    setLoadingLogRunId(expandedLogRunId);
    const unsubscribe = listenForEvaluationLogs(teamId, expandedLogRunId, latestLogs => {
      setLogsByRun(current => {
        const merged = new Map((current[expandedLogRunId] || []).map(log => [log.id, log]));
        latestLogs.forEach(log => merged.set(log.id, log));
        return { ...current, [expandedLogRunId]: Array.from(merged.values()).sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || ''))) };
      });
      setHasMoreLogsByRun(current => ({ ...current, [expandedLogRunId]: latestLogs.length >= 20 || current[expandedLogRunId] === true }));
      setLoadingLogRunId(current => current === expandedLogRunId ? null : current);
    });
    return unsubscribe;
  }, [expandedLogRunId, teamId]);

  useEffect(() => {
    jobs.filter(job => job.status === 'pending' || job.status === 'processing').forEach(job => {
      const run = runs.find(item => item.jobId === job.id || (job.runId && item.id === job.runId));
      if (!run || !runCompletesJob(run, job) || reconcilingJobs.current.has(job.id)) return;
      reconcilingJobs.current.add(job.id);
      const status = run.status === 'failed' ? 'failed' : run.status === 'cancelled' ? 'cancelled' : 'completed';
      void reconcileEvaluationJob(teamId, job.id, run.id, status, run.analysis?.updatedAt || run.completedAt, run.error)
        .catch(error => {
          reconcilingJobs.current.delete(job.id);
          console.error('Evaluation job reconciliation failed:', error);
        });
    });
  }, [jobs, runs, teamId]);

  const accessibleAccountIds = useMemo(() => new Set(accounts.map(account => account.id)), [accounts]);
  const accessibleRuns = useMemo(
    () => runs.filter(run => accessibleAccountIds.has(run.accountId)),
    [accessibleAccountIds, runs],
  );
  const accessibleJobs = useMemo(
    () => jobs.filter(job => accessibleAccountIds.has(job.accountId)),
    [accessibleAccountIds, jobs],
  );
  const canDeleteAllEvaluationData = role === 'owner' || permissions.canManageSettings === true;

  const pendingByAccount = useMemo(() => {
    const map = new Map<string, EvaluationJob>();
    accessibleJobs.filter(job => job.status === 'pending' || job.status === 'processing').forEach(job => {
      const run = accessibleRuns.find(item => item.jobId === job.id || (job.runId && item.id === job.runId));
      if (!run || !runCompletesJob(run, job)) map.set(job.accountId, job);
    });
    return map;
  }, [accessibleJobs, accessibleRuns]);
  const selectedAccount = useMemo(() => accounts.find(account => account.id === selectedAccountId) || null, [accounts, selectedAccountId]);
  const selectedPendingJob = selectedAccount ? pendingByAccount.get(selectedAccount.id) : undefined;
  const selectedPendingRun = selectedPendingJob ? accessibleRuns.find(run => run.jobId === selectedPendingJob.id || run.id === selectedPendingJob.runId) : undefined;
  const selectedActiveAnalysisRun = selectedAccount ? accessibleRuns.find(run => run.accountId === selectedAccount.id && run.analysis?.status === 'running') : undefined;
  const selectedWorkerOnline = selectedAccount ? isWorkerOnline(selectedAccount) : false;
  const selectedWorkerState = selectedAccount ? workerState(selectedAccount) : null;
  const selectedWorkerBusy = selectedAccount?.evaluation_worker_status?.status === 'processing';
  const sellerPeriodEnabled = requestedTools.includes('collect_seller_stats') || requestedTools.includes('collect_seller_ads');
  const selectedCrawlFinished = selectedPendingRun && ['collected', 'partial'].includes(selectedPendingRun.status);
  const selectedAnalysisRunning = selectedPendingRun?.analysis?.status === 'running';
  const selectedJobLabel = !selectedPendingJob
    ? null
    : selectedPendingJob.status === 'pending'
      ? `Job ${selectedPendingJob.id.slice(0, 8)} · chờ extension`
      : selectedAnalysisRunning
        ? `Đã crawl xong · AI ${selectedPendingRun.analysis?.progress ? `${selectedPendingRun.analysis.progress.current}/${selectedPendingRun.analysis.progress.total}` : 'đang phân tích'}`
        : selectedCrawlFinished
          ? 'Đã crawl xong · đang chốt job'
          : `Đang crawl · ${selectedPendingRun?.stage || 'đang khởi động'}`;
  const selectedJobHelp = selectedPendingRun?.stage === 'waiting-human-verification'
    ? 'Cần bạn hỗ trợ: mở tab Etsy của agent và hoàn tất xác minh/CAPTCHA.'
    : selectedAnalysisRunning
      ? 'Crawl đã xong; không cần giữ tab Etsy. AI đang tạo báo cáo và workbook.'
      : selectedPendingRun?.status === 'running'
        ? 'Agent đang thao tác chỉ đọc trên Etsy; chỉ hỗ trợ khi xuất hiện yêu cầu xác minh.'
        : selectedPendingJob?.status === 'pending'
          ? 'Extension sẽ nhận job ở lần quét gần nhất.'
          : null;
  const visibleRuns = useMemo(() => accessibleRuns.filter(run => !selectedAccountId || run.accountId === selectedAccountId), [accessibleRuns, selectedAccountId]);
  const latestLiveRun = useMemo(() => visibleRuns
    .filter(run => Boolean(aiStreamByRun[run.id] || run.aiLive))
    .sort((left, right) => {
      const leftActive = ['connecting', 'running'].includes(aiStreamByRun[left.id]?.stage || left.aiLive?.status || '') ? 1 : 0;
      const rightActive = ['connecting', 'running'].includes(aiStreamByRun[right.id]?.stage || right.aiLive?.status || '') ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return Date.parse(String(right.aiLive?.updatedAt || right.analysis?.startedAt || right.startedAt || '')) - Date.parse(String(left.aiLive?.updatedAt || left.analysis?.startedAt || left.startedAt || ''));
    })[0] || null, [aiStreamByRun, visibleRuns]);
  const latestLiveState = latestLiveRun ? aiStreamByRun[latestLiveRun.id] || latestLiveRun.aiLive : null;
  const latestLiveStatus = latestLiveState ? ('stage' in latestLiveState ? latestLiveState.stage : latestLiveState.status) : '';
  const latestLiveRunning = ['connecting', 'connected', 'running', 'streaming', 'analyzing', 'analyzing-batch', 'synthesizing'].some(status => latestLiveStatus.includes(status));
  useEffect(() => {
    if (!followLatestLive || !latestLiveState?.text || !latestLiveOutputRef.current) return;
    latestLiveOutputRef.current.scrollTop = latestLiveOutputRef.current.scrollHeight;
  }, [followLatestLive, latestLiveState?.text]);
  const viewerRunId = expandedReportRunId || expandedRunId || expandedLogRunId;
  const viewerRun = useMemo(() => accessibleRuns.find(run => run.id === viewerRunId && run.accountId === selectedAccountId) || null, [accessibleRuns, selectedAccountId, viewerRunId]);
  const viewerMode: 'report' | 'raw' | 'logs' | null = expandedReportRunId ? 'report' : expandedRunId ? 'raw' : expandedLogRunId ? 'logs' : null;

  const toggleRequestedTool = (tool: EvaluationTool) => {
    setRequestedTools(current => {
      if (tool === 'collect_listing_details' && !current.includes(tool)) {
        return Array.from(new Set([...current, 'collect_public_listings', 'collect_listing_details']));
      }
      if (tool === 'collect_public_listings' && current.includes(tool)) {
        return current.filter(item => item !== 'collect_public_listings' && item !== 'collect_listing_details');
      }
      return current.includes(tool) ? current.filter(item => item !== tool) : [...current, tool];
    });
  };

  const handleRun = async (account: Account) => {
    if (pendingByAccount.has(account.id)) return addNotification(`${account.label} đã có job đang chờ/chạy.`, 'info');
    if (account.evaluation_worker_status?.status === 'processing') return addNotification(`${account.label} vẫn đang xử lý run trước.`, 'info');
    setCreatingAccountId(account.id);
    try {
      if (!isWorkerOnline(account)) throw new Error('Extension của shop chưa online.');
      if (requestedTools.length === 0) throw new Error('Hãy tick ít nhất một nguồn dữ liệu cần crawl.');
      const scope = inferEvaluationScope(requestedTools);
      const toolNotes = Object.fromEntries(requestedTools.map(tool => {
        const option = EVALUATION_TOOL_OPTIONS.find(item => item.tool === tool)!;
        const extra = String(extraPrompts[tool] || '').trim();
        return [tool, `${option.defaultPrompt}${extra ? `\nEXTRA PROMPT: ${extra}` : ''}`];
      })) as EvaluationToolNotes;
      const customPrompt = requestedTools.flatMap(tool => {
        const extra = String(extraPrompts[tool] || '').trim();
        return extra ? [`${EVALUATION_TOOL_OPTIONS.find(item => item.tool === tool)?.label}: ${extra}`] : [];
      }).join('\n\n').slice(0, 4_000);
      const result = await createAgentEvaluationJob(teamId, account, { scope, customPrompt, periodDays, provider, model: provider === '9router' ? nineRouterModel : '', requestedTools, crawlLimits, toolNotes });
      addNotification(`Browser agent đã lập plan ${result.plan.tools.length} mục tiêu và tạo job ${result.jobId}.`, 'success');
    } catch (error) {
      console.error(error);
      addNotification(error instanceof Error ? error.message : 'Không thể tạo evaluation job.', 'error');
    } finally {
      setCreatingAccountId(null);
    }
  };

  const handleAnalyze = async (run: EvaluationRun) => {
    setAnalyzingRunId(run.id);
    setAiStreamByRun(current => ({ ...current, [run.id]: { text: '', stage: 'connecting' } }));
    try {
      const backgroundJobId = await queueEvaluationAnalysis(teamId, run, provider, provider === '9router' ? nineRouterModel : '');
      setAiStreamByRun(current => {
        const next = { ...current };
        delete next[run.id];
        return next;
      });
      addNotification(`Đã xếp hàng phân tích nền ${run.shopLabel} · job ${backgroundJobId.slice(0, 8)}. Có thể đóng dashboard.`, 'success');
      return;
      await analyzeEvaluationRun(teamId, run.id, provider, provider === '9router' ? nineRouterModel : '', {
        onStatus: status => setAiStreamByRun(current => ({ ...current, [run.id]: { ...(current[run.id] || { text: '' }), stage: status.stage, model: status.model } })),
        onProgress: progress => setAiStreamByRun(current => ({ ...current, [run.id]: { ...(current[run.id] || { text: '' }), stage: progress.stage, progress } })),
        onDelta: delta => setAiStreamByRun(current => {
          const previous = current[run.id] || { text: '', stage: 'streaming' };
          const text = `${previous.text}${delta}`.slice(-60_000);
          return { ...current, [run.id]: { ...previous, stage: 'streaming', text } };
        }),
      });
      setAiStreamByRun(current => ({ ...current, [run.id]: { ...(current[run.id] || { text: '' }), stage: 'completed' } }));
      setExpandedRunId(null);
      setExpandedLogRunId(null);
      setExpandedReportRunId(run.id);
      addNotification(`Đã phân tích ${run.shopLabel} bằng ${provider === 'anthropic' ? 'Claude' : '9Router'}.`, 'success');
    } catch (error) {
      console.error(error);
      setAiStreamByRun(current => ({ ...current, [run.id]: { ...(current[run.id] || { text: '' }), stage: 'failed', error: error instanceof Error ? error.message : 'AI analysis failed.' } }));
      addNotification(error instanceof Error ? error.message : 'AI analysis failed.', 'error');
    } finally {
      setAnalyzingRunId(null);
    }
  };

  const handleCancelJob = async (job: EvaluationJob) => {
    setCancellingJobId(job.id);
    try {
      await cancelEvaluationJob(teamId, job.id);
      addNotification(job.status === 'processing' ? 'Đã gửi yêu cầu dừng. Extension sẽ dừng tại checkpoint an toàn gần nhất.' : 'Đã hủy job đang chờ.', 'success');
    } catch (error) {
      console.error(error);
      addNotification(error instanceof Error ? error.message : 'Không thể hủy evaluation job.', 'error');
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleCancelAnalysis = async (job: EvaluationJob, run: EvaluationRun) => {
    setCancellingJobId(job.id);
    try {
      await cancelEvaluationAnalysis(teamId, run.id, job.id);
      addNotification(`Đã hủy phân tích ${run.shopLabel}. Bạn có thể chạy test lại.`, 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không thể hủy phân tích.', 'error');
    } finally {
      setCancellingJobId(null);
    }
  };

  const handleCancelStandaloneAnalysis = async (run: EvaluationRun) => {
    setCancellingJobId(run.id);
    try {
      await cancelEvaluationAnalysis(teamId, run.id);
      addNotification(`Đã hủy phân tích ${run.shopLabel}. Bạn có thể chạy test lại.`, 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không thể hủy phân tích.', 'error');
    } finally {
      setCancellingJobId(null);
    }
  };

  const handlePublicTest = async (account: Account) => {
    setPublicTestAccountId(account.id);
    try {
      const result = await collectPublicEvaluationWithoutExtension(teamId, account);
      addNotification(`Public test ${account.label}: lấy được ${result.listings} listing (${result.status}).`, result.status === 'collected' ? 'success' : 'info');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Public crawler failed.', 'error');
    } finally {
      setPublicTestAccountId(null);
    }
  };

  const handleToggleData = async (run: EvaluationRun) => {
    if (expandedRunId === run.id) return setExpandedRunId(null);
    setExpandedReportRunId(null);
    setExpandedLogRunId(null);
    setExpandedRunId(run.id);
    setListingPageByRun(current => ({ ...current, [run.id]: 1 }));
    if (rawDataByRun[run.id]) return;
    setLoadingRawRunId(run.id);
    try {
      const data = await getEvaluationRawData(teamId, run.id);
      setRawDataByRun(current => ({ ...current, [run.id]: data }));
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không tải được listing data.', 'error');
    } finally {
      setLoadingRawRunId(null);
    }
  };

  const handleDeleteRun = async (run: EvaluationRun) => {
    if (!window.confirm(`Xóa run ${run.shopLabel} và toàn bộ listing/review/AI data bên trong?`)) return;
    setDeletingRunId(run.id);
    try {
      await deleteEvaluationRun(teamId, run.id);
      setExpandedRunId(current => current === run.id ? null : current);
      setExpandedReportRunId(current => current === run.id ? null : current);
      setExpandedLogRunId(current => current === run.id ? null : current);
      setRawDataByRun(current => { const next = { ...current }; delete next[run.id]; return next; });
      setAiStreamByRun(current => { const next = { ...current }; delete next[run.id]; return next; });
      setLogsByRun(current => { const next = { ...current }; delete next[run.id]; return next; });
      addNotification('Đã xóa evaluation run.', 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không xóa được run.', 'error');
    } finally {
      setDeletingRunId(null);
    }
  };

  const handleDeleteAll = async () => {
    if (!canDeleteAllEvaluationData) return addNotification('Không có quyền xóa toàn bộ evaluation data.', 'error');
    if (!window.confirm('Xóa TOÀN BỘ evaluation jobs, runs, listings, reviews và AI data của tất cả shop?')) return;
    setDeletingAll(true);
    try {
      const result = await deleteAllEvaluationData(teamId);
      setExpandedRunId(null); setExpandedReportRunId(null); setExpandedLogRunId(null); setRawDataByRun({}); setAiStreamByRun({}); setLogsByRun({});
      addNotification(`Đã xóa ${result.runsDeleted} runs và ${result.jobsDeleted} jobs.`, 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không xóa được evaluation data.', 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  const handleToggleLogs = async (run: EvaluationRun) => {
    if (expandedLogRunId === run.id) return setExpandedLogRunId(null);
    setExpandedReportRunId(null);
    setExpandedRunId(null);
    setExpandedLogRunId(run.id);
  };

  const handleLoadMoreLogs = async (run: EvaluationRun) => {
    if (loadingMoreLogRunId === run.id || hasMoreLogsByRun[run.id] === false) return;
    const currentLogs = logsByRun[run.id] || [];
    const oldestTimestamp = currentLogs[currentLogs.length - 1]?.timestamp;
    if (!oldestTimestamp) return;
    setLoadingMoreLogRunId(run.id);
    try {
      const page = await getEvaluationLogs(teamId, run.id, { pageSize: 20, beforeTimestamp: oldestTimestamp });
      setLogsByRun(current => {
        const merged = new Map((current[run.id] || []).map(log => [log.id, log]));
        page.logs.forEach(log => merged.set(log.id, log));
        return { ...current, [run.id]: Array.from(merged.values()).sort((left, right) => String(right.timestamp || '').localeCompare(String(left.timestamp || ''))) };
      });
      setHasMoreLogsByRun(current => ({ ...current, [run.id]: page.hasMore }));
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không tải được diagnostic logs.', 'error');
    } finally {
      setLoadingMoreLogRunId(null);
    }
  };

  const handleDownloadLogs = (run: EvaluationRun) => {
    const logs = logsByRun[run.id] || [];
    const blob = new Blob([JSON.stringify({ runId: run.id, shopLabel: run.shopLabel, status: run.status, stage: run.stage, error: run.error, warnings: run.warnings, analysis: run.analysis, logs }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `evaluation-${run.shopLabel}-${run.id}-logs.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const handleDownloadReport = (run: EvaluationRun) => {
    const blob = new Blob([JSON.stringify({ runId: run.id, shopLabel: run.shopLabel, scope: run.scope, analysis: run.analysis }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `evaluation-${run.shopLabel}-${run.id}-report.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const handleDownloadRawData = (run: EvaluationRun) => {
    const data = rawDataByRun[run.id];
    if (!data) return;
    const blob = new Blob([JSON.stringify({ runId: run.id, shopLabel: run.shopLabel, coverage: run.coverage, data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `evaluation-${run.shopLabel}-${run.id}-raw-data.json`; anchor.click(); URL.revokeObjectURL(url);
  };

  const renderToolCard = (option: (typeof EVALUATION_TOOL_OPTIONS)[number]) => {
    const checked = requestedTools.includes(option.tool);
    return <div key={option.tool} className={`rounded-xl border p-3 transition-colors ${checked ? 'border-blue-400 bg-blue-50/40 dark:border-blue-700 dark:bg-blue-950/20' : 'border-gray-200 bg-gray-50/60 dark:border-gray-700 dark:bg-gray-900/40'}`}>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="checkbox" checked={checked} onChange={() => toggleRequestedTool(option.tool)} className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
        <span><span className="block text-sm font-semibold text-gray-900 dark:text-white">{option.label}</span><span className="block text-[11px] leading-4 text-gray-500">{option.description}</span></span>
      </label>
      {checked && option.tool === 'collect_public_listings' && <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-500">Tối đa trang<input type="number" min={1} max={30} value={crawlLimits.listingPages || 5} onChange={event => setCrawlLimits(current => ({ ...current, listingPages: Math.max(1, Math.min(30, Number(event.target.value) || 1)) }))} className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-white" /></label>
        <label className="text-[11px] text-gray-500">Tối đa listing<input type="number" min={1} max={2000} value={crawlLimits.listings || 100} onChange={event => setCrawlLimits(current => ({ ...current, listings: Math.max(1, Math.min(2000, Number(event.target.value) || 1)) }))} className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-white" /></label>
      </div>}
      {checked && option.tool === 'collect_listing_details' && <div className="mt-3 grid grid-cols-1 gap-2">
        <label className="text-[11px] text-gray-500">Số listing cần mở chi tiết<input type="number" min={1} max={200} value={crawlLimits.listingDetails || 20} onChange={event => setCrawlLimits(current => ({ ...current, listingDetails: Math.max(1, Math.min(200, Number(event.target.value) || 1)) }))} className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-white" /></label>
        <div className="text-[10px] leading-4 text-gray-400">Tool này chạy sau Listings và chỉ mở các URL listing đã crawl, không dùng phân trang shop.</div>
      </div>}
      {checked && option.tool === 'collect_public_reviews' && <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="text-[11px] text-gray-500">Tối đa trang<input type="number" min={1} max={50} value={crawlLimits.reviewPages || 5} onChange={event => setCrawlLimits(current => ({ ...current, reviewPages: Math.max(1, Math.min(50, Number(event.target.value) || 1)) }))} className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-white" /></label>
        <label className="text-[11px] text-gray-500">Tối đa review<input type="number" min={1} max={2000} value={crawlLimits.reviews || 100} onChange={event => setCrawlLimits(current => ({ ...current, reviews: Math.max(1, Math.min(2000, Number(event.target.value) || 1)) }))} className="mt-1 w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-sm text-gray-900 dark:text-white" /></label>
      </div>}
      {checked && <div className="mt-3 space-y-2">
        <details className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-gray-900/70"><summary className="cursor-pointer px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Xem prompt mặc định của agent</summary><div className="border-t border-slate-100 dark:border-slate-800 px-2.5 py-2 text-[11px] leading-4 text-slate-600 dark:text-slate-300">{option.defaultPrompt}</div></details>
        <textarea value={extraPrompts[option.tool] || ''} maxLength={1000} onChange={event => setExtraPrompts(current => ({ ...current, [option.tool]: event.target.value }))} rows={2} placeholder={`Extra prompt cho ${option.label} (tùy chọn)...`} className="w-full resize-y rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-2 py-1.5 text-xs" />
      </div>}
    </div>;
  };

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Shop Evaluation</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">AI tự lập kế hoạch, crawl bằng các thao tác chỉ đọc, tự phân tích ngay khi thu thập xong; dữ liệu gốc và báo cáo đều có thể mở theo từng sheet.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-300">AI provider</label>
          <select value={provider} onChange={event => setProvider(event.target.value as 'anthropic' | '9router')} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
            <option value="anthropic">Claude</option>
            <option value="9router">9Router</option>
          </select>
          {provider === '9router' && <select value={nineRouterModel} onChange={event => setNineRouterModel(event.target.value)} className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm">
            <option value="cc/claude-fable-5">Claude Fable 5</option>
            <option value="ag/gemini-3-flash-agent">Gemini 3 Flash Agent</option>
          </select>}
        </div>
      </div>

      <section>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <div className="mb-5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/10 p-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
              <div className="min-w-0">
                <label className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-300">Tìm và chọn shop ({accounts.length})</label>
                <ShopPicker accounts={accounts} selectedAccountId={selectedAccountId} onSelect={setSelectedAccountId} />
              </div>
              {selectedAccount && <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                {selectedPendingJob ? selectedCrawlFinished && selectedPendingRun ? <button type="button" disabled={cancellingJobId === selectedPendingJob.id} onClick={() => void handleCancelAnalysis(selectedPendingJob, selectedPendingRun)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:bg-gray-900 dark:hover:bg-red-950/20"><StopIcon className="h-4 w-4" />{cancellingJobId === selectedPendingJob.id ? 'Đang hủy phân tích...' : 'Hủy phân tích'}</button> : <button type="button" disabled={cancellingJobId === selectedPendingJob.id} onClick={() => void handleCancelJob(selectedPendingJob)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:bg-gray-900 dark:hover:bg-red-950/20"><StopIcon className="h-4 w-4" />{cancellingJobId === selectedPendingJob.id ? 'Đang gửi lệnh dừng...' : selectedPendingJob.status === 'processing' ? 'Dừng browser agent' : 'Hủy job đang chờ'}</button> : selectedActiveAnalysisRun ? <button type="button" disabled={cancellingJobId === selectedActiveAnalysisRun.id} onClick={() => void handleCancelStandaloneAnalysis(selectedActiveAnalysisRun)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:bg-gray-900 dark:hover:bg-red-950/20"><StopIcon className="h-4 w-4" />{cancellingJobId === selectedActiveAnalysisRun.id ? 'Đang hủy phân tích...' : 'Hủy phân tích'}</button> : <button type="button" disabled={!selectedWorkerOnline || selectedWorkerBusy || creatingAccountId === selectedAccount.id || requestedTools.length === 0} onClick={() => handleRun(selectedAccount)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"><PlayIcon className="h-4 w-4" />{creatingAccountId === selectedAccount.id ? 'AI đang lập plan...' : selectedWorkerBusy ? 'Đang chờ agent dừng...' : 'Chạy browser agent'}</button>}
              </div>}
            </div>
            {selectedAccount && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-blue-100 pt-3 text-xs text-gray-500 dark:border-blue-900 dark:text-gray-400">
              {selectedWorkerState && <span className={`rounded-full px-2.5 py-1 font-semibold ${selectedWorkerState.color}`}>{selectedWorkerState.label}</span>}
              {selectedPendingJob ? <span className={`rounded-full px-2.5 py-1 font-semibold ${selectedCrawlFinished ? 'bg-violet-100 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'}`}>{selectedJobLabel}</span> : selectedWorkerBusy ? <span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">Đang hoàn tất lệnh dừng</span> : <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">Sẵn sàng chạy lượt mới</span>}
              <span className="max-w-72 truncate" title={selectedAccount.evaluation_worker_status?.workerId || ''}>Worker: {selectedAccount.evaluation_worker_status?.workerId || '—'}</span>
              <span>Heartbeat: {formatDate(selectedAccount.evaluation_worker_status?.lastHeartbeat)}</span>
              <a className="font-semibold text-blue-600 hover:underline dark:text-blue-400" href={`https://www.etsy.com/shop/${selectedAccount.label.replace(/\s+/g, '')}`} target="_blank" rel="noreferrer">Mở Etsy</a>
              <details className="relative"><summary className="cursor-pointer font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">Công cụ test</summary><div className="absolute right-0 z-30 mt-2 w-64 rounded-lg border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900"><button type="button" disabled={publicTestAccountId === selectedAccount.id} onClick={() => handlePublicTest(selectedAccount)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-left text-xs font-semibold disabled:opacity-50 dark:border-gray-600">{publicTestAccountId === selectedAccount.id ? 'Collector cố định đang chạy...' : 'Chạy collector public cố định'}</button><p className="mt-1.5 text-[10px] leading-4 text-gray-400">Chỉ dùng chẩn đoán public listing, không phải browser agent.</p></div></details>
              {!selectedWorkerOnline && <span className="font-medium text-amber-700 dark:text-amber-300">Extension chưa online.</span>}
            </div>}
            {selectedAccount && selectedJobHelp && <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${selectedPendingRun?.stage === 'waiting-human-verification' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200' : 'bg-white/70 text-gray-600 dark:bg-gray-900/60 dark:text-gray-300'}`}>{selectedJobHelp}</div>}
          </div>
          <div className="mb-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div><div className="text-base font-semibold text-gray-900 dark:text-white">Nguồn dữ liệu agent cần crawl</div><div className="text-xs text-gray-500">Mỗi chức năng đã có prompt crawl mặc định. Chỉ nhập Extra prompt khi cần bổ sung yêu cầu riêng.</div></div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <button type="button" onClick={() => setRequestedTools(SCOPE_TOOLS.full)} className="rounded-md border border-blue-300 px-2.5 py-1.5 font-semibold text-blue-700 dark:text-blue-300">Tất cả</button>
                <button type="button" onClick={() => setRequestedTools(EVALUATION_TOOL_OPTIONS.filter(option => option.group === 'public').map(option => option.tool))} className="rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 font-semibold">Public Shop</button>
                <button type="button" onClick={() => setRequestedTools(SCOPE_TOOLS.seller)} className="rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 font-semibold">Seller Center</button>
                <button type="button" onClick={() => setRequestedTools([])} className="rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 font-semibold text-gray-500">Bỏ chọn</button>
                <span className="rounded-full bg-blue-50 dark:bg-blue-950/30 px-2.5 py-1.5 font-semibold text-blue-700 dark:text-blue-300">{requestedTools.length}/{EVALUATION_TOOL_OPTIONS.length}</span>
              </div>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              <section className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/30 dark:bg-emerald-950/10 p-3">
                <div className="mb-2"><div className="text-sm font-bold text-emerald-800 dark:text-emerald-300">Public Shop</div><div className="text-[11px] text-gray-500">Không cần đăng nhập seller; crawl dữ liệu khách hàng nhìn thấy.</div></div>
                <div className="grid gap-2">{EVALUATION_TOOL_OPTIONS.filter(option => option.group === 'public').map(renderToolCard)}</div>
              </section>
              <section className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/30 dark:bg-amber-950/10 p-3">
                <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                  <div><div className="text-sm font-bold text-amber-800 dark:text-amber-300">Seller Center</div><div className="text-[11px] text-gray-500">Dùng phiên Etsy đã đăng nhập trong extension và chỉ thực hiện thao tác đọc.</div></div>
                  {sellerPeriodEnabled && <label className="flex items-center gap-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300">Kỳ Stats / Ads<select value={periodDays} onChange={event => setPeriodDays(Number(event.target.value) as 1 | 7 | 14 | 30)} className="rounded-md border border-amber-300 bg-white px-2 py-1.5 text-xs text-gray-900 dark:border-amber-800 dark:bg-gray-900 dark:text-white"><option value={1}>Yesterday</option><option value={7}>7 ngày</option><option value={14}>14 ngày</option><option value={30}>30 ngày</option></select></label>}
                </div>
                <div className="grid gap-2">{EVALUATION_TOOL_OPTIONS.filter(option => option.group === 'seller').map(renderToolCard)}</div>
              </section>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3"><h3 className="font-semibold text-gray-900 dark:text-white">Evaluation runs · {selectedAccount?.label || '—'}</h3>{canDeleteAllEvaluationData && <button type="button" disabled={deletingAll || accessibleRuns.length === 0} onClick={handleDeleteAll} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-40 text-xs font-semibold"><TrashIcon className="w-4 h-4" />{deletingAll ? 'Đang xóa...' : 'Xóa toàn bộ data test'}</button>}</div>
        {latestLiveRun && latestLiveState && <div className="sticky top-2 z-20 mb-3 overflow-hidden rounded-xl border border-cyan-300 bg-slate-950 text-slate-100 shadow-xl dark:border-cyan-900"><div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2 text-xs"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-1 font-bold ${latestLiveRunning ? 'bg-cyan-400/20 text-cyan-300' : latestLiveStatus === 'completed' ? 'bg-emerald-400/20 text-emerald-300' : latestLiveStatus === 'failed' ? 'bg-red-400/20 text-red-300' : 'bg-amber-400/20 text-amber-300'}`}>{latestLiveRunning ? 'ĐANG CHẠY' : latestLiveStatus === 'completed' ? 'HOÀN TẤT' : latestLiveStatus === 'failed' ? 'LỖI' : latestLiveStatus.toUpperCase()}</span><span className="font-semibold text-cyan-300">{latestLiveRun.shopLabel} · {latestLiveState.model || latestLiveRun.analysis?.model || (provider === '9router' ? nineRouterModel : provider)}</span></div><div className="flex items-center gap-2"><span className="text-slate-400">{'progress' in latestLiveState && latestLiveState.progress ? `${latestLiveState.progress.stage} ${latestLiveState.progress.current}/${latestLiveState.progress.total}` : latestLiveStatus}</span><button type="button" onClick={() => { setFollowLatestLive(true); requestAnimationFrame(() => { if (latestLiveOutputRef.current) latestLiveOutputRef.current.scrollTop = latestLiveOutputRef.current.scrollHeight; }); }} className={`rounded border px-2 py-1 font-semibold ${followLatestLive ? 'border-cyan-700 text-cyan-300' : 'border-slate-600 text-slate-300'}`}>{followLatestLive ? 'Đang theo dõi mới nhất' : 'Theo dõi mới nhất'}</button></div></div>{latestLiveState.text ? <pre ref={latestLiveOutputRef} onScroll={event => { const element = event.currentTarget; setFollowLatestLive(element.scrollHeight - element.scrollTop - element.clientHeight < 24); }} className="max-h-64 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 font-mono">{latestLiveState.text}</pre> : <div className="p-3 text-xs text-slate-400">{latestLiveStatus === 'connecting' ? 'Job đã xếp hàng, đang chờ extension nhận...' : 'Đang kết nối AI và chờ token đầu tiên...'}</div>}{latestLiveState.error && <div className="border-t border-red-900/60 px-3 py-2 text-xs text-red-400"><strong>Lỗi:</strong> {latestLiveState.error}</div>}</div>}
        <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-left text-xs uppercase text-gray-500"><tr><th className="p-3">Shop</th><th className="p-3">Status</th><th className="p-3">Stage</th><th className="p-3">Listings</th><th className="p-3">Reviews</th><th className="p-3">Started</th><th className="p-3">Thao tác</th></tr></thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {visibleRuns.map(run => (
                <React.Fragment key={run.id}>
                  <tr>
                    <td className="p-3 font-medium text-gray-900 dark:text-white">{run.shopLabel}{run.scope && <div className="mt-1 text-[11px] font-normal text-gray-500">{SCOPE_LABELS[run.scope]}</div>}</td>
                    <td className="p-3"><span className="inline-flex items-center gap-1">{run.status === 'failed' || run.status === 'partial' ? <ExclamationTriangleIcon className="w-4 h-4 text-amber-500" /> : run.status === 'collected' ? <CheckCircleIcon className="w-4 h-4 text-green-500" /> : <ArrowPathIcon className={`w-4 h-4 text-blue-500 ${run.status === 'running' ? 'animate-spin' : ''}`} />}{run.status}</span></td>
                    <td className="p-3 text-gray-500"><div>{run.stage || '—'}</div>{run.lastAgentDecision && <div className="mt-1 max-w-72 rounded-md bg-cyan-50 dark:bg-cyan-950/20 px-2 py-1 text-[11px] text-cyan-800 dark:text-cyan-300"><strong>Browser agent:</strong> {run.lastAgentDecision.action} · {run.lastAgentDecision.reason || 'đang quyết định'}<div className="mt-0.5 font-mono text-[10px] opacity-70">{run.lastAgentDecision.tool} · step {run.lastAgentDecision.step} · {run.lastAgentDecision.model}</div></div>}</td><td className="p-3">{run.coverage?.listings ?? 0}</td><td className="p-3">{run.coverage?.reviews ?? 0}</td><td className="p-3 text-gray-500 whitespace-nowrap">{formatDate(run.startedAt || run.createdAt)}</td>
                    <td className="p-3">
                      <div className="flex flex-col gap-1.5">
                        <button type="button" disabled={!['collected', 'partial'].includes(run.status) || run.stage === 'analysis-queued' || analyzingRunId === run.id || (run.analysis?.status === 'running' && Date.now() - Date.parse(run.analysis.startedAt || '') < 15 * 60_000)} onClick={() => handleAnalyze(run)} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:bg-gray-400 text-white text-xs font-semibold whitespace-nowrap">{run.stage === 'analysis-queued' ? 'Đang chờ phân tích nền' : analyzingRunId === run.id || run.analysis?.status === 'running' ? run.analysis?.progress ? `AI ${run.analysis.progress.current}/${run.analysis.progress.total}` : 'Đang phân tích tự động' : run.analysis?.status === 'completed' ? 'Phân tích lại' : 'Phân tích thủ công'}</button>
                        <button type="button" disabled={run.analysis?.status !== 'completed'} onClick={() => { setExpandedRunId(null); setExpandedLogRunId(null); setExpandedReportRunId(run.id); }} className="px-3 py-1.5 rounded-lg border border-violet-300 text-violet-700 dark:text-violet-300 disabled:opacity-40 text-xs font-semibold whitespace-nowrap">Mở workbook</button>
                        <button type="button" disabled={!['collected', 'partial'].includes(run.status) || loadingRawRunId === run.id} onClick={() => handleToggleData(run)} className="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 disabled:opacity-40 text-xs font-semibold whitespace-nowrap">{loadingRawRunId === run.id ? 'Đang tải...' : 'Mở dữ liệu crawl'}</button>
                        <button type="button" disabled={loadingLogRunId === run.id} onClick={() => handleToggleLogs(run)} className="px-3 py-1.5 rounded-lg border border-cyan-300 text-cyan-700 dark:text-cyan-300 disabled:opacity-40 text-xs font-semibold whitespace-nowrap">{loadingLogRunId === run.id ? 'Đang tải log...' : 'Mở agent logs'}</button>
                        <button type="button" disabled={deletingRunId === run.id || run.status === 'running'} onClick={() => handleDeleteRun(run)} className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 disabled:opacity-40 text-xs font-semibold whitespace-nowrap">{deletingRunId === run.id ? 'Đang xóa...' : 'Xóa run'}</button>
                      </div>
                    </td>
                  </tr>
                  {run.id !== latestLiveRun?.id && aiStreamByRun[run.id] && <tr><td colSpan={7} className="px-3 pb-3"><div className="rounded-lg border border-cyan-200 dark:border-cyan-900 bg-slate-950 text-slate-100 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 text-xs"><span className="font-semibold text-cyan-300">AI Live · {aiStreamByRun[run.id].model || (provider === '9router' ? nineRouterModel : provider)}</span><span className="text-slate-400">{aiStreamByRun[run.id].progress ? `${aiStreamByRun[run.id].progress?.stage} ${aiStreamByRun[run.id].progress?.current}/${aiStreamByRun[run.id].progress?.total}${aiStreamByRun[run.id].progress?.listingStart ? ` · listing ${aiStreamByRun[run.id].progress?.listingStart}-${aiStreamByRun[run.id].progress?.listingEnd}/${aiStreamByRun[run.id].progress?.listingTotal}` : ''}` : aiStreamByRun[run.id].stage}</span></div>{aiStreamByRun[run.id].text ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 font-mono">{aiStreamByRun[run.id].text}</pre> : <div className="p-3 text-xs text-slate-400">Đang chờ token đầu tiên từ 9Router...</div>}{aiStreamByRun[run.id].error && <div className="px-3 pb-3 text-xs text-red-400">{aiStreamByRun[run.id].error}</div>}</div></td></tr>}
                  {run.id !== latestLiveRun?.id && !aiStreamByRun[run.id] && run.aiLive && <tr><td colSpan={7} className="px-3 pb-3"><div className="rounded-lg border border-cyan-200 dark:border-cyan-900 bg-slate-950 text-slate-100 overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-800 text-xs"><span className="font-semibold text-cyan-300">AI Live · {run.aiLive.model || run.analysis?.model || provider}</span><span className="text-slate-400">{run.aiLive.progress ? `${run.aiLive.progress.stage} ${run.aiLive.progress.current}/${run.aiLive.progress.total}${run.aiLive.progress.listingStart ? ` · listing ${run.aiLive.progress.listingStart}-${run.aiLive.progress.listingEnd}/${run.aiLive.progress.listingTotal}` : ''}` : run.aiLive.status}</span></div>{run.aiLive.text ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs leading-5 font-mono">{run.aiLive.text}</pre> : <div className="p-3 text-xs text-slate-400">Đang kết nối AI và chờ nội dung đầu tiên...</div>}{run.aiLive.error && <div className="px-3 pb-3 text-xs text-red-400">{run.aiLive.error}</div>}</div></td></tr>}
                  {run.analysis?.result?.summary && <tr><td colSpan={7} className="px-3 pb-4 text-sm text-gray-600 dark:text-gray-300"><strong>AI:</strong> {run.analysis.result.summary}</td></tr>}
                  {run.agentPlan?.summary && <tr><td colSpan={7} className="px-3 pb-4 text-xs text-blue-700 dark:text-blue-300"><strong>Agent plan:</strong> {run.agentPlan.summary} · {run.agentPlan.executionMode === 'browser-agent' ? 'Tự thao tác read-only' : 'Collector fallback'} · {run.agentPlan.tools.join(' → ')}</td></tr>}
                  {run.warnings && run.warnings.length > 0 && <tr><td colSpan={7} className="px-3 pb-4 text-xs text-amber-700 dark:text-amber-300">Thiếu dữ liệu: {run.warnings.join(' · ')}</td></tr>}
                  {run.analysis?.status === 'failed' && <tr><td colSpan={7} className="px-3 pb-4 text-sm text-red-600">AI lỗi: {run.analysis.error}</td></tr>}
                </React.Fragment>
              ))}
              {visibleRuns.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-gray-500">Shop này chưa có evaluation run.</td></tr>}
            </tbody>
          </table>
        </div>
        {viewerRun && <div className="mt-4 overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50 px-3 pt-3">
            <div className="pb-2"><div className="font-semibold text-gray-900 dark:text-white">{viewerRun.shopLabel}</div><div className="text-xs text-gray-500">Run {viewerRun.id} · {formatDate(viewerRun.startedAt || viewerRun.createdAt)}</div></div>
            <div className="flex items-end gap-1 self-end overflow-x-auto">
              <button type="button" disabled={viewerRun.analysis?.status !== 'completed'} onClick={() => { setExpandedRunId(null); setExpandedLogRunId(null); setExpandedReportRunId(viewerRun.id); }} className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold disabled:opacity-40 ${viewerMode === 'report' ? 'border-violet-600 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300' : 'border-transparent text-gray-500 hover:text-violet-600'}`}>Báo cáo AI</button>
              <button type="button" disabled={!['collected', 'partial'].includes(viewerRun.status)} onClick={() => { if (viewerMode !== 'raw') void handleToggleData(viewerRun); }} className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold disabled:opacity-40 ${viewerMode === 'raw' ? 'border-blue-600 bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300' : 'border-transparent text-gray-500 hover:text-blue-600'}`}>Dữ liệu crawl</button>
              <button type="button" onClick={() => { if (viewerMode !== 'logs') void handleToggleLogs(viewerRun); }} className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-semibold ${viewerMode === 'logs' ? 'border-cyan-600 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300' : 'border-transparent text-gray-500 hover:text-cyan-600'}`}>Agent logs</button>
              <button type="button" onClick={() => { setExpandedReportRunId(null); setExpandedRunId(null); setExpandedLogRunId(null); }} className="mb-1 ml-2 rounded-md border border-gray-300 dark:border-gray-600 px-2 py-1 text-xs text-gray-500">Đóng</button>
            </div>
          </div>
          <div className="p-3">
            {viewerMode === 'report' && <><div className="mb-3 flex items-center justify-between gap-3"><div className="text-xs text-gray-500">{viewerRun.analysis?.model || provider} · {viewerRun.analysis?.listingAuditCount ?? 0} listing đã đánh giá</div><button type="button" onClick={() => handleDownloadReport(viewerRun)} className="rounded-md border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 text-xs font-semibold">Tải JSON</button></div><AnalysisReportTables result={viewerRun.analysis?.result} /></>}
            {viewerMode === 'raw' && (loadingRawRunId === viewerRun.id ? <div className="py-10 text-center text-gray-500">Đang tải toàn bộ dữ liệu agent...</div> : rawDataByRun[viewerRun.id] ? <RawDataSheets data={rawDataByRun[viewerRun.id]} listingPage={listingPageByRun[viewerRun.id] || 1} onListingPageChange={page => setListingPageByRun(current => ({ ...current, [viewerRun.id]: page }))} onDownload={() => handleDownloadRawData(viewerRun)} /> : <div className="py-10 text-center text-gray-500">Run chưa có dữ liệu.</div>)}
            {viewerMode === 'logs' && <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"><div className="flex flex-wrap justify-between items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs"><span><strong>{logsByRun[viewerRun.id]?.length || 0}</strong> log đã tải · mới nhất ở trên · tự cập nhật realtime</span><button type="button" onClick={() => handleDownloadLogs(viewerRun)} className="px-2 py-1 rounded border border-gray-300 dark:border-gray-600">Tải JSON đã tải</button></div><div onScroll={event => { const element = event.currentTarget; if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) void handleLoadMoreLogs(viewerRun); }} className="max-h-[38rem] overflow-auto divide-y divide-gray-100 dark:divide-gray-800">{(logsByRun[viewerRun.id] || []).map(log => <EvaluationLogCard key={log.id} log={log} />)}{loadingLogRunId === viewerRun.id && <div className="p-5 text-center text-gray-500 text-xs">Đang kết nối snapshot log...</div>}{loadingMoreLogRunId === viewerRun.id && <div className="p-3 text-center text-gray-500 text-xs">Đang tải thêm 20 log cũ...</div>}{hasMoreLogsByRun[viewerRun.id] === true && loadingMoreLogRunId !== viewerRun.id && <div className="p-3 text-center"><button type="button" onClick={() => void handleLoadMoreLogs(viewerRun)} className="rounded-md border border-gray-300 dark:border-gray-600 px-3 py-1.5 text-xs font-semibold">Tải thêm 20 log cũ</button></div>}{hasMoreLogsByRun[viewerRun.id] === false && (logsByRun[viewerRun.id]?.length || 0) > 0 && <div className="p-3 text-center text-gray-400 text-xs">Đã hết log.</div>}{(logsByRun[viewerRun.id]?.length || 0) === 0 && loadingLogRunId !== viewerRun.id && <div className="p-6 text-center text-gray-500 text-xs">Run này chưa có diagnostic log.</div>}</div></div>}
          </div>
        </div>}
      </section>
    </div>
  );
};

export default ShopEvaluationTab;
