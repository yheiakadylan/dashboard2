import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Check, ChevronDown, Clock3, FileSliders, Pencil, Plus, ShieldCheck, SlidersHorizontal, Users, X } from 'lucide-react';
import { useDashboardAccess } from '../../../contexts/DashboardContext';
import { useNotification } from '../../../contexts/NotificationContext';
import { fetchOperationUsers, type OperationUser } from '../../../services/reportService';
import { hasPermission } from '../../../utils/permissionHelper';
import BusinessCalendarBoard from '../components/BusinessCalendarBoard';
import KpiBaselineBoard from '../components/KpiBaselineBoard';
import KpiMeasurementPreview, { type KpiCohortPreview } from '../components/KpiMeasurementPreview';
import MetricHelpTooltip from '../components/MetricHelpTooltip';
import PerformancePageSkeleton from '../components/PerformancePageSkeleton';
import TemplatePointBoard from '../components/TemplatePointBoard';
import { usePerformanceData } from '../hooks/usePerformanceData';
import { getKpiPeriodWindow, getNextKpiPeriodStart } from '../kpiProgress';
import { CONFIGURABLE_KPI_SECTIONS } from '../kpiTargets';
import { createKpiProposal, fetchKpiTargetHistory, reviewKpiProposal } from '../services/kpiTargetService';
import type { KpiTarget, KpiTargetPeriod, PerformanceSectionId } from '../types';

type KpiConfigSection = Exclude<PerformanceSectionId, 'company-overview' | 'kpi-assignment'>;
type DesignerConfigSection = Extract<KpiConfigSection, 'designer-idea' | 'designer-fulfillment'>;
type ConfigurationTab = 'targets' | 'calendar' | 'template-points';
type ProposalScope = 'department' | 'employee';
type ActivationMode = Extract<NonNullable<KpiTarget['activationMode']>, 'current_period' | 'next_period'>;

const configurationTabs = [
  { id: 'targets', label: 'KPI Target', icon: FileSliders },
  { id: 'calendar', label: 'Lịch làm việc', icon: CalendarDays },
  { id: 'template-points', label: 'Điểm template', icon: SlidersHorizontal },
] as const;

const sectionLabels: Record<KpiConfigSection, string> = {
  'designer-fulfillment': 'Designer Fulfillment',
  'designer-idea': 'Designer Idea',
  'research-development': 'Research & Development',
  scale: 'Scale',
  'customer-service': 'Customer Service',
  fulfillment: 'Fulfillment',
};

const periodLabels: Record<KpiTargetPeriod, string> = {
  daily: 'Ngày',
  weekly: 'Tuần',
  monthly: 'Tháng',
  quarterly: 'Quý',
};

const today = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const formatVietnameseDate = (dateValue?: string) => {
  const match = dateValue?.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : dateValue || '—';
};

const formatPeriodLabel = (period: KpiTargetPeriod, dateValue: string) => {
  const window = getKpiPeriodWindow(period, dateValue);
  if (period === 'daily') return `Ngày ${formatVietnameseDate(window.from)}`;
  if (period === 'weekly') return `Tuần ${formatVietnameseDate(window.from)} – ${formatVietnameseDate(window.to)}`;
  if (period === 'monthly') return `Tháng ${window.from.slice(5, 7)}/${window.from.slice(0, 4)}`;
  const date = new Date(`${window.from}T00:00:00Z`);
  return `Quý ${Math.floor(date.getUTCMonth() / 3) + 1}/${date.getUTCFullYear()}`;
};

const getUserLabel = (operationUser: OperationUser) => operationUser.displayName || operationUser.empID || operationUser.email || operationUser.uid;
const isApproved = (target: KpiTarget) => target.active !== false && (target.status === 'approved' || !target.status);
const isCurrentlyEffective = (target: KpiTarget) => isApproved(target)
  && target.effectiveFrom <= today()
  && (!target.effectiveTo || target.effectiveTo >= today());

const getActualDescription = (section: KpiConfigSection) => {
  if (section === 'designer-idea' || section === 'designer-fulfillment') {
    return 'Tổng điểm độ khó template của file đã hoàn thành, gồm board chính và support';
  }
  if (section === 'research-development' || section === 'scale') {
    return 'Số Active Listing có create_date trong kỳ và empID trong SKU map đúng nhân sự';
  }
  if (section === 'customer-service') {
    return 'Số order duy nhất được CS chuyển từ Draft sang New trong kỳ theo submitted_to_new_at';
  }
  return 'Số order duy nhất đã Fulfill; ưu tiên người thực hiện trong fulfilled_by';
};

const StatusBadge = ({ target }: { target: KpiTarget }) => {
  const status = target.status || (target.active !== false ? 'approved' : 'rejected');
  const styles = status === 'approved'
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
    : status === 'pending'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300';
  return <span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${styles}`}>{status === 'approved' ? 'Đã duyệt' : status === 'pending' ? 'Chờ duyệt' : 'Từ chối'}</span>;
};

export default function KpiAssignmentPage() {
  const { teamId, user, role: dashboardRole, sharedRole, permissions, boards, selectedBoardId, filterDateRange } = useDashboardAccess();
  const { addNotification } = useNotification();
  const [activeConfigTab, setActiveConfigTab] = useState<ConfigurationTab>('targets');
  const [selectedSection, setSelectedSection] = useState<KpiConfigSection>('designer-fulfillment');
  const [templatePointSection, setTemplatePointSection] = useState<DesignerConfigSection>('designer-fulfillment');
  const [targets, setTargets] = useState<KpiTarget[]>([]);
  const [operationUsers, setOperationUsers] = useState<OperationUser[]>([]);
  const [scope, setScope] = useState<ProposalScope>('department');
  const [employeeId, setEmployeeId] = useState('');
  const [targetValue, setTargetValue] = useState('100');
  const [period, setPeriod] = useState<KpiTargetPeriod>('quarterly');
  const [activationMode, setActivationMode] = useState<ActivationMode>('current_period');
  const initialPeriodWindow = getKpiPeriodWindow('quarterly', today());
  const [effectiveFrom, setEffectiveFrom] = useState(initialPeriodWindow.from);
  const [effectiveTo, setEffectiveTo] = useState(initialPeriodWindow.to);
  const [reason, setReason] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [rejectingTarget, setRejectingTarget] = useState<KpiTarget | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const performanceDataSection = activeConfigTab === 'template-points' ? templatePointSection : selectedSection;
  const {
    employees: performanceEmployees,
    baselineSeries = [],
    templates,
    designerPointDataQuality,
    baselineDataSource,
    baselineUpdatedAt,
    baselineRefreshStatus,
    baselineRefreshError,
    baselineRange,
    isBaselineLoading,
    accessLevel: performanceAccessLevel,
    isLoading: isPerformanceLoading,
    error: performanceError,
  } = usePerformanceData(performanceDataSection, {
    configurationMode: activeConfigTab === 'targets',
    templatePointMode: activeConfigTab === 'template-points',
    enabled: activeConfigTab !== 'calendar',
  });

  const viewer = useMemo(() => {
    const email = String(user.email || '').trim().toLowerCase();
    return operationUsers.find(operationUser => operationUser.uid === user.uid)
      || operationUsers.find(operationUser => String(operationUser.email || '').trim().toLowerCase() === email);
  }, [operationUsers, user.email, user.uid]);
  const businessRole = String(sharedRole || viewer?.role || '').toUpperCase();
  const canManageAllDepartments = dashboardRole === 'owner'
    || hasPermission(dashboardRole, permissions, 'canManageSettings');
  const canManageTemplatePoints = canManageAllDepartments
    || hasPermission(dashboardRole, permissions, 'canManageTemplatePoints');
  const canApprove = dashboardRole === 'owner'
    || hasPermission(dashboardRole, permissions, 'canApproveKpi');
  const canPropose = canApprove
    || hasPermission(dashboardRole, permissions, 'canProposeKpi');

  const accessibleMetrics = useMemo(() => (
    canApprove
      ? CONFIGURABLE_KPI_SECTIONS
      : CONFIGURABLE_KPI_SECTIONS.filter(item => item.roles.includes(businessRole))
  ), [businessRole, canApprove]);
  const accessibleDesignerSections = useMemo(() => accessibleMetrics
    .map(item => item.sectionId)
    .filter((sectionId): sectionId is DesignerConfigSection => sectionId === 'designer-idea' || sectionId === 'designer-fulfillment'), [accessibleMetrics]);
  const canViewTemplatePoints = accessibleDesignerSections.length > 0;
  const visibleConfigurationTabs = configurationTabs.filter(tab => tab.id !== 'template-points' || canViewTemplatePoints);
  const metric = accessibleMetrics.find(item => item.sectionId === selectedSection) || accessibleMetrics[0] || CONFIGURABLE_KPI_SECTIONS[0];
  const hasSectionAccess = accessibleMetrics.some(item => item.code === metric.code);
  const isListingSection = selectedSection === 'research-development' || selectedSection === 'scale';
  const hasApprovedListingFormula = !isListingSection;
  const canProposeSection = canPropose && hasSectionAccess && hasApprovedListingFormula;
  const canApproveSection = canApprove && hasSectionAccess && hasApprovedListingFormula;
  const periodOptions = useMemo<KpiTargetPeriod[]>(
    () => isListingSection ? ['monthly', 'quarterly'] : ['daily', 'weekly', 'monthly', 'quarterly'],
    [isListingSection],
  );
  const selectedTargets = useMemo(() => targets.filter(target => target.metricCode === metric.code), [metric.code, targets]);
  const selectedPODMemberIds = useMemo(() => {
    if (!selectedBoardId) return null;
    const selectedPODTeam = boards.find(board => board.uid === selectedBoardId);
    return new Set(selectedPODTeam?.memberIds || []);
  }, [boards, selectedBoardId]);
  const sectionUsers = useMemo(() => operationUsers
    .filter(operationUser => operationUser.active !== false && operationUser.isActive !== false)
    .filter(operationUser => !selectedPODMemberIds || selectedPODMemberIds.has(operationUser.uid))
    .filter(operationUser => metric.roles.includes(String(operationUser.role || '').toUpperCase()))
    .sort((left, right) => getUserLabel(left).localeCompare(getUserLabel(right))), [metric.roles, operationUsers, selectedPODMemberIds]);
  const performanceEmployeeIds = useMemo(
    () => new Set(performanceEmployees.map(employee => employee.id)),
    [performanceEmployees],
  );
  const visibleUsers = performanceAccessLevel === 'employee'
    ? sectionUsers.filter(operationUser => operationUser.uid === viewer?.uid)
    : sectionUsers.filter(operationUser => performanceEmployeeIds.has(operationUser.uid));
  const scopedSelectedTargets = selectedTargets.filter(target => (
    target.scope !== 'employee'
    || canManageAllDepartments
    || visibleUsers.some(operationUser => operationUser.uid === target.scopeId)
  ));
  const pendingCount = scopedSelectedTargets.filter(target => target.status === 'pending').length;
  const proposalScopeId = scope === 'department' ? selectedSection : employeeId;
  const isPeriodRevision = selectedTargets.some(target => (
    isApproved(target)
    && target.scope === scope
    && target.scopeId === proposalScopeId
    && target.period === period
    && target.effectiveFrom === effectiveFrom
    && target.effectiveTo === effectiveTo
  ));
  const selectedPerformance = performanceEmployees.find(employee => employee.id === (scope === 'employee' ? employeeId : ''));
  const teamActual = performanceEmployees.length
    ? performanceEmployees.reduce((sum, employee) => sum + employee.kpiActual, 0) / performanceEmployees.length
    : null;
  const previewActual = selectedPerformance?.kpiActual ?? teamActual ?? 0;
  const previewTarget = Math.max(1, Number(targetValue) || 100);
  const previewCohort = useMemo<KpiCohortPreview | undefined>(() => {
    if (!isListingSection) return undefined;
    const aggregateRate = (eligibleKey: 'firstSaleD7Eligible' | 'firstSaleD14Eligible' | 'firstSaleD30Eligible', convertedKey: 'firstSaleD7Converted' | 'firstSaleD14Converted' | 'firstSaleD30Converted') => {
      const eligible = performanceEmployees.reduce((sum, employee) => sum + employee[eligibleKey], 0);
      const converted = performanceEmployees.reduce((sum, employee) => sum + employee[convertedKey], 0);
      return eligible > 0 ? converted / eligible * 100 : null;
    };
    if (selectedPerformance) {
      return {
        d7Rate: selectedPerformance.firstSaleD7Rate,
        d14Rate: selectedPerformance.firstSaleD14Rate,
        d30Rate: selectedPerformance.firstSaleD30Rate,
      };
    }
    return {
      d7Rate: aggregateRate('firstSaleD7Eligible', 'firstSaleD7Converted'),
      d14Rate: aggregateRate('firstSaleD14Eligible', 'firstSaleD14Converted'),
      d30Rate: aggregateRate('firstSaleD30Eligible', 'firstSaleD30Converted'),
    };
  }, [isListingSection, performanceEmployees, selectedPerformance]);
  const actualDescription = getActualDescription(metric.sectionId as KpiConfigSection);

  const reload = async () => {
    if (!teamId) return;
    const [nextTargets, nextUsers] = await Promise.all([fetchKpiTargetHistory(teamId, true), fetchOperationUsers()]);
    setTargets(nextTargets);
    setOperationUsers(nextUsers);
  };

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    Promise.all([fetchKpiTargetHistory(teamId), fetchOperationUsers()]).then(([nextTargets, nextUsers]) => {
      if (!cancelled) {
        setTargets(nextTargets);
        setOperationUsers(nextUsers);
      }
    }).catch(error => {
      if (!cancelled) addNotification(error instanceof Error ? error.message : 'Không tải được cấu hình KPI.', 'error');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [addNotification, teamId]);

  useEffect(() => {
    if (!visibleUsers.some(operationUser => operationUser.uid === employeeId)) setEmployeeId(visibleUsers[0]?.uid || '');
  }, [employeeId, visibleUsers]);

  useEffect(() => {
    if (!accessibleMetrics.some(item => item.sectionId === selectedSection) && accessibleMetrics[0]) {
      setSelectedSection(accessibleMetrics[0].sectionId as KpiConfigSection);
    }
  }, [accessibleMetrics, selectedSection]);

  useEffect(() => {
    if (canViewTemplatePoints && !accessibleDesignerSections.includes(templatePointSection)) {
      setTemplatePointSection(accessibleDesignerSections[0]);
    }
    if (!canViewTemplatePoints && activeConfigTab === 'template-points') setActiveConfigTab('targets');
  }, [accessibleDesignerSections, activeConfigTab, canViewTemplatePoints, templatePointSection]);

  useEffect(() => {
    if (!periodOptions.includes(period)) setPeriod(periodOptions[0]);
  }, [period, periodOptions]);

  useEffect(() => {
    const anchor = activationMode === 'current_period' ? today() : getNextKpiPeriodStart(period, today());
    const window = getKpiPeriodWindow(period, anchor);
    setEffectiveFrom(window.from);
    setEffectiveTo(window.to);
  }, [activationMode, period]);

  const startProposal = (target?: KpiTarget, targetEmployeeId?: string, preferredPeriod?: KpiTargetPeriod) => {
    if (!canProposeSection) return;
    setScope(targetEmployeeId || target?.scope === 'employee' ? 'employee' : 'department');
    setEmployeeId(targetEmployeeId || target?.scopeId || visibleUsers[0]?.uid || '');
    setTargetValue(String(target?.targetValue || 100));
    const targetPeriod = target?.period || preferredPeriod || (isListingSection ? 'monthly' : 'quarterly');
    setPeriod(targetPeriod);
    const currentPeriod = getKpiPeriodWindow(targetPeriod, today());
    const nextPeriod = getKpiPeriodWindow(targetPeriod, getNextKpiPeriodStart(targetPeriod, today()));
    const targetIsNextPeriod = target?.effectiveFrom === nextPeriod.from;
    setActivationMode(targetIsNextPeriod ? 'next_period' : 'current_period');
    setEffectiveFrom(targetIsNextPeriod ? nextPeriod.from : currentPeriod.from);
    setEffectiveTo(targetIsNextPeriod ? nextPeriod.to : currentPeriod.to);
    setReason('');
    setShowForm(true);
    window.setTimeout(() => document.getElementById('kpi-proposal-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const submitProposal = async (event: FormEvent) => {
    event.preventDefault();
    const value = Number(targetValue);
    const targetEmployee = visibleUsers.find(operationUser => operationUser.uid === employeeId);
    if (!teamId || !Number.isFinite(value) || value <= 0 || (scope === 'employee' && !targetEmployee)) {
      addNotification('Hãy chọn đúng đối tượng và nhập target lớn hơn 0.', 'error');
      return;
    }
    if (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo) {
      addNotification('Khoảng hiệu lực KPI không hợp lệ.', 'error');
      return;
    }
    if ((scope === 'employee' || isPeriodRevision) && !reason.trim()) {
      addNotification(isPeriodRevision ? 'Thay thế KPI đã duyệt bắt buộc phải có lý do.' : 'KPI tùy chỉnh cá nhân bắt buộc phải có lý do.', 'error');
      return;
    }
    setIsSaving(true);
    try {
      await createKpiProposal(teamId, {
        scope,
        scopeId: scope === 'department' ? selectedSection : targetEmployee!.uid,
        scopeLabel: scope === 'department' ? sectionLabels[selectedSection] : getUserLabel(targetEmployee!),
        metricCode: metric.code,
        metricLabel: metric.label,
        comparison: metric.comparison,
        targetValue: value,
        unit: metric.unit,
        period,
        sectionId: selectedSection,
        departmentId: selectedSection,
        departmentLabel: sectionLabels[selectedSection],
        reason: reason.trim(),
        effectiveFrom,
        effectiveTo,
        activationMode,
        createdBy: user.uid,
        createdByName: viewer ? getUserLabel(viewer) : user.email || user.uid,
        proposerRole: canApproveSection ? 'head' : 'leader',
        updatedBy: user.uid,
      });
      await reload();
      window.dispatchEvent(new Event('kpi-targets-change'));
      addNotification('Đã gửi đề xuất KPI để Head duyệt.', 'success');
      setShowForm(false);
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không tạo được đề xuất KPI.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const approveProposal = async (target: KpiTarget) => {
    if (!canApproveSection || !teamId) return;
    if (target.scope === 'employee' && !visibleUsers.some(operationUser => operationUser.uid === target.scopeId)) {
      addNotification('Bạn không có quyền duyệt KPI của nhân sự ngoài phạm vi phụ trách.', 'error');
      return;
    }
    try {
      await reviewKpiProposal(teamId, target, 'approved', { uid: user.uid, name: viewer ? getUserLabel(viewer) : user.email || user.uid });
      await reload();
      window.dispatchEvent(new Event('kpi-targets-change'));
      addNotification('KPI đã được duyệt và kích hoạt.', 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không duyệt được KPI.', 'error');
    }
  };

  const rejectProposal = async () => {
    if (!canApproveSection || !teamId || !rejectingTarget) return;
    try {
      await reviewKpiProposal(teamId, rejectingTarget, 'rejected', { uid: user.uid, name: viewer ? getUserLabel(viewer) : user.email || user.uid }, rejectionReason);
      await reload();
      addNotification('Đã từ chối đề xuất và gửi lý do cho Leader.', 'success');
      setRejectingTarget(null);
      setRejectionReason('');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không từ chối được KPI.', 'error');
    }
  };

  const activeDepartmentTarget = selectedTargets.find(target => target.scope === 'department' && isCurrentlyEffective(target));
  const visibleHistory = selectedTargets.filter(target => {
    if (canApproveSection) return scopedSelectedTargets.some(scopedTarget => scopedTarget.id === target.id);
    if (canProposeSection) return target.scope === 'department' || target.createdBy === user.uid || visibleUsers.some(operationUser => operationUser.uid === target.scopeId);
    return isCurrentlyEffective(target) && (target.scope === 'department' || target.scopeId === viewer?.uid || target.scopeId === businessRole);
  });

  if (isLoading || (activeConfigTab !== 'calendar' && isPerformanceLoading)) return <PerformancePageSkeleton variant="configuration" />;

  return <div className="h-full overflow-y-auto p-2 pb-28 md:p-6 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
    <div className="mx-auto max-w-[1500px] space-y-5">
      <nav role="tablist" aria-label="Nhóm cấu hình Performance & KPI" className="flex gap-2 overflow-x-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-sm dark:border-gray-700 dark:bg-gray-800 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
        {visibleConfigurationTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeConfigTab === tab.id;
          return <button key={tab.id} role="tab" type="button" aria-selected={isActive} onClick={() => { setActiveConfigTab(tab.id); setShowForm(false); }} className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition ${isActive ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-700 dark:hover:text-white'}`}><Icon className="h-4 w-4" />{tab.label}</button>;
        })}
      </nav>

      {activeConfigTab === 'targets' && <>
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-50 p-2.5 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300"><FileSliders className="h-5 w-5" /></div><div><h2 className="text-xl font-black text-gray-950 dark:text-white">Cấu hình KPI</h2><p className="mt-1 max-w-4xl text-sm leading-6 text-gray-500 dark:text-gray-400">Chỉ cấu hình Target và cách lấy Actual. Hệ thống không lưu công thức chấm điểm, trọng số, bảng điểm nhân sự hoặc OKR.</p></div></div>
          <label className="w-full lg:w-72"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">Phòng ban</span><div className="relative"><select value={selectedSection} onChange={event => { setSelectedSection(event.target.value as KpiConfigSection); setShowForm(false); }} disabled={accessibleMetrics.length <= 1} className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 pr-10 text-sm font-black text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-default disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">{accessibleMetrics.map(item => <option key={item.sectionId} value={item.sectionId}>{sectionLabels[item.sectionId as KpiConfigSection]}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /></div></label>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="relative rounded-xl bg-gray-50 p-3 pb-11 dark:bg-gray-900/40"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Quyền hiện tại</p><p className="mt-1 font-black">{isListingSection ? 'Chờ công thức sale + listing' : canApproveSection ? 'Head · Duyệt & đề xuất' : canProposeSection ? 'Leader · Đề xuất phòng ban' : 'Nhân sự · Chỉ xem'}</p><MetricHelpTooltip title="Quyền KPI hiện tại" content={{ summary: isListingSection ? 'R&D/Scale chỉ xem dữ liệu tham khảo cho tới khi công thức sale + listing được duyệt.' : 'Quyền thao tác được xác định theo role dùng chung và phòng ban đang chọn.', calculation: ['Head/Management có thể duyệt và đề xuất.', 'Leader được đề xuất KPI trong phạm vi phòng ban nhưng không tự duyệt đề xuất của chính mình.', 'Nhân sự thường chỉ xem KPI đã active của bản thân.'], sources: ['authentication/{uid}.role và permission role.'], rules: [isListingSection ? 'Không tạo hoặc duyệt target listing đơn lẻ trong giai đoạn chờ công thức.' : 'Đề xuất chỉ active sau khi Head duyệt.'] }} className="absolute bottom-3 right-3" /></div>
          <div className="relative rounded-xl bg-gray-50 p-3 pb-11 dark:bg-gray-900/40"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Mặc định phòng ban</p><p className="mt-1 font-black">{activeDepartmentTarget ? `${activeDepartmentTarget.targetValue} ${activeDepartmentTarget.unit}/${periodLabels[activeDepartmentTarget.period]}` : 'Chưa thiết lập'}</p><MetricHelpTooltip title="KPI mặc định phòng ban" content={{ summary: 'Snapshot KPI cấp phòng ban áp cho nhân sự chưa có override riêng.', currentSummary: activeDepartmentTarget ? `${activeDepartmentTarget.targetValue} ${activeDepartmentTarget.unit}/${periodLabels[activeDepartmentTarget.period]}.` : 'Chưa có snapshot phòng ban đang active.', calculation: ['Ưu tiên target cá nhân.', 'Nếu không có, dùng target phòng ban đã duyệt.'], sources: ['user/{teamId}/kpi_targets.'], rules: ['Không sửa ngược snapshot lịch sử.'] }} className="absolute bottom-3 right-3" /></div>
          <div className="relative rounded-xl bg-gray-50 p-3 pb-11 dark:bg-gray-900/40"><p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Chờ Head duyệt</p><p className="mt-1 font-black text-amber-700 dark:text-amber-300">{pendingCount} đề xuất</p><MetricHelpTooltip title="Đề xuất chờ Head duyệt" content={{ summary: 'Số target snapshot đang pending của phòng ban hiện tại.', calculation: ['Lọc target theo section và status = pending.'], sources: ['user/{teamId}/kpi_targets.'], rules: ['Target pending chưa ảnh hưởng tiến độ đang chạy.'] }} className="absolute bottom-3 right-3" /></div>
        </div>
      </section>

      {pendingCount > 0 && <section className="flex items-center justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"><div className="flex items-center gap-2 text-sm font-black"><Clock3 className="h-5 w-5" /> {pendingCount} đề xuất đang chờ duyệt cho {sectionLabels[selectedSection]}</div><ChevronDown className="h-4 w-4" /></section>}

      {isListingSection && <section className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">R&D/Scale đang chỉ hiển thị dữ liệu listing và sale để tham khảo. Chức năng tạo hoặc duyệt KPI sẽ mở sau khi có công thức kết hợp chính thức.</section>}

      {canProposeSection && <div className="flex justify-end"><button type="button" onClick={() => showForm ? setShowForm(false) : startProposal(activeDepartmentTarget)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700"><Plus className="h-4 w-4" /> Đề xuất KPI mới</button></div>}

      <KpiBaselineBoard sectionId={selectedSection} sectionLabel={sectionLabels[selectedSection]} unit={metric.unit} series={baselineSeries} dataSource={baselineDataSource} updatedAt={baselineUpdatedAt} refreshStatus={baselineRefreshStatus} refreshError={baselineRefreshError} rangeFrom={baselineRange.from} rangeTo={baselineRange.to} quarterLabel={baselineRange.label} isLoading={isBaselineLoading} canApplySuggestion={canProposeSection} onApplySuggestion={(targetEmployeeId, value, baselinePeriod) => {
        const existingEmployeeTarget = selectedTargets.find(target => target.scope === 'employee' && target.scopeId === targetEmployeeId && target.period === baselinePeriod && isCurrentlyEffective(target));
        startProposal(existingEmployeeTarget, targetEmployeeId, baselinePeriod);
        setTargetValue(String(value));
      }} />

      {showForm && canProposeSection && <form id="kpi-proposal-form" onSubmit={submitProposal} className="grid scroll-mt-4 gap-5 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
          <div className="flex items-start justify-between"><div><h3 className="font-black text-gray-950 dark:text-white">Đề xuất target snapshot mới</h3><p className="mt-1 text-xs text-gray-500">Bản đang active không bị sửa ngược lịch sử.</p></div><button type="button" onClick={() => setShowForm(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-4 w-4" /></button></div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Cấp áp dụng</span><select value={scope} onChange={event => setScope(event.target.value as ProposalScope)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"><option value="department">Mặc định phòng ban</option><option value="employee">Tùy chỉnh cá nhân</option></select></label>
            <label><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Kỳ KPI</span><select value={period} onChange={event => setPeriod(event.target.value as KpiTargetPeriod)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white">{periodOptions.map(option => <option key={option} value={option}>{periodLabels[option]}</option>)}</select></label>
            {scope === 'employee' && <label className="sm:col-span-2"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Nhân sự</span><select value={employeeId} onChange={event => setEmployeeId(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white">{visibleUsers.map(operationUser => <option key={operationUser.uid} value={operationUser.uid}>{getUserLabel(operationUser)} · {operationUser.role}</option>)}</select></label>}
            <label className="sm:col-span-2"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Target Output ({metric.unit}/{periodLabels[period].toLowerCase()})</span><input type="number" min="0.1" step="0.1" value={targetValue} onChange={event => setTargetValue(event.target.value)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label>
            <label className="sm:col-span-2"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Kỳ áp dụng</span><select value={activationMode} onChange={event => setActivationMode(event.target.value as ActivationMode)} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold dark:border-gray-700 dark:bg-gray-900 dark:text-white"><option value="current_period">Kỳ hiện tại · {formatPeriodLabel(period, today())}</option><option value="next_period">Kỳ kế tiếp · {formatPeriodLabel(period, getNextKpiPeriodStart(period, today()))}</option></select></label>
            <p className="sm:col-span-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">Target áp dụng từ {formatVietnameseDate(effectiveFrom)} đến {formatVietnameseDate(effectiveTo)}. Bộ lọc ngày trên Dashboard chỉ dùng xem dữ liệu; kỳ KPI được xác định bởi snapshot.</p>
            {(scope === 'employee' || isPeriodRevision) && <label className="sm:col-span-2"><span className="text-xs font-bold uppercase tracking-wide text-gray-500">{isPeriodRevision ? 'Lý do thay thế KPI đã duyệt' : 'Lý do tùy chỉnh'}</span><textarea rows={3} value={reason} onChange={event => setReason(event.target.value)} placeholder={isPeriodRevision ? 'Nêu rõ vì sao target của kỳ phải thay đổi...' : 'Ví dụ: mới onboard, đang lead thêm mảng...'} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label>}
          </div>
          <div className="mt-4 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">Actual = {actualDescription}. Tiến độ = Actual / Target × 100%; đây không phải điểm đánh giá.</div>
          <button type="submit" disabled={isSaving} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-60"><ShieldCheck className="h-4 w-4" /> {isSaving ? 'Đang gửi...' : 'Gửi Head duyệt'}</button>
        </section>
        <KpiMeasurementPreview actual={previewActual} target={previewTarget} unit={metric.unit} actualDescription={actualDescription} cohort={previewCohort} isSample={!selectedPerformance && teamActual === null} />
      </form>}

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-700 md:flex-row md:items-center md:justify-between md:px-5"><div><h3 className="font-black text-gray-950 dark:text-white">Bảng KPI nhân sự</h3><p className="mt-1 text-xs text-gray-500">Override cá nhân được ưu tiên; nếu không có sẽ dùng mặc định phòng ban.</p></div><span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-600 dark:bg-gray-700 dark:text-gray-300"><Users className="h-3.5 w-3.5" /> {visibleUsers.length} nhân sự</span></div>
        {performanceError && <div className="border-b border-rose-100 bg-rose-50 px-5 py-3 text-xs font-semibold text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">Không tải được dữ liệu thực tế: {performanceError}</div>}
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-gray-900/40"><tr><th className="px-5 py-3">Nhân sự</th><th className="px-4 py-3">KPI hiện tại</th><th className="px-4 py-3">Dữ liệu thực tế</th><th className="px-4 py-3">Trạng thái</th>{canProposeSection && <th className="px-5 py-3 text-right">Thao tác</th>}</tr></thead><tbody className="divide-y divide-gray-100 dark:divide-gray-700">{visibleUsers.map(operationUser => {
          const employeeTarget = selectedTargets.find(target => target.scope === 'employee' && target.scopeId === operationUser.uid && isCurrentlyEffective(target));
          const roleTarget = selectedTargets.find(target => target.scope === 'role' && target.scopeId.toUpperCase() === String(operationUser.role || '').toUpperCase() && isCurrentlyEffective(target));
          const assignedTarget = employeeTarget || roleTarget || activeDepartmentTarget;
          const pending = selectedTargets.find(target => target.status === 'pending' && (target.scopeId === operationUser.uid || (!employeeTarget && target.scope === 'department')));
          const performance = performanceEmployees.find(employee => employee.id === operationUser.uid);
          const actualRangeNote = assignedTarget
            ? performance?.kpiProgress
              ? `${performance.kpiProgress.periodLabel} · tính đến ${formatVietnameseDate(performance.kpiProgress.asOf)}`
              : `Kỳ ${formatVietnameseDate(assignedTarget.effectiveFrom)} – ${formatVietnameseDate(assignedTarget.effectiveTo)}`
            : `Chưa có KPI · theo phạm vi Dashboard ${formatVietnameseDate(filterDateRange.from)} – ${formatVietnameseDate(filterDateRange.to)}`;
          const actualNote = isPerformanceLoading
            ? 'Đang tải dữ liệu thực tế...'
            : `${actualRangeNote}${performance?.kpiActual === 0 ? ' · chưa ghi nhận output phù hợp' : ''}`;
          return <tr key={operationUser.uid} className={pending ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}><td className="px-5 py-4"><p className="font-black text-gray-950 dark:text-white">{getUserLabel(operationUser)}</p><p className="mt-0.5 text-xs text-gray-500">{operationUser.role}</p></td><td className="px-4 py-4">{assignedTarget ? <><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${employeeTarget ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{employeeTarget ? 'Tùy chỉnh' : 'Mặc định'}</span><p className="mt-2 font-black">{assignedTarget.targetValue} {assignedTarget.unit}/{periodLabels[assignedTarget.period]}</p>{employeeTarget?.reason && <p className="mt-1 max-w-[240px] text-xs text-gray-500">{employeeTarget.reason}</p>}</> : <span className="text-xs font-semibold text-gray-400">Chưa có KPI</span>}</td><td className="px-4 py-4"><p className="font-black">{isPerformanceLoading ? 'Đang tải...' : performance ? `${performance.kpiActual.toFixed(1)} ${performance.kpiUnit || metric.unit}` : '—'}</p><p className="mt-1 max-w-[280px] text-[10px] font-semibold leading-4 text-gray-400">{actualNote}</p></td><td className="px-4 py-4">{pending ? <StatusBadge target={pending} /> : assignedTarget ? <StatusBadge target={assignedTarget} /> : <span className="text-xs text-gray-400">—</span>}</td>{canProposeSection && <td className="px-5 py-4 text-right"><button type="button" onClick={() => startProposal(employeeTarget || activeDepartmentTarget, operationUser.uid)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-blue-600 dark:hover:bg-gray-700" aria-label="Đề xuất KPI riêng"><Pencil className="h-4 w-4" /></button></td>}</tr>;
        })}</tbody></table></div>
        {!isLoading && visibleUsers.length === 0 && <div className="px-6 py-12 text-center text-sm font-semibold text-gray-400">Không tìm thấy nhân sự thuộc phạm vi {sectionLabels[selectedSection]}.</div>}
      </section>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="border-b border-gray-100 p-4 dark:border-gray-700 md:px-5"><h3 className="font-black text-gray-950 dark:text-white">Lịch sử đề xuất & snapshot</h3><p className="mt-1 text-xs text-gray-500">Không sửa ngược lịch sử; mỗi dòng là một phiên bản độc lập.</p></div>
        <div className="divide-y divide-gray-100 dark:divide-gray-700">{visibleHistory.map(target => <article key={target.id} className={`p-4 md:px-5 ${target.status === 'pending' ? 'bg-amber-50/60 dark:bg-amber-900/10' : target.status === 'rejected' ? 'bg-rose-50/40 dark:bg-rose-900/10' : ''}`}><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><StatusBadge target={target} /><span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-black uppercase text-gray-500 dark:bg-gray-700 dark:text-gray-300">v{target.version || 1}</span><p className="font-black text-gray-950 dark:text-white">{target.scopeLabel}</p></div><p className="mt-2 text-sm font-semibold">{target.targetValue} {target.unit}/{periodLabels[target.period]} · {formatPeriodLabel(target.period, target.effectiveFrom)}</p><p className="mt-1 text-xs text-gray-500">Đề xuất bởi {target.createdByName || target.updatedBy || '—'} · hiệu lực {formatVietnameseDate(target.effectiveFrom)} → {formatVietnameseDate(target.effectiveTo)}</p>{target.reason && <p className="mt-1 text-xs text-gray-500">Lý do: {target.reason}</p>}{target.rejectionReason && <p className="mt-2 text-xs font-bold text-rose-700 dark:text-rose-300">Lý do từ chối: {target.rejectionReason}</p>}</div>{canApproveSection && target.status === 'pending' && <div className="flex shrink-0 gap-2"><button type="button" onClick={() => void approveProposal(target)} disabled={target.proposerRole === 'leader' && target.createdBy === user.uid} className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"><Check className="h-4 w-4" /> Duyệt</button><button type="button" onClick={() => { setRejectingTarget(target); setRejectionReason(''); }} className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-black text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300"><X className="h-4 w-4" /> Từ chối</button></div>}</div></article>)}{!isLoading && visibleHistory.length === 0 && <div className="px-6 py-12 text-center text-sm font-semibold text-gray-400">Chưa có snapshot KPI cho board này.</div>}</div>
      </section>
      </>}

      {activeConfigTab === 'calendar' && <BusinessCalendarBoard canEdit={canManageAllDepartments} />}

      {activeConfigTab === 'template-points' && canViewTemplatePoints && <>
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div><h2 className="text-xl font-black text-gray-950 dark:text-white">Cấu hình điểm template</h2><p className="mt-1 text-sm text-gray-500">Kiểm tra điểm hiệu lực, nguồn điểm và mức độ đầy đủ của snapshot theo từng Designer board.</p></div>
            <label className="w-full md:w-72"><span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wide text-gray-400">Designer board</span><div className="relative"><select value={templatePointSection} onChange={event => setTemplatePointSection(event.target.value as DesignerConfigSection)} disabled={accessibleDesignerSections.length <= 1} className="w-full appearance-none rounded-xl border border-gray-200 bg-white px-4 py-2.5 pr-10 text-sm font-black text-gray-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:cursor-default disabled:bg-gray-50 disabled:text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200">{accessibleDesignerSections.map(sectionId => <option key={sectionId} value={sectionId}>{sectionLabels[sectionId]}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /></div></label>
          </div>
        </section>
        <TemplatePointBoard sectionId={templatePointSection} templates={templates} dataQuality={designerPointDataQuality} isLoading={isPerformanceLoading} canEdit={canManageTemplatePoints} />
      </>}
    </div>

    {rejectingTarget && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setRejectingTarget(null)}><section role="dialog" aria-modal="true" aria-label="Từ chối đề xuất KPI" onMouseDown={event => event.stopPropagation()} className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-5 shadow-2xl dark:border-gray-700 dark:bg-gray-800"><div className="flex items-start justify-between"><div><h3 className="font-black text-gray-950 dark:text-white">Từ chối đề xuất KPI</h3><p className="mt-1 text-sm text-gray-500">Leader cần biết chính xác nội dung phải điều chỉnh.</p></div><button type="button" onClick={() => setRejectingTarget(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"><X className="h-4 w-4" /></button></div><textarea autoFocus rows={4} value={rejectionReason} onChange={event => setRejectionReason(event.target.value)} placeholder="Nhập lý do từ chối bắt buộc..." className="mt-5 w-full rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm dark:border-gray-700 dark:bg-gray-900 dark:text-white" /><div className="mt-4 flex justify-end gap-2"><button type="button" onClick={() => setRejectingTarget(null)} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-bold text-gray-600 dark:border-gray-700 dark:text-gray-300">Hủy</button><button type="button" onClick={() => void rejectProposal()} disabled={!rejectionReason.trim()} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-black text-white hover:bg-rose-700 disabled:opacity-40">Xác nhận từ chối</button></div></section></div>}
  </div>;
}
