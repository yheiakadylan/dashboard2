import React from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../features/auth/hooks/useAuthLogic';
import { DashboardProvider } from './DashboardContext';
import { useUIFilters, useUISettings, useUITabs } from './UIContext';


interface ConnectedDashboardProviderProps {
    user: User;
    userProfile: UserProfile;
    logout: () => Promise<void>;
    children: React.ReactNode;
}

const ConnectedDashboardProvider: React.FC<ConnectedDashboardProviderProps> = ({ user, userProfile, logout, children }) => {
    const { timeZone, filterDateRange, selectedAccountId, searchTerm } = useUIFilters();
    const { activeTab } = useUITabs();
    const { globalUsdMode } = useUISettings();

    // Memoize stable permissions and accounts to prevent infinite loops in DashboardProvider
    const memoizedPermissions = React.useMemo(() => userProfile.permissions || {}, [userProfile.permissions]);
    const memoizedAllowedAccounts = React.useMemo(() => userProfile.allowedAccounts || [], [userProfile.allowedAccounts]);

    return (
        <DashboardProvider
            user={user}
            displayName={userProfile.displayName || userProfile.fullName || user.displayName || user.email || 'User'}
            employeeId={String(userProfile.empID || '')}
            teamId={userProfile.teamId}
            role={userProfile.role}
            sharedRole={userProfile.sharedRole || null}
            permissions={memoizedPermissions}
            allowedAccounts={memoizedAllowedAccounts}
            display_name={userProfile.displayName || userProfile.fullName}
            user_number={userProfile.empID}
            is_kpi={userProfile.isKpi ?? userProfile.is_kpi}
            can_view_leaderboard={userProfile.canViewLeaderboard ?? userProfile.can_view_leaderboard}
            kpi_team={userProfile.kpiTeam ?? userProfile.kpi_team}
            viewable_kpi_teams={userProfile.viewableKpiTeams ?? userProfile.viewable_kpi_teams}
            onLogout={logout}
            timeZone={timeZone}
            filterDateRange={filterDateRange}
            selectedAccountId={selectedAccountId}
            searchTerm={searchTerm}
            globalUsdMode={globalUsdMode}
            activeTab={activeTab}
        >
            {children}
        </DashboardProvider>
    );
};

export default ConnectedDashboardProvider;
