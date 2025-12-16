import React, { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastProps {
  id: string;
  message: string;
  type: ToastType;
  onClose: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ id, message, type, onClose }) => {
  const [progress, setProgress] = useState(100);
  const [isPaused, setIsPaused] = useState(false);
  const DURATION = 5000; // 5 seconds

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        const newProgress = prev - (100 / (DURATION / 50)); // Update every 50ms
        if (newProgress <= 0) {
          clearInterval(interval);
          return 0;
        }
        return newProgress;
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isPaused]);

  // Separate effect to handle auto-close when progress reaches 0
  // Note: onClose is stable (useCallback in parent), so it's safe to omit from deps
  useEffect(() => {
    if (progress <= 0) {
      onClose(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress, id]);

  const typeConfig = {
    success: {
      bgColor: 'bg-gradient-to-r from-green-500 to-green-600',
      borderColor: 'border-green-600',
      progressColor: 'bg-green-300',
      icon: (
        <svg className="w-6 h-6 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    error: {
      bgColor: 'bg-gradient-to-r from-red-500 to-red-600',
      borderColor: 'border-red-600',
      progressColor: 'bg-red-300',
      icon: (
        <svg className="w-6 h-6 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
    info: {
      bgColor: 'bg-gradient-to-r from-blue-500 to-blue-600',
      borderColor: 'border-blue-600',
      progressColor: 'bg-blue-300',
      icon: (
        <svg className="w-6 h-6 mr-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    },
  };

  const config = typeConfig[type];

  return (
    <div
      className={`relative flex items-start w-full max-w-sm p-4 mb-3 text-white rounded-lg shadow-lg hover:shadow-xl dark:text-gray-100 border-2 ${config.bgColor} ${config.borderColor} transition-all duration-300 transform animate-slide-in-right backdrop-blur-sm`}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20 rounded-b-lg overflow-hidden">
        <div
          className={`h-full ${config.progressColor} transition-all duration-100 ease-linear`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Icon */}
      <div className="inline-flex items-center justify-center flex-shrink-0">
        {config.icon}
      </div>

      {/* Message */}
      <div className="ml-1 text-sm font-medium break-words flex-grow pr-2">
        {message}
      </div>

      {/* Close Button */}
      <button
        type="button"
        className="ml-auto -mr-1 -mt-1 bg-white/20 hover:bg-white/30 text-white rounded-lg focus:ring-2 focus:ring-white/50 p-1.5 inline-flex h-8 w-8 transition-colors items-center justify-center flex-shrink-0"
        onClick={() => onClose(id)}
        aria-label="Close"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"></path>
        </svg>
      </button>
    </div>
  );
};

export default Toast;
