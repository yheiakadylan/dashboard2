import { CSSProperties } from 'react';
import { TableData } from '../../types';

// Define ListChildComponentProps manually
export interface ListChildComponentProps<T = any> {
    index: number;
    style: CSSProperties;
    data: T;
    isScrolling?: boolean;
}

export interface RowData {
    items: any[][];
    headers: string[];
    loadingItems: Set<string>;
    onViewDayDetails?: (date: string) => void;
    onViewOrderDetails?: (recordId: string) => void;
    onUpdateCost?: (recordId: string, newCost: number | null) => Promise<void>;
    onResyncClick: (id: string) => void;
    onImageClick: (src: string) => void;
    isMobile: boolean;
    columnWidths?: { [key: string]: number };
}

export interface DataTableProps {
    headers: string[];
    data: TableData['rows'];
    onViewDayDetails?: (date: string) => void;
    onViewOrderDetails?: (recordId: string) => void;
    onUpdateCost?: (recordId: string, newCost: number | null) => Promise<void>;
    onResyncOrder?: (recordId: string) => Promise<void>;
    autoHeight?: boolean;
    mobileRowHeight?: number;
    forceCardView?: boolean;
    mobileBreakpoint?: number;
    columnWidths?: { [key: string]: number };
    scrollParentId?: string;
}
