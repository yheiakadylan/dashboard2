// hooks/usePullToRefresh.ts
import { useState, useRef, useCallback } from 'react';

interface UsePullToRefreshOptions {
    onRefresh: () => Promise<void>;
    threshold?: number; // Minimum pull distance to trigger refresh (pixels)
    maxPullDistance?: number; // Maximum pull distance for visual effect
    resistance?: number; // Pull resistance factor (0-1, lower = more resistance)
}

interface UsePullToRefreshReturn {
    isPulling: boolean;
    isRefreshing: boolean;
    pullDistance: number;
    pullProgress: number; // 0-1 for visual indicators
    touchHandlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchMove: (e: React.TouchEvent) => void;
        onTouchEnd: () => void;
    };
}

export const usePullToRefresh = ({
    onRefresh,
    threshold = 80,
    maxPullDistance = 120,
    resistance = 0.5,
}: UsePullToRefreshOptions): UsePullToRefreshReturn => {
    const [isPulling, setIsPulling] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);

    const startY = useRef(0);
    const currentY = useRef(0);
    const containerRef = useRef<HTMLElement | null>(null);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        // Only activate if scrolled to top
        const target = e.currentTarget as HTMLElement;
        containerRef.current = target;

        if (target.scrollTop === 0 && !isRefreshing) {
            startY.current = e.touches[0].clientY;
            setIsPulling(true);
        }
    }, [isRefreshing]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isPulling || isRefreshing) return;

        currentY.current = e.touches[0].clientY;
        const diff = currentY.current - startY.current;

        // Only pull down (positive diff)
        if (diff > 0) {
            // Apply resistance to make pull feel natural
            const distance = Math.min(diff * resistance, maxPullDistance);
            setPullDistance(distance);

            // Prevent default scroll when pulling
            if (distance > 10) {
                e.preventDefault();
            }
        }
    }, [isPulling, isRefreshing, maxPullDistance, resistance]);

    const handleTouchEnd = useCallback(async () => {
        if (!isPulling) return;

        setIsPulling(false);

        // Trigger refresh if pulled past threshold
        if (pullDistance >= threshold && !isRefreshing) {
            setIsRefreshing(true);

            try {
                await onRefresh();
            } catch (error) {
                console.error('Pull-to-refresh error:', error);
            } finally {
                setIsRefreshing(false);
                setPullDistance(0);
            }
        } else {
            // Animate back to 0
            setPullDistance(0);
        }

        // Reset refs
        startY.current = 0;
        currentY.current = 0;
    }, [isPulling, pullDistance, threshold, isRefreshing, onRefresh]);

    const pullProgress = Math.min(pullDistance / threshold, 1);

    return {
        isPulling,
        isRefreshing,
        pullDistance,
        pullProgress,
        touchHandlers: {
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd,
        },
    };
};
