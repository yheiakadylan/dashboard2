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
  // Only expose permissions enforced by currently mounted Dashboard flows.
  { key: 'viewOverviewTab', label: 'Overview', description: 'Mở trang tổng quan vận hành.', group: 'Trang Dashboard' },
  { key: 'viewOrderListTab', label: 'Order List', description: 'Xem danh sách đơn hàng.', group: 'Trang Dashboard' },
  { key: 'viewProductsTab', label: 'Products', description: 'Xem dữ liệu sản phẩm.', group: 'Trang Dashboard' },
  { key: 'viewSupportTab', label: 'Support', description: 'Xem dữ liệu hỗ trợ khách hàng.', group: 'Trang Dashboard' },
  { key: 'viewFulfillTab', label: 'Fulfill', description: 'Xem dữ liệu fulfillment.', group: 'Trang Dashboard' },
  { key: 'viewReviewsTab', label: 'Reviews', description: 'Xem review của shop.', group: 'Trang Dashboard' },
  { key: 'viewDesignTab', label: 'Design', description: 'Mở tab quản lý thiết kế.', group: 'Trang Dashboard' },
  { key: 'viewTemplatesTab', label: 'Templates', description: 'Mở tab quản lý template.', group: 'Trang Dashboard' },
  { key: 'viewShopEvaluationTab', label: 'Shop Evaluation', description: 'Mở công cụ đánh giá shop.', group: 'Trang Dashboard' },
  { key: 'viewWorkloadTab', label: 'Workload', description: 'Mở Workload trong Dashboard.', group: 'Trang Dashboard' },
  { key: 'viewKpiOrders', label: 'Số đơn', description: 'Xem chỉ số số lượng đơn.', group: 'Số liệu tổng quan' },
  { key: 'viewKpiShops', label: 'Số shop', description: 'Xem chỉ số shop.', group: 'Số liệu tổng quan' },
  { key: 'viewKpiRevenue', label: 'Doanh thu', description: 'Xem doanh thu.', group: 'Số liệu tổng quan' },
  { key: 'viewKpiFunds', label: 'Funds', description: 'Xem funds.', group: 'Số liệu tổng quan' },
  { key: 'viewKpiCost', label: 'Chi phí', description: 'Xem chi phí.', group: 'Số liệu tổng quan' },
  { key: 'viewKpiEarn', label: 'Lợi nhuận', description: 'Xem lợi nhuận.', group: 'Số liệu tổng quan' },
  { key: 'canEditCost', label: 'Sửa chi phí', description: 'Thêm hoặc sửa chi phí thủ công.', group: 'Cài đặt & thao tác' },
  { key: 'canExportData', label: 'Xuất dữ liệu', description: 'Xuất Excel hoặc CSV.', group: 'Cài đặt & thao tác' },
  { key: 'canManageMailSettings', label: 'Quản lý email', description: 'Quản lý kết nối email và đồng bộ.', group: 'Cài đặt & thao tác' },
  { key: 'canManageSettings', label: 'Cấu hình Dashboard', description: 'Quản lý team, API và cấu hình chung.', group: 'Cài đặt & thao tác' },
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
