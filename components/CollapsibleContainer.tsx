// dashboardtestfunc/components/CollapsibleContainer.tsx
import React, { useState } from 'react';

interface CollapsibleContainerProps {
  title: string;
  children: React.ReactNode;
}

const CollapsibleContainer: React.FC<CollapsibleContainerProps> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 md:p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-all duration-200 rounded-t-lg"
      >
        <h3 className="font-semibold text-sm md:text-base text-gray-900 dark:text-white truncate pr-2">{title}</h3>
        <svg
          className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-300 flex-shrink-0 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'}`}>
        <div className="p-2 md:p-4 border-t border-gray-200 dark:border-gray-700 overflow-x-auto">
          {children}
        </div>
      </div>
    </div>
  );
};

export default CollapsibleContainer;
