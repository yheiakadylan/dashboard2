import React from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../features/auth/hooks/useAuthLogic';
import { DashboardProvider } from './DashboardContext';
import { useUI } from './UIContext';
import { CrawlerProvider } from './CrawlerContext';

interface ConnectedDashboardProviderProps {
    user: User;
    userProfile: UserProfile;
    logout: () => Promise<void>;
    children: React.ReactNode;
}

const ConnectedDashboardProvider: React.FC<ConnectedDashboardProviderProps> = ({ user, userProfile, logout, children }) => {
    const { timeZone, filterDateRange, selectedAccountId, searchTerm, globalUsdMode } = useUI();

    // Memoize stable permissions and accounts to prevent infinite loops in DashboardProvider
    const memoizedPermissions = React.useMemo(() => userProfile.permissions || {}, [userProfile.permissions]);
    const memoizedAllowedAccounts = React.useMemo(() => userProfile.allowedAccounts || [], [userProfile.allowedAccounts]);

    return (
        <DashboardProvider
            user={user}
            teamId={userProfile.teamId}
            role={userProfile.role}
            permissions={memoizedPermissions}
            allowedAccounts={memoizedAllowedAccounts}
            onLogout={logout}
            timeZone={timeZone}
            filterDateRange={filterDateRange}
            selectedAccountId={selectedAccountId}
            searchTerm={searchTerm}
            globalUsdMode={globalUsdMode}
        >
            <CrawlerProvider>
                {children}
            </CrawlerProvider>
        </DashboardProvider>
    );
};

export default ConnectedDashboardProvider;
