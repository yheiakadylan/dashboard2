import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { KpiReport, Record as DashboardRecord } from '../types';
import { getKpiReports, getKpiTargets, saveKpiTarget, getKpiUserProfiles, KpiUserProfile, listenKpiReports, ExtendedKpiTarget } from '../services/kpiService';
import { getRecordsForDateRange, listenForSettings } from '../services/firebaseService';
import * as XLSX from 'xlsx';
import { ArrowDownTrayIcon, TrophyIcon, FireIcon, ArrowTrendingUpIcon, StarIcon, LightBulbIcon, InformationCircleIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import { useUI } from '../contexts/UIContext';
import { useDashboard } from '../contexts/DashboardContext';

interface KpiLeaderboardProps {
    teamId: string;
    exportTrigger?: number;
}

interface WeekData {
    ideas: number;
    mockup: number;
    listing: number;
    fulfill: number;
    revenue: number;
}

interface LeaderboardEntry {
    normalizedName: string;
    sellerName: string;
    current: WeekData;
    prev: WeekData;
    targets: {
        revenue: number;
        ideas: number;
        mockup: number;
        listing: number;
        fulfill: number;
    };
    note: string;
    score: number;
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

type EditingField = 'target' | 'targetIdeas' | 'targetMockup' | 'targetListing' | 'targetFulfill' | 'note';

const KpiLeaderboard: React.FC<KpiLeaderboardProps> = ({ teamId, exportTrigger }) => {
    const { filterDateRange, timeZone } = useUI();
    const { records, user, role, can_view_leaderboard, viewable_kpi_teams } = useDashboard();
    const [loading, setLoading] = useState(false);
    const [selectedTeam, setSelectedTeam] = useState<string>('all');
    const [globalKpiTeams, setGlobalKpiTeams] = useState<string[]>([]);
    const canViewAll = role === 'owner' || !!can_view_leaderboard;
    const [kpiUsers, setKpiUsers] = useState<KpiUserProfile[]>([]);
    const [currentReports, setCurrentReports] = useState<KpiReport[]>([]);
    const [prevReports, setPrevReports] = useState<KpiReport[]>([]);
    const [targets, setTargets] = useState<Record<string, ExtendedKpiTarget>>({});
    const [editingCell, setEditingCell] = useState<{normalizedName: string, field: EditingField} | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [fetchedWeekRecords, setFetchedWeekRecords] = useState<DashboardRecord[]>([]);
    const [noteLang, setNoteLang] = useState<'en' | 'vi'>('en');
    const [viewingIdeasFor, setViewingIdeasFor] = useState<{ normalizedName: string, sellerName: string } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen().catch(err => {
                console.error(`Error attempting to enable fullscreen: ${err.message}`);
            });
        } else {
            document.exitFullscreen();
        }
    };

    const currentRange = useMemo(() => getWeekRange(filterDateRange.from, 0), [filterDateRange.from]);
    const prevRange = useMemo(() => getWeekRange(filterDateRange.from, -1), [filterDateRange.from]);
    const currentWeekId = useMemo(() => getWeekId(currentRange.start), [currentRange]);

    // Fetch static data and setup real-time listeners
    useEffect(() => {
        if (!teamId) return;
        
        setLoading(true);
        Promise.all([
            getKpiUserProfiles(teamId),
            getKpiTargets(teamId, currentWeekId),
            getRecordsForDateRange(teamId, prevRange.start, currentRange.end, timeZone)
        ]).then(([fetchedKpiUsers, targetData, fetchedRecords]) => {
            setKpiUsers(fetchedKpiUsers);
            setTargets(targetData);
            setFetchedWeekRecords(fetchedRecords);
        }).catch(err => console.error(err))
        .finally(() => setLoading(false));

        const unsubCurrent = listenKpiReports(teamId, currentRange.start, currentRange.end, setCurrentReports);
        
        const unsubSettings = listenForSettings(teamId, (settings) => {
            setGlobalKpiTeams(settings.kpiTeams || []);
        });
        const unsubPrev = listenKpiReports(teamId, prevRange.start, prevRange.end, setPrevReports);

        return () => {
            unsubCurrent();
            unsubPrev();
            unsubSettings();
        };
    }, [teamId, currentRange, prevRange, currentWeekId, timeZone]);

    
    const availableTeamOptions = useMemo(() => {
        if (role === 'owner') return globalKpiTeams;
        if (can_view_leaderboard) return viewable_kpi_teams || [];
        return [];
    }, [role, globalKpiTeams, can_view_leaderboard, viewable_kpi_teams]);

    useEffect(() => {
        if (availableTeamOptions.length === 1 && selectedTeam === 'all') {
            setSelectedTeam(availableTeamOptions[0]);
        }
    }, [availableTeamOptions, selectedTeam]);

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

    const isVisible = useCallback((normalizedName: string) => {
        return visibleUsers.some(u => {
            const displayMatch = (u.display_name || '').toLowerCase().trim().replace(/\s+/g, '-') === normalizedName;
            const emailMatch = u.email.toLowerCase().trim().replace(/\s+/g, '-') === normalizedName;
            return displayMatch || emailMatch;
        });
    }, [visibleUsers]);

    const entries = useMemo(() => {
        const sellerMap: Record<string, LeaderboardEntry> = {};

        const initEntry = (displayName: string, normalizedName: string) => {
            if (!sellerMap[normalizedName]) {
                const t = targets[normalizedName] || { target: 0, targetIdeas: 0, targetMockup: 0, targetListing: 0, targetFulfill: 0, note: '' };
                sellerMap[normalizedName] = {
                    normalizedName,
                    sellerName: displayName,
                    current: { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0 },
                    prev: { ideas: 0, mockup: 0, listing: 0, fulfill: 0, revenue: 0 },
                    targets: {
                        revenue: t.target || 0,
                        ideas: t.targetIdeas || 0,
                        mockup: t.targetMockup || 0,
                        listing: t.targetListing || 0,
                        fulfill: t.targetFulfill || 0
                    },
                    note: t.note || '',
                    score: 0
                };
            }
        };

        // -- Step 1: Pre-populate from KPI users (is_kpi=true) so they ALWAYS appear --
        visibleUsers.forEach(u => {
            const displayName = u.display_name || u.email;
            const normalizedName = displayName.trim().toLowerCase().replace(/\s+/g, '-');
            initEntry(displayName, normalizedName);
        });
        
        // -- Step 2: Overlay data from current-week reports --
        currentReports.forEach(r => {

            const normalizedName = r.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
                        if (!isVisible(normalizedName)) return;
            initEntry(r.sellerName, normalizedName);
            sellerMap[normalizedName].current.ideas += r.ideas.reduce((sum, i) => sum + i.count, 0);
            sellerMap[normalizedName].current.mockup += r.mockup || 0;
            sellerMap[normalizedName].current.listing += r.listing || 0;
            sellerMap[normalizedName].current.fulfill += r.fulfill || 0;
            sellerMap[normalizedName].current.revenue += r.revenue || 0;
        });

        // -- Step 3: Overlay previous-week reports --
        prevReports.forEach(r => {

            const normalizedName = r.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
                        if (!isVisible(normalizedName)) return;
            initEntry(r.sellerName, normalizedName);
            sellerMap[normalizedName].prev.ideas += r.ideas.reduce((sum, i) => sum + i.count, 0);
            sellerMap[normalizedName].prev.mockup += r.mockup || 0;
            sellerMap[normalizedName].prev.listing += r.listing || 0;
            sellerMap[normalizedName].prev.fulfill += r.fulfill || 0;
            sellerMap[normalizedName].prev.revenue += r.revenue || 0;
        });

        return Object.values(sellerMap);
    }, [visibleUsers, targets, currentReports, prevReports, isVisible]);

    // --- Real-time Revenue from records per KPI user's allowedAccounts ---
    const allRecords = useMemo(() => {
        const map = new Map<string, DashboardRecord>();
        for (const r of fetchedWeekRecords) map.set(r.id, r);
        for (const r of records) map.set(r.id, r); // records from context (real-time) overrides or adds
        return Array.from(map.values());
    }, [fetchedWeekRecords, records]);

    const enrichedEntries = useMemo(() => {
        return entries.map(entry => {
            const kpiUser = kpiUsers.find(u => {
                const displayMatch = (u.display_name || '').toLowerCase().trim() === entry.sellerName.toLowerCase().trim();
                const emailMatch = u.email.toLowerCase().trim() === entry.sellerName.toLowerCase().trim();
                return displayMatch || emailMatch;
            });

            const allowedAccs = kpiUser?.allowedAccounts;
            let accountFilter: Set<string> | null | 'NONE' = null;
            if (!allowedAccs || allowedAccs.length === 0) {
                accountFilter = 'NONE';
            } else {
                accountFilter = new Set(allowedAccs);
            }

            let currentRev = 0;
            let prevRev = 0;
            
            if (accountFilter !== 'NONE') {
                for (const r of allRecords) {
                    if (r.kind !== 'order') continue;
                    if (accountFilter && !accountFilter.has(r.account)) continue;
                    const dateStr = r.dt_local.split('T')[0];
                    if (dateStr >= currentRange.start && dateStr <= currentRange.end) {
                        currentRev += r.amount || 0;
                    } else if (dateStr >= prevRange.start && dateStr <= prevRange.end) {
                        prevRev += r.amount || 0;
                    }
                }
            } else {
                currentRev = entry.current.revenue;
                prevRev = entry.prev.revenue;
            }

            const e = { ...entry };
            e.current.revenue = currentRev;
            e.prev.revenue = prevRev;
            e.sellerName = kpiUser?.display_name || entry.sellerName;

            let targetScores: number[] = [];
            if (e.targets.revenue > 0) targetScores.push(Math.min(100, (e.current.revenue / e.targets.revenue) * 100));
            if (e.targets.ideas > 0) targetScores.push(Math.min(100, (e.current.ideas / e.targets.ideas) * 100));
            if (e.targets.mockup > 0) targetScores.push(Math.min(100, (e.current.mockup / e.targets.mockup) * 100));
            if (e.targets.listing > 0) targetScores.push(Math.min(100, (e.current.listing / e.targets.listing) * 100));
            if (e.targets.fulfill > 0) targetScores.push(Math.min(100, (e.current.fulfill / e.targets.fulfill) * 100));
            
            if (targetScores.length > 0) {
                e.score = targetScores.reduce((a, b) => a + b, 0) / targetScores.length;
            } else {
                // Just fallback to 0 to encourage setting targets
                e.score = 0;
            }

            return e;
        }).sort((a, b) => b.score - a.score);
    }, [entries, kpiUsers, allRecords, currentRange, prevRange]);

    const handleCellDoubleClick = (normalizedName: string, field: EditingField, currentValue: any) => {
        setEditingCell({ normalizedName, field });
        setEditValue(String(currentValue || ''));
    };

    const handleCellBlur = async () => {
        if (!editingCell || !teamId) return;
        
        const { normalizedName, field } = editingCell;
        const entry = enrichedEntries.find(e => e.normalizedName === normalizedName);
        if (!entry) {
            setEditingCell(null);
            return;
        }

        let newNote = entry.note;
        let newTgtRev = entry.targets.revenue;
        let newTgtIdeas = entry.targets.ideas;
        let newTgtMockup = entry.targets.mockup;
        let newTgtListing = entry.targets.listing;
        let newTgtFulfill = entry.targets.fulfill;

        if (field === 'note') newNote = editValue;
        else if (field === 'target') newTgtRev = Number(editValue) || 0;
        else if (field === 'targetIdeas') newTgtIdeas = Number(editValue) || 0;
        else if (field === 'targetMockup') newTgtMockup = Number(editValue) || 0;
        else if (field === 'targetListing') newTgtListing = Number(editValue) || 0;
        else if (field === 'targetFulfill') newTgtFulfill = Number(editValue) || 0;

        // Optimistic UI update
        setTargets(prev => {
            const oldT = prev[normalizedName] || {};
            return {
                ...prev,
                [normalizedName]: { 
                    ...oldT,
                    target: newTgtRev, 
                    targetIdeas: newTgtIdeas,
                    targetMockup: newTgtMockup,
                    targetListing: newTgtListing,
                    targetFulfill: newTgtFulfill,
                    note: newNote 
                }
            };
        });
        setEditingCell(null);

        // Save to DB
        try {
            await saveKpiTarget(teamId, {
                sellerName: entry.sellerName,
                weekId: currentWeekId,
                targetRevenue: newTgtRev,
                targetIdeas: newTgtIdeas,
                targetMockup: newTgtMockup,
                targetListing: newTgtListing,
                targetFulfill: newTgtFulfill,
                note: newNote
            });
        } catch (err) {
            console.error('Failed to save target', err);
        }
    };

    const handleExport = () => {
        const exportData: any[] = [];
        
        enrichedEntries.forEach((r, idx) => {
            exportData.push({
                Rank: idx + 1,
                Seller: r.sellerName,
                Week: 'Current',
                'Ideas': r.current.ideas,
                'Ideas Target': r.targets.ideas,
                'Mockup': r.current.mockup,
                'Mockup Target': r.targets.mockup,
                'Listing': r.current.listing,
                'Listing Target': r.targets.listing,
                'Fulfill': r.current.fulfill,
                'Fulfill Target': r.targets.fulfill,
                'Revenue ($)': r.current.revenue,
                'Revenue Target ($)': r.targets.revenue,
                'Score': r.score.toFixed(1),
                'Note': r.note
            });
            exportData.push({
                Rank: '',
                Seller: '',
                Week: 'Previous',
                'Ideas': r.prev.ideas,
                'Ideas Target': '',
                'Mockup': r.prev.mockup,
                'Mockup Target': '',
                'Listing': r.prev.listing,
                'Listing Target': '',
                'Fulfill': r.prev.fulfill,
                'Fulfill Target': '',
                'Revenue ($)': r.prev.revenue,
                'Revenue Target ($)': '',
                'Score': '',
                'Note': ''
            });
        });

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leaderboard");
        XLSX.writeFile(wb, `Leaderboard_KPI_${currentRange.start}_${currentRange.end}.xlsx`);
    };

    useEffect(() => {
        if (exportTrigger && exportTrigger > 0) {
            handleExport();
        }
    }, [exportTrigger]);

    // Calculate totals
    const totals = useMemo(() => {
        return enrichedEntries.reduce((acc, curr) => ({
            currentRev: acc.currentRev + curr.current.revenue,
            prevRev: acc.prevRev + curr.prev.revenue,
            targetRev: acc.targetRev + curr.targets.revenue,
            currentIdeas: acc.currentIdeas + curr.current.ideas,
            prevIdeas: acc.prevIdeas + curr.prev.ideas,
            targetIdeas: acc.targetIdeas + curr.targets.ideas,
            currentMockup: acc.currentMockup + curr.current.mockup,
            prevMockup: acc.prevMockup + curr.prev.mockup,
            targetMockup: acc.targetMockup + curr.targets.mockup,
            currentListing: acc.currentListing + curr.current.listing,
            prevListing: acc.prevListing + curr.prev.listing,
            targetListing: acc.targetListing + curr.targets.listing,
            currentFulfill: acc.currentFulfill + curr.current.fulfill,
            prevFulfill: acc.prevFulfill + curr.prev.fulfill,
            targetFulfill: acc.targetFulfill + curr.targets.fulfill,
        }), { 
            currentRev: 0, prevRev: 0, targetRev: 0, 
            currentIdeas: 0, prevIdeas: 0, targetIdeas: 0, 
            currentMockup: 0, prevMockup: 0, targetMockup: 0, 
            currentListing: 0, prevListing: 0, targetListing: 0, 
            currentFulfill: 0, prevFulfill: 0, targetFulfill: 0 
        });
    }, [enrichedEntries]);

    // Achievements calculation
    const topGrowth = enrichedEntries.length > 0 ? [...enrichedEntries].sort((a,b) => {
        const aPct = a.prev.revenue > 0 ? (a.current.revenue - a.prev.revenue) / a.prev.revenue : (a.current.revenue > 0 ? 1 : 0);
        const bPct = b.prev.revenue > 0 ? (b.current.revenue - b.prev.revenue) / b.prev.revenue : (b.current.revenue > 0 ? 1 : 0);
        return bPct - aPct;
    })[0] : null;

    const topAbsGrowth = enrichedEntries.length > 0 ? [...enrichedEntries].sort((a,b) => {
        const aUsd = a.current.revenue - a.prev.revenue;
        const bUsd = b.current.revenue - b.prev.revenue;
        return bUsd - aUsd;
    })[0] : null;

    const topTarget = enrichedEntries.length > 0 ? [...enrichedEntries].sort((a,b) => {
        const aTgt = a.targets.revenue > 0 ? a.current.revenue / a.targets.revenue : 0;
        const bTgt = b.targets.revenue > 0 ? b.current.revenue / b.targets.revenue : 0;
        return bTgt - aTgt;
    })[0] : null;

    const topIdeas = enrichedEntries.length > 0 ? [...enrichedEntries].sort((a,b) => b.current.ideas - a.current.ideas)[0] : null;

    // Helper to render editable target cell
    
    const renderMetricCell = (
        achieved: number, 
        target: number, 
        normalizedName: string, 
        targetField: EditingField, 
        isCurrency: boolean = false,
        isIdeas: boolean = false,
        sellerName: string = ''
    ) => {
        let achievedColorClass = 'bg-blue-50 dark:bg-blue-900/30 text-gray-900 dark:text-gray-100 border-blue-200 dark:border-blue-800'; // Xanh nhạt
        let pctText = null;

        if (target > 0) {
            const pct = achieved / target;
            pctText = Math.round(pct * 100) + '%';
            if (pct >= 1) {
                achievedColorClass = 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 border-green-300 dark:border-green-700'; // Xanh lá
            } else if (pct >= 0.8) {
                achievedColorClass = 'bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-300 border-orange-300 dark:border-orange-700'; // Cam
            } else {
                achievedColorClass = 'bg-red-100 dark:bg-red-900/40 text-red-800 dark:text-red-300 border-red-300 dark:border-red-700'; // Đỏ
            }
        }

        const achievedDisplay = isCurrency ? `${achieved.toFixed(2)}` : achieved;

        return (
            <div className="flex flex-col items-center justify-center gap-1.5 h-full w-full">
                <div 
                    className={`px-2 py-1 rounded-lg w-full text-center font-bold text-base border shadow-sm flex flex-col justify-center items-center ${achievedColorClass} ${isIdeas ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
                    onClick={isIdeas ? () => setViewingIdeasFor({ normalizedName, sellerName }) : undefined}
                    title={isIdeas ? "Click để xem chi tiết Ideas" : undefined}
                >
                    <div className="leading-tight">{achievedDisplay}</div>
                    <div className={`text-[10px] font-semibold mt-0.5 tracking-wider leading-none ${pctText ? 'opacity-80' : 'opacity-0 select-none'}`}>
                        {pctText || '0%'}
                    </div>
                </div>
                <div className="w-full">
                    {renderTargetCell(normalizedName, targetField, target, isCurrency)}
                </div>
            </div>
        );
    };

    const renderTargetCell = (normalizedName: string, field: EditingField, value: number, isCurrency: boolean = false) => {
        const isEditing = editingCell?.normalizedName === normalizedName && editingCell?.field === field;
        return (
            <div 
                className={`text-xs font-semibold text-yellow-800 dark:text-yellow-400 mt-1 cursor-pointer bg-yellow-50 dark:bg-yellow-900/20 hover:bg-yellow-100 dark:hover:bg-yellow-900/40 rounded-md border border-yellow-300 dark:border-yellow-700 block w-full text-center shadow-sm transition-colors ${isEditing ? '' : 'px-1 py-1'}`}
                onClick={!isEditing ? () => handleCellDoubleClick(normalizedName, field, value) : undefined}
                title="Click to edit target"
            >
                {isEditing ? (
                    <input 
                        autoFocus
                        type="number" 
                        value={editValue} 
                        onChange={e => setEditValue(e.target.value)}
                        onBlur={handleCellBlur}
                        onKeyDown={e => e.key === 'Enter' && handleCellBlur()}
                        className="w-full px-1 text-center text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-500 rounded-md [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none leading-tight py-0.5"
                    />
                ) : (
                    <>KPI: {isCurrency ? '$' : ''}{value}</>
                )}
            </div>
        );
    };

    return (
        <div ref={containerRef} className={`space-y-6 ${isFullscreen ? 'p-6 bg-gray-50 dark:bg-gray-900 overflow-y-auto' : ''}`}>
            {/* Toolbar */}
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Showing week: <b>{currentRange.start}</b> to <b>{currentRange.end}</b>
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button 
                        onClick={toggleFullscreen}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                        title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
                    >
                        {isFullscreen ? <ArrowsPointingInIcon className="w-4 h-4" /> : <ArrowsPointingOutIcon className="w-4 h-4" />}
                        <span className="hidden sm:inline">{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
                    </button>
                </div>
            </div>

            
            {/* Tabs */}
            {canViewAll && availableTeamOptions.length > 0 && (
                <div className="flex overflow-x-auto border-b border-gray-200 dark:border-gray-700 pb-1 gap-2">
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

            {/* Achievements Highlight */}
            {!loading && enrichedEntries.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <AchievementCard 
                        icon={<FireIcon className="w-6 h-6 text-orange-500" />} 
                        title="Highest % Growth" 
                        seller={(topGrowth && (topGrowth.current.revenue > 0 || topGrowth.prev.revenue > 0) && (topGrowth.prev.revenue > 0 ? (topGrowth.current.revenue - topGrowth.prev.revenue)/topGrowth.prev.revenue : 1) > 0) ? topGrowth.sellerName : 'N/A'} 
                        sub={`${topGrowth ? (topGrowth.prev.revenue > 0 ? ((topGrowth.current.revenue - topGrowth.prev.revenue)/topGrowth.prev.revenue * 100).toFixed(1) : (topGrowth.current.revenue > 0 ? 100 : 0)) : 0}%`} 
                    />
                    <AchievementCard 
                        icon={<ArrowTrendingUpIcon className="w-6 h-6 text-green-500" />} 
                        title="Top Absolute Growth" 
                        seller={(topAbsGrowth && (topAbsGrowth.current.revenue - topAbsGrowth.prev.revenue) > 0) ? topAbsGrowth.sellerName : 'N/A'} 
                        sub={`+$${topAbsGrowth && (topAbsGrowth.current.revenue - topAbsGrowth.prev.revenue) > 0 ? (topAbsGrowth.current.revenue - topAbsGrowth.prev.revenue).toFixed(2) : '0.00'}`} 
                    />
                    <AchievementCard 
                        icon={<StarIcon className="w-6 h-6 text-yellow-500" />} 
                        title="Best Rev Target" 
                        seller={(topTarget && topTarget.targets.revenue > 0 && (topTarget.current.revenue / topTarget.targets.revenue) > 0) ? topTarget.sellerName : 'N/A'} 
                        sub={`${topTarget && topTarget.targets.revenue > 0 ? ((topTarget.current.revenue / topTarget.targets.revenue) * 100).toFixed(1) : 0}%`} 
                    />
                    <AchievementCard 
                        icon={<LightBulbIcon className="w-6 h-6 text-blue-500" />} 
                        title="Most Ideas" 
                        seller={(topIdeas && topIdeas.current.ideas > 0) ? topIdeas.sellerName : 'N/A'} 
                        sub={`${topIdeas ? topIdeas.current.ideas : 0} ideas`} 
                    />
                </div>
            )}

            {/* Leaderboard Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                                <th className="p-4 font-semibold w-[8%] text-center">Rank</th>
                                <th className="p-4 font-semibold w-[12%]">Seller</th>
                                <th className="p-4 font-semibold w-[10%]">Week</th>
                                <th className="p-4 font-semibold text-center w-[8%]">Ideas</th>
                                <th className="p-4 font-semibold text-center w-[8%]">Mockup</th>
                                <th className="p-4 font-semibold text-center w-[8%]">Listing</th>
                                <th className="p-4 font-semibold text-center w-[8%]">Fulfill</th>
                                <th className="p-4 font-semibold text-right w-[10%]">Revenue</th>
                                <th className="p-4 font-semibold text-right w-[8%]">Score</th>
                                <th className="p-4 font-semibold w-[20%]">Note</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center"><Spinner size="md" /></td>
                                </tr>
                            ) : enrichedEntries.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-gray-500">No data for this week.</td>
                                </tr>
                            ) : (
                                enrichedEntries.map((r, idx) => {
                                    const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
                                    
                                    return (
                                        <React.Fragment key={r.normalizedName}>
                                            {/* Current Week Row */}
                                            <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors bg-white dark:bg-gray-800">
                                                <td className="p-4 text-center font-bold text-lg border-b border-gray-100 dark:border-gray-800" rowSpan={2}>{rankIcon}</td>
                                                <td className="p-4 font-medium text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800" rowSpan={2}>{r.sellerName}</td>
                                                <td className="p-4 font-semibold text-blue-600 dark:text-blue-400">Current</td>
                                                
                                                <td className="p-3 text-center align-top">
                                                    {renderMetricCell(r.current.ideas, r.targets.ideas, r.normalizedName, 'targetIdeas', false, true, r.sellerName)}
                                                </td>
                                                <td className="p-3 text-center align-top">
                                                    {renderMetricCell(r.current.mockup, r.targets.mockup, r.normalizedName, 'targetMockup')}
                                                </td>
                                                <td className="p-3 text-center align-top">
                                                    {renderMetricCell(r.current.listing, r.targets.listing, r.normalizedName, 'targetListing')}
                                                </td>
                                                <td className="p-3 text-center align-top">
                                                    {renderMetricCell(r.current.fulfill, r.targets.fulfill, r.normalizedName, 'targetFulfill')}
                                                </td>
                                                <td className="p-3 text-right align-top">
                                                    {renderMetricCell(r.current.revenue, r.targets.revenue, r.normalizedName, 'target', true)}
                                                </td>
                                                
                                                <td className="p-4 text-center font-bold text-blue-700 dark:text-blue-300 text-xl border-b border-gray-100 dark:border-gray-800 bg-blue-50/50 dark:bg-blue-900/10 align-middle" rowSpan={2}>
                                                    <div className="bg-blue-100 dark:bg-blue-900/40 rounded-full py-2 px-3 border border-blue-200 dark:border-blue-700 shadow-sm">
                                                    {r.score.toFixed(1)}</div>
                                                </td>
                                                <td className="p-3 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800 align-top bg-yellow-50/50 dark:bg-yellow-900/10" rowSpan={2}>
                                                    <div 
                                                        className="relative w-full h-full min-h-[80px] flex items-stretch px-2 cursor-pointer hover:bg-yellow-100 dark:hover:bg-yellow-900/30 rounded-lg py-1 border border-transparent hover:border-yellow-300 dark:hover:border-yellow-700 transition-colors"
                                                        onClick={() => handleCellDoubleClick(r.normalizedName, 'note', r.note)}
                                                        title="Click to edit note"
                                                    >
                                                        {editingCell?.normalizedName === r.normalizedName && editingCell?.field === 'note' ? (
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
                                                                onBlur={handleCellBlur}
                                                                onKeyDown={e => e.key === 'Escape' && handleCellBlur()}
                                                                className="w-full flex-1 px-2 text-sm text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-500 rounded-md resize-none overflow-hidden break-words whitespace-pre-wrap min-h-[80px]"
                                                            />
                                                        ) : (
                                                            <div className="text-sm w-full whitespace-pre-wrap break-words min-h-[80px]">
                                                                {r.note || <span className="text-gray-400 dark:text-gray-600 border-b border-dashed">Add note...</span>}
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {/* Previous Week Row */}
                                            <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors bg-gray-50/50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700 text-xs">
                                                <td className="p-4 text-gray-500 dark:text-gray-400">Previous</td>
                                                <td className="p-4 text-center text-gray-500 dark:text-gray-400">{r.prev.ideas}</td>
                                                <td className="p-4 text-center text-gray-500 dark:text-gray-400">{r.prev.mockup}</td>
                                                <td className="p-4 text-center text-gray-500 dark:text-gray-400">{r.prev.listing}</td>
                                                <td className="p-4 text-center text-gray-500 dark:text-gray-400">{r.prev.fulfill}</td>
                                                <td className="p-4 text-right text-gray-500 dark:text-gray-400">${r.prev.revenue.toFixed(2)}</td>
                                            </tr>
                                        </React.Fragment>
                                    );
                                })
                            )}
                        </tbody>
                        {/* Summary Footer */}
                        {enrichedEntries.length > 0 && (
                            <tfoot className="bg-gray-900 text-white dark:bg-black dark:text-gray-100">
                                <tr>
                                    <td colSpan={2} className="p-4 font-bold text-right border-r border-gray-700" rowSpan={2}>TEAM TOTAL</td>
                                    <td className="p-4 font-bold text-blue-400">Current</td>
                                    <td className="p-4 text-center">
                                        <div className="font-bold">{totals.currentIdeas}</div>
                                        <div className="text-xs text-gray-400">KPI: {totals.targetIdeas}</div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="font-bold">{totals.currentMockup}</div>
                                        <div className="text-xs text-gray-400">KPI: {totals.targetMockup}</div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="font-bold">{totals.currentListing}</div>
                                        <div className="text-xs text-gray-400">KPI: {totals.targetListing}</div>
                                    </td>
                                    <td className="p-4 text-center">
                                        <div className="font-bold">{totals.currentFulfill}</div>
                                        <div className="text-xs text-gray-400">KPI: {totals.targetFulfill}</div>
                                    </td>
                                    <td className="p-4 text-right">
                                        <div className="font-bold">${totals.currentRev.toFixed(2)}</div>
                                        <div className="text-xs text-gray-400">KPI: ${totals.targetRev.toFixed(2)}</div>
                                    </td>
                                    <td colSpan={2} rowSpan={2} className="p-4"></td>
                                </tr>
                                <tr>
                                    <td className="p-4 text-gray-400">Previous</td>
                                    <td className="p-4 text-center text-gray-400">{totals.prevIdeas}</td>
                                    <td className="p-4 text-center text-gray-400">{totals.prevMockup}</td>
                                    <td className="p-4 text-center text-gray-400">{totals.prevListing}</td>
                                    <td className="p-4 text-center text-gray-400">{totals.prevFulfill}</td>
                                    <td className="p-4 text-right text-gray-400">${totals.prevRev.toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
            
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                * Click on <b>KPI Target</b> or <b>Note</b> to edit. Press Enter or click outside to save.
            </div>

            {/* Explanatory Notes */}
            <div className="mt-4 bg-blue-50 dark:bg-gray-800/50 p-4 rounded-xl border border-blue-100 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-300">
                <div className="flex items-center justify-between mb-3">
                    <h4 className="font-semibold text-sm flex items-center gap-2 text-blue-800 dark:text-blue-300">
                        <InformationCircleIcon className="w-4 h-4" /> {noteLang === 'vi' ? 'Ghi chú về Xếp hạng & Điểm số' : 'Ranking & Scoring Notes'}
                    </h4>
                    <div className="flex items-center gap-1 bg-white dark:bg-gray-700 p-0.5 rounded-lg border border-gray-200 dark:border-gray-600">
                        <button 
                            onClick={() => setNoteLang('en')}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${noteLang === 'en' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                        >EN</button>
                        <button 
                            onClick={() => setNoteLang('vi')}
                            className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-colors ${noteLang === 'vi' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
                        >VI</button>
                    </div>
                </div>
                {noteLang === 'vi' ? (
                    <ul className="list-disc pl-5 space-y-1.5">
                        <li><b>Điểm (Score)</b>: Là điểm trung bình % hoàn thành của các mục có đặt KPI. Mức tối đa của mỗi mục là 100%. Nếu không đặt KPI nào, điểm sẽ bằng 0.<br/>
                            <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-blue-600 dark:text-blue-400 mt-1 inline-block">Công thức = Tổng % hoàn thành của các mục có KPI (tối đa 100%/mục) / Số lượng mục có KPI</code>
                        </li>
                        <li><b>Highest % Growth</b>: Seller có phần trăm tăng trưởng doanh thu tuần này so với tuần trước cao nhất (yêu cầu doanh thu tuần trước &gt; 0).</li>
                        <li><b>Top Absolute Growth</b>: Seller có doanh thu tăng thêm thực tế ($) cao nhất so với tuần trước.</li>
                        <li><b>Best Rev Target</b>: Seller có tỉ lệ hoàn thành mục tiêu doanh thu (Current / KPI) cao nhất trong tuần.</li>
                        <li><b>Most Ideas</b>: Seller đóng góp nhiều Ideas nhất trong tuần.</li>
                    </ul>
                ) : (
                    <ul className="list-disc pl-5 space-y-1.5">
                        <li><b>Score</b>: The average completion percentage of all categories with a set KPI Target. The maximum for each category is 100%. If no targets are set, the score will be 0.<br/>
                            <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-blue-600 dark:text-blue-400 mt-1 inline-block">Formula = Sum of % completion for categories with KPI (max 100% each) / Number of categories with KPI</code>
                        </li>
                        <li><b>Highest % Growth</b>: The seller with the highest percentage of revenue growth this week compared to last week (requires previous week's revenue &gt; 0).</li>
                        <li><b>Top Absolute Growth</b>: The seller with the highest actual added revenue ($) compared to last week.</li>
                        <li><b>Best Rev Target</b>: The seller with the highest Revenue KPI completion rate (Current / KPI) this week.</li>
                        <li><b>Most Ideas</b>: The seller who contributed the most Ideas this week.</li>
                    </ul>
                )}
            </div>
            
            {/* Ideas View Modal */}
            {viewingIdeasFor && (
                <ViewIdeasModal 
                    sellerName={viewingIdeasFor.sellerName}
                    normalizedName={viewingIdeasFor.normalizedName}
                    currentReports={currentReports}
                    onClose={() => setViewingIdeasFor(null)}
                />
            )}
        </div>
    );
};

const AchievementCard = ({ icon, title, seller, sub }: { icon: React.ReactNode, title: string, seller?: string, sub: string }) => (
    <div className="bg-gradient-to-br from-white to-gray-50 dark:from-gray-800 dark:to-gray-900 p-4 rounded-xl border border-gray-200 dark:border-gray-700 flex items-center gap-4 shadow-sm">
        <div className="p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            {icon}
        </div>
        <div>
            <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{title}</p>
            <p className="text-base font-bold text-gray-900 dark:text-white truncate max-w-[150px]">{seller || 'N/A'}</p>
            <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">{sub}</p>
        </div>
    </div>
);

// ---- ViewIdeasModal ----
const ViewIdeasModal: React.FC<{
    sellerName: string;
    normalizedName: string;
    currentReports: KpiReport[];
    onClose: () => void;
}> = ({ sellerName, normalizedName, currentReports, onClose }) => {
    // Gather all ideas for this user from all days in the current week
    const userReports = currentReports.filter(r => r.sellerName.trim().toLowerCase().replace(/\s+/g, '-') === normalizedName);
    
    // Accumulate ideas by type
    const aggregatedIdeasMap = new Map<string, number>();
    let totalIdeas = 0;

    userReports.forEach(report => {
        const ideas = report.ideas || [];
        ideas.forEach(idea => {
            const type = idea.type.trim();
            // Capitalize first letter for consistency
            const standardizedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
            aggregatedIdeasMap.set(standardizedType, (aggregatedIdeasMap.get(standardizedType) || 0) + idea.count);
            totalIdeas += idea.count;
        });
    });

    const aggregatedIdeas = Array.from(aggregatedIdeasMap.entries())
                                 .map(([type, count]) => ({ type, count }))
                                 .sort((a, b) => b.count - a.count);
    
    return (
        <div 
            className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-white dark:bg-gray-800 rounded-xl max-w-2xl w-full flex flex-col max-h-[85vh] shadow-2xl animate-modal-scale">
                <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800 rounded-t-xl">
                    <h3 className="font-semibold text-xl text-gray-900 dark:text-white">Ideas Detail - {sellerName}</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1 rounded-md hover:bg-gray-200 dark:hover:bg-gray-700">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1">
                    {aggregatedIdeas.length === 0 ? (
                        <div className="text-center text-gray-500 dark:text-gray-400 py-12 flex flex-col items-center">
                            <svg className="w-12 h-12 mb-4 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>
                            <p>No ideas recorded for this week.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            {aggregatedIdeas.map((idea, idx) => (
                                <div key={idx} className="flex justify-between items-center p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors group">
                                    <div className="font-medium text-gray-800 dark:text-gray-200 truncate pr-4 capitalize" title={idea.type}>
                                        {idea.type}
                                    </div>
                                    <div className="flex-shrink-0 bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-bold px-3 py-1 rounded-lg min-w-[3rem] text-center shadow-sm">
                                        {idea.count}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="p-5 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/80 rounded-b-xl flex justify-between items-center shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] z-10">
                    <span className="font-medium text-gray-600 dark:text-gray-400">Total this week</span>
                    <span className="text-xl font-black text-blue-600 dark:text-blue-400 bg-white dark:bg-gray-900 px-4 py-1.5 rounded-xl border border-blue-100 dark:border-gray-700 shadow-sm">{totalIdeas} Ideas</span>
                </div>
            </div>
        </div>
    );
};

export default KpiLeaderboard;
