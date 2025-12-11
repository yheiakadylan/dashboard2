// utils/haptics.ts
// Haptic feedback utility for iOS and Android devices

/**
 * Check if device supports haptic feedback
 */
const isHapticSupported = (): boolean => {
    return 'vibrate' in navigator;
};

/**
 * Haptic feedback types with different intensities
 */
export type HapticType = 'light' | 'medium' | 'heavy' | 'selection';

/**
 * Vibration patterns for different haptic types
 */
const hapticPatterns: Record<HapticType, number | number[]> = {
    light: 10,      // Quick tap
    medium: 20,     // Normal feedback
    heavy: 30,      // Strong feedback (delete, important actions)
    selection: 5,   // Very light (tab switches, selections)
};

/**
 * Trigger haptic feedback
 * @param type - Type of haptic feedback to trigger
 */
export const triggerHaptic = (type: HapticType = 'light'): void => {
    if (!isHapticSupported()) {
        return; // Graceful fallback for unsupported devices
    }

    try {
        const pattern = hapticPatterns[type];
        navigator.vibrate(pattern);
    } catch (error) {
        // Silently fail if vibration API throws error
        console.debug('Haptic feedback failed:', error);
    }
};

/**
 * Add haptic feedback to any click handler
 * Usage: onClick={(e) => withHaptic(() => handleClick(e), 'medium')}
 */
export const withHaptic = <T extends (...args: any[]) => any>(
    callback: T,
    type: HapticType = 'light'
): T => {
    return ((...args: Parameters<T>) => {
        triggerHaptic(type);
        return callback(...args);
    }) as T;
};

/**
 * React hook for haptic feedback
 */
export const useHaptic = () => {
    return {
        triggerHaptic,
        withHaptic,
        isSupported: isHapticSupported(),
    };
};
