import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, RotateCcw, Save, Search, SlidersHorizontal } from 'lucide-react';
import { useNotification } from '../../../contexts/NotificationContext';
import { saveOperationTemplatePoint, type OperationTemplate } from '../../../services/reportService';
import { getDesignerFallbackPoints, type DesignerBoard } from '../designerPoints';
import type { DesignerPointDataQuality } from '../types';

type DesignerSection = 'designer-idea' | 'designer-fulfillment';
type PointFilter = 'all' | 'configured' | 'fallback';

type Props = {
  sectionId: DesignerSection;
  templates: OperationTemplate[];
  dataQuality: DesignerPointDataQuality | null;
  isLoading: boolean;
  canEdit: boolean;
};

const PAGE_SIZE = 20;
const isConfigured = (template: OperationTemplate) => (
  typeof template.points === 'number' && Number.isFinite(template.points) && template.points >= 0
);

const getBoardLabel = (boardType?: OperationTemplate['boardType']) => {
  if (boardType === 'idea') return 'Idea';
  if (boardType === 'fulfill') return 'Fulfillment';
  return 'All boards';
};

export default function TemplatePointBoard({ sectionId, templates, dataQuality, isLoading, canEdit }: Props) {
  const { addNotification } = useNotification();
  const board: DesignerBoard = sectionId === 'designer-idea' ? 'idea' : 'fulfill';
  const fallbackPoints = getDesignerFallbackPoints(board);
  const [search, setSearch] = useState('');
  const [pointFilter, setPointFilter] = useState<PointFilter>('all');
  const [page, setPage] = useState(1);
  const [draftPoints, setDraftPoints] = useState<Record<string, string>>({});
  const [savingTemplateId, setSavingTemplateId] = useState<string | null>(null);

  const relevantTemplates = useMemo(() => templates
    .filter(template => !template.archived)
    .filter(template => template.boardType === board || template.boardType === 'all')
    .sort((a, b) => Number(isConfigured(a)) - Number(isConfigured(b))
      || String(a.name || a.id).localeCompare(String(b.name || b.id))), [board, templates]);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return relevantTemplates.filter(template => {
      const configured = isConfigured(template);
      if (pointFilter === 'configured' && !configured) return false;
      if (pointFilter === 'fallback' && configured) return false;
      if (!query) return true;
      return `${template.name || ''} ${template.id}`.toLowerCase().includes(query);
    });
  }, [pointFilter, relevantTemplates, search]);

  useEffect(() => {
    setPage(1);
    setDraftPoints({});
  }, [board]);

  const updateSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  const updatePointFilter = (value: PointFilter) => {
    setPointFilter(value);
    setPage(1);
  };

  const getDraftPoint = (template: OperationTemplate) => (
    Object.prototype.hasOwnProperty.call(draftPoints, template.id)
      ? draftPoints[template.id]
      : isConfigured(template) ? String(template.points) : ''
  );

  const parseDraftPoint = (value: string) => {
    if (!value.trim()) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  };

  const hasPointChanged = (template: OperationTemplate) => {
    const nextPoints = parseDraftPoint(getDraftPoint(template));
    if (nextPoints === undefined) return true;
    const currentPoints = isConfigured(template) ? template.points : null;
    return nextPoints !== currentPoints;
  };

  const persistPoint = async (template: OperationTemplate, forcedValue?: string) => {
    if (!canEdit || savingTemplateId) return;
    const rawValue = forcedValue ?? getDraftPoint(template);
    const nextPoints = parseDraftPoint(rawValue);
    if (nextPoints === undefined) {
      addNotification('Điểm template phải là số lớn hơn hoặc bằng 0.', 'error');
      return;
    }
    setSavingTemplateId(template.id);
    try {
      await saveOperationTemplatePoint(template.id, nextPoints);
      setDraftPoints(current => {
        const next = { ...current };
        delete next[template.id];
        return next;
      });
      addNotification(nextPoints === null
        ? `Đã đưa ${template.name || template.id} về điểm fallback.`
        : `Đã lưu ${nextPoints} điểm cho ${template.name || template.id}.`, 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không lưu được điểm template.', 'error');
    } finally {
      setSavingTemplateId(null);
    }
  };

  const configuredTemplates = relevantTemplates.filter(isConfigured).length;
  const fallbackTemplates = relevantTemplates.length - configuredTemplates;
  const pageCount = Math.max(1, Math.ceil(filteredTemplates.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const visibleTemplates = filteredTemplates.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const snapshotRate = dataQuality?.totalCompletedTasks
    ? Math.round((dataQuality.snapshottedTasks / dataQuality.totalCompletedTasks) * 100)
    : 0;

  return <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
    <div className="border-b border-gray-100 p-4 dark:border-gray-700 md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-xl bg-amber-50 p-2.5 text-amber-600 dark:bg-amber-900/20 dark:text-amber-300"><SlidersHorizontal className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-black text-gray-950 dark:text-white">Danh sách điểm template</h3><span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black uppercase text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Dữ liệu thật</span><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${canEdit ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300'}`}>{canEdit ? 'Có thể chỉnh sửa' : 'Chỉ xem'}</span></div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-gray-500">Nguồn <code className="font-mono">settings/templates</code>. Điểm task ưu tiên snapshot lúc hoàn thành, sau đó dùng điểm template hiện tại; template chưa cấu hình dùng fallback {fallbackPoints} điểm trên {board === 'idea' ? 'Idea' : 'Fulfillment'} board. Thay đổi chỉ ảnh hưởng task chưa có snapshot điểm.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-4 lg:min-w-[520px]">
          <div className="rounded-xl bg-gray-50 p-3 dark:bg-gray-900/40"><p className="text-[10px] font-bold uppercase text-gray-400">Template áp dụng</p><p className="mt-1 text-xl font-black">{relevantTemplates.length}</p></div>
          <div className="rounded-xl bg-emerald-50 p-3 dark:bg-emerald-900/20"><p className="text-[10px] font-bold uppercase text-emerald-600">Đã cấu hình</p><p className="mt-1 text-xl font-black text-emerald-700 dark:text-emerald-300">{configuredTemplates}</p></div>
          <div className="rounded-xl bg-amber-50 p-3 dark:bg-amber-900/20"><p className="text-[10px] font-bold uppercase text-amber-600">Đang fallback</p><p className="mt-1 text-xl font-black text-amber-700 dark:text-amber-300">{fallbackTemplates}</p></div>
          <div className="rounded-xl bg-blue-50 p-3 dark:bg-blue-900/20"><p className="text-[10px] font-bold uppercase text-blue-600">Snapshot kỳ chọn</p><p className="mt-1 text-xl font-black text-blue-700 dark:text-blue-300">{snapshotRate}%</p></div>
        </div>
      </div>

      {dataQuality && dataQuality.totalCompletedTasks > 0 && (dataQuality.fallbackTasks > 0 || dataQuality.tasksWithoutTemplate > 0) && <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><p>Trong khoảng ngày đang chọn có <strong>{dataQuality.totalCompletedTasks}</strong> file hoàn thành: {dataQuality.snapshottedTasks} dùng snapshot, {dataQuality.configuredTasks} dùng điểm cấu hình hiện tại, {dataQuality.fallbackTasks} dùng fallback và {dataQuality.tasksWithoutTemplate} chưa có template. Số liệu fallback có thể thay đổi khi cấu hình template được hoàn thiện.</p></div>}
    </div>

    <div className="flex flex-col gap-3 border-b border-gray-100 p-4 dark:border-gray-700 sm:flex-row sm:items-center sm:justify-between md:px-5">
      <label className="relative min-w-0 flex-1 sm:max-w-md"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" /><input value={search} onChange={event => updateSearch(event.target.value)} placeholder="Tìm theo tên hoặc template ID" className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /></label>
      <select value={pointFilter} onChange={event => updatePointFilter(event.target.value as PointFilter)} className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-bold text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"><option value="all">Tất cả trạng thái</option><option value="fallback">Chưa cấu hình điểm</option><option value="configured">Đã cấu hình điểm</option></select>
    </div>

    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-sm">
        <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-400 dark:bg-gray-900/40"><tr><th className="px-5 py-3">Template</th><th className="px-4 py-3">Board</th><th className="px-4 py-3">Điểm cấu hình</th><th className="px-4 py-3">Nguồn điểm</th></tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">{visibleTemplates.map(template => {
          const configured = isConfigured(template);
          const effectivePoints = configured ? template.points : fallbackPoints;
          const draftPoint = getDraftPoint(template);
          const isSaving = savingTemplateId === template.id;
          return <tr key={template.id} className="transition hover:bg-gray-50 dark:hover:bg-gray-900/30"><td className="px-5 py-4"><p className="font-black text-gray-950 dark:text-white">{template.name || 'Template chưa đặt tên'}</p><p className="mt-0.5 font-mono text-[11px] text-gray-400">{template.id}</p></td><td className="px-4 py-4 font-semibold text-gray-600 dark:text-gray-300">{getBoardLabel(template.boardType)}</td><td className="px-4 py-4">{canEdit ? <div className="flex items-center gap-2"><input type="number" min="0" step="0.1" value={draftPoint} onChange={event => setDraftPoints(current => ({ ...current, [template.id]: event.target.value }))} placeholder={String(fallbackPoints)} disabled={Boolean(savingTemplateId)} className="w-24 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-black outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-white" /><button type="button" onClick={() => void persistPoint(template)} disabled={Boolean(savingTemplateId) || !hasPointChanged(template)} aria-label={`Lưu điểm ${template.name || template.id}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-30"><Save className="h-4 w-4" /></button></div> : <p className="text-lg font-black">{effectivePoints}</p>}</td><td className="px-4 py-4"><div className="flex flex-wrap items-center gap-2">{configured ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-black uppercase text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> Cấu hình</span> : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><Database className="h-3.5 w-3.5" /> Fallback {effectivePoints}</span>}{canEdit && configured && <button type="button" onClick={() => void persistPoint(template, '')} disabled={Boolean(savingTemplateId)} className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-[10px] font-black uppercase text-gray-500 transition hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"><RotateCcw className={`h-3.5 w-3.5 ${isSaving ? 'animate-spin' : ''}`} /> Dùng fallback</button>}</div></td></tr>;
        })}</tbody>
      </table>
    </div>

    {!isLoading && visibleTemplates.length === 0 && <div className="px-6 py-12 text-center text-sm font-semibold text-gray-400">Không tìm thấy template phù hợp.</div>}
    {filteredTemplates.length > PAGE_SIZE && <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-xs font-bold text-gray-500 dark:border-gray-700 md:px-5"><span>{filteredTemplates.length} template · trang {safePage}/{pageCount}</span><div className="flex gap-2"><button type="button" onClick={() => setPage(current => Math.max(1, current - 1))} disabled={safePage === 1} className="rounded-lg border border-gray-200 px-3 py-2 disabled:opacity-40 dark:border-gray-700">Trước</button><button type="button" onClick={() => setPage(current => Math.min(pageCount, current + 1))} disabled={safePage === pageCount} className="rounded-lg border border-gray-200 px-3 py-2 disabled:opacity-40 dark:border-gray-700">Sau</button></div></div>}
  </section>;
}
