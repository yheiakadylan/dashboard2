
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useUI } from '../contexts/UIContext';



// --- Date Utilities ---
const formatDateISO = (date: Date): string => date.toISOString().split('T')[0];
const getTodayInTimezone = (timeZone: string): Date => {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    const [year, month, day] = formatter.format(new Date()).split('-').map(Number);
    // Use UTC functions to create the date to avoid local timezone interference
    return new Date(Date.UTC(year, month - 1, day));
};

const presets = [
    { label: 'Today', getRange: (today: Date) => ({ from: today, to: today }) },
    { label: 'Yesterday', getRange: (today: Date) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() - 1); return { from: d, to: d }; } },
    { label: 'Last 7 days', getRange: (today: Date) => { const f = new Date(today); f.setUTCDate(f.getUTCDate() - 6); return { from: f, to: today }; } },
    { label: 'Last 30 days', getRange: (today: Date) => { const f = new Date(today); f.setUTCDate(f.getUTCDate() - 29); return { from: f, to: today }; } },
    { label: 'Last 90 days', getRange: (today: Date) => { const f = new Date(today); f.setUTCDate(f.getUTCDate() - 89); return { from: f, to: today }; } },
    { label: 'This month', getRange: (today: Date) => { const f = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); return { from: f, to: today }; } },
    { label: 'Last month', getRange: (today: Date) => { const f = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)); const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)); return { from: f, to: t }; } },
    { label: 'Week to date', getRange: (today: Date) => { const f = new Date(today); f.setUTCDate(f.getUTCDate() - today.getUTCDay()); return { from: f, to: today }; } },
    { label: 'Month to date', getRange: (today: Date) => { const f = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)); return { from: f, to: today }; } },
    { label: 'Year to date', getRange: (today: Date) => { const f = new Date(Date.UTC(today.getUTCFullYear(), 0, 1)); return { from: f, to: today }; } },
];


const DateRangePicker: React.FC = () => {
    const { filterDateRange, setFilterDateRange, timeZone } = useUI();


    const [isOpen, setIsOpen] = useState(false);
    const [tempRange, setTempRange] = useState({ from: new Date(`${filterDateRange.from}T00:00:00Z`), to: new Date(`${filterDateRange.to}T00:00:00Z`) });
    const [viewDate, setViewDate] = useState(new Date(`${filterDateRange.to}T00:00:00Z`));
    const [activePreset, setActivePreset] = useState('');
    const [selectingStart, setSelectingStart] = useState(true); // To manage selection phase
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [isMobile, setIsMobile] = useState(false);

    // Detect mobile
    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth < 768);
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // Sync component state with global context
    useEffect(() => {
        const from = new Date(`${filterDateRange.from}T00:00:00Z`);
        const to = new Date(`${filterDateRange.to}T00:00:00Z`);
        setTempRange({ from, to });
        setViewDate(to);

        const todayInTz = getTodayInTimezone(timeZone);
        let matchedPreset = '';
        for (const preset of presets) {
            const range = preset.getRange(todayInTz);
            if (formatDateISO(range.from) === filterDateRange.from && formatDateISO(range.to) === filterDateRange.to) {
                matchedPreset = preset.label;
                break;
            }
        }
        setActivePreset(matchedPreset);
    }, [filterDateRange, timeZone]);

    const getButtonText = useCallback(() => {
        if (activePreset) {
            return activePreset;
        }
        const fromFormatted = tempRange.from.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
        const toFormatted = tempRange.to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

        return formatDateISO(tempRange.from) === formatDateISO(tempRange.to)
            ? fromFormatted
            : `${fromFormatted} → ${toFormatted}`;
    }, [activePreset, tempRange]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node) && !isMobile) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMobile]);

    const handleApply = () => {
        setFilterDateRange({ from: formatDateISO(tempRange.from), to: formatDateISO(tempRange.to) });
        setIsOpen(false);
        setSelectingStart(true);
    };

    const handleCancel = () => {
        // Reset temp state to match global state
        const from = new Date(`${filterDateRange.from}T00:00:00Z`);
        const to = new Date(`${filterDateRange.to}T00:00:00Z`);
        setTempRange({ from, to });
        setIsOpen(false);
        setSelectingStart(true);
    };

    const handlePresetClick = (presetLabel: string) => {
        const preset = presets.find(p => p.label === presetLabel);
        if (preset) {
            const range = preset.getRange(getTodayInTimezone(timeZone));
            setTempRange(range);
            setActivePreset(preset.label);
            setViewDate(range.to);
            setSelectingStart(true); // Reset for next custom selection
        }
    };

    const handleDayClick = (day: Date) => {
        setActivePreset(''); // A custom range is being selected
        if (selectingStart) {
            setTempRange({ from: day, to: day });
            setSelectingStart(false);
        } else {
            if (day < tempRange.from) {
                setTempRange({ from: day, to: tempRange.from });
            } else {
                setTempRange({ from: tempRange.from, to: day });
            }
            setSelectingStart(true);
        }
    };

    const renderCalendar = (dateForMonth: Date) => {
        const month = dateForMonth.getUTCMonth();
        const year = dateForMonth.getUTCFullYear();
        const firstDayOfMonth = new Date(Date.UTC(year, month, 1));
        const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const startingDay = firstDayOfMonth.getUTCDay();

        const days = [];
        for (let i = 0; i < startingDay; i++) { days.push(<div key={`empty-start-${i}`} />); }
        for (let i = 1; i <= daysInMonth; i++) { days.push(new Date(Date.UTC(year, month, i))); }

        const fromTime = tempRange.from.getTime();
        const toTime = tempRange.to.getTime();
        const todayTime = getTodayInTimezone(timeZone).getTime();

        return (
            <div className="p-2">
                <div className="text-center font-semibold mb-2">{dateForMonth.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })}</div>
                <div className="grid grid-cols-7 gap-1 text-xs text-center text-gray-500 dark:text-gray-400">
                    <div>Su</div><div>Mo</div><div>Tu</div><div>We</div><div>Th</div><div>Fr</div><div>Sa</div>
                </div>
                <div className="grid grid-cols-7 gap-1 mt-2">
                    {days.map((day, index) => {
                        if (!(day instanceof Date)) return <div key={index} />;
                        const dayTime = day.getTime();
                        const isSelected = dayTime >= fromTime && dayTime <= toTime;
                        const isStart = dayTime === fromTime;
                        const isEnd = dayTime === toTime;
                        const isToday = dayTime === todayTime;

                        const baseClasses = 'w-8 h-8 flex items-center justify-center text-sm rounded cursor-pointer';
                        let dayClasses = baseClasses;

                        if (isSelected) {
                            dayClasses += ' bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200';
                            if (isStart) dayClasses += ' rounded-r-none';
                            if (isEnd) dayClasses += ' rounded-l-none';
                            if (isStart && isEnd) dayClasses += ' rounded-full';
                        } else {
                            dayClasses += ' hover:bg-gray-100 dark:hover:bg-gray-700';
                        }
                        if (isStart || isEnd) dayClasses += ' bg-blue-600 text-white font-bold rounded-full';
                        if (isToday && !isSelected) dayClasses += ' border border-gray-400 dark:border-gray-500';

                        return <button key={index} onClick={() => handleDayClick(day)} className={dayClasses}>{day.getUTCDate()}</button>
                    })}
                </div>
            </div>
        );
    };

    const previousMonthDate = new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() - 1, 1));

    // Responsive classes
    const containerClass = `bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-700 flex flex-col md:flex-row overflow-hidden ${isMobile ? 'w-full max-w-sm' : ''}`;

    const sidebarClass = `w-full md:w-44 p-2 border-b md:border-b-0 md:border-r border-gray-200 dark:border-gray-700 overflow-y-auto ${isMobile ? 'max-h-32 grid grid-cols-2 gap-1' : ''}`;

    const popupContent = (
        <div className={containerClass} onClick={(e) => e.stopPropagation()}>
            <div className={sidebarClass}>
                <ul className={isMobile ? "contents" : "space-y-1"}>
                    {presets.map(p => (
                        <li key={p.label} className={isMobile ? "" : ""}>
                            <button
                                onClick={() => handlePresetClick(p.label)}
                                className={`w-full text-left px-3 py-1.5 text-sm rounded transition-colors ${activePreset === p.label ? 'bg-blue-600 text-white' : 'hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                            >
                                {p.label}
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
            <div className="flex flex-col flex-1 pr-2 max-w-full">
                <div className="p-2">
                    <div className="flex items-center justify-between mb-2">
                        <button onClick={() => setViewDate(new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() - 1, 1)))} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                        </button>
                        <div className="flex gap-2">
                            <input type="text" readOnly value={tempRange.from.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} className="w-24 md:w-32 text-center bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-1 md:px-2 py-1 text-xs md:text-sm" />
                            <span className="self-center">→</span>
                            <input type="text" readOnly value={tempRange.to.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} className="w-24 md:w-32 text-center bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-1 md:px-2 py-1 text-xs md:text-sm" />
                        </div>
                        <button onClick={() => setViewDate(new Date(Date.UTC(viewDate.getUTCFullYear(), viewDate.getUTCMonth() + 1, 1)))} className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700">
                            <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
                        </button>
                    </div>
                </div>
                <div className={`flex border-t border-gray-200 dark:border-gray-700 justify-center ${isMobile ? 'overflow-x-auto' : ''}`}>
                    {!isMobile && renderCalendar(previousMonthDate)}
                    {renderCalendar(viewDate)}
                </div>
                <div className="flex justify-end gap-2 p-2 border-t border-gray-200 dark:border-gray-700 mt-auto">
                    <button onClick={handleCancel} className="px-4 py-2 text-sm font-semibold bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded-md w-full md:w-auto">Cancel</button>
                    <button onClick={handleApply} className="px-4 py-2 text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white rounded-md w-full md:w-auto">Apply</button>
                </div>
            </div>
        </div>
    );

    return (
        <div ref={wrapperRef} className="relative w-full md:w-44">
            <button onClick={() => setIsOpen(!isOpen)} className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 flex items-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-500 dark:text-gray-400 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" /></svg>
                <span className="text-sm ml-2 flex-grow text-left truncate" title={getButtonText()}>{getButtonText()}</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 ml-1 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
            </button>

            {isOpen && (
                isMobile
                    ? createPortal(
                        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200" onClick={() => setIsOpen(false)}>
                            {popupContent}
                        </div>,
                        document.body
                    )
                    : <div className="absolute top-full mt-2 z-20 w-auto">{popupContent}</div>
            )}
        </div>
    );
};

export default DateRangePicker;
