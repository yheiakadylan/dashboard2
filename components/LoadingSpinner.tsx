import React from 'react';
import SkeletonLoader from './SkeletonLoader';

interface LoadingSpinnerProps {
    variant?: 'table-row' | 'card' | 'chart' | 'kpi-card';
    count?: number;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ variant = 'table-row', count = 3 }) => (
    <SkeletonLoader variant={variant} count={count} />
);

export default LoadingSpinner;
