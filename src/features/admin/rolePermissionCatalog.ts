import { getDashboardPermissionsForRole } from '../../utils/permissionHelper';
import type { AppId, SharedRole } from './authenticationTypes';

export interface RolePermissionDefinition {
  key: string;
  label: string;
  description: string;
  group: string;
  contextual?: boolean;
}

const dashboardPermissions: RolePermissionDefinition[] = [
  { key: 'viewOverviewTab', label: 'Overview', description: 'Mở trang tổng quan vận hành.', group: 'Điều hướng' },
  { key: 'viewOrderListTab', label: 'Order List', description: 'Xem danh sách đơn hàng.', group: 'Điều hướng' },
  { key: 'viewProductsTab', label: 'Products', description: 'Xem dữ liệu sản phẩm.', group: 'Điều hướng' },
  { key: 'viewSupportTab', label: 'Support', description: 'Xem dữ liệu hỗ trợ khách hàng.', group: 'Điều hướng' },
  { key: 'viewFulfillTab', label: 'Fulfill', description: 'Xem dữ liệu fulfillment.', group: 'Điều hướng' },
  { key: 'viewReviewsTab', label: 'Reviews', description: 'Xem review của shop.', group: 'Điều hướng' },
  { key: 'viewDesignTab', label: 'Design', description: 'Mở tab quản lý thiết kế.', group: 'Điều hướng' },
  { key: 'viewTemplatesTab', label: 'Templates', description: 'Mở tab quản lý template.', group: 'Điều hướng' },
  { key: 'viewShopEvaluationTab', label: 'Shop Evaluation', description: 'Mở công cụ đánh giá shop bằng browser agent.', group: 'Điều hướng' },
  { key: 'viewWorkloadTab', label: 'Workload', description: 'Mở workload nhúng trong Dashboard.', group: 'Điều hướng' },
  { key: 'viewKpiOrders', label: 'KPI Orders', description: 'Xem chỉ số số lượng đơn.', group: 'Dữ liệu tài chính' },
  { key: 'viewKpiShops', label: 'KPI Shops', description: 'Xem chỉ số shop.', group: 'Dữ liệu tài chính' },
  { key: 'viewKpiRevenue', label: 'KPI Revenue', description: 'Xem doanh thu.', group: 'Dữ liệu tài chính' },
  { key: 'viewKpiFunds', label: 'KPI Funds', description: 'Xem funds.', group: 'Dữ liệu tài chính' },
  { key: 'viewKpiCost', label: 'KPI Cost', description: 'Xem chi phí.', group: 'Dữ liệu tài chính' },
  { key: 'viewKpiEarn', label: 'KPI Earn', description: 'Xem lợi nhuận.', group: 'Dữ liệu tài chính' },
  { key: 'viewCompanyPerformance', label: 'Performance Company', description: 'Xem tổng quan hiệu suất công ty.', group: 'KPI & Performance' },
  { key: 'viewDesignerIdeaPerformance', label: 'Performance Designer Idea', description: 'Xem hiệu suất Designer Idea.', group: 'KPI & Performance' },
  { key: 'viewDesignerFulfillmentPerformance', label: 'Performance Designer Fulfillment', description: 'Xem hiệu suất Designer Fulfillment.', group: 'KPI & Performance' },
  { key: 'viewResearchDevelopmentPerformance', label: 'Performance R&D', description: 'Xem hiệu suất Research & Development.', group: 'KPI & Performance' },
  { key: 'viewScalePerformance', label: 'Performance Scale', description: 'Xem hiệu suất Scale.', group: 'KPI & Performance' },
  { key: 'viewCustomerServicePerformance', label: 'Performance CS', description: 'Xem hiệu suất Customer Service.', group: 'KPI & Performance' },
  { key: 'viewFulfillmentPerformance', label: 'Performance Fulfillment', description: 'Xem hiệu suất Fulfillment.', group: 'KPI & Performance' },
  { key: 'viewKpiConfiguration', label: 'KPI Configuration', description: 'Mở trang cấu hình KPI.', group: 'KPI & Performance' },
  { key: 'viewOwnPerformanceData', label: 'Xem KPI cá nhân', description: 'Xem dữ liệu hiệu suất của chính mình.', group: 'KPI & Performance' },
  { key: 'viewTeamPerformanceData', label: 'Xem KPI team', description: 'Xem dữ liệu hiệu suất của team theo role.', group: 'KPI & Performance' },
  { key: 'viewAllPerformanceData', label: 'Xem toàn bộ KPI', description: 'Xem dữ liệu hiệu suất toàn bộ nhân sự.', group: 'KPI & Performance' },
  { key: 'viewMerchizeData', label: 'Dữ liệu Merchize', description: 'Xem thông tin và biểu đồ từ Merchize.', group: 'Dữ liệu nhà cung cấp' },
  { key: 'viewPrintwayData', label: 'Dữ liệu Printway', description: 'Xem thông tin và biểu đồ từ Printway.', group: 'Dữ liệu nhà cung cấp' },
  { key: 'viewEbayData', label: 'Dữ liệu eBay', description: 'Xem dữ liệu bán hàng từ eBay.', group: 'Dữ liệu nhà cung cấp' },
  { key: 'viewEtsyData', label: 'Dữ liệu Etsy', description: 'Xem dữ liệu bán hàng từ Etsy.', group: 'Dữ liệu nhà cung cấp' },
  { key: 'canEditCost', label: 'Sửa chi phí', description: 'Thêm hoặc sửa chi phí thủ công.', group: 'Thao tác quản trị' },
  { key: 'canExportData', label: 'Xuất dữ liệu', description: 'Xuất Excel hoặc CSV.', group: 'Thao tác quản trị' },
  { key: 'canManageUsers', label: 'Quản lý nhân sự', description: 'Quản lý tài khoản và hồ sơ nhân sự.', group: 'Thao tác quản trị' },
  { key: 'canManageMailSettings', label: 'Quản lý email', description: 'Quản lý kết nối email và đồng bộ.', group: 'Thao tác quản trị' },
  { key: 'canManageSettings', label: 'Cấu hình Dashboard', description: 'Quản lý cấu hình chung của Dashboard.', group: 'Thao tác quản trị' },
  { key: 'canManageMappings', label: 'Quản lý mapping', description: 'Quản lý mapping sản phẩm và danh mục.', group: 'Thao tác quản trị' },
  { key: 'canResyncOrder', label: 'Đồng bộ lại đơn', description: 'Chạy đồng bộ lại từng đơn.', group: 'Thao tác quản trị' },
  { key: 'canSyncData', label: 'Đồng bộ dữ liệu', description: 'Chạy đồng bộ dữ liệu thủ công.', group: 'Thao tác quản trị' },
  { key: 'canManageTemplatePoints', label: 'Quản lý điểm template', description: 'Cấu hình điểm template cho KPI Designer.', group: 'Thao tác quản trị' },
  { key: 'canProposeKpi', label: 'Đề xuất KPI', description: 'Đề xuất KPI cho nhân sự/phòng ban.', group: 'Thao tác quản trị' },
  { key: 'canApproveKpi', label: 'Duyệt KPI', description: 'Duyệt và áp KPI chính thức.', group: 'Thao tác quản trị' },
];

const workloadPermissions: RolePermissionDefinition[] = [
  { key: 'canAccessFulfillBoard', label: 'Truy cập Fulfill Board', description: 'Mở bảng công việc Fulfill.', group: 'Truy cập board' },
  { key: 'canAccessIdeaBoard', label: 'Truy cập Idea Board', description: 'Mở bảng công việc Idea.', group: 'Truy cập board' },
  { key: 'canViewAllFulfillTasks', label: 'Xem tất cả task Fulfill', description: 'Không giới hạn ở task của chính mình.', group: 'Phạm vi dữ liệu' },
  { key: 'canViewAllIdeaTasks', label: 'Xem tất cả task Idea', description: 'Không giới hạn ở task của chính mình.', group: 'Phạm vi dữ liệu' },
  { key: 'canViewDesignerWorkload', label: 'Xem workload Designer', description: 'Xem số lượng task và tải công việc của Designer.', group: 'Phạm vi dữ liệu' },
  { key: 'canViewPinkTasks', label: 'Xem task Outsource', description: 'Xem và lọc task Pink/Outsource.', group: 'Phạm vi dữ liệu' },
  { key: 'canCreateFulfillTask', label: 'Tạo task Fulfill', description: 'Tạo mới task trên Fulfill Board.', group: 'Fulfill' },
  { key: 'canAssignFulfillTask', label: 'Assign task Fulfill', description: 'Phân công task Fulfill cho Designer.', group: 'Fulfill' },
  { key: 'canDeleteFulfillTask', label: 'Xóa task Fulfill', description: 'Xóa task khỏi Fulfill Board.', group: 'Fulfill' },
  { key: 'canCreateIdeaTask', label: 'Tạo task Idea', description: 'Tạo mới task trên Idea Board.', group: 'Idea' },
  { key: 'canAssignIdeaTask', label: 'Assign task Idea', description: 'Phân công task Idea cho Designer.', group: 'Idea' },
  { key: 'canDeleteIdeaTask', label: 'Xóa task Idea', description: 'Xóa task khỏi Idea Board.', group: 'Idea' },
  { key: 'canReviewIdeaTask', label: 'Review task Idea', description: 'Duyệt task Idea ở trạng thái review.', group: 'Idea' },
  { key: 'canUploadDesign', label: 'Upload thiết kế', description: 'Tải file thiết kế lên task.', group: 'Designer' },
  { key: 'canOverrideDesigner', label: 'Ghi đè Designer', description: 'Thay file hoặc thao tác thay Designer khác.', group: 'Designer' },
  { key: 'canOverrideTaskStatus', label: 'Ghi đè trạng thái', description: 'Duyệt, từ chối hoặc đổi trạng thái đặc biệt.', group: 'Designer' },
  { key: 'canEditTaskInformation', label: 'Sửa thông tin task', description: 'Cho phép sửa thông tin task; fallback code còn phụ thuộc trạng thái task.', group: 'Nội dung task', contextual: true },
  { key: 'canEditReviewedTaskContent', label: 'Sửa nội dung đã review', description: 'Cho phép sửa nội dung task ở luồng review/done.', group: 'Nội dung task', contextual: true },
  { key: 'canChangeTaskTemplate', label: 'Đổi template task', description: 'Cho phép thay template đang gắn với task; một số luồng draft có ngoại lệ theo ngữ cảnh.', group: 'Nội dung task', contextual: true },
  { key: 'canChangeGiftCardTemplate', label: 'Đổi Gift Card template', description: 'Cho phép thay Gift Card template; fallback code còn phụ thuộc trạng thái task.', group: 'Nội dung task', contextual: true },
  { key: 'canMapFulfillmentSku', label: 'Map SKU Fulfillment', description: 'Cho phép tạo mapping cho SKU Fulfillment chưa nhận diện.', group: 'SKU & Mapping' },
  { key: 'canFixFulfillmentMapping', label: 'Sửa mapping Fulfillment', description: 'Cho phép sửa mapping SKU Fulfillment hiện có.', group: 'SKU & Mapping' },
  { key: 'canManageArtworkLibrary', label: 'Quản lý Artwork Library', description: 'Thêm, sửa và xóa file nguồn.', group: 'Quản trị' },
  { key: 'canManageSystemConfig', label: 'Cấu hình hệ thống', description: 'Quản lý kênh, cửa hàng và cấu hình chung.', group: 'Quản trị' },
  { key: 'canManageUsers', label: 'Quản lý Users', description: 'Mở và quản lý danh sách nhân sự.', group: 'Quản trị' },
  { key: 'canManageTemplates', label: 'Quản lý Templates', description: 'Quản lý template thiết kế.', group: 'Quản trị' },
  { key: 'canManageProductTemplateMapping', label: 'Product Template Mapping', description: 'Quản lý mapping product-template.', group: 'Quản trị' },
  { key: 'canAccessAnalyst', label: 'Truy cập Analyst', description: 'Mở trang phân tích thống kê.', group: 'Quản trị' },
  { key: 'canAccessMapping', label: 'Truy cập SKU Mapping', description: 'Mở và thao tác trang mapping SKU.', group: 'Quản trị' },
];

export const ROLE_PERMISSION_CATALOGS: Record<AppId, RolePermissionDefinition[]> = {
  dashboard: dashboardPermissions,
  workload: workloadPermissions,
};

const getWorkloadDefaults = (role: SharedRole): Record<string, boolean> => {
  const management = role === 'ADMIN' || role === 'MANAGER';
  const csMember = role === 'CS_SUPPORT' || role === 'CS_FULFILL';
  const csLead = role === 'LEADCS_SUPPORT' || role === 'LEADCS_FULFILL';
  const dsMember = role === 'DS_FULFILL' || role === 'DS_IDEA';
  const dsLead = role === 'LEADDS_FULFILL' || role === 'LEADDS_IDEA';
  const ideaMember = role === 'IDEA_RD' || role === 'IDEA_SCALE';
  const ideaLead = role === 'LEADIDEA_RD' || role === 'LEADIDEA_SCALE';
  const csTeam = csMember || csLead;
  const dsTeam = dsMember || dsLead;
  const ideaTeam = ideaMember || ideaLead;
  const leader = csLead || dsLead || ideaLead;

  return {
    canAccessFulfillBoard: management || csTeam || dsTeam,
    canAccessIdeaBoard: management || ideaTeam || dsTeam,
    canViewAllFulfillTasks: management || csTeam || dsLead,
    canViewAllIdeaTasks: management || ideaLead || dsLead,
    canViewDesignerWorkload: management || dsLead,
    canViewPinkTasks: management || csTeam || ideaTeam,
    canCreateFulfillTask: management || csTeam,
    canAssignFulfillTask: management || dsLead,
    canDeleteFulfillTask: management || csTeam,
    canCreateIdeaTask: management || ideaTeam,
    canAssignIdeaTask: management || dsLead,
    canDeleteIdeaTask: management || ideaTeam,
    canReviewIdeaTask: management || ideaLead,
    canUploadDesign: management || dsTeam,
    canOverrideDesigner: management || dsLead,
    canOverrideTaskStatus: management || csLead,
    canEditTaskInformation: management,
    canEditReviewedTaskContent: false,
    canChangeTaskTemplate: !csMember,
    canChangeGiftCardTemplate: management,
    canMapFulfillmentSku: role !== 'CS_SUPPORT',
    canFixFulfillmentMapping: !csMember,
    canManageArtworkLibrary: management || csTeam || dsTeam || ideaTeam,
    canManageSystemConfig: management || leader,
    canManageUsers: management || leader,
    canManageTemplates: management || leader,
    canManageProductTemplateMapping: management || csLead,
    canAccessAnalyst: management || leader,
    canAccessMapping: management || csLead || role === 'CS_FULFILL',
  };
};

export const getDefaultRolePermissions = (role: SharedRole, appId: AppId): Record<string, boolean> => {
  const defaults = appId === 'dashboard'
    ? getDashboardPermissionsForRole(role)
    : getWorkloadDefaults(role);

  return Object.fromEntries(
    ROLE_PERMISSION_CATALOGS[appId].map(permission => [permission.key, defaults[permission.key] === true]),
  );
};

export const mergeRolePermissions = (
  role: SharedRole,
  appId: AppId,
  permissions?: Record<string, boolean> | null,
) => ({
  ...getDefaultRolePermissions(role, appId),
  ...(permissions || {}),
});
