import React, { useState } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';
import KpiReportModal from '../KpiReportModal';
import KpiPersonalReport from '../KpiPersonalReport';
import KpiLeaderboard from '../KpiLeaderboard';
import { PlusIcon, ArrowDownTrayIcon, ArrowUpTrayIcon } from '@heroicons/react/24/outline';
import * as XLSX from 'xlsx';
import { saveKpiReportsBatch, addIdeaTags, getIdeaTags } from '../../services/kpiService';
import { useNotification } from '../../contexts/NotificationContext';
import { KpiReport } from '../../types';

const KpiManagement: React.FC = () => {
    const { teamId, user, role, is_kpi, can_view_leaderboard } = useDashboard();
    const { addNotification } = useNotification();

    // Owner luôn thấy tất cả
    const canViewPersonal = role === 'owner' || !!is_kpi;
    const canViewLeaderboard = role === 'owner' || !!can_view_leaderboard;

    // Mặc định tab: nếu không có personal, chuyển sang leaderboard
    const defaultTab = canViewPersonal ? 'personal' : 'leaderboard';
    const [activeTab, setActiveTab] = useState<'personal' | 'leaderboard'>(defaultTab);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [exportTrigger, setExportTrigger] = useState(0);
    
    // To trigger refresh in child components when a new report is added
    const [refreshKey, setRefreshKey] = useState(0);

    const handleSuccess = () => {
        setRefreshKey(prev => prev + 1);
    };

    const handleDownloadTemplate = () => {
        const templateData = [
            {
                'Date (DD/MM/YYYY)': 'HƯỚNG DẪN:',
                'Name': 'Xoá dòng này trước khi nộp.',
                'Total Mockup': 0,
                'Listing': 0,
                'Push Fulfill': 0,
                'Revenue ($)': 0,
                'Base Cost ($)': 0,
                'Idea': 'Cú pháp chuẩn nhất: [Số lượng] [Khoảng trắng] [Tên Idea], phân cách bằng dấu phẩy. VD: 2 summer, 3 father',
                'Note': ''
            },
            {
                'Date (DD/MM/YYYY)': '15/06/2026',
                'Name': 'John Doe',
                'Total Mockup': 10,
                'Listing': 5,
                'Push Fulfill': 2,
                'Revenue ($)': 150.50,
                'Base Cost ($)': 80.00,
                'Idea': '2 summer, 3 graduation, 1 father',
                'Note': 'Optional text'
            }
        ];
        const ws = XLSX.utils.json_to_sheet(templateData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        XLSX.writeFile(wb, 'KPI_Report_Template.xlsx');
    };

    const parseIdeas = (ideaStr: string) => {
        if (!ideaStr) return [];
        const cleanStr = ideaStr.toString().replace(/^\(+|\)+$/g, '').trim();
        if (cleanStr === '-' || cleanStr === '') return [];

        const parts = cleanStr.replace(/\+/g, ',').split(',');
        const ideas: {count: number, type: string}[] = [];
        
        for (let part of parts) {
            part = part.trim().replace(/^\(+|\)+$/g, '').trim();
            if (!part || part === '-') continue;

            let count = 1;
            let type = part;

            const startMatch = part.match(/^(\d+)\s*[:\-]?\s*(.+)$/);
            const endMatch = part.match(/^(.+?)\s*[:\-;]\s*(\d+)$/) || part.match(/^(.+?)\s+(\d+)$/);

            if (startMatch) {
                count = parseInt(startMatch[1]);
                type = startMatch[2];
            } else if (endMatch) {
                count = parseInt(endMatch[2]);
                type = endMatch[1];
            }

            type = type.replace(/[:;]/g, '').trim();
            if (!type || type === '-') continue;

            // Capitalize
            type = type.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
            
            const existing = ideas.find(i => i.type.toLowerCase() === type.toLowerCase());
            if (existing) {
                existing.count += count;
            } else {
                ideas.push({ count, type });
            }
        }
        return ideas;
    };

    const parseDateString = (dateStr: string) => {
        if (!dateStr) return null;
        // Check DD/MM/YYYY
        const parts = dateStr.toString().split('/');
        if (parts.length === 3) {
            return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
        }
        const d = new Date(dateStr);
        return isNaN(d.getTime()) ? null : d;
    };

    const getColValue = (row: any, keywords: string[]) => {
        for (const key of Object.keys(row)) {
            if (keywords.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
                return row[key];
            }
        }
        return undefined;
    };

    const parseCurrency = (val: any) => {
        if (val === undefined || val === null) return 0;
        if (typeof val === 'number') return val;
        let s = val.toString().trim();
        if (!s || s === '-') return 0;
        s = s.replace(/[\$\s]/g, ''); // remove $ and spaces
        if (s.includes(',') && !s.includes('.')) {
            s = s.replace(',', '.'); // replace 389,27 to 389.27
        } else {
            s = s.replace(/,/g, ''); // replace 1,234.56 to 1234.56
        }
        return Number(s) || 0;
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !teamId) return;

        setIsUploading(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data, { type: 'array' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            // raw: false ensures dates are read as formatted strings (e.g., '15/06/2026')
            const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, { raw: false });

            const reportsToSave: (Omit<KpiReport, 'id'> & { id: string })[] = [];
            const newTags = new Set<string>();

            for (const row of jsonData) {
                const rawDate = getColValue(row, ['date', 'ngày']);
                const name = getColValue(row, ['name', 'seller', 'nhân viên']);
                
                if (!rawDate || !name) continue;

                const parsedDate = parseDateString(rawDate);
                if (!parsedDate) continue;

                const dateIsoStr = parsedDate.toISOString();
                const dateYYYYMMDD = dateIsoStr.split('T')[0];
                const normalizedName = name.toString().trim().toLowerCase().replace(/\s+/g, '-');
                const docId = `report_${dateYYYYMMDD}_${normalizedName}`;

                const ideaRaw = getColValue(row, ['idea', 'ý tưởng']);
                const ideas = parseIdeas(ideaRaw);
                ideas.forEach(i => newTags.add(i.type));

                const revenue = parseCurrency(getColValue(row, ['revenue', 'doanh thu']));
                const baseCost = parseCurrency(getColValue(row, ['base cost', 'cost']));
                const grossProfit = revenue - baseCost;
                const profitMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

                reportsToSave.push({
                    id: docId,
                    date: dateIsoStr,
                    timestamp: parsedDate.getTime(),
                    sellerName: name.toString().trim(),
                    ideas,
                    mockup: Number(getColValue(row, ['mockup'])) || 0,
                    listing: Number(getColValue(row, ['listing'])) || 0,
                    fulfill: Number(getColValue(row, ['fulfill'])) || 0,
                    revenue,
                    baseCost,
                    grossProfit,
                    profitMargin,
                    note: getColValue(row, ['note', 'ghi chú'])?.toString().trim() || ''
                });
            }

            if (reportsToSave.length > 0) {
                await saveKpiReportsBatch(teamId, reportsToSave);
                
                // Save new idea tags
                if (newTags.size > 0) {
                    const existingTags = await getIdeaTags(teamId);
                    const tagsToAdd = Array.from(newTags).filter(t => !existingTags.includes(t) && !existingTags.includes(t.toLowerCase()));
                    if (tagsToAdd.length > 0) {
                        await addIdeaTags(teamId, tagsToAdd);
                    }
                }
                
                addNotification(`Successfully imported ${reportsToSave.length} reports!`, 'success');
                handleSuccess(); // Refresh UI
            } else {
                addNotification('No valid data found in file. Please check template.', 'error');
            }
        } catch (error) {
            console.error('Upload error:', error);
            addNotification('Error processing file', 'error');
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    // Không có quyền nào cả
    if (!canViewPersonal && !canViewLeaderboard) {
        return (
            <div className="h-full flex items-center justify-center p-8">
                <div className="text-center">
                    <div className="text-5xl mb-4">🔒</div>
                    <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Không có quyền truy cập</h3>
                    <p className="text-gray-500 dark:text-gray-400">Tài khoản của bạn chưa được cấp quyền xem KPI.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col space-y-4 p-4 lg:p-6 pb-24">
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="flex gap-2 bg-gray-100 dark:bg-gray-900 p-1 rounded-lg">
                    {canViewPersonal && (
                        <button 
                            onClick={() => setActiveTab('personal')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                activeTab === 'personal' 
                                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                            }`}
                        >
                            Daily Report
                        </button>
                    )}
                    {canViewLeaderboard && (
                        <button 
                            onClick={() => setActiveTab('leaderboard')}
                            className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                                activeTab === 'leaderboard' 
                                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                            }`}
                        >
                            Leaderboard
                        </button>
                    )}
                </div>
                
                <div className="flex gap-2">
                    <button 
                        onClick={() => setExportTrigger(prev => prev + 1)}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
                    >
                        <ArrowDownTrayIcon className="w-5 h-5" />
                        <span className="hidden sm:inline">Export XLSX</span>
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl">
                {activeTab === 'personal' ? (
                    <KpiPersonalReport key={`personal-${refreshKey}`} teamId={teamId} exportTrigger={exportTrigger} />
                ) : (
                    <KpiLeaderboard key={`leaderboard-${refreshKey}`} teamId={teamId} exportTrigger={exportTrigger} />
                )}
            </div>

            <KpiReportModal 
                isOpen={isModalOpen} 
                onClose={() => setIsModalOpen(false)} 
                teamId={teamId} 
                userProfile={user} 
                onSuccess={handleSuccess} 
            />
        </div>
    );
};

export default KpiManagement;
