import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { useDashboard } from './DashboardContext'; // Access accounts/teamId
import { isExtensionInstalled, crawlShopViaExtension, getInstallInstructions, syncConfigToExtension, stopExtensionCrawl, triggerExtensionCrawl } from '../services/extensionCrawler';
import { crawlAccount } from '../services/etsyCrawler';
import { Account } from '../types';
import { auth, db } from '../services/firebaseService'; // Import auth and db
import { collection, onSnapshot, query, where } from 'firebase/firestore'; // ✅ Import Firestore functions

interface CrawlStatus {
    status: 'pending' | 'success' | 'error' | 'crawling' | 'waiting';
    message?: string;
}

interface CrawlerContextType {
    isCrawling: boolean;
    progress: { current: number; total: number; status: string };
    crawlStatuses: Record<string, CrawlStatus>;
    startBatchCrawl: (accounts: Account[]) => Promise<void>;
    stopCrawl: () => void;
    extensionAvailable: boolean;
    // New auto-crawl properties
    // Auto Crawl (Enhanced)
    autoCrawlEnabled: boolean;
    setAutoCrawlEnabled: (enabled: boolean) => void;
    autoCrawlMode: 'interval' | 'daily'; // New
    setAutoCrawlMode: (mode: 'interval' | 'daily') => void;
    autoCrawlInterval: number; // Hours (interval mode)
    setAutoCrawlInterval: (hours: number) => void;
    autoCrawlDailyTime: string; // HH:mm (daily mode)
    setAutoCrawlDailyTime: (time: string) => void;
    nextCrawlTime: Date | null;

    // Global Setting: New Listing Duration (Hours)
    newListingDuration: number;
    setNewListingDuration: (hours: number) => void;
}

const CrawlerContext = createContext<CrawlerContextType | undefined>(undefined);

export const CrawlerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { teamId, allAccounts } = useDashboard(); // Access allAccounts for auto-crawl
    const etsyAccounts = allAccounts.filter(acc => acc.platforms?.includes('etsy'));

    // State
    const [isCrawling, setIsCrawling] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, status: '' });
    const [crawlStatuses, setCrawlStatuses] = useState<Record<string, CrawlStatus>>({});
    const [extensionAvailable, setExtensionAvailable] = useState(false);

    // Auto Crawl State
    const [autoCrawlEnabled, setAutoCrawlEnabled] = useState(false);
    const [autoCrawlMode, setAutoCrawlMode] = useState<'interval' | 'daily'>('interval');
    const [autoCrawlInterval, setAutoCrawlInterval] = useState(12); // hours
    const [autoCrawlDailyTime, setAutoCrawlDailyTime] = useState('06:00');
    const [nextCrawlTime, setNextCrawlTime] = useState<Date | null>(null);

    // New Listing Duration State
    const [newListingDuration, setNewListingDuration] = useState(24);

    // Refs for control
    const abortRef = useRef(false);

    // Initial check
    useEffect(() => {
        isExtensionInstalled().then(setExtensionAvailable);

        // Load Settings
        const savedDuration = localStorage.getItem('listing_new_duration');
        if (savedDuration) setNewListingDuration(parseInt(savedDuration, 10));
    }, []);

    // Helper: Calculate Next Crawl
    const calculateNextCrawl = useCallback((mode: 'interval' | 'daily', val: number | string) => {
        const now = new Date();
        let next: Date;

        if (mode === 'daily') {
            const timeStr = typeof val === 'string' ? val : '06:00';
            const [h, m] = timeStr.split(':').map(Number);
            next = new Date();
            next.setHours(h, m, 0, 0);
            if (next <= now) {
                next.setDate(next.getDate() + 1); // Tomorrow
            }
        } else {
            // Interval
            const hours = typeof val === 'number' ? val : 12;
            next = new Date(now.getTime() + hours * 60 * 60 * 1000);
        }

        setNextCrawlTime(next);
        localStorage.setItem('next_crawl_target', next.toISOString());
    }, []);

    const stopCrawl = useCallback(() => {
        if (isCrawling) {
            abortRef.current = true;
            setIsCrawling(false);
            setProgress(prev => ({ ...prev, status: 'Stopping...' }));
            stopExtensionCrawl().catch(console.error);
        }
    }, [isCrawling]);

    // MAIN CRAWL FUNCTION - Delegates to Extension
    const startBatchCrawl = useCallback(async (accountsToCrawl: Account[], isAuto: boolean = false) => {
        if (!teamId) return;
        if (!extensionAvailable) {
            alert(getInstallInstructions());
            return;
        }

        setIsCrawling(true);
        // Show status briefly
        setProgress({
            current: 0,
            total: accountsToCrawl.length,
            status: 'Triggering Extension...'
        });

        try {
            await triggerExtensionCrawl();
            console.log('Extension triggered successfully');

            setProgress({
                current: 0,
                total: accountsToCrawl.length,
                status: 'Extension is crawling shops...'
            });

            // ✅ FIXED: Don't reset progress after 3s
            // Progress will stay visible and update via real-time Firestore listener
            // See useEffect below for real-time status monitoring

        } catch (error: any) {
            console.error('Failed to trigger extension:', error);
            setIsCrawling(false);
            alert('Failed to trigger extension: ' + (error.message || 'Unknown error'));
        }
    }, [teamId, extensionAvailable]);


    // Load auto crawl settings from local storage
    const [isLoaded, setIsLoaded] = useState(false);

    useEffect(() => {
        const savedEnabled = localStorage.getItem('auto_crawl_enabled') === 'true';
        const savedMode = (localStorage.getItem('auto_crawl_mode') || 'interval') as 'interval' | 'daily';
        const savedInterval = parseInt(localStorage.getItem('auto_crawl_interval') || '12', 10);
        const savedDailyTime = localStorage.getItem('auto_crawl_daily_time') || '06:00';
        const savedTarget = localStorage.getItem('next_crawl_target');

        const savedDuration = localStorage.getItem('listing_new_duration');
        if (savedDuration) setNewListingDuration(parseInt(savedDuration, 10));

        setAutoCrawlEnabled(savedEnabled);
        setAutoCrawlMode(savedMode);
        setAutoCrawlInterval(savedInterval);
        setAutoCrawlDailyTime(savedDailyTime);

        if (savedEnabled && savedTarget) {
            const targetDate = new Date(savedTarget);
            if (targetDate > new Date()) {
                setNextCrawlTime(targetDate);
            } else {
                // Determine next immediate if missed
                calculateNextCrawl(savedMode, savedMode === 'daily' ? savedDailyTime : 0.02);
            }
        } else if (savedEnabled) {
            calculateNextCrawl(savedMode, savedMode === 'daily' ? savedDailyTime : savedInterval);
        }
        setIsLoaded(true);
    }, [calculateNextCrawl]);



    // Save settings
    useEffect(() => {
        if (!isLoaded) return; // Prevent overwriting before load

        localStorage.setItem('auto_crawl_enabled', String(autoCrawlEnabled));
        localStorage.setItem('auto_crawl_mode', autoCrawlMode);
        localStorage.setItem('auto_crawl_interval', String(autoCrawlInterval));
        localStorage.setItem('auto_crawl_daily_time', autoCrawlDailyTime);

        if (autoCrawlEnabled && !nextCrawlTime) {
            calculateNextCrawl(autoCrawlMode, autoCrawlMode === 'daily' ? autoCrawlDailyTime : autoCrawlInterval);
        } else if (!autoCrawlEnabled) {
            setNextCrawlTime(null);
            localStorage.removeItem('next_crawl_target');
        }

        // SYNC TO EXTENSION (Background Logic)
        if (teamId && auth.currentUser) {
            // Use ALL Etsy accounts to allow extension to see disabled ones (unchecked)
            const etsyAccounts = allAccounts.filter(acc => acc.platforms?.includes('etsy'));

            auth.currentUser.getIdToken().then(token => {
                syncConfigToExtension({
                    // Only sync critical auth and shop list. Let Extension manage schedule.
                    teamId,
                    userId: auth.currentUser?.uid || 'user',
                    email: auth.currentUser?.email,
                    token, // Critical: Auto-login extension
                    shops: etsyAccounts.map(s => ({
                        id: s.id,
                        label: s.label,
                        selected: !!s.listing_tracking_enabled
                    }))
                }).catch(console.error);
            });
        }
    }, [autoCrawlEnabled, autoCrawlMode, autoCrawlInterval, autoCrawlDailyTime, nextCrawlTime, calculateNextCrawl, isLoaded, teamId, allAccounts]);


    // Timer removed - Auto crawl is now handled exclusively by the Chrome Extension
    /*
    useEffect(() => {
        if (!autoCrawlEnabled || !nextCrawlTime) return;

        const timer = setInterval(() => {
            if (new Date() >= nextCrawlTime && !isCrawling) {
                console.log('⏰ Auto Crawl Triggered!');
                // Filter enabled accounts from CURRENT allAccounts
                const enabled = allAccounts.filter(acc => acc.platforms?.includes('etsy') && acc.listing_tracking_enabled);
                if (enabled.length > 0) {
                    startBatchCrawl(enabled, true); // Pass true to indicate auto-triggered
                    // Next crawl will be scheduled in finally block of startBatchCrawl
                }
            }
        }, 60000); // Check every minute

        return () => clearInterval(timer);
    }, [autoCrawlEnabled, nextCrawlTime, isCrawling, allAccounts, startBatchCrawl, calculateNextCrawl, autoCrawlInterval]);
    */

    // ✅ NEW: Real-time listener for crawl progress
    // Monitor account updates to show live progress when extension crawls
    const crawlStateRef = useRef({
        completedCount: 0,
        watchedAccounts: new Set<string>(),
        startTime: 0
    });

    useEffect(() => {
        if (!teamId || !isCrawling) return;

        console.log('[CrawlerContext] Setting up real-time crawl progress listener');

        // Reset state when new crawl session starts
        crawlStateRef.current = {
            completedCount: 0,
            watchedAccounts: new Set<string>(),
            startTime: Date.now()
        };

        const accountsRef = collection(db, 'user', teamId, 'accounts');
        const etsyQuery = query(accountsRef, where('platforms', 'array-contains', 'etsy'));

        const unsubscribe = onSnapshot(etsyQuery, (snapshot) => {
            snapshot.docChanges().forEach((change) => {
                if (change.type === 'modified') {
                    const accountData = change.doc.data();
                    const accountId = change.doc.id;

                    // Check if last_listing_crawl was updated
                    if (accountData.last_listing_crawl) {
                        const lastCrawlTime = accountData.last_listing_crawl.toMillis
                            ? accountData.last_listing_crawl.toMillis()
                            : new Date(accountData.last_listing_crawl).getTime();

                        // ✅ Only count if crawled AFTER this session started
                        if (lastCrawlTime > crawlStateRef.current.startTime &&
                            !crawlStateRef.current.watchedAccounts.has(accountId)) {

                            crawlStateRef.current.watchedAccounts.add(accountId);
                            crawlStateRef.current.completedCount++;

                            const stats = accountData.last_crawl_stats;
                            const statusMsg = stats
                                ? `${accountData.label}: +${stats.added || 0} -${stats.removed || 0}`
                                : `${accountData.label}: Done`;

                            console.log(`[CrawlerContext] Progress: ${crawlStateRef.current.completedCount} completed - ${statusMsg}`);

                            // Get enabled count from current etsyAccounts snapshot
                            const enabledCount = etsyAccounts.filter(a => a.listing_tracking_enabled).length;

                            setProgress({
                                current: crawlStateRef.current.completedCount,
                                total: enabledCount,
                                status: statusMsg
                            });

                            // Check if all enabled accounts are done
                            if (crawlStateRef.current.completedCount >= enabledCount) {
                                console.log('[CrawlerContext] All accounts crawled! Resetting state...');
                                setTimeout(() => {
                                    setIsCrawling(false);
                                    setProgress({ current: 0, total: 0, status: 'Crawl complete!' });
                                }, 2000); // Show "Done" for 2s before reset
                            }
                        }
                    }
                }
            });
        }, (error) => {
            console.error('[CrawlerContext] Listener error:', error);
            setIsCrawling(false);
        });

        return () => {
            console.log('[CrawlerContext] Cleaning up crawl progress listener');
            unsubscribe();
        };
    }, [teamId, isCrawling]); // ✅ Removed etsyAccounts from dependencies


    // ✅ NEW: Listen for extension messages (crawl start + completion)
    useEffect(() => {
        if (!teamId) return;

        // Listen for messages from extension
        const handleExtensionMessage = (event: MessageEvent) => {
            // Handle crawl START
            if (event.data && event.data.type === 'EXTENSION_CRAWL_START') {
                console.log('[CrawlerContext] Extension started crawling (Run Now clicked)');
                const enabledCount = etsyAccounts.filter(a => a.listing_tracking_enabled).length;

                setIsCrawling(true);
                setProgress({
                    current: 0,
                    total: enabledCount,
                    status: 'Extension is crawling shops...'
                });
            }

            // ✅ NEW: Handle crawl COMPLETE
            if (event.data && event.data.type === 'EXTENSION_CRAWL_COMPLETE') {
                const stats = event.data.stats;
                console.log('[CrawlerContext] Extension crawl complete:', stats);

                const durationSec = Math.round(stats.duration / 1000);
                const statusMsg = `Complete! ${stats.successCount} success, ${stats.errorCount} errors (${durationSec}s)`;

                setProgress({
                    current: stats.totalShops,
                    total: stats.totalShops,
                    status: statusMsg
                });

                // Reset after 3s
                setTimeout(() => {
                    setIsCrawling(false);
                    setProgress({ current: 0, total: 0, status: '' });
                }, 3000);
            }
        };

        window.addEventListener('message', handleExtensionMessage);

        return () => {
            window.removeEventListener('message', handleExtensionMessage);
        };
    }, [teamId, etsyAccounts]);

    // Prevent Unload Warning
    useEffect(() => {
        const handleBeforeUnload = (e: BeforeUnloadEvent) => {
            if (isCrawling) {
                e.preventDefault();
                e.returnValue = ''; // Chrome requires returnValue to be set
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [isCrawling]);

    const updateAutoCrawlInterval = useCallback((interval: number) => {
        setAutoCrawlInterval(interval);
        if (autoCrawlEnabled && autoCrawlMode === 'interval') {
            calculateNextCrawl('interval', interval);
        }
    }, [autoCrawlEnabled, autoCrawlMode, calculateNextCrawl]);

    const updateAutoCrawlDailyTime = useCallback((time: string) => {
        setAutoCrawlDailyTime(time);
        if (autoCrawlEnabled && autoCrawlMode === 'daily') {
            calculateNextCrawl('daily', time);
        }
    }, [autoCrawlEnabled, autoCrawlMode, calculateNextCrawl]);

    const updateAutoCrawlMode = useCallback((mode: 'interval' | 'daily') => {
        setAutoCrawlMode(mode);
        if (autoCrawlEnabled) {
            calculateNextCrawl(mode, mode === 'daily' ? autoCrawlDailyTime : autoCrawlInterval);
        }
    }, [autoCrawlEnabled, autoCrawlDailyTime, autoCrawlInterval, calculateNextCrawl]);

    return (
        <CrawlerContext.Provider value={{
            isCrawling,
            progress,
            crawlStatuses,
            startBatchCrawl,
            stopCrawl,
            extensionAvailable,
            autoCrawlEnabled,
            setAutoCrawlEnabled,
            autoCrawlMode,
            setAutoCrawlMode: updateAutoCrawlMode,
            autoCrawlInterval,
            setAutoCrawlInterval: updateAutoCrawlInterval,
            autoCrawlDailyTime,
            setAutoCrawlDailyTime: updateAutoCrawlDailyTime,
            nextCrawlTime,
            newListingDuration,
            setNewListingDuration: (h: number) => {
                setNewListingDuration(h);
                localStorage.setItem('listing_new_duration', String(h));
            }
        }}>
            {children}
        </CrawlerContext.Provider>
    );
};

export const useCrawler = () => {
    const context = useContext(CrawlerContext);
    if (context === undefined) {
        throw new Error('useCrawler must be used within a CrawlerProvider');
    }
    return context;
};
