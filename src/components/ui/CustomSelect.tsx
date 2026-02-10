import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
    label: string;
    value: string | number;
}

interface CustomSelectProps {
    value: string | number;
    onChange: (value: any) => void;
    options: SelectOption[];
    className?: string;
    renderTrigger?: (value: string | number, label: string) => React.ReactNode;
    align?: 'left' | 'right';
    width?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
    value,
    onChange,
    options,
    className = '',
    renderTrigger,
    align = 'left',
    width = 'w-48'
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    const selectedOption = options.find(opt => opt.value === value);
    const currentLabel = selectedOption?.label || String(value);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = (val: string | number) => {
        onChange(val);
        setIsOpen(false);
    };

    return (
        <div className={`relative inline-block ${className}`} ref={containerRef}>
            <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer select-none">
                {renderTrigger ? renderTrigger(value, currentLabel) : (
                    <button type="button" className="flex items-center justify-between w-full px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20">
                        <span className="text-sm font-medium text-gray-700">{currentLabel}</span>
                        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                )}
            </div>

            {isOpen && (
                <div
                    className={`absolute bg-white rounded-xl shadow-2xl border border-gray-100 py-1.5 mt-2 animate-in fade-in zoom-in-95 duration-200 origin-top ${width} ${align === 'right' ? 'right-0' : 'left-0'}`}
                    style={{ zIndex: 9999 }}
                >
                    {options.map((option) => {
                        const isSelected = option.value === value;
                        return (
                            <div
                                key={option.value}
                                onClick={(e) => {
                                    e.stopPropagation(); // Prevent triggering current close
                                    handleSelect(option.value);
                                }}
                                className={`
                                    flex items-center justify-between px-3 py-2 text-sm cursor-pointer transition-colors mx-1 rounded-lg
                                    ${isSelected ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}
                                `}
                            >
                                <span>{option.label}</span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-blue-600" />}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
