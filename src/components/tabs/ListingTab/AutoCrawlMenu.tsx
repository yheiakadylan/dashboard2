import React, { useState, useRef, useEffect } from 'react';
import { Clock, Check, ChevronDown, X } from 'lucide-react';
import { useCrawler } from '../../../contexts/CrawlerContext';
import { CustomSelect } from '../../ui/CustomSelect';

const INTERVAL_OPTIONS = [
    { label: '15m', value: 0.25 },
    { label: '30m', value: 0.5 },
    { label: '1h', value: 1 },
    { label: '3h', value: 3 },
    { label: '6h', value: 6 },
    { label: '12h', value: 12 },
    { label: '24h', value: 24 },
];

const AutoCrawlMenu: React.FC = () => {
    const {
        autoCrawlEnabled, setAutoCrawlEnabled,
        autoCrawlMode, setAutoCrawlMode,
        autoCrawlInterval, setAutoCrawlInterval,
        autoCrawlDailyTime, setAutoCrawlDailyTime,
        nextCrawlTime
    } = useCrawler();

    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const [customValue, setCustomValue] = useState('');
    const [customUnit, setCustomUnit] = useState<'m' | 'h'>('h');
    const [timeLeft, setTimeLeft] = useState('');

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Countdown logic
    useEffect(() => {
        if (!nextCrawlTime || !autoCrawlEnabled) {
            setTimeLeft('');
            return;
        }
        const update = () => {
            const diff = nextCrawlTime.getTime() - new Date().getTime();
            if (diff <= 0) {
                setTimeLeft('Due now');
                return;
            }
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);

            if (h > 0) setTimeLeft(`${h}h ${m}m`);
            else if (m > 0) setTimeLeft(`${m}m ${s}s`);
            else setTimeLeft(`${s}s`);
        };
        update();
        const timer = setInterval(update, 1000);
        return () => clearInterval(timer);
    }, [nextCrawlTime, autoCrawlEnabled]);

    const handleIntervalSelect = (hours: number) => {
        setAutoCrawlInterval(hours);
    };

    const handleCustomSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const val = parseFloat(customValue);
        if (isNaN(val) || val <= 0) return;

        const hours = customUnit === 'm' ? val / 60 : val;
        setAutoCrawlInterval(hours);
    };

    const formatCurrentInterval = (hours: number) => {
        if (hours < 1) return `${Math.round(hours * 60)}m`;
        return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
    };

    return (
        <div className="relative" ref={menuRef}>
            {/* Main Trigger Button - Matching Map Orders Style */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition-all ${autoCrawlEnabled
                    ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 ring-2 ring-blue-500/20'
                    : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                title="Configure Auto-Crawl Settings"
            >
                <div className={`relative ${autoCrawlEnabled ? 'animate-pulse-slow' : ''}`}>
                    <Clock className="w-4 h-4" />
                    {autoCrawlEnabled && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-green-500 rounded-full border border-white"></span>}
                </div>
                <div className="flex flex-col items-start leading-none">
                    <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1">
                        Auto Crawl
                        {autoCrawlEnabled && <span className="text-[10px] ml-1 opacity-80 font-normal normal-case">({timeLeft})</span>}
                    </span>
                    <span className="text-[10px] opacity-70 font-medium mt-0.5">
                        {autoCrawlEnabled
                            ? (autoCrawlMode === 'daily' ? `Runs at ${autoCrawlDailyTime}` : `Every ${formatCurrentInterval(autoCrawlInterval)}`)
                            : 'Disabled'}
                    </span>
                </div>
                <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Popover Menu */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-gray-100 p-4 z-50 animate-in fade-in zoom-in-95 duration-200">
                    <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100">
                        <span className="font-semibold text-gray-800">Crawl Schedule</span>
                        <div className="flex items-center gap-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={autoCrawlEnabled}
                                    onChange={(e) => setAutoCrawlEnabled(e.target.checked)}
                                    className="sr-only peer"
                                />
                                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none ring-0 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                            <span className={`text-xs font-bold ${autoCrawlEnabled ? 'text-blue-600' : 'text-gray-400'}`}>
                                {autoCrawlEnabled ? 'ON' : 'OFF'}
                            </span>
                        </div>
                    </div>

                    {/* Mode Selector */}
                    <div className="flex p-1 bg-gray-100 rounded-lg mb-4">
                        <button
                            onClick={() => setAutoCrawlMode('interval')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${autoCrawlMode === 'interval' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            Interval (Every Xh)
                        </button>
                        <button
                            onClick={() => setAutoCrawlMode('daily')}
                            className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all ${autoCrawlMode === 'daily' ? 'bg-white shadow-sm text-blue-600' : 'text-gray-500 hover:text-gray-700'
                                }`}
                        >
                            Daily (Fixed Time)
                        </button>
                    </div>

                    {autoCrawlMode === 'interval' ? (
                        <div className="space-y-4">
                            <div>
                                <span className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Quick Presets</span>
                                <div className="grid grid-cols-4 gap-2">
                                    {INTERVAL_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.label}
                                            onClick={() => handleIntervalSelect(opt.value)}
                                            className={`px-2 py-1.5 text-xs font-medium rounded-md border transition-colors ${Math.abs(autoCrawlInterval - opt.value) < 0.01
                                                ? 'bg-blue-100 text-blue-700 border-blue-200'
                                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                                }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <span className="text-xs font-semibold text-gray-500 uppercase mb-2 block">Custom Interval</span>
                                <form onSubmit={handleCustomSubmit} className="flex gap-2">
                                    <input
                                        type="number"
                                        min="1"
                                        step="1"
                                        placeholder="Value"
                                        value={customValue}
                                        onChange={(e) => setCustomValue(e.target.value)}
                                        className="w-32 px-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    />
                                    <CustomSelect
                                        value={customUnit}
                                        onChange={(val) => setCustomUnit(val)}
                                        options={[
                                            { label: 'Minute(s)', value: 'm' },
                                            { label: 'Hour(s)', value: 'h' },
                                        ]}
                                        className="inline-block"
                                        width="w-32"
                                        align="right"
                                        renderTrigger={() => (
                                            <div className="flex items-center justify-between gap-1 px-3 py-1.5 text-sm border border-gray-200 rounded-md bg-gray-50 cursor-pointer min-w-[90px]">
                                                <span>{customUnit === 'm' ? 'Minute(s)' : 'Hour(s)'}</span>
                                                <ChevronDown className="w-3 h-3 text-gray-500" />
                                            </div>
                                        )}
                                    />
                                    <button
                                        type="submit"
                                        disabled={!customValue}
                                        className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-md hover:bg-gray-800 disabled:opacity-50"
                                    >
                                        Set
                                    </button>
                                </form>
                            </div>
                        </div>
                    ) : (
                        <div className="py-2">
                            <label className="text-xs font-semibold text-gray-500 uppercase mb-2 block">
                                Select Daily Crawl Time
                            </label>
                            <div className="flex gap-2">
                                <input
                                    type="time"
                                    value={autoCrawlDailyTime}
                                    onChange={(e) => setAutoCrawlDailyTime(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm font-medium"
                                />
                            </div>
                            <p className="text-xs text-gray-400 mt-2">
                                The crawler will run automatically every day at {autoCrawlDailyTime}.
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default AutoCrawlMenu;
