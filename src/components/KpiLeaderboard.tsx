import React, { useState, useEffect, useMemo } from 'react';
import { KpiReport } from '../types';
import { getKpiReports, getKpiTargets, saveKpiTarget } from '../services/kpiService';
import * as XLSX from 'xlsx';
import { ArrowDownTrayIcon, TrophyIcon, FireIcon, ArrowTrendingUpIcon, StarIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import Spinner from './Spinner';
import { useUI } from '../contexts/UIContext';

interface KpiLeaderboardProps {
    teamId: string;
}

interface LeaderboardEntry {
    normalizedName: string;
    sellerName: string;
    currentRev: number;
    prevRev: number;
    changeUsd: number;
    changePct: number;
    target: number;
    targetPct: number;
    score: number;
    note: string;
    totalIdeas: number;
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

const KpiLeaderboard: React.FC<KpiLeaderboardProps> = ({ teamId }) => {
    const { filterDateRange } = useUI();
    const [loading, setLoading] = useState(false);
    const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
    const [targets, setTargets] = useState<Record<string, { target: number, note: string }>>({});
    const [editingCell, setEditingCell] = useState<{normalizedName: string, field: 'target' | 'note'} | null>(null);
    const [editValue, setEditValue] = useState<string>('');

    const currentRange = useMemo(() => getWeekRange(filterDateRange.from, 0), [filterDateRange.from]);
    const prevRange = useMemo(() => getWeekRange(filterDateRange.from, -1), [filterDateRange.from]);
    const currentWeekId = useMemo(() => getWeekId(currentRange.start), [currentRange]);

    useEffect(() => {
        if (!teamId) return;
        
        setLoading(true);
        Promise.all([
            getKpiReports(teamId, currentRange.start, currentRange.end),
            getKpiReports(teamId, prevRange.start, prevRange.end),
            getKpiTargets(teamId, currentWeekId)
        ]).then(([currentReports, prevReports, targetData]) => {
            setTargets(targetData);
            
            const sellerMap: Record<string, LeaderboardEntry> = {};
            
            // Build base from current reports
            currentReports.forEach(r => {
                const normalizedName = r.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
                if (!sellerMap[normalizedName]) {
                    sellerMap[normalizedName] = {
                        normalizedName: normalizedName,
                        sellerName: r.sellerName,
                        currentRev: 0,
                        prevRev: 0,
                        changeUsd: 0,
                        changePct: 0,
                        target: targetData[normalizedName]?.target || 0,
                        targetPct: 0,
                        score: 0,
                        note: targetData[normalizedName]?.note || '',
                        totalIdeas: 0
                    };
                }
                sellerMap[normalizedName].currentRev += r.revenue;
                sellerMap[normalizedName].totalIdeas += r.ideas.reduce((sum, i) => sum + i.count, 0);
            });

            // Add previous revenue
            prevReports.forEach(r => {
                const normalizedName = r.sellerName.trim().toLowerCase().replace(/\s+/g, '-');
                if (!sellerMap[normalizedName]) {
                    sellerMap[normalizedName] = {
                        normalizedName: normalizedName,
                        sellerName: r.sellerName,
                        currentRev: 0,
                        prevRev: 0,
                        changeUsd: 0,
                        changePct: 0,
                        target: targetData[normalizedName]?.target || 0,
                        targetPct: 0,
                        score: 0,
                        note: targetData[normalizedName]?.note || '',
                        totalIdeas: 0
                    };
                }
                sellerMap[normalizedName].prevRev += r.revenue;
            });

            // Calculate metrics
            const finalEntries = Object.values(sellerMap).map(e => {
                e.changeUsd = e.currentRev - e.prevRev;
                e.changePct = e.prevRev > 0 ? (e.changeUsd / e.prevRev) * 100 : (e.currentRev > 0 ? 100 : 0);
                e.targetPct = e.target > 0 ? (e.currentRev / e.target) * 100 : 0;
                
                // Simple KPI score formula: weighted mix of target completion and growth
                e.score = (e.targetPct * 0.6) + (Math.min(e.changePct, 100) * 0.4);
                return e;
            });

            // Sort by Revenue descending
            finalEntries.sort((a, b) => b.currentRev - a.currentRev);
            setEntries(finalEntries);
        }).catch(err => console.error(err))
        .finally(() => setLoading(false));
    }, [teamId, currentRange, prevRange, currentWeekId]);

    const handleCellDoubleClick = (normalizedName: string, field: 'target' | 'note', currentValue: any) => {
        setEditingCell({ normalizedName, field });
        setEditValue(String(currentValue || ''));
    };

    const handleCellBlur = async () => {
        if (!editingCell || !teamId) return;
        
        const { normalizedName, field } = editingCell;
        const entry = entries.find(e => e.normalizedName === normalizedName);
        if (!entry) {
            setEditingCell(null);
            return;
        }

        let newTarget = entry.target;
        let newNote = entry.note;

        if (field === 'target') {
            newTarget = Number(editValue) || 0;
        } else {
            newNote = editValue;
        }

        // Optimistic UI update
        const updatedEntries = entries.map(e => {
            if (e.normalizedName === normalizedName) {
                const updated = { ...e, target: newTarget, note: newNote };
                updated.targetPct = updated.target > 0 ? (updated.currentRev / updated.target) * 100 : 0;
                updated.score = (updated.targetPct * 0.6) + (Math.min(updated.changePct, 100) * 0.4);
                return updated;
            }
            return e;
        });
        setEntries(updatedEntries);
        setEditingCell(null);

        // Save to DB
        try {
            await saveKpiTarget(teamId, {
                sellerName: entry.sellerName,
                weekId: currentWeekId,
                targetRevenue: newTarget,
                note: newNote
            });
        } catch (err) {
            console.error('Failed to save target', err);
        }
    };

    const handleExport = () => {
        const exportData = entries.map((r, idx) => ({
            Rank: idx + 1,
            Seller: r.sellerName,
            'Current Rev ($)': r.currentRev,
            'Previous Rev ($)': r.prevRev,
            'Change ($)': r.changeUsd,
            'Change (%)': r.changePct.toFixed(1),
            'Target ($)': r.target,
            'Target Achieved (%)': r.targetPct.toFixed(1),
            'Score': r.score.toFixed(1),
            'Note': r.note
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Leaderboard");
        XLSX.writeFile(wb, `Leaderboard_${currentWeekId}.xlsx`);
    };

    // Calculate totals
    const totals = useMemo(() => {
        return entries.reduce((acc, curr) => ({
            currentRev: acc.currentRev + curr.currentRev,
            prevRev: acc.prevRev + curr.prevRev,
            target: acc.target + curr.target
        }), { currentRev: 0, prevRev: 0, target: 0 });
    }, [entries]);

    const totalChangeUsd = totals.currentRev - totals.prevRev;
    const totalChangePct = totals.prevRev > 0 ? (totalChangeUsd / totals.prevRev) * 100 : 0;

    // Determine Achievements
    const topGrowth = entries.length > 0 ? [...entries].sort((a,b) => b.changePct - a.changePct)[0] : null;
    const topAbsGrowth = entries.length > 0 ? [...entries].sort((a,b) => b.changeUsd - a.changeUsd)[0] : null;
    const topTarget = entries.length > 0 ? [...entries].sort((a,b) => b.targetPct - a.targetPct)[0] : null;
    const topIdeas = entries.length > 0 ? [...entries].sort((a,b) => b.totalIdeas - a.totalIdeas)[0] : null;

    return (
        <div className="space-y-6">
            {/* Toolbar */}
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-xl border border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-4">
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Showing week: <b>{currentRange.start}</b> to <b>{currentRange.end}</b>
                    </span>
                </div>
                <button onClick={handleExport} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-md transition-colors">
                    <ArrowDownTrayIcon className="w-4 h-4" /> Export XLSX
                </button>
            </div>

            {/* Achievements Highlight */}
            {!loading && entries.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <AchievementCard icon={<FireIcon className="w-6 h-6 text-orange-500" />} title="Highest % Growth" seller={topGrowth?.changePct! > 0 ? topGrowth?.sellerName : 'N/A'} sub={`${topGrowth?.changePct.toFixed(1) || 0}%`} />
                    <AchievementCard icon={<ArrowTrendingUpIcon className="w-6 h-6 text-green-500" />} title="Top Absolute Growth" seller={topAbsGrowth?.changeUsd! > 0 ? topAbsGrowth?.sellerName : 'N/A'} sub={`+$${topAbsGrowth?.changeUsd.toFixed(2) || 0}`} />
                    <AchievementCard icon={<StarIcon className="w-6 h-6 text-yellow-500" />} title="Best KPI Target" seller={topTarget?.targetPct! > 0 ? topTarget?.sellerName : 'N/A'} sub={`${topTarget?.targetPct.toFixed(1) || 0}%`} />
                    <AchievementCard icon={<LightBulbIcon className="w-6 h-6 text-blue-500" />} title="Most Ideas" seller={topIdeas?.totalIdeas! > 0 ? topIdeas?.sellerName : 'N/A'} sub={`${topIdeas?.totalIdeas || 0} ideas`} />
                </div>
            )}

            {/* Leaderboard Table */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs uppercase text-gray-500 dark:text-gray-400">
                                <th className="p-4 font-semibold w-16 text-center">Rank</th>
                                <th className="p-4 font-semibold">Seller</th>
                                <th className="p-4 font-semibold text-right">Rev (Current)</th>
                                <th className="p-4 font-semibold text-right">Rev (Prev)</th>
                                <th className="p-4 font-semibold text-right">Change ($)</th>
                                <th className="p-4 font-semibold text-right">Change (%)</th>
                                <th className="p-4 font-semibold text-right text-blue-600 dark:text-blue-400">KPI Target</th>
                                <th className="p-4 font-semibold text-right">% Target</th>
                                <th className="p-4 font-semibold text-right">Score</th>
                                <th className="p-4 font-semibold">Note (Leader)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-gray-700 text-sm">
                            {loading ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center"><Spinner size="md" /></td>
                                </tr>
                            ) : entries.length === 0 ? (
                                <tr>
                                    <td colSpan={10} className="p-8 text-center text-gray-500">No data for this week.</td>
                                </tr>
                            ) : (
                                entries.map((r, idx) => {
                                    const rankIcon = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}`;
                                    
                                    return (
                                        <tr key={r.normalizedName} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                                            <td className="p-4 text-center font-bold text-lg">{rankIcon}</td>
                                            <td className="p-4 font-medium text-gray-900 dark:text-gray-100">{r.sellerName}</td>
                                            <td className="p-4 text-right font-medium">${r.currentRev.toFixed(2)}</td>
                                            <td className="p-4 text-right text-gray-500">${r.prevRev.toFixed(2)}</td>
                                            <td className={`p-4 text-right font-medium ${r.changeUsd >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                {r.changeUsd > 0 ? '+' : ''}${r.changeUsd.toFixed(2)}
                                            </td>
                                            <td className={`p-4 text-right font-medium ${r.changePct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                                {r.changePct > 0 ? '+' : ''}{r.changePct.toFixed(1)}%
                                            </td>
                                            <td className="p-4 text-right bg-blue-50/50 dark:bg-blue-900/10 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900/30" onDoubleClick={() => handleCellDoubleClick(r.normalizedName, 'target', r.target)}>
                                                {editingCell?.normalizedName === r.normalizedName && editingCell?.field === 'target' ? (
                                                    <input 
                                                        autoFocus
                                                        type="number" 
                                                        value={editValue} 
                                                        onChange={e => setEditValue(e.target.value)}
                                                        onBlur={handleCellBlur}
                                                        onKeyDown={e => e.key === 'Enter' && handleCellBlur()}
                                                        className="w-20 px-2 py-1 text-right text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-500 rounded"
                                                    />
                                                ) : (
                                                    <span className="font-semibold text-blue-600 dark:text-blue-400 border-b border-dashed border-blue-300 dark:border-blue-700">${r.target}</span>
                                                )}
                                            </td>
                                            <td className="p-4 text-right font-medium text-purple-600 dark:text-purple-400">{r.targetPct.toFixed(1)}%</td>
                                            <td className="p-4 text-right font-bold text-gray-900 dark:text-gray-100">{r.score.toFixed(1)}</td>
                                            <td className="p-4 text-gray-600 dark:text-gray-400 italic cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700" onDoubleClick={() => handleCellDoubleClick(r.normalizedName, 'note', r.note)}>
                                                {editingCell?.normalizedName === r.normalizedName && editingCell?.field === 'note' ? (
                                                    <input 
                                                        autoFocus
                                                        type="text" 
                                                        value={editValue} 
                                                        onChange={e => setEditValue(e.target.value)}
                                                        onBlur={handleCellBlur}
                                                        onKeyDown={e => e.key === 'Enter' && handleCellBlur()}
                                                        className="w-full px-2 py-1 text-gray-900 dark:text-white bg-white dark:bg-gray-700 border border-blue-500 rounded"
                                                    />
                                                ) : (
                                                    r.note || <span className="text-gray-400 dark:text-gray-600 border-b border-dashed">Thêm ghi chú...</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                        {/* Summary Footer */}
                        {entries.length > 0 && (
                            <tfoot className="bg-gray-900 text-white dark:bg-black dark:text-gray-100">
                                <tr>
                                    <td colSpan={2} className="p-4 font-bold text-right">TEAM TOTAL</td>
                                    <td className="p-4 text-right font-bold">${totals.currentRev.toFixed(2)}</td>
                                    <td className="p-4 text-right">${totals.prevRev.toFixed(2)}</td>
                                    <td className={`p-4 text-right font-bold ${totalChangeUsd >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {totalChangeUsd > 0 ? '+' : ''}${totalChangeUsd.toFixed(2)}
                                    </td>
                                    <td className={`p-4 text-right font-bold ${totalChangePct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                        {totalChangePct > 0 ? '+' : ''}{totalChangePct.toFixed(1)}%
                                    </td>
                                    <td className="p-4 text-right font-bold text-blue-300">${totals.target.toFixed(2)}</td>
                                    <td className="p-4 text-right font-bold text-purple-300">
                                        {totals.target > 0 ? ((totals.currentRev / totals.target) * 100).toFixed(1) : 0}%
                                    </td>
                                    <td colSpan={2} className="p-4"></td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>
            
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                * Double-click on <b>KPI Target</b> or <b>Note</b> to edit. Press Enter or click outside to save.
            </div>
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

export default KpiLeaderboard;
