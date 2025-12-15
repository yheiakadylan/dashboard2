import { CSSProperties } from 'react';

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
    onResyncClick: (id: string) => void;
    onImageClick: (src: string) => void;
    isMobile: boolean;
    columnWidths?: { [key: string]: number };
}

export interface DataTableProps {
    headers: string[];
    data: (string | number | null | { type: 'button', label: string, id: string } | { type: 'image', src: string, alt: string, fullSrc?: string } | { type: 'action_group', actions: any[] } | { type: 'value_with_unit', value: number, display: string, unit?: string })[][];
    onViewDayDetails?: (date: string) => void;
    onViewOrderDetails?: (recordId: string) => void;
    onResyncOrder?: (recordId: string) => Promise<void>;
    autoHeight?: boolean;
    mobileRowHeight?: number;
    forceCardView?: boolean;
    mobileBreakpoint?: number;
    columnWidths?: { [key: string]: number };
    scrollParentId?: string;
}
