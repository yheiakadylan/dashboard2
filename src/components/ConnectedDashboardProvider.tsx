import React from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../hooks/useAuthLogic';
import { DashboardProvider } from '../contexts/DashboardContext';
import { useUI } from '../contexts/UIContext';

interface ConnectedDashboardProviderProps {
    user: User;
    userProfile: UserProfile;
    logout: () => Promise<void>;
    children: React.ReactNode;
}

const ConnectedDashboardProvider: React.FC<ConnectedDashboardProviderProps> = ({ user, userProfile, logout, children }) => {
    const { timeZone, filterDateRange, selectedAccountId, searchTerm } = useUI();

    return (
        <DashboardProvider
            user={user}
            teamId={userProfile.teamId}
            role={userProfile.role}
            permissions={userProfile.permissions || {}}
            allowedAccounts={userProfile.allowedAccounts || []}
            onLogout={logout}
            timeZone={timeZone}
            filterDateRange={filterDateRange}
            selectedAccountId={selectedAccountId}
            searchTerm={searchTerm}
        >
            {children}
        </DashboardProvider>
    );
};

export default ConnectedDashboardProvider;
