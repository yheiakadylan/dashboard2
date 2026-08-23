import { useState, useEffect, useCallback } from 'react';
import { fetchExchangeRates, ExchangeRates } from '../services/exchangeRates';

const CACHE_KEY = 'exchange_rates_cache';
const CACHE_DATE_KEY = 'exchange_rates_cache_date';

const isExchangeRateVerboseEnabled = () => {
    try {
        return import.meta.env.DEV && localStorage.getItem('exchangeRatesVerbose') === '1';
    } catch {
        return false;
    }
};

const logExchangeRates = (message: string, details?: unknown) => {
    if (isExchangeRateVerboseEnabled()) {
        console.info('[ExchangeRates]', message, details ?? '');
    }
};

const getTodayString = (): string => {
    const now = new Date();
    return now.toISOString().split('T')[0];
};

const getNextUpdateTime = (): Date => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow;
};

const loadCachedRates = (): ExchangeRates | null => {
    try {
        const cachedDate = localStorage.getItem(CACHE_DATE_KEY);
        const today = getTodayString();

        if (cachedDate === today) {
            const cachedRates = localStorage.getItem(CACHE_KEY);
            if (cachedRates) {
                logExchangeRates('Using cached rates from today', today);
                return JSON.parse(cachedRates);
            }
        } else {
            logExchangeRates('Cache expired or not found, will fetch fresh rates');
        }
    } catch (error) {
        console.error('[ExchangeRates] Error loading cache:', error);
    }
    return null;
};

const saveCachedRates = (rates: ExchangeRates): void => {
    try {
        const today = getTodayString();
        localStorage.setItem(CACHE_KEY, JSON.stringify(rates));
        localStorage.setItem(CACHE_DATE_KEY, today);
        logExchangeRates('Cached rates for', today);
    } catch (error) {
        console.error('[ExchangeRates] Error saving cache:', error);
    }
};

export const useExchangeRates = () => {
    const [rates, setRates] = useState<ExchangeRates | null>(() => loadCachedRates());
    const [originalRates, setOriginalRates] = useState<ExchangeRates | null>(() => rates);
    const [nextUpdateTime, setNextUpdateTime] = useState<Date | null>(() => rates ? getNextUpdateTime() : null);

    useEffect(() => {
        if (rates) return;
        const loadRates = async () => {
            logExchangeRates('Fetching fresh rates from API');
            const data = await fetchExchangeRates();
            if (data) {
                setRates(data);
                setOriginalRates(data);
                saveCachedRates(data);
                setNextUpdateTime(getNextUpdateTime());
            }
        };

        loadRates();
    }, [rates]);

    const updateRate = useCallback((currency: string, rate: number) => {
        setRates(prev => {
            if (!prev) return prev;

            const newRates = {
                ...prev,
                [currency]: rate
            };

            saveCachedRates(newRates);
            return newRates;
        });
    }, []);

    const resetRates = useCallback(() => {
        if (originalRates) {
            setRates(originalRates);
        }
    }, [originalRates]);

    const refreshRates = useCallback(async () => {
        logExchangeRates('Manual refresh triggered');
        const data = await fetchExchangeRates();
        if (data) {
            setRates(data);
            setOriginalRates(data);
            saveCachedRates(data);
            setNextUpdateTime(getNextUpdateTime());
        }
    }, []);

    return { rates, updateRate, resetRates, refreshRates, nextUpdateTime };
};
