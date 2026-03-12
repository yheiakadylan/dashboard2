import React, { useMemo, Suspense } from 'react';
import DataTable from '../ui/DataTable';
import { ProcessedData } from '../../types';
import LoadingSpinner from '../ui/LoadingSpinner';
import { useUI } from '../../contexts/UIContext';
import useMediaQuery from '../../hooks/useMediaQuery';
import Pagination from '../ui/Pagination';

const ITEMS_PER_PAGE = 200;


interface SupportTabProps {
    processedData: ProcessedData;
}

const SupportTab: React.FC<SupportTabProps> = ({ processedData }) => {
    const { timeZone, supportFilter, setSupportFilter } = useUI();
    const isDesktop = useMediaQuery('(min-width: 768px)');
    const [currentPage, setCurrentPage] = React.useState(0);

    // Reset page when filtering
    React.useEffect(() => {
        setCurrentPage(0);
    }, [supportFilter]);

    const displayData = useMemo(() => {
        const caseRows = processedData.cases.rows;
        const helpRows = processedData.help.rows;

        // Common headers for consistent display
        const commonHeaders = [
            "Order Number",
            "Message",
            "Source",
            "Account",
            "DateTime", // Index  4
            "DateTimeRaw" // Index 5 (Hidden)
        ];

        const displayHeaders = commonHeaders.slice(0, 5);

        if (supportFilter === 'Case') {
            return { headers: displayHeaders, rows: caseRows.map(row => row.slice(0, 5)) };
        }
        if (supportFilter === 'Help') {
            return { headers: displayHeaders, rows: helpRows.map(row => row.slice(0, 5)) };
        }

        // Combine for 'All'
        const combinedRows = [
            ...caseRows,
            ...helpRows
        ].sort((a, b) => {
            const dateA = new Date(a[5] as string).getTime();
            const dateB = new Date(b[5] as string).getTime();
            return dateB - dateA;
        });

        // Filter out the "DateTimeRaw" column (Index 5) for display
        // Note: commonHeaders is already sliced above into displayHeaders constant but we are in a different scope block potentially or just need to reuse
        // Actually, let's just use the sliced version.

        const displayRows = combinedRows.map(row => row.slice(0, 5));

        return { headers: displayHeaders, rows: displayRows };

    }, [processedData.cases.rows, processedData.help.rows, supportFilter]);

    const totalPages = Math.ceil(displayData.rows.length / ITEMS_PER_PAGE);
    const paginatedRows = useMemo(() => {
        return displayData.rows.slice(currentPage * ITEMS_PER_PAGE, (currentPage + 1) * ITEMS_PER_PAGE);
    }, [displayData.rows, currentPage]);

    return (
        <div className="h-full bg-gray-50 dark:bg-gray-900 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']">
            <div className="p-2 md:p-6">
                <div style={isDesktop ? { height: 'calc(100vh - 160px)' } : {}} className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 overflow-hidden shadow-sm">
                    <div className="flex-1 min-h-0 relative">
                        <Suspense fallback={<LoadingSpinner variant="table-row" count={10} />}>
                            <DataTable
                                headers={displayData.headers}
                                data={paginatedRows}
                                autoHeight={!isDesktop}
                            />
                        </Suspense>
                    </div>
                    <Pagination 
                        currentPage={currentPage}
                        totalPages={totalPages}
                        onPageChange={setCurrentPage}
                    />
                </div>
            </div>
        </div>
    );
};

export default SupportTab;
