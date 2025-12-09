// dashboardtestfunc/components/CollapsibleContainer.tsx
import React, { useState } from 'react';

interface CollapsibleContainerProps {
  title: string;
  children: React.ReactNode;
}

const CollapsibleContainer: React.FC<CollapsibleContainerProps> = ({ title, children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800 shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex justify-between items-center p-4 text-left bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors rounded-t-lg"
      >
        <h3 className="font-semibold text-base text-gray-900 dark:text-white">{title}</h3>
        <svg className={`w-5 h-5 transform transition-transform text-gray-500 dark:text-gray-400 ${isOpen ? 'rotate-180' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      {isOpen && (
        <div className="p-2 md:p-4 border-t border-gray-200 dark:border-gray-700">
          {children}
        </div>
      )}
    </div>
  );
};

export default CollapsibleContainer;
