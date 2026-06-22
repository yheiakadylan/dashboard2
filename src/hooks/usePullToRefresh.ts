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
    threshold = 120, // Increased default from 80
    maxPullDistance = 180,
    resistance = 0.4, // Reduced from 0.5 for more resistance
}: UsePullToRefreshOptions): UsePullToRefreshReturn => {
    const [isPulling, setIsPulling] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);

    const startY = useRef(0);
    const startX = useRef(0);
    const currentY = useRef(0);
    const containerRef = useRef<HTMLElement | null>(null);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        // Only activate if scrolled to top
        const target = e.currentTarget as HTMLElement;
        containerRef.current = target;

        if (target.scrollTop === 0 && !isRefreshing) {
            startY.current = e.touches[0].clientY;
            startX.current = e.touches[0].clientX;
            setIsPulling(true);
        }
    }, [isRefreshing]);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isPulling || isRefreshing) return;

        currentY.current = e.touches[0].clientY;
        const currentX = e.touches[0].clientX;
        const diffY = currentY.current - startY.current;
        const diffX = Math.abs(currentX - startX.current);

        // Only pull down if:
        // 1. Vertical movement is downward (positive diffY)
        // 2. Vertical movement is larger than horizontal (indicates vertical intent)
        // 3. Minimum 30px movement to avoid accidental triggers
        if (diffY > 30 && diffY > diffX * 1.5) {
            // Apply resistance to make pull feel natural
            const distance = Math.min(diffY * resistance, maxPullDistance);
            setPullDistance(distance);

            // Prevent default scroll when pulling
            if (distance > 15) {
                e.preventDefault();
            }
        } else {
            // Reset if not a clear downward pull
            setPullDistance(0);
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
