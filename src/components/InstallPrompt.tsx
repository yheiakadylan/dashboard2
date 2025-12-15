import React from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt';

// Detect iOS
const isIOS = () => {
    return /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
};

const isSafari = () => {
    return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
};

const InstallPrompt: React.FC = () => {
    const { isInstallable, isInstalled, promptInstall } = useInstallPrompt();
    const [isDismissed, setIsDismissed] = React.useState(false);
    const [showIOSInstructions, setShowIOSInstructions] = React.useState(false);

    // Don't show if already installed or dismissed
    if (isInstalled || isDismissed) {
        return null;
    }

    // Check if iOS
    const isIOSDevice = isIOS() && isSafari();

    // For iOS Safari: show manual instructions
    // For others: show only if installable (beforeinstallprompt fired)
    if (!isIOSDevice && !isInstallable) {
        return null;
    }

    const handleInstall = async () => {
        if (isIOSDevice) {
            setShowIOSInstructions(true);
        } else {
            const success = await promptInstall();
            if (!success) {
                setIsDismissed(true);
            }
        }
    };

    const handleDismiss = () => {
        setIsDismissed(true);
        setShowIOSInstructions(false);
    };

    return (
        <div className="fixed bottom-20 md:bottom-6 left-4 right-4 md:left-auto md:right-6 md:w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4 z-50 animate-slide-up">
            {!showIOSInstructions ? (
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                        <svg
                            className="w-10 h-10 text-blue-600 dark:text-blue-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                            />
                        </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">
                            Install Dashboard App
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                            {isIOSDevice
                                ? 'Add this app to your home screen for easy access.'
                                : 'Install this app on your device for quick access and offline support.'}
                        </p>
                        <div className="flex gap-2">
                            <button
                                onClick={handleInstall}
                                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
                            >
                                {isIOSDevice ? 'Show Instructions' : 'Install'}
                            </button>
                            <button
                                onClick={handleDismiss}
                                className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
                            >
                                Not now
                            </button>
                        </div>
                    </div>
                    <button
                        onClick={handleDismiss}
                        className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        aria-label="Close"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>
            ) : (
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-gray-900 dark:text-white">
                            Install on iOS
                        </h3>
                        <button
                            onClick={handleDismiss}
                            className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <ol className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
                        <li className="flex items-start gap-2">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">1</span>
                            <span>Tap the <strong>Share</strong> button
                                <svg className="inline w-4 h-4 mx-1" fill="currentColor" viewBox="0 0 24 24">
                                    <path d="M16 5l-1.42 1.42-1.59-1.59V16h-1.98V4.83L9.42 6.42 8 5l4-4 4 4zm4 5v11c0 1.1-.9 2-2 2H6c-1.11 0-2-.9-2-2V10c0-1.11.89-2 2-2h3v2H6v11h12V10h-3V8h3c1.1 0 2 .89 2 2z" />
                                </svg>
                                at the bottom of Safari
                            </span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">2</span>
                            <span>Scroll down and tap <strong>"Add to Home Screen"</strong></span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold">3</span>
                            <span>Tap <strong>"Add"</strong> in the top right corner</span>
                        </li>
                    </ol>
                    <button
                        onClick={handleDismiss}
                        className="w-full px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg transition-colors"
                    >
                        Got it
                    </button>
                </div>
            )}
        </div>
    );
};

export default InstallPrompt;
