import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search } from 'lucide-react';

interface SelectOption {
  value: string;
  label: string;
  status?: 'alive' | 'suspended';
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  triggerClassName?: string;
  align?: 'left' | 'right';
  icon?: React.ReactNode;
  disabled?: boolean;
  showSearch?: boolean;
  searchPlaceholder?: string;
}

const CustomSelect: React.FC<CustomSelectProps> = ({
  value,
  onChange,
  options,
  className = '',
  triggerClassName = '',
  align = 'left',
  icon,
  disabled = false,
  showSearch = false,
  searchPlaceholder = 'Search...',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchValue('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = useMemo(() => (
    options.find(option => option.value === value)
  ), [options, value]);
  const selectedLabel = selectedOption?.label || value;

  const renderStatusIcon = (status?: SelectOption['status']) => {
    if (!status) return null;

    const isSuspended = status === 'suspended';
    return (
      <span
        className={`mr-2 inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
          isSuspended
            ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
        }`}
        title={isSuspended ? 'Suspended' : 'Live'}
      >
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  };

  const filteredOptions = useMemo(() => {
    if (!showSearch) return options;
    const normalizedSearch = searchValue.toLowerCase();
    return options.filter(option => option.label.toLowerCase().includes(normalizedSearch));
  }, [options, searchValue, showSearch]);

  const handleSelect = (nextValue: string) => {
    onChange(nextValue);
    setIsOpen(false);
    setSearchValue('');
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => !disabled && setIsOpen(prev => !prev)}
        disabled={disabled}
        className={`flex items-center justify-between w-full appearance-none bg-gray-100 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md px-3 py-2 text-sm font-medium text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors ${triggerClassName} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <span className="flex min-w-0 items-center truncate mr-1">
          {renderStatusIcon(selectedOption?.status)}
          <span className="truncate">{selectedLabel}</span>
        </span>
        {icon || (
          <svg className="h-4 w-4 text-gray-500 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {isOpen && !disabled && (
        <div className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} min-w-full max-h-60 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-xl z-50 py-1`}>
          {showSearch && (
            <div className="px-2 py-1.5 sticky top-0 bg-white dark:bg-gray-800 z-10 border-b border-gray-100 dark:border-gray-700 mb-1">
              <div className="relative flex items-center">
                <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                  <Search className="h-3.5 w-3.5 text-gray-400" />
                </div>
                <input
                  type="text"
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-md bg-gray-50 dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                  placeholder={searchPlaceholder}
                  value={searchValue}
                  onChange={(event) => setSearchValue(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  autoFocus
                />
              </div>
            </div>
          )}

          {filteredOptions.length > 0 ? (
            filteredOptions.map(option => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className={`w-full text-left px-3 py-2 text-sm font-medium transition-colors flex items-center ${value === option.value
                  ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {renderStatusIcon(option.status)}
                <span className="truncate">{option.label}</span>
              </button>
            ))
          ) : (
            <div className="px-3 py-4 text-sm text-gray-500 dark:text-gray-400 text-center">No results found</div>
          )}
        </div>
      )}
    </div>
  );
};

export default CustomSelect;
