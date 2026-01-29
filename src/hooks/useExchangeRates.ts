
import { useState, useEffect, useCallback } from 'react';
import { fetchExchangeRates, ExchangeRates } from '../services/exchangeRates';

const CACHE_KEY = 'exchange_rates_cache';
const CACHE_DATE_KEY = 'exchange_rates_cache_date';

/**
 * Get today's date in YYYY-MM-DD format
 */
const getTodayString = (): string => {
    const now = new Date();
    return now.toISOString().split('T')[0];
};

/**
 * Load cached rates from localStorage if still valid for today
 */
const loadCachedRates = (): ExchangeRates | null => {
    try {
        const cachedDate = localStorage.getItem(CACHE_DATE_KEY);
        const today = getTodayString();

        // Check if cache is from today
        if (cachedDate === today) {
            const cachedRates = localStorage.getItem(CACHE_KEY);
            if (cachedRates) {
                console.log('[ExchangeRates] ✅ Using cached rates from today:', today);
                return JSON.parse(cachedRates);
            }
        } else {
            console.log('[ExchangeRates] 🔄 Cache expired or not found, will fetch fresh rates');
        }
    } catch (error) {
        console.error('[ExchangeRates] Error loading cache:', error);
    }
    return null;
};

/**
 * Save rates to localStorage with today's date
 */
const saveCachedRates = (rates: ExchangeRates): void => {
    try {
        const today = getTodayString();
        localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
        localStorage.setItem(CACHE_DATE_KEY, today);
        console.log('[ExchangeRates] 💾 Cached rates for:', today);
    } catch (error) {
        console.error('[ExchangeRates] Error saving cache:', error);
    }
};

/**
 * Exchange Rates Hook with Daily Caching
 * - Fetches from API only ONCE per day
 * - Cache expires at 00:00 every day
 * - Saves ~50 API calls/day → Only 30 calls/month instead of 1500
 */
export const useExchangeRates = () => {
    const [rates, setRates] = useState<ExchangeRates | null>(null);
    const [originalRates, setOriginalRates] = useState<ExchangeRates | null>(null);
    const [nextUpdateTime, setNextUpdateTime] = useState<Date | null>(null);

    useEffect(() => {
        const loadRates = async () => {
            // Try to load from cache first
            const cached = loadCachedRates();
            if (cached) {
                setRates(cached);
                setOriginalRates(cached);

                // Calculate next update time (00:00 tomorrow)
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                setNextUpdateTime(tomorrow);

                return; // ✅ Dùng cache, KHÔNG fetch API
            }

            // Cache miss or expired - fetch from API
            console.log('[ExchangeRates] 📡 Fetching fresh rates from API...');
            const data = await fetchExchangeRates();
            if (data) {
                setRates(data);
                setOriginalRates(data);
                saveCachedRates(data); // Save to cache

                // Calculate next update time (00:00 tomorrow)
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                tomorrow.setHours(0, 0, 0, 0);
                setNextUpdateTime(tomorrow);
            }
        };
        loadRates();
    }, []);

    /**
     * Manually update a single currency rate
     * @param currency - Currency code (e.g., 'AUD', 'GBP')
     * @param rate - New exchange rate to USD
     */
    const updateRate = useCallback((currency: string, rate: number) => {
        setRates(prev => {
            if (!prev) return prev;
            return {
                ...prev,
                [currency]: rate
            };
        });
    }, []);

    /**
     * Reset all rates to original API values
     */
    const resetRates = useCallback(() => {
        if (originalRates) {
            setRates(originalRates);
        }
    }, [originalRates]);

    /**
     * Force refresh rates from API (Bypass cache)
     */
    const refreshRates = useCallback(async () => {
        console.log('[ExchangeRates] 📡 Manual refresh triggered...');
        const data = await fetchExchangeRates();
        if (data) {
            setRates(data);
            setOriginalRates(data);
            saveCachedRates(data); // Update cache with fresh data

            // Recalculate next update time
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);
            setNextUpdateTime(tomorrow);
        }
    }, []);

    return { rates, updateRate, resetRates, refreshRates, nextUpdateTime };
};
