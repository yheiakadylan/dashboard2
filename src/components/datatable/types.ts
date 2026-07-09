import React, { CSSProperties } from 'react';

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
    onRowClick?: (rowRecord: any) => void;
    selectedKeys?: Set<string>;
    onToggleSelect?: (key: string) => void;
}

export interface DataTableProps {
    headers: string[];
    data: (string | number | null | any | React.ReactNode |
    { type: 'button', label: string, id: string } |
    { type: 'image', src: string, alt: string, fullSrc?: string } |
    { type: 'action_group', actions: any[] } |
    { type: 'value_with_unit', value: number, display: string, unit?: string } |
    {
        type: 'text_with_subtitle',
        main: string,
        subtitle: string,
        subtitleClass?: string,
        mainClass?: string,
        trendDirection?: 'up' | 'down' | 'neutral',
        mainAmountMap?: { [c: string]: number },
        subtitleAmountMap?: { [c: string]: number },
        subtitleLabel?: string,
        subtitleValue?: string,
        subtitleDelta?: string,
        subtitleDeltaDirection?: 'up' | 'down' | 'neutral',
        extraSubtitle?: string,
        extraSubtitleClass?: string,
        extraSubtitleAmountMap?: { [c: string]: number },
        extraSubtitleLabel?: string,
        extraSubtitleDelta?: string,
        value?: number
    } |
    { type: 'checkbox', idKey?: string, checked?: boolean, onChange?: (checked: boolean) => void }
    )[][];
    onViewDayDetails?: (date: string) => void;
    onViewOrderDetails?: (recordId: string) => void;
    onResyncOrder?: (recordId: string) => Promise<void>;
    autoHeight?: boolean;
    mobileRowHeight?: number;
    forceCardView?: boolean;
    mobileBreakpoint?: number;
    columnWidths?: { [key: string]: number };
    headerActions?: { [header: string]: React.ReactNode };
    scrollParentId?: string;
    onRowClick?: (rowRecord: any) => void;
    onItemsRendered?: (props: {
        overscanStartIndex: number;
        overscanStopIndex: number;
        visibleStartIndex: number;
        visibleStopIndex: number;
    }) => void;
    selectedKeys?: Set<string>;
    onToggleSelect?: (key: string) => void;
}
