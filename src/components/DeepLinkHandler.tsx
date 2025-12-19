/**
 * Deep Link Handler
 * Handles URL parameters for notification deep linking
 */

import React, { useEffect } from 'react';
import { useUI } from '../contexts/UIContext';

interface Props {
    onOpenOrder?: (orderId: string) => void;
}

export const DeepLinkHandler: React.FC<Props> = ({ onOpenOrder }) => {
    const { setActiveTab, setSelectedNotificationId, setIsNotificationDetailOpen } = useUI();

    useEffect(() => {
        // Parse URL parameters
        const params = new URLSearchParams(window.location.search);

        // Handle notification deep link
        const notificationId = params.get('notification');
        if (notificationId) {
            console.log('[Deep Link] Opening notification:', notificationId);
            setSelectedNotificationId(notificationId);
            setIsNotificationDetailOpen(true);
            // Clear URL parameter
            window.history.replaceState({}, '', window.location.pathname);
            return;
        }

        // Handle order deep link
        const orderId = params.get('order');
        if (orderId && onOpenOrder) {
            console.log('[Deep Link] Opening order:', orderId);
            setActiveTab('Order List');
            // Wait for tab to load, then open order detail
            setTimeout(() => {
                onOpenOrder(orderId);
            }, 500);
            // Clear URL parameter
            window.history.replaceState({}, '', window.location.pathname);
            return;
        }

        // Handle tab parameter
        const tab = params.get('tab');
        if (tab) {
            console.log('[Deep Link] Switching to tab:', tab);
            setActiveTab(tab as any); // TODO: Validate tab name
            // Clear URL parameter
            window.history.replaceState({}, '', window.location.pathname);
        }
    }, [setActiveTab, setSelectedNotificationId, setIsNotificationDetailOpen, onOpenOrder]);

    return null;
};
