import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Tab } from '../types';
import { useUI } from '../contexts/UIContext';
import {
    HomeIcon,
    DocumentTextIcon,
    QuestionMarkCircleIcon,
    TruckIcon,
    TagIcon
} from '@heroicons/react/24/outline';

interface BottomNavProps {
    tabs: Tab[];
}

const BottomNav: React.FC<BottomNavProps> = ({ tabs }) => {
    const { activeTab, handleTabClick, isNotificationDetailOpen } = useUI();
    const bottomTabs = tabs;

    // Refs for each tab button to calculate position
    const tabsRef = useRef<{ [key: string]: HTMLButtonElement | null }>({});

    // State for the sliding indicator
    const [indicatorStyle, setIndicatorStyle] = useState({
        left: 0,
        width: 0,
        top: 0,
        height: 0,
        opacity: 0,
    });

    // Memoized handler
    const handleClick = useCallback((tab: Tab) => {
        handleTabClick(tab);
    }, [handleTabClick]);

    // Update indicator position when activeTab changes or window resizes
    useEffect(() => {
        const updateIndicator = () => {
            const activeElement = tabsRef.current[activeTab];
            if (activeElement) {
                setIndicatorStyle({
                    left: activeElement.offsetLeft,
                    width: activeElement.offsetWidth,
                    top: activeElement.offsetTop,
                    height: activeElement.offsetHeight,
                    opacity: 1,
                });
            }
        };

        // Run immediately
        updateIndicator();

        // Run on resize
        window.addEventListener('resize', updateIndicator);

        // Small delay to ensure layout is stable (e.g. after fonts load or animations)
        const timeoutId = setTimeout(updateIndicator, 50);

        return () => {
            window.removeEventListener('resize', updateIndicator);
            clearTimeout(timeoutId);
        };
    }, [activeTab, tabs]); // Re-run if tabs list changes too

    // Icon mapping for each tab
    const getTabIcon = (tab: Tab) => {
        const iconClass = "w-6 h-6";
        switch (tab) {
            case 'Overview':
                return <HomeIcon className={iconClass} />;
            case 'Order List':
                return <DocumentTextIcon className={iconClass} />;
            case 'Products':
                return <TagIcon className={iconClass} />;
            case 'Fulfill':
                return <TruckIcon className={iconClass} />;
            case 'Support':
                return <QuestionMarkCircleIcon className={iconClass} />;
            default:
                return <HomeIcon className={iconClass} />;
        }
    };

    return (
        <nav
            className={`md:hidden fixed left-4 right-4 bg-white/40 dark:bg-black/30 backdrop-blur-2xl backdrop-saturate-[1.8] border border-white/30 dark:border-white/10 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.12)] z-50 flex justify-between items-center px-4 py-2 transition-opacity duration-200 ${isNotificationDetailOpen ? 'pointer-events-none opacity-30' : ''
                }`}
            style={{
                bottom: 'max(16px, env(safe-area-inset-bottom))'
            }}
        >
            {/* Sliding Active Indicator */}
            <div
                className="absolute bg-blue-100/50 dark:bg-blue-900/30 rounded-xl z-0 transition-all duration-300 ease-[cubic-bezier(0.25,0.8,0.25,1)]"
                style={{
                    left: indicatorStyle.left,
                    width: indicatorStyle.width,
                    top: indicatorStyle.top,
                    height: indicatorStyle.height,
                    opacity: indicatorStyle.opacity,
                }}
            />

            {bottomTabs.map((tab) => {
                const isActive = activeTab === tab;
                return (
                    <button
                        key={tab}
                        ref={(el) => { tabsRef.current[tab] = el; }}
                        onClick={() => handleClick(tab)}
                        className={`flex flex-col items-center justify-center relative p-2 transition-colors duration-300 rounded-xl z-20 ${isActive
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                            }`}
                    >
                        {/* Note: Removed individual active background div */}

                        <div className={`transition-transform duration-300 ${isActive ? 'scale-110' : 'scale-100'}`}>
                            {getTabIcon(tab)}
                        </div>
                        <span className={`text-[10px] font-bold transition-all duration-300 overflow-hidden whitespace-nowrap ${isActive ? 'max-h-[20px] opacity-100 mt-1' : 'max-h-0 opacity-0 mt-0'}`}>
                            {tab.toUpperCase()}
                        </span>
                    </button>
                );
            })}
        </nav>
    );
};

export default BottomNav;
