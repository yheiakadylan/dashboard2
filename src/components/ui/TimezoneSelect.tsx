
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { getOffsetInfo } from '../../utils/timezones';
import useMediaQuery from '../../hooks/useMediaQuery';

interface Option {
  value: string;
  label: string;
}

interface TimezoneSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
}

const COMMON_TIMEZONE_LABELS = ['UTC+07:00', 'UTC-07:00', 'UTC-08:00'];

const TimezoneSelect: React.FC<TimezoneSelectProps> = ({ value, onChange, options }) => {
  const isMobile = useMediaQuery('(max-width: 767px)');
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const { commonOptions, otherOptions, orderedOptions } = useMemo(() => {
    const common = COMMON_TIMEZONE_LABELS
      .map(label => options.find(option => option.label === label))
      .filter((option): option is Option => Boolean(option));
    const commonLabels = new Set(common.map(option => option.label));
    const other = options.filter(option => !commonLabels.has(option.label));

    return {
      commonOptions: common,
      otherOptions: other,
      orderedOptions: [...common, ...other],
    };
  }, [options]);

  // Determine current label based on value (IANA ID) or fallback to calculating offset
  let displayLabel = 'Select Timezone';
  
  // 1. Try to find exact match in options
  const exactMatch = options.find(opt => opt.value === value);
  if (exactMatch) {
      displayLabel = exactMatch.label;
  } else if (value) {
      // 2. If no exact match (e.g. user stored 'Asia/Bangkok' but options has 'Asia/Ho_Chi_Minh'),
      // calculate offset and show that label.
      const { offsetStr } = getOffsetInfo(value);
      displayLabel = offsetStr; 
  }

  useEffect(() => {
    if (isMobile || !isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMobile, isOpen]);

  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  if (isMobile) {
    return (
      <div className="relative w-full">
        <select 
            value={value} 
            onChange={(e) => onChange(e.target.value)}
            className="appearance-none w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        >
            {orderedOptions.map(opt => (
                <option key={opt.value} value={opt.value}>
                    {opt.label}
                </option>
            ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500 dark:text-gray-400">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
        </div>
      </div>
    );
  }

  return (
      <div ref={wrapperRef} className="relative w-32">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-md px-3 py-2 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm flex items-center justify-between text-left"
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          title="Select Timezone"
        >
          <span className="truncate font-medium">
            {displayLabel}
          </span>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0 text-gray-500 ml-2" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
        </button>

        {isOpen && (
          <ul
            className="absolute top-full mt-1 z-20 w-full bg-white dark:bg-gray-800 rounded-md shadow-lg border border-gray-200 dark:border-gray-700 max-h-60 overflow-y-auto"
            role="listbox"
          >
            {commonOptions.map(option => {
              const isSelected = displayLabel === option.label;

              return (
                <li
                  key={option.label} // Use label as key since we want unique offsets
                  onClick={() => handleOptionClick(option.value)}
                  className={`px-3 py-2 text-sm cursor-pointer truncate transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0
                    ${isSelected 
                      ? 'font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300' 
                      : 'font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20'
                    }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  {option.label}
                </li>
              );
            })}
            {commonOptions.length > 0 && otherOptions.length > 0 && (
              <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/40">
                All timezones
              </li>
            )}
            {otherOptions.map(option => {
              const isSelected = displayLabel === option.label;

              return (
                <li
                  key={option.label}
                  onClick={() => handleOptionClick(option.value)}
                  className={`px-3 py-2 text-sm cursor-pointer truncate transition-colors border-b border-gray-50 dark:border-gray-700 last:border-0
                    ${isSelected
                      ? 'font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
                    }`}
                  role="option"
                  aria-selected={isSelected}
                >
                  {option.label}
                </li>
              );
            })}
          </ul>
        )}
      </div>
  );
};

export default TimezoneSelect;
