// components/HapticButton.tsx
import React from 'react';
import { triggerHaptic, HapticType } from '../utils/haptics';

interface HapticButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    hapticType?: HapticType;
    children: React.ReactNode;
}

/**
 * Button component with built-in haptic feedback
 * Drop-in replacement for <button> with automatic haptic on click
 */
const HapticButton: React.FC<HapticButtonProps> = ({
    hapticType = 'light',
    onClick,
    children,
    ...props
}) => {
    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
        // Trigger haptic first
        triggerHaptic(hapticType);

        // Then call original onClick if provided
        if (onClick) {
            onClick(e);
        }
    };

    return (
        <button onClick={handleClick} {...props}>
            {children}
        </button>
    );
};

export default HapticButton;
