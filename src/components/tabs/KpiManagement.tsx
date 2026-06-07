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
    const { teamId, user } = useDashboard();
    const { addNotification } = useNotification();
    const [activeTab, setActiveTab] = useState<'personal' | 'leaderboard'>('personal');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    
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

    return (
        <div className="h-full flex flex-col space-y-4 p-4 lg:p-6 pb-24">
            <div className="flex justify-between items-center bg-white dark:bg-gray-800 p-4 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700">
                <div className="flex gap-2 bg-gray-100 dark:bg-gray-900 p-1 rounded-lg">
                    <button 
                        onClick={() => setActiveTab('personal')}
                        className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                            activeTab === 'personal' 
                                ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' 
                                : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                        }`}
                    >
                        Personal Report
                    </button>
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
                </div>
                
                <div className="flex gap-2">
                    <button 
                        onClick={handleDownloadTemplate}
                        className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg font-medium transition-colors shadow-sm"
                    >
                        <ArrowDownTrayIcon className="w-5 h-5" />
                        <span className="hidden sm:inline">Template</span>
                    </button>
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        className={`flex items-center gap-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 px-4 py-2 rounded-lg font-medium transition-colors shadow-sm ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                        <ArrowUpTrayIcon className="w-5 h-5" />
                        <span className="hidden sm:inline">{isUploading ? 'Uploading...' : 'Upload XLSX'}</span>
                    </button>
                    <input 
                        type="file" 
                        ref={fileInputRef} 
                        onChange={handleFileUpload} 
                        accept=".xlsx, .xls" 
                        className="hidden" 
                    />
                    <button 
                        onClick={() => setIsModalOpen(true)}
                        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors shadow-sm ml-2"
                    >
                        <PlusIcon className="w-5 h-5" />
                        Report Daily
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl">
                {activeTab === 'personal' ? (
                    <KpiPersonalReport key={`personal-${refreshKey}`} teamId={teamId} />
                ) : (
                    <KpiLeaderboard key={`leaderboard-${refreshKey}`} teamId={teamId} />
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
