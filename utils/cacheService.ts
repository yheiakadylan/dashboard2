import { get, set, del, clear } from 'idb-keyval';

/**
 * Cache entry with timestamp for TTL checking
 */
interface CacheEntry<T> {
    data: T;
    timestamp: number;
    version: number;
}

/**
 * Cache configuration
 */
interface CacheConfig {
    ttl?: number; // Time to live in milliseconds (default: 5 minutes)
    version?: number; // Cache version for invalidation
}

const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes
const CURRENT_VERSION = 1;

/**
 * IndexedDB cache service for API responses
 */
export class CacheService {
    /**
     * Get cached data if valid (not expired)
     */
    static async get<T>(key: string, config: CacheConfig = {}): Promise<T | null> {
        try {
            const entry = await get<CacheEntry<T>>(key);

            if (!entry) {
                return null;
            }

            const ttl = config.ttl ?? DEFAULT_TTL;
            const version = config.version ?? CURRENT_VERSION;
            const now = Date.now();
            const age = now - entry.timestamp;

            // Check version mismatch
            if (entry.version !== version) {
                await this.invalidate(key);
                return null;
            }

            // Check if expired
            if (age > ttl) {
                await this.invalidate(key);
                return null;
            }

            return entry.data;
        } catch (error) {
            console.warn('Cache get error:', error);
            return null;
        }
    }

    /**
     * Get cached data even if stale (for stale-while-revalidate pattern)
     */
    static async getStale<T>(key: string): Promise<{ data: T; isStale: boolean } | null> {
        try {
            const entry = await get<CacheEntry<T>>(key);

            if (!entry) {
                return null;
            }

            const now = Date.now();
            const age = now - entry.timestamp;
            const isStale = age > DEFAULT_TTL;

            return {
                data: entry.data,
                isStale
            };
        } catch (error) {
            console.warn('Cache getStale error:', error);
            return null;
        }
    }

    /**
     * Set cache data with timestamp
     */
    static async set<T>(key: string, data: T, config: CacheConfig = {}): Promise<void> {
        try {
            const version = config.version ?? CURRENT_VERSION;
            const entry: CacheEntry<T> = {
                data,
                timestamp: Date.now(),
                version
            };

            await set(key, entry);
        } catch (error) {
            console.error('Cache set error:', error);
        }
    }

    /**
     * Invalidate (delete) specific cache entry
     */
    static async invalidate(key: string): Promise<void> {
        try {
            await del(key);
        } catch (error) {
            console.error('Cache invalidate error:', error);
        }
    }

    /**
     * Clear all cache entries
     */
    static async clearAll(): Promise<void> {
        try {
            await clear();
        } catch (error) {
            console.error('Cache clear error:', error);
        }
    }

    /**
     * Check if cache entry exists and is valid
     */
    static async has(key: string, config: CacheConfig = {}): Promise<boolean> {
        const data = await this.get(key, config);
        return data !== null;
    }
}

/**
 * Generate cache key for dashboard data
 * IMPORTANT: Include timezone to prevent stale cache when timezone changes
 */
export function getDashboardCacheKey(teamId: string, startDate: string, endDate: string, timeZone: string): string {
    return `dashboard:${teamId}:${startDate}:${endDate}:${timeZone}`;
}

/**
 * Generate cache key for accounts
 */
export function getAccountsCacheKey(teamId: string): string {
    return `accounts:${teamId}`;
}

/**
 * Generate cache key for user roles
 */
export function getUserRolesCacheKey(userId: string): string {
    return `user:${userId}:roles`;
}
