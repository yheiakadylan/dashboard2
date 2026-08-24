import React, { useState, useEffect, useMemo, useRef } from 'react';
import { KpiReport, KpiIdea } from '../types';
import { updateKpiReportField, getKpiUserProfiles, KpiUserProfile, listenKpiReports, getIdeaTags, addIdeaTags, getKpiTargets, ExtendedKpiTarget } from '../services/kpiService';
import { getKpiAccountFilter } from '../utils/kpiAccess';
import * as XLSX from 'xlsx';
import { ArrowDownTrayIcon, ChevronDownIcon, PencilIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import { useUI } from '../contexts/UIContext';
import { useDashboard } from '../contexts/DashboardContext';
import { formatDateEfficiently } from '../utils/dateFormatter';

interface KpiPersonalReportProps {
    teamId: string;
    exportTrigger?: number;
}

const getWeekRange = (baseDateStr: string, offsetWeeks = 0) => {
    const baseDate = new Date(baseDateStr);
    const day = baseDate.getDay();
    const diff = baseDate.getDate() - day + (day === 0 ? -6 : 1) + (offsetWeeks * 7); // Monday
    const start = new Date(baseDate.setDate(diff));
    const end = new Date(start);
    end.setDate(end.getDate() + 6); // Sunday
    
    const yyyyMmDd = (d: Date) => d.toISOString().split('T')[0];
    return { start: yyyyMmDd(start), end: yyyyMmDd(end) };
};

const getWeekId = (dateStr: string) => {
    const d = new Date(dateStr);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${weekNo}`;
};

// ---- Helpers ----
const normalizeName = (name: string) =>
    name.trim().toLowerCase().replace(/\s+/g, '-');

const getDateRange = (from: string, to: string): string[] => {
    const dates: string[] = [];
    const cur = new Date(from);
    const end = new Date(to);
    while (cur <= end) {
        dates.push(cur.toISOString().split('T')[0]);
        cur.setDate(cur.getDate() + 1);
    }
    return dates.reverse(); // newest first
};

// ---- EditableNumberCell ----
interface EditableNumberCellProps {
    value: number;
    reportId: string;
    field: string;
    teamId: string;
    baseData: Partial<KpiReport>;
    isEditable?: boolean;
    remainingText?: string;
    isCurrency?: boolean;
    textClassName?: string;
    onUpdate: (reportId: string, field: string, newValue: any) => void;
}

const EditableNumberCell: React.FC<EditableNumberCellProps> = ({ value, reportId, field, teamId, baseData, isEditable = true, remainingText, isCurrency = false, textClassName = '', onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(String(value));
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        const parsed = parseFloat(editValue);
        const newVal = isNaN(parsed) ? 0 : parsed;
        if (newVal === value) { setIsEditing(false); return; }
        setIsSaving(true);
        try {
            await updateKpiReportField(teamId, reportId, field, newVal, baseData);
            onUpdate(reportId, field, newVal);
        } finally {
            setIsSaving(false);
            setIsEditing(false);
        }
    };

    if (isEditing && isEditable) {
        return (
            <div className="flex flex-col items-center justify-center gap-1">
                <div className="relative w-full min-w-[4rem] max-w-[6rem] mx-auto h-7">
                    <input
                        type="number"
                        autoFocus
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={handleSave}
                        onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') setIsEditing(false); }}
                        disabled={isSaving}
                        className="absolute inset-0 w-full h-full text-center px-1 border border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-md dark:bg-gray-700 dark:text-white text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    {isSaving && <div className="absolute -right-5 top-1/2 -translate-y-1/2"><Spinner size="xs" /></div>}
                </div>
                {remainingText && (
                    <div className="text-[10px] text-gray-500 font-normal leading-tight">{remainingText}</div>
                )}
            </div>
        );
    }

    const displayValue = isCurrency && value > 0 ? `$${value.toFixed(2)}` : (value === 0 && isCurrency ? '0' : value);

    return (
        <div className="flex flex-col gap-0.5 w-full h-full">
            <div
                className={`flex items-center rounded-md border border-transparent w-full h-7 relative px-1 ${isEditable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 group' : ''}`}
                onClick={() => { if(isEditable) { setEditValue(String(value)); setIsEditing(true); } }}
                title={isEditable ? "Click để chỉnh sửa" : ""}
            >
                <span className={`w-full ${textClassName} ${value === 0 ? 'text-gray-400 dark:text-gray-600' : ''}`}>{displayValue}</span>
                {isEditable && <PencilIcon className="absolute top-1 right-1 h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
            </div>
            {remainingText && !isEditing && (
                <div className="text-[10px] text-gray-500 font-normal leading-tight whitespace-nowrap text-center">{remainingText}</div>
            )}
        </div>
    );
};

// ---- EditableNoteCell ----
interface EditableNoteCellProps {
    value: string | undefined;
    reportId: string;
    teamId: string;
    baseData: Partial<KpiReport>;
    isEditable?: boolean;
    onUpdate: (reportId: string, field: string, newValue: string) => void;
}

const EditableNoteCell: React.FC<EditableNoteCellProps> = ({ value, reportId, teamId, baseData, isEditable = true, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value || '');
    const [isSaving, setIsSaving] = useState(false);

    const handleSave = async () => {
        if (editValue === (value || '')) { setIsEditing(false); return; }
        setIsSaving(true);
        try {
            await updateKpiReportField(teamId, reportId, 'note', editValue, baseData);
            onUpdate(reportId, 'note', editValue);
        } finally {
            setIsSaving(false);
            setIsEditing(false);
        }
    };

    if (isEditing && isEditable) {
        return (
            <div className="relative w-full h-full min-h-[40px] py-1 flex items-stretch">
                <textarea
                    autoFocus
                    value={editValue}
                    ref={(el) => {
                        if (el) {
                            el.style.height = 'inherit';
                            el.style.height = `${el.scrollHeight}px`;
                        }
                    }}
                    onChange={e => setEditValue(e.target.value)}
                    onBlur={handleSave}
                    onKeyDown={e => { if (e.key === 'Escape') setIsEditing(false); }}
                    disabled={isSaving}
                    className="w-full flex-1 px-1 text-xs text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded-md resize-none overflow-hidden break-words whitespace-pre-wrap min-h-[40px]"
                />
                {isSaving && <div className="absolute right-1 top-1/2 -translate-y-1/2"><Spinner size="xs" /></div>}
            </div>
        );
    }

    return (
        <div
            className={`relative rounded-md border border-transparent px-1 w-full h-full min-h-[40px] py-1 flex items-start ${isEditable ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 group' : ''}`}
            onClick={() => { if(isEditable) { setEditValue(value || ''); setIsEditing(true); } }}
            title={isEditable ? "Click để chỉnh sửa" : ""}
        >
            <div className="text-gray-600 dark:text-gray-400 text-xs w-full pr-3 text-left whitespace-pre-wrap break-words min-h-[40px]">
                {value || <span className="text-gray-300 dark:text-gray-600 not-italic">--</span>}
            </div>
            {isEditable && <PencilIcon className="absolute top-1 right-1 h-3 w-3 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />}
        </div>
    );
};

// ---- IdeasPopup ----
interface IdeasPopupProps {
    ideas: KpiIdea[];
    reportId: string;
    teamId: string;
    baseData: Partial<KpiReport>;
    onUpdate: (reportId: string, field: string, newValue: any) => void;
    onClose: () => void;
}

const IdeasPopup: React.FC<IdeasPopupProps> = ({ ideas, reportId, teamId, baseData, onUpdate, onClose }) => {
    const [localIdeas, setLocalIdeas] = useState<KpiIdea[]>(ideas.map(i => ({ ...i })));
    const [newType, setNewType] = useState('');
    const [newCount, setNewCount] = useState('1');
    const [isSaving, setIsSaving] = useState(false);
    const overlayRef = useRef<HTMLDivElement>(null);

    const [availableTags, setAvailableTags] = useState<string[]>([]);
    useEffect(() => {
        getIdeaTags(teamId).then(setAvailableTags).catch(console.error);
    }, [teamId]);

    const handleAddIdea = (typeOverride?: string) => {
        const type = (typeOverride !== undefined ? typeOverride : newType).trim();
        if (!type) return;
        const count = parseInt(newCount, 10) || 1;
        const existing = localIdeas.find(i => i.type.toLowerCase() === type.toLowerCase());
        if (existing) {
            setLocalIdeas(prev => prev.map(i => i.type.toLowerCase() === type.toLowerCase() ? { ...i, count: i.count + count } : i));
        } else {
            setLocalIdeas(prev => [...prev, { type: type.charAt(0).toUpperCase() + type.slice(1), count }]);
        }
        setNewType('');
        setNewCount('1');
    };

    const handleIdeaChange = (index: number, typeStr: string) => {
        setLocalIdeas(prev => prev.map((i, ii) => ii === index ? { ...i, type: typeStr } : i));
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const validIdeas = localIdeas.filter(i => i.type.trim() !== '' && Number(i.count) > 0);
            
            const newTags = validIdeas.map(i => i.type.trim()).filter(t => !availableTags.includes(t) && !availableTags.includes(t.toLowerCase()));
            if (newTags.length > 0) {
                await addIdeaTags(teamId, newTags);
            }

            await updateKpiReportField(teamId, reportId, 'ideas', validIdeas, baseData);
            onUpdate(reportId, 'ideas', validIdeas);
            onClose();
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[200] p-4"
            ref={overlayRef} onClick={e => { if (e.target === overlayRef.current) onClose(); }}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl border border-gray-200 dark:border-gray-700">
                <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="font-semibold text-gray-900 dark:text-white">Chỉnh sửa Ideas</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none px-1">✕</button>
                </div>
                <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto overflow-visible">
                    {localIdeas.length === 0 && (
                        <p className="text-center text-gray-400 text-sm py-3">Chưa có idea nào.</p>
                    )}
                    {localIdeas.map((idea, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                            <input type="number" value={idea.count} min={1}
                                onChange={e => setLocalIdeas(prev => prev.map((i, ii) => ii === idx ? { ...i, count: parseInt(e.target.value) || 1 } : i))}
                                className="w-14 text-center px-1 py-0.5 border border-gray-300 dark:border-gray-500 rounded-md text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-white" />
                            
                            <div className="flex-1 relative group">
                                <input type="text" value={idea.type}
                                    placeholder="Select or type..."
                                    onChange={e => handleIdeaChange(idx, e.target.value)}
                                    className="w-full px-2 py-0.5 pr-6 border border-gray-300 dark:border-gray-500 rounded-md text-sm bg-white dark:bg-gray-600 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 peer" />
                                <div className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </div>
                                <div className="absolute z-[210] w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg opacity-0 invisible peer-focus:opacity-100 peer-focus:visible hover:opacity-100 hover:visible transition-all max-h-48 overflow-y-auto">
                                    {availableTags
                                        .filter(t => t.toLowerCase().includes(idea.type.toLowerCase()))
                                        .map(t => (
                                            <div 
                                                key={t}
                                                className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
                                                onMouseDown={(e) => { e.preventDefault(); handleIdeaChange(idx, t); }}
                                            >
                                                {t}
                                            </div>
                                    ))}
                                    {idea.type && !availableTags.some(t => t.toLowerCase() === idea.type.toLowerCase()) && (
                                        <div className="px-3 py-2 text-sm text-blue-600 dark:text-blue-400 font-medium italic border-t border-gray-100 dark:border-gray-600">
                                            + Add "{idea.type}"
                                        </div>
                                    )}
                                </div>
                            </div>
                            
                            <button onClick={() => setLocalIdeas(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600 px-1">✕</button>
                        </div>
                    ))}
                </div>
                <div className="px-4 pb-4">
                    <div className="flex gap-2 items-center bg-blue-50 dark:bg-blue-900/20 rounded-lg p-2">
                        <input type="number" value={newCount} onChange={e => setNewCount(e.target.value)} min={1} placeholder="Qty"
                            className="w-14 text-center px-1 py-1 border border-blue-300 dark:border-blue-700 rounded-md text-sm dark:bg-gray-700 dark:text-white" />
                        
                        <div className="flex-1 relative group">
                            <input
                                type="text"
                                placeholder="Select or type new idea..."
                                value={newType}
                                onChange={e => setNewType(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleAddIdea(); }}
                                className="w-full px-2 py-1 pr-6 text-sm border border-blue-300 dark:border-blue-700 rounded-md dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 peer"
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                            </div>
                            
                            {/* Dropdown list */}
                            <div className="absolute z-[210] w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-md shadow-lg opacity-0 invisible peer-focus:opacity-100 peer-focus:visible hover:opacity-100 hover:visible transition-all max-h-48 overflow-y-auto">
                                {availableTags
                                    .filter(t => t.toLowerCase().includes(newType.toLowerCase()))
                                    .map(t => (
                                        <div 
                                            key={t}
                                            className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"
                                            onMouseDown={(e) => { e.preventDefault(); handleAddIdea(t); }}
                                        >
                                            {t}
                                        </div>
                                ))}
                                {newType && !availableTags.some(t => t.toLowerCase() === newType.toLowerCase()) && (
                                    <div 
                                        className="px-3 py-2 text-sm text-blue-600 dark:text-blue-400 font-medium italic border-t border-gray-100 dark:border-gray-600 cursor-pointer"
                                        onMouseDown={(e) => { e.preventDefault(); handleAddIdea(); }}
                                    >
                                        + Add "{newType}"
                                    </div>
                                )}
                                {availableTags.length > 0 && availableTags.filter(t => t.toLowerCase().includes(newType.toLowerCase())).length === 0 && !newType && (
                                    <div className="px-3 py-2 text-sm text-gray-500 italic">No matches</div>
                                )}
                            </div>
                        </div>

                        <button onClick={() => handleAddIdea()} className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-md">+</button>
                    </div>
                </div>
                <div className="p-4 flex justify-end gap-3 border-t border-gray-200 dark:border-gray-700">
                    <button onClick={onClose} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 rounded-md text-sm font-semibold">Hủy</button>
                    <button onClick={handleSave} disabled={isSaving}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-semibold disabled:opacity-50 flex items-center gap-2">
                        {isSaving && <Spinner size="xs" color="text-white" />} Lưu
                    </button>
                </div>
            </div>
        </div>
    );
};

// ---- Row type ----
interface ReportRow {
    rowKey: string;      // unique key: date_normalizedName
    docId: string;       // Firestore document ID
    dateStr: string;
    kpiUser: KpiUserProfile;
    displayName: string;
    uEmail: string;
    report: KpiReport;   // existing or placeholder
    isPlaceholder: boolean;
    hasShops?: boolean;
}

// ---- Main Component ----
const KpiPersonalReport: React.FC<KpiPersonalReportProps> = ({ teamId, exportTrigger }) => {
    const { filterDateRange, timeZone } = useUI();
    const { records, allowedAccounts, display_name, user, role, sharedRole, can_view_leaderboard, allAccounts } = useDashboard();
    const viewerHasFullAccountAccess = role === 'owner' || ['ADMIN', 'MANAGER'].includes(String(sharedRole || '').toUpperCase());

    const [reports, setReports] = useState<KpiReport[]>([]);
    const [weekReports, setWeekReports] = useState<KpiReport[]>([]);
    const [weekTargets, setWeekTargets] = useState<Record<string, ExtendedKpiTarget>>({});
    const [kpiUsers, setKpiUsers] = useState<KpiUserProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
    const [ideasPopupFor, setIdeasPopupFor] = useState<{ row: ReportRow } | null>(null);
    const [globalKpiTeams, setGlobalKpiTeams] = useState<string[]>([]);
    const [selectedTeam, setSelectedTeam] = useState<string>('all');

    // Can this user see all KPI members?
    const canViewAll = role === 'owner' || !!can_view_leaderboard;

    const currentWeekInfo = useMemo(() => {
        if (!filterDateRange.from) return null;
        const range = getWeekRange(filterDateRange.from, 0);
        const id = getWeekId(filterDateRange.from);
        return { ...range, id };
    }, [filterDateRange.from]);

    // Load KPI users + reports
    useEffect(() => {
        if (!teamId || !filterDateRange.from || !filterDateRange.to) return;
        setLoading(true);

        import('../services/firebaseService').then(({ getSettings }) => {
            getSettings(teamId).then(settings => {
                setGlobalKpiTeams(settings.kpiTeams || []);
            }).catch(console.error);
        });
        
        // Fetch profiles once
        getKpiUserProfiles(teamId).then(users => {
            setKpiUsers(users);
            setLoading(false);
        }).catch(err => {
            console.error("Error fetching KPI users:", err);
            setLoading(false);
        });

        // Listen to active query reports
        const unsubscribe = listenKpiReports(teamId, filterDateRange.from, filterDateRange.to, (reps) => {
            setReports(reps);
        });

        return () => unsubscribe();
    }, [teamId, filterDateRange]);

    // Load week data for targets
    useEffect(() => {
        if (!teamId || !currentWeekInfo) return;
        
        getKpiTargets(teamId, currentWeekInfo.id).then(setWeekTargets).catch(console.error);

        const unsubscribeWeek = listenKpiReports(teamId, currentWeekInfo.start, currentWeekInfo.end, (reps) => {
            setWeekReports(reps);
        });

        return () => unsubscribeWeek();
    }, [teamId, currentWeekInfo]);

    // My own display name (for filtering when user only sees themselves)
    const myDisplayName = display_name || user?.email || '';
    const myNormalized = normalizeName(myDisplayName);

    // Which KPI users to show rows for
    const { viewable_kpi_teams, kpi_team: myKpiTeam } = useDashboard();

    const visibleUsers = useMemo(() => {
        let baseUsers = [];
        if (canViewAll) {
            baseUsers = kpiUsers;
        } else {
            baseUsers = kpiUsers.filter(u => user?.uid === u.id);
        }

        if (selectedTeam === 'all') {
            if (role === 'owner') return baseUsers;
            if (can_view_leaderboard) {
                const allowedTeams = viewable_kpi_teams || [];
                return baseUsers.filter(u => allowedTeams.includes(u.kpi_team || '') || user?.uid === u.id);
            }
            return baseUsers;
        } else {
            return baseUsers.filter(u => u.kpi_team === selectedTeam);
        }
    }, [canViewAll, kpiUsers, user?.uid, selectedTeam, role, can_view_leaderboard, viewable_kpi_teams]);

    const availableTeamOptions = useMemo(() => {
        if (role === 'owner') return globalKpiTeams;
        if (can_view_leaderboard) return viewable_kpi_teams || [];
        return [];
    }, [role, globalKpiTeams, can_view_leaderboard, viewable_kpi_teams]);

    // Auto-select single team if only 1 is available
    useEffect(() => {
        if (availableTeamOptions.length === 1 && selectedTeam === 'all') {
            setSelectedTeam(availableTeamOptions[0]);
        }
    }, [availableTeamOptions, selectedTeam]);

    // Date list (newest first)
    const dateList = useMemo(
        () => getDateRange(filterDateRange.from, filterDateRange.to),
        [filterDateRange]
    );

    // Existing reports indexed by "dateStr_normalizedName"
    const reportMap = useMemo(() => {
        const map: Record<string, KpiReport> = {};
        for (const r of reports) {
            const dateStr = r.date.split('T')[0];
            const key = `${dateStr}_${normalizeName(r.sellerName)}`;
            map[key] = r;
        }
        return map;
    }, [reports]);

    // Build flat row list: date × kpiUser (newest date first)
    const rows = useMemo((): ReportRow[] => {
        const result: ReportRow[] = [];
        for (const dateStr of dateList) {
            for (const u of visibleUsers) {
                const displayName = u.display_name || u.email;
                const normalizedName = normalizeName(displayName);
                const rowKey = `${dateStr}_${normalizedName}`;
                const docId = `report_${dateStr}_${normalizedName}`;
                const existing = reportMap[rowKey] || reportMap[`${dateStr}_${normalizeName(u.email)}`];

                const placeholder: KpiReport = {
                    id: docId,
                    date: `${dateStr}T00:00:00.000Z`,
                    timestamp: new Date(dateStr).getTime(),
                    sellerName: displayName,
                    ideas: [],
                    mockup: 0, listing: 0, fulfill: 0,
                    revenue: 0, baseCost: 0, grossProfit: 0, profitMargin: 0,
                    note: '',
                };

                result.push({
                    rowKey,
                    docId,
                    dateStr,
                    kpiUser: u,
                    displayName,
                    uEmail: u.email,
                    report: existing || placeholder,
                    isPlaceholder: !existing,
                });
            }
        }
        return result;
    }, [dateList, visibleUsers, reportMap]);

    // Calculate weekly sums per user to display remaining KPIs
    const userWeeklySums = useMemo(() => {
        const sums: Record<string, { ideas: number; mockup: number; listing: number; fulfill: number; revenue: number }> = {};
        for (const u of kpiUsers) {
             const key = normalizeName(u.display_name || u.email);
             sums[key] = { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0 };
        }
        for (const r of weekReports) {
             const normalized = normalizeName(r.sellerName);
             if (!sums[normalized]) {
                 sums[normalized] = { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0 };
             }
             sums[normalized].ideas += r.ideas.reduce((s, i) => s + i.count, 0);
             sums[normalized].mockup += r.mockup || 0;
             sums[normalized].listing += r.listing || 0;
             sums[normalized].fulfill += r.fulfill || 0;
             sums[normalized].revenue += r.revenue || 0;
        }
        return sums;
    }, [weekReports, kpiUsers]);

    // Real-time revenue per (dateStr, allowedAccounts-set)
    const revenueByUserDate = useMemo(() => {
        // Build lookup: normalizedName → Set of allowedAccounts
        const userAccountMap = new Map<string, Set<string> | null | 'NONE'>();
        for (const u of kpiUsers) {
            const key = normalizeName(u.display_name || u.email);
            userAccountMap.set(key, getKpiAccountFilter(u, allowedAccounts, viewerHasFullAccountAccess));
        }

        const result: Record<string, { revenue: number; baseCost: number; refund: number }> = {};
        for (const r of records) {
            if (r.kind !== 'order') continue;
            const dateStr = formatDateEfficiently(r.dt_local, timeZone);

            for (const [normName, accountFilter] of userAccountMap) {
                if (accountFilter === 'NONE') continue;
                if (accountFilter && !accountFilter.has(r.account)) continue;
                const key = `${dateStr}_${normName}`;
                if (!result[key]) result[key] = { revenue: 0, baseCost: 0, refund: 0 };
                
                let isRefund = false;
                let refAmt = 0;
                if (r.source === 'Etsy_Refunded' || r.status === 'Refunded') {
                    isRefund = true;
                    refAmt = r.refund_details?.total_refund_amount || r.refund_details?.refundAmount || 0;
                }
                
                result[key].revenue += r.amount || 0;
                result[key].baseCost += r.cost_total || 0;
                if (isRefund && refAmt > 0) {
                    result[key].refund += refAmt;
                }
            }
        }
        return result;
    }, [allowedAccounts, records, kpiUsers, viewerHasFullAccountAccess]);

    // Enrich rows with live revenue
    const enrichedRows = useMemo(() => rows.map(row => {
        const liveKey = `${row.dateStr}_${normalizeName(row.displayName)}`;
        const accountFilter = getKpiAccountFilter(row.kpiUser, allowedAccounts, viewerHasFullAccountAccess);
        const hasShops = accountFilter !== 'NONE';
        
        let finalRevenue = row.report.revenue || 0;
        let finalBaseCost = row.report.baseCost || 0;
        let finalRefund = row.report.refund || 0;
        
        if (hasShops) {
            const live = revenueByUserDate[liveKey] || { revenue: 0, baseCost: 0, refund: 0 };
            finalRevenue = live.revenue;
            finalBaseCost = live.baseCost;
            finalRefund = live.refund;
        } else {
            finalRevenue = 0;
            finalBaseCost = 0;
            finalRefund = 0;
        }

        const netRevenue = finalRevenue - finalRefund;
        const grossProfit = netRevenue - finalBaseCost;
        const profitMargin = netRevenue > 0 ? (grossProfit / netRevenue) * 100 : 0;
        return { ...row, report: { ...row.report, revenue: netRevenue, baseCost: finalBaseCost, refund: finalRefund, grossProfit, profitMargin }, hasShops };
    }), [allowedAccounts, revenueByUserDate, rows, viewerHasFullAccountAccess]);

    // Summary By Team
    const summaryByTeam = useMemo(() => {
        const init = () => ({ ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0, baseCost: 0, grossProfit: 0 });
        const teamsData: Record<string, ReturnType<typeof init>> = {};

        for (const row of enrichedRows) {
            const teamName = row.kpiUser.kpi_team || 'No Team';
            if (!teamsData[teamName]) {
                teamsData[teamName] = init();
            }
            const r = row.report;
            teamsData[teamName].ideas += r.ideas.reduce((s, i) => s + i.count, 0);
            teamsData[teamName].mockup += r.mockup;
            teamsData[teamName].listing += r.listing;
            teamsData[teamName].fulfill += r.fulfill;
            teamsData[teamName].revenue += r.revenue;
            teamsData[teamName].baseCost += r.baseCost;
            teamsData[teamName].grossProfit += r.grossProfit;
            // Accumulate refund for team level if we want, but it's not displayed there currently.
        }
        return teamsData;
    }, [enrichedRows]);

    // Summary (totals across all visible rows)
    const summary = useMemo(() => {
        const init = { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0, baseCost: 0, grossProfit: 0 };
        return enrichedRows.reduce((acc, { report: r }) => ({
            ideas: acc.ideas + r.ideas.reduce((s, i) => s + i.count, 0),
            mockup: acc.mockup + r.mockup,
            listing: acc.listing + r.listing,
            fulfill: acc.fulfill + r.fulfill,
            revenue: acc.revenue + r.revenue,
            baseCost: acc.baseCost + r.baseCost,
            grossProfit: acc.grossProfit + r.grossProfit,
        }), init);
    }, [enrichedRows]);

    const profitMarginTotal = summary.revenue > 0 ? (summary.grossProfit / summary.revenue) * 100 : 0;

    // Inline field update (handled realtime by snapshot, no need to update local state manually)
    const handleFieldUpdate = (reportId: string, field: string, newValue: any) => {
        // Realtime listener will automatically update reports state
    };

    const handleExport = () => {
        const data = enrichedRows.map(({ report: r, displayName }) => ({
            Date: r.date.split('T')[0],
            Seller: displayName,
            Ideas: r.ideas.map(i => `${i.count} ${i.type}`).join(', '),
            Mockup: r.mockup, Listing: r.listing, Fulfill: r.fulfill,
            'Revenue ($)': r.revenue.toFixed(2),
            'Base Cost ($)': r.baseCost.toFixed(2),
            'Gross Profit ($)': r.grossProfit.toFixed(2),
            'Tỉ lệ LN (%)': r.profitMargin.toFixed(1),
            Note: r.note || ''
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'KPI Report');
        XLSX.writeFile(wb, `KPI_${filterDateRange.from}_${filterDateRange.to}.xlsx`);
    };

    useEffect(() => {
        if (exportTrigger && exportTrigger > 0) {
            handleExport();
        }
    }, [exportTrigger]);

    
    
    const renderTable = (rowsData: typeof enrichedRows) => (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                                {canViewAll && <th className="p-3 font-semibold w-[12%]">Seller</th>}
                                <th className="p-3 font-semibold w-[8%]">Ideas</th>
                                <th className="p-3 font-semibold text-center w-[8%]">Mockup</th>
                                <th className="p-3 font-semibold text-center w-[8%]">Listing</th>
                                <th className="p-3 font-semibold text-center w-[8%]">Fulfill</th>
                                <th className="p-3 font-semibold text-right w-[10%]">Revenue</th>
                                <th className="p-3 font-semibold text-right w-[10%]">Base Cost</th>
                                <th className="p-3 font-semibold text-right w-[10%]">Gross Profit</th>
                                <th className="p-3 font-semibold text-right w-[8%]">Tỉ lệ LN</th>
                                <th className="p-3 font-semibold w-[18%]">Note</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm">
                            {loading ? (
                                <tr><td colSpan={canViewAll ? 10 : 9} className="p-10 text-center"><Spinner size="md" /></td></tr>
                            ) : rowsData.length === 0 ? (
                                <tr><td colSpan={canViewAll ? 10 : 9} className="p-10 text-center text-gray-500">
                                    Không có thành viên KPI nào. Hãy bật <b>Tham gia KPI</b> trong User Management.
                                </td></tr>
                            ) : (() => {
                                // Group rows by date
                                const groups: { dateStr: string; rows: typeof enrichedRows }[] = [];
                                for (const row of rowsData) {
                                    const last = groups[groups.length - 1];
                                    if (last && last.dateStr === row.dateStr) {
                                        last.rows.push(row);
                                    } else {
                                        groups.push({ dateStr: row.dateStr, rows: [row] });
                                    }
                                }

                                return groups.map(({ dateStr, rows: groupRows }) => {
                                    // Subtotals for this date group
                                    const dateRevenue = groupRows.reduce((s, r) => s + r.report.revenue, 0);
                                    const dateGrossProfit = groupRows.reduce((s, r) => s + r.report.grossProfit, 0);
                                    const dateMockup = groupRows.reduce((s, r) => s + r.report.mockup, 0);
                                    const dateListing = groupRows.reduce((s, r) => s + r.report.listing, 0);
                                    const dateFulfill = groupRows.reduce((s, r) => s + r.report.fulfill, 0);
                                    const dateIdeas = groupRows.reduce((s, r) => s + r.report.ideas.reduce((si, i) => si + i.count, 0), 0);
                                    const dateMargin = dateRevenue > 0 ? (dateGrossProfit / dateRevenue) * 100 : 0;

                                    // Format date nicely
                                    const d = new Date(dateStr + 'T00:00:00');
                                    const dayLabel = d.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

                                    return (
                                        <React.Fragment key={dateStr}>
                                            {/* ── Date Group Header ── */}
                                            <tr className="bg-blue-50 dark:bg-gray-700 border-t-2 border-blue-200 dark:border-blue-800">
                                                <td colSpan={canViewAll ? 10 : 9} className="px-4 py-2">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-3">
                                                            <span className="font-bold text-blue-900 dark:text-blue-100 text-sm">{dayLabel}</span>
                                                        </div>
                                                        {/* Date sub-totals */}
                                                        <div className="flex items-center gap-5 text-xs text-blue-800 dark:text-blue-200">
                                                            {dateIdeas > 0 && <span>{dateIdeas} ideas</span>}
                                                            {dateMockup > 0 && <span>{dateMockup} mockup</span>}
                                                            {dateListing > 0 && <span>{dateListing} listing</span>}
                                                            {dateFulfill > 0 && <span>{dateFulfill} fulfill</span>}
                                                            {dateRevenue > 0 && (
                                                                <span className="font-bold text-green-700 dark:text-green-300">
                                                                    ${dateRevenue.toFixed(2)}
                                                                    <span className="font-normal text-blue-700 dark:text-blue-300 ml-1">({dateMargin.toFixed(1)}%)</span>
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                            {/* ── Rows for this date ── */}
                                            {groupRows.map((row) => {
                                                const { report: r, rowKey, docId, displayName, uEmail, isPlaceholder } = row;
                                                const totalIdeas = r.ideas.reduce((acc, i) => acc + i.count, 0);
                                                const baseData: Partial<KpiReport> = {
                                                    date: r.date,
                                                    timestamp: r.timestamp,
                                                    sellerName: displayName,
                                                    ideas: r.ideas,
                                                    mockup: r.mockup,
                                                    listing: r.listing,
                                                    fulfill: r.fulfill,
                                                    note: r.note || '',
                                                };
                                                
                                                // Check if user is allowed to edit this row
                                                const isOwnerOrLeader = role === 'owner' || can_view_leaderboard;
                                                const isRowEditable = !!(user?.uid && (row.kpiUser?.id === user.uid || isOwnerOrLeader));

                                                const normalizedName = normalizeName(displayName);
                                                const weeklySum = userWeeklySums[normalizedName] || { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0 };
                                                // KPI Target is mapped by normalizedName in getKpiTargets
                                                const target = weekTargets[normalizedName];
                                                
                                                const getRemainingText = (field: 'ideas' | 'mockup' | 'listing' | 'fulfill') => {
                                                    if (!target) return undefined;
                                                    let targetValue = 0;
                                                    if (field === 'ideas') targetValue = target.targetIdeas;
                                                    else if (field === 'mockup') targetValue = target.targetMockup;
                                                    else if (field === 'listing') targetValue = target.targetListing;
                                                    else if (field === 'fulfill') targetValue = target.targetFulfill;

                                                    if (!targetValue || targetValue <= 0) return undefined;

                                                    const sum = weeklySum[field];
                                                    const rem = targetValue - sum;
                                                    if (rem <= 0) return 'Done';
                                                    return `Left: ${rem}`;
                                                };

                                                return (
                                                    <React.Fragment key={rowKey}>
                                                        <tr className={`border-t border-gray-100 dark:border-gray-700 hover:bg-blue-50/40 dark:hover:bg-gray-600/40 transition-colors ${isPlaceholder ? 'opacity-50' : ''}`}>
                                                            {/* Seller */}
                                                            {canViewAll && (
                                                                <td className="p-3 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap pl-6">
                                                                    {displayName}
                                                                </td>
                                                            )}
                                                            {/* Ideas */}
                                                            <td className="p-3 bg-yellow-50/40 dark:bg-yellow-900/10 border-r border-gray-100 dark:border-gray-800">
                                                                <div className="flex items-center gap-1.5">
                                                                    <button
                                                                        onClick={() => totalIdeas > 0 && setExpandedRows(prev => ({ ...prev, [rowKey]: !prev[rowKey] }))}
                                                                        className={`flex flex-col items-start transition-colors cursor-pointer`}
                                                                    >
                                                                        <div className={`flex items-center gap-1 font-medium ${totalIdeas > 0 ? 'text-blue-600 dark:text-blue-400 hover:text-blue-800' : 'text-gray-400 dark:text-gray-600 cursor-default'}`}>
                                                                            <span>{totalIdeas}</span>
                                                                            {totalIdeas > 0 && <ChevronDownIcon className={`w-3.5 h-3.5 transition-transform ${expandedRows[rowKey] ? 'rotate-180' : ''}`} />}
                                                                        </div>
                                                                        {getRemainingText('ideas') && (
                                                                            <span className="text-[10px] text-gray-500 font-normal leading-tight mt-0.5 whitespace-nowrap">{getRemainingText('ideas')}</span>
                                                                        )}
                                                                    </button>
                                                                    {isRowEditable && (
                                                                        <button onClick={() => setIdeasPopupFor({ row })}
                                                                            className="text-gray-400 hover:text-blue-500 transition-colors ml-1" title="Sửa Ideas">
                                                                            <PencilIcon className="w-3.5 h-3.5" />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            {/* Editable: Mockup, Listing, Fulfill */}
                                                            <td className={`p-2 text-center bg-yellow-50/40 dark:bg-yellow-900/10 border-r border-gray-100 dark:border-gray-800`}>
                                                                <EditableNumberCell isEditable={isRowEditable} value={r.mockup} reportId={docId} field="mockup" teamId={teamId} baseData={isPlaceholder ? baseData : undefined} onUpdate={handleFieldUpdate} remainingText={getRemainingText('mockup')} textClassName="text-sm text-center" />
                                                            </td>
                                                            <td className={`p-2 text-center bg-yellow-50/40 dark:bg-yellow-900/10 border-r border-gray-100 dark:border-gray-800`}>
                                                                <EditableNumberCell isEditable={isRowEditable} value={r.listing} reportId={docId} field="listing" teamId={teamId} baseData={isPlaceholder ? baseData : undefined} onUpdate={handleFieldUpdate} remainingText={getRemainingText('listing')} textClassName="text-sm text-center" />
                                                            </td>
                                                            <td className={`p-2 text-center bg-yellow-50/40 dark:bg-yellow-900/10 border-r border-gray-100 dark:border-gray-800`}>
                                                                <EditableNumberCell isEditable={isRowEditable} value={r.fulfill} reportId={docId} field="fulfill" teamId={teamId} baseData={isPlaceholder ? baseData : undefined} onUpdate={handleFieldUpdate} remainingText={getRemainingText('fulfill')} textClassName="text-sm text-center" />
                                                            </td>
                                                            {/* Revenue & BaseCost (Editable if !hasShops) */}
                                                            <td className={`p-2 align-middle bg-blue-50/40 dark:bg-blue-900/10 border-r border-gray-100 dark:border-gray-800 text-right`}>
                                                                {row.hasShops ? (
                                                                    r.revenue > 0 ? <span className="font-medium mr-1">${r.revenue.toFixed(2)}</span> : <span className="text-gray-400 dark:text-gray-600 mr-1">--</span>
                                                                ) : (
                                                                    <EditableNumberCell isEditable={isRowEditable} value={r.revenue} reportId={docId} field="revenue" teamId={teamId} baseData={isPlaceholder ? baseData : undefined} onUpdate={handleFieldUpdate} isCurrency={true} textClassName="font-medium text-right pr-1 block" />
                                                                )}
                                                            </td>
                                                            <td className={`p-2 align-middle text-orange-600 dark:text-orange-400 bg-blue-50/40 dark:bg-blue-900/10 border-r border-gray-100 dark:border-gray-800 text-right`}>
                                                                {row.hasShops ? (
                                                                    r.baseCost > 0 ? <span className="mr-1">${r.baseCost.toFixed(2)}</span> : <span className="text-gray-400 dark:text-gray-600 mr-1">--</span>
                                                                ) : (
                                                                    <EditableNumberCell isEditable={isRowEditable} value={r.baseCost} reportId={docId} field="baseCost" teamId={teamId} baseData={isPlaceholder ? baseData : undefined} onUpdate={handleFieldUpdate} isCurrency={true} textClassName="text-right pr-1 block" />
                                                                )}
                                                            </td>
                                                            <td className={`p-3 text-right font-medium whitespace-nowrap bg-blue-50/40 dark:bg-blue-900/10 border-r border-gray-100 dark:border-gray-800 ${r.grossProfit > 0 ? 'text-green-600 dark:text-green-400' : r.grossProfit < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                                                                {(r.revenue > 0 || r.baseCost > 0) ? `$${r.grossProfit.toFixed(2)}` : <span className="text-gray-400 dark:text-gray-600">--</span>}
                                                            </td>
                                                            <td className="p-3 text-right text-blue-600 dark:text-blue-400 font-medium whitespace-nowrap bg-blue-50/40 dark:bg-blue-900/10 border-r border-gray-100 dark:border-gray-800">
                                                                {r.revenue > 0 ? `${r.profitMargin.toFixed(1)}%` : <span className="text-gray-400 dark:text-gray-600">--</span>}
                                                            </td>
                                                            <td className="p-2 bg-yellow-50/40 dark:bg-yellow-900/10">
                                                                <EditableNoteCell isEditable={isRowEditable} value={r.note} reportId={docId} teamId={teamId} baseData={isPlaceholder ? baseData : undefined} onUpdate={handleFieldUpdate} />
                                                            </td>
                                                        </tr>
                                                        {/* Expanded Ideas detail */}
                                                        {expandedRows[rowKey] && totalIdeas > 0 && (
                                                            <tr className="bg-blue-50/40 dark:bg-blue-900/10">
                                                                <td colSpan={canViewAll ? 11 : 10} className="px-8 py-3 border-t border-gray-100 dark:border-gray-800">
                                                                    <div className="flex items-center justify-between mb-1.5">
                                                                        <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Ideas{canViewAll ? ` — ${displayName}` : ''}</span>
                                                                        {isRowEditable && (
                                                                            <button onClick={() => setIdeasPopupFor({ row })} className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400">
                                                                                <PencilIcon className="w-3 h-3" /> Sửa
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                                                                        {r.ideas.map((i, iIdx) => (
                                                                            <div key={iIdx} className="flex items-center gap-2 text-sm">
                                                                                <span className="font-bold text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900/50 px-1.5 py-0.5 rounded-md text-xs min-w-[1.5rem] text-center">{i.count}</span>
                                                                                <span className="text-gray-700 dark:text-gray-300 truncate">{i.type}</span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                });
                            })()}
                        </tbody>
                    </table>
                </div>
            </div>
    );


    return (
        <div className="space-y-5">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-3">
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {filterDateRange.from === filterDateRange.to
                            ? `Date: ${filterDateRange.from}`
                            : `${filterDateRange.from} → ${filterDateRange.to}`}
                    </div>
                    {canViewAll && kpiUsers.length > 0 && (
                        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
                            {visibleUsers.length} employees
                        </span>
                    )}
                </div>
            </div>

            {/* Tabs */}
            {canViewAll && availableTeamOptions.length > 0 && (
                <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700 mb-4 pb-1 gap-2">
                    {availableTeamOptions.length > 1 && (
                        <button
                            onClick={() => setSelectedTeam('all')}
                            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${selectedTeam === 'all' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                        >
                            All
                        </button>
                    )}
                    {availableTeamOptions.map(t => (
                        <button
                            key={t}
                            onClick={() => setSelectedTeam(t)}
                            className={`px-4 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${selectedTeam === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            )}

            {/* Render Sections */}
            {selectedTeam === 'all' && canViewAll ? (
                <div className="space-y-8">
                    {Object.keys(summaryByTeam).length === 0 && renderTable([])}
                    {Object.entries(summaryByTeam).map(([teamName, teamSummary]) => {
                        const teamMargin = teamSummary.revenue > 0 ? (teamSummary.grossProfit / teamSummary.revenue) * 100 : 0;
                        const teamRows = enrichedRows.filter(r => (r.kpiUser.kpi_team || 'No Team') === teamName);
                        
                        return (
                            <div key={teamName} className="space-y-3">
                                <div className="bg-gray-50 dark:bg-gray-800/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700/50">
                                    <h4 className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Team: {teamName}</h4>
                                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                                        {[
                                            { title: 'Total Ideas', value: teamSummary.ideas },
                                            { title: 'Mockups', value: teamSummary.mockup },
                                            { title: 'Listings', value: teamSummary.listing },
                                            { title: 'Fulfill', value: teamSummary.fulfill },
                                            { title: 'Revenue', value: `$${teamSummary.revenue.toFixed(2)}` },
                                            { title: 'Base Cost', value: `$${teamSummary.baseCost.toFixed(2)}` },
                                            { title: 'Gross Profit', value: `$${teamSummary.grossProfit.toFixed(2)}`, isPositive: teamSummary.grossProfit >= 0 },
                                            { title: 'Tỉ lệ LN', value: `${teamMargin.toFixed(1)}%`, isPositive: teamMargin >= 0 },
                                        ].map(c => <StatCard key={c.title} {...c} />)}
                                    </div>
                                </div>
                                {renderTable(teamRows)}
                            </div>
                        );
                    })}

                    {Object.keys(summaryByTeam).length > 1 && (
                        <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700 mt-8">
                            <h4 className="text-sm font-bold mb-2 text-gray-800 dark:text-gray-200">Grand Total</h4>
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                                {[
                                    { title: 'Total Ideas', value: summary.ideas },
                                    { title: 'Mockups', value: summary.mockup },
                                    { title: 'Listings', value: summary.listing },
                                    { title: 'Fulfill', value: summary.fulfill },
                                    { title: 'Revenue', value: `$${summary.revenue.toFixed(2)}` },
                                    { title: 'Base Cost', value: `$${summary.baseCost.toFixed(2)}` },
                                    { title: 'Gross Profit', value: `$${summary.grossProfit.toFixed(2)}`, isPositive: summary.grossProfit >= 0 },
                                    { title: 'Tỉ lệ LN', value: `${profitMarginTotal.toFixed(1)}%`, isPositive: profitMarginTotal >= 0 },
                                ].map(c => <StatCard key={c.title} {...c} />)}
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-gray-200 dark:border-gray-700">
                        <h4 className="text-sm font-bold mb-2 text-gray-800 dark:text-gray-200">
                            {selectedTeam === 'all' ? 'Total Summary' : `Team: ${selectedTeam}`}
                        </h4>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
                            {[
                                { title: 'Total Ideas', value: summary.ideas },
                                { title: 'Mockups', value: summary.mockup },
                                { title: 'Listings', value: summary.listing },
                                { title: 'Fulfill', value: summary.fulfill },
                                { title: 'Revenue', value: `$${summary.revenue.toFixed(2)}` },
                                { title: 'Base Cost', value: `$${summary.baseCost.toFixed(2)}` },
                                { title: 'Gross Profit', value: `$${summary.grossProfit.toFixed(2)}`, isPositive: summary.grossProfit >= 0 },
                                { title: 'Tỉ lệ LN', value: `${profitMarginTotal.toFixed(1)}%`, isPositive: profitMarginTotal >= 0 },
                            ].map(c => <StatCard key={c.title} {...c} />)}
                        </div>
                    </div>
                    {renderTable(enrichedRows)}
                </div>
            )}

            {/* Ideas Popup */}
            {ideasPopupFor && (
                <IdeasPopup
                    ideas={ideasPopupFor.row.report.ideas}
                    reportId={ideasPopupFor.row.docId}
                    teamId={teamId}
                    baseData={{
                        date: ideasPopupFor.row.report.date,
                        timestamp: ideasPopupFor.row.report.timestamp,
                        sellerName: ideasPopupFor.row.displayName,
                        mockup: ideasPopupFor.row.report.mockup,
                        listing: ideasPopupFor.row.report.listing,
                        fulfill: ideasPopupFor.row.report.fulfill,
                        note: ideasPopupFor.row.report.note || '',
                    }}
                    onUpdate={handleFieldUpdate}
                    onClose={() => setIdeasPopupFor(null)}
                />
            )}
        </div>
    );
};

const StatCard = ({ title, value, isPositive }: { title: string; value: string | number; isPositive?: boolean }) => (
    <div className="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-200 dark:border-gray-700 flex flex-col shadow-sm">
        <p className="text-xs text-gray-500 dark:text-gray-400 font-medium mb-1 truncate">{title}</p>
        <p className={`text-lg font-bold ${isPositive === true ? 'text-green-600 dark:text-green-400' : isPositive === false ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
            {value}
        </p>
    </div>
);

export default KpiPersonalReport;
