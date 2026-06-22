import { useState, useEffect } from 'react';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const useInstallPrompt = () => {
    const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
    const [isInstallable, setIsInstallable] = useState(false);
    const [isInstalled, setIsInstalled] = useState(false);

    useEffect(() => {
        // Check if app is already installed
        if (window.matchMedia('(display-mode: standalone)').matches) {
            setIsInstalled(true);
            return;
        }

        // Listen for the beforeinstallprompt event
        const handleBeforeInstallPrompt = (e: Event) => {
            // Prevent the default browser install prompt
            e.preventDefault();

            const promptEvent = e as BeforeInstallPromptEvent;
            setInstallPrompt(promptEvent);
            setIsInstallable(true);
        };

        // Listen for successful installation
        const handleAppInstalled = () => {
            setIsInstalled(true);
            setIsInstallable(false);
            setInstallPrompt(null);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const promptInstall = async () => {
        if (!installPrompt) return false;

        try {
            // Show the install prompt
            await installPrompt.prompt();

            // Wait for the user's response
            const choiceResult = await installPrompt.userChoice;

            if (choiceResult.outcome === 'accepted') {
                setIsInstallable(false);
                setInstallPrompt(null);
                return true;
            }

            return false;
        } catch (error) {
            console.error('Error showing install prompt:', error);
            return false;
        }
    };

    return {
        isInstallable,
        isInstalled,
        promptInstall,
    };
};
