import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Save } from 'lucide-react';
import { useDashboardAccess } from '../../../contexts/DashboardContext';
import { useNotification } from '../../../contexts/NotificationContext';
import {
  DEFAULT_PERFORMANCE_CALENDAR,
  getBusinessMinutesPerDay,
  isSaturdayDateKey,
  isValidDateKey,
  parseHolidayInput,
  type PerformanceCalendarSettings,
} from '../businessCalendar';
import { fetchPerformanceCalendar, savePerformanceCalendar } from '../services/performanceCalendarService';

interface Props {
  canEdit: boolean;
}

const formatDateWithWeekday = (dateKey: string | null) => {
  if (!dateKey || !isValidDateKey(dateKey)) return null;
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'UTC',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${dateKey}T00:00:00Z`));
};

export default function BusinessCalendarBoard({ canEdit }: Props) {
  const { teamId, user } = useDashboardAccess();
  const { addNotification } = useNotification();
  const [settings, setSettings] = useState<PerformanceCalendarSettings>(DEFAULT_PERFORMANCE_CALENDAR);
  const [holidayInput, setHolidayInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const dailyHours = useMemo(() => getBusinessMinutesPerDay(settings) / 60, [settings]);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    fetchPerformanceCalendar(teamId).then(nextSettings => {
      if (cancelled) return;
      setSettings(nextSettings);
      setHolidayInput(nextSettings.holidays.join('\n'));
    }).catch(error => {
      if (!cancelled) addNotification(error instanceof Error ? error.message : 'Không tải được lịch làm việc.', 'error');
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [addNotification, teamId]);

  const save = async () => {
    if (!teamId || !canEdit) return;
    const holidays = parseHolidayInput(holidayInput);
    const invalidHoliday = holidays.find(dateValue => !isValidDateKey(dateValue));
    if (invalidHoliday) {
      addNotification(`Ngày nghỉ không hợp lệ: ${invalidHoliday}. Dùng định dạng YYYY-MM-DD.`, 'error');
      return;
    }
    if (settings.workingSaturdayAnchor && !isSaturdayDateKey(settings.workingSaturdayAnchor)) {
      const selectedDate = formatDateWithWeekday(settings.workingSaturdayAnchor);
      addNotification(`${selectedDate || settings.workingSaturdayAnchor} không phải là thứ Bảy. Hãy chọn đúng ngày thứ Bảy làm mốc.`, 'error');
      return;
    }
    setIsSaving(true);
    try {
      const saved = await savePerformanceCalendar(teamId, { ...settings, holidays }, user.uid);
      setSettings(saved);
      setHolidayInput(saved.holidays.join('\n'));
      addNotification('Đã lưu lịch làm việc Performance & KPI.', 'success');
    } catch (error) {
      addNotification(error instanceof Error ? error.message : 'Không lưu được lịch làm việc.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800 md:p-5">
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-cyan-50 p-2.5 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300"><CalendarDays className="h-5 w-5" /></div>
        <div><h3 className="font-black text-gray-950 dark:text-white">Lịch làm việc dùng để tính thời gian</h3><p className="mt-1 text-sm text-gray-500">UTC+7 Việt Nam · 09:00–12:00 và 13:30–18:00 · {dailyHours.toFixed(1)} giờ/ngày.</p></div>
      </div>
      {canEdit && <button type="button" onClick={() => void save()} disabled={isLoading || isSaving} className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white hover:bg-blue-700 disabled:opacity-50"><Save className="h-4 w-4" />{isSaving ? 'Đang lưu...' : 'Lưu lịch'}</button>}
    </div>

    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      <label><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Thứ Bảy mốc đang đi làm</span><input type="date" lang="vi-VN" value={settings.workingSaturdayAnchor || ''} disabled={!canEdit || isLoading} onChange={event => setSettings(current => ({ ...current, workingSaturdayAnchor: event.target.value || null }))} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-semibold disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-900/50" />{settings.workingSaturdayAnchor && <span className={`mt-1 block text-[11px] font-semibold ${isSaturdayDateKey(settings.workingSaturdayAnchor) ? 'text-emerald-600' : 'text-red-600'}`}>Hệ thống đang hiểu: {settings.workingSaturdayAnchor} · {formatDateWithWeekday(settings.workingSaturdayAnchor)}</span>}<span className="mt-1 block text-[11px] leading-5 text-gray-400">Ngày mốc và các thứ Bảy cách 2, 4, 6... tuần là ngày làm. Các thứ Bảy xen giữa là ngày nghỉ.</span></label>
      <label><span className="text-xs font-bold uppercase tracking-wide text-gray-500">Holiday calendar</span><textarea rows={4} value={holidayInput} disabled={!canEdit || isLoading} onChange={event => setHolidayInput(event.target.value)} placeholder={'2026-09-02\n2027-01-01'} className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 font-mono text-sm disabled:bg-gray-50 disabled:text-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:disabled:bg-gray-900/50" /><span className="mt-1 block text-[11px] text-gray-400">Nhập YYYY-MM-DD, mỗi dòng một ngày. Holiday luôn được loại khỏi giờ làm việc, kể cả thứ Bảy đang làm.</span></label>
    </div>

    {!settings.workingSaturdayAnchor && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold leading-5 text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">Chưa chọn thứ Bảy mốc nên hệ thống tạm xem toàn bộ thứ Bảy là ngày nghỉ, tránh tính sai thời gian.</p>}
  </section>;
}
