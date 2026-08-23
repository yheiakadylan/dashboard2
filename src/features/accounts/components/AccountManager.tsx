import React, { Suspense, useState } from 'react';
import {
  Bell,
  Bot,
  Mail,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { useDashboardAccess } from '../../../contexts/DashboardContext';
import { useUIModals } from '../../../contexts/UIContext';
import UserProfileSettings from '../../users/components/UserProfileSettings';

const MailManager = React.lazy(() => import('./MailManager').then(module => ({ default: module.MailManager })));
const NotificationSettings = React.lazy(() => import('../../notifications/components/NotificationSettings'));
const WorkerStatusManager = React.lazy(() => import('./WorkerStatusManager'));
const PODTeamManager = React.lazy(() => import('../../teams/components/PODTeamManager'));

type SettingsTab = 'profile' | 'podteams' | 'mail' | 'notifications' | 'workers';

const AccountManager: React.FC = () => {
  const { role, permissions } = useDashboardAccess();
  const { setIsAccountManagerOpen } = useUIModals();
  const [activeTab, setActiveTab] = useState<SettingsTab>('profile');

  const canManageMail = role === 'owner' || permissions.canManageMailSettings;
  const canManagePodTeams = role === 'owner' || permissions.canManageSettings;
  const canManageWorkers = role === 'owner' || permissions.canEditCost;

  const tabs = [
    {
      id: 'profile' as const,
      label: 'Profile',
      description: 'Personal information and security',
      icon: UserRound,
      visible: true,
    },
    {
      id: 'podteams' as const,
      label: 'POD Teams',
      description: 'Team members and assigned shops',
      icon: UsersRound,
      visible: canManagePodTeams,
    },
    {
      id: 'mail' as const,
      label: 'Mail Accounts',
      description: 'Connected support inboxes',
      icon: Mail,
      visible: canManageMail,
    },
    {
      id: 'notifications' as const,
      label: 'Notifications',
      description: 'Browser alerts and preferences',
      icon: Bell,
      visible: true,
    },
    {
      id: 'workers' as const,
      label: 'Workers',
      description: 'Crawler status and schedules',
      icon: Bot,
      visible: canManageWorkers,
    },
  ].filter(tab => tab.visible);

  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      setIsAccountManagerOpen(false);
    }
  };

  return (
    <div
      onClick={handleBackdropClick}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm md:p-5 animate-modal-backdrop"
    >
      <div
        onClick={event => event.stopPropagation()}
        className="flex h-[94vh] w-full max-w-[1280px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 md:h-[780px] md:max-h-[92vh] animate-slide-in-right"
      >
        <header className="flex flex-shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3.5 dark:border-slate-800 md:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Settings</h2>
            <p className="hidden text-sm text-slate-500 dark:text-slate-400 sm:block">
              Manage account, team and system preferences.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsAccountManagerOpen(false)}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Close settings"
          >
            <X size={19} />
          </button>
        </header>

        <nav className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-3 py-2 scrollbar-hide dark:border-slate-800 dark:bg-slate-900 md:hidden">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex flex-shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-white hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[230px] flex-shrink-0 border-r border-slate-200 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/30 md:block">
            <div className="space-y-1">
              {tabs.map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                      isActive
                        ? 'bg-white text-blue-700 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:text-blue-400 dark:ring-slate-700'
                        : 'text-slate-600 hover:bg-white/80 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800/70 dark:hover:text-white'
                    }`}
                  >
                    <span className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${
                      isActive
                        ? 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                        : 'bg-slate-200/70 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                    }`}>
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{tab.label}</span>
                      <span className="mt-0.5 block text-xs font-normal leading-4 text-slate-500 dark:text-slate-500">
                        {tab.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-hidden bg-white p-3 dark:bg-slate-900 md:p-5">
            <Suspense fallback={<div className="p-4 text-sm text-slate-500 dark:text-slate-400">Loading...</div>}>
              {activeTab === 'profile' && <UserProfileSettings />}
              {activeTab === 'podteams' && <PODTeamManager />}
              {activeTab === 'mail' && <MailManager />}
              {activeTab === 'notifications' && <NotificationSettings />}
              {activeTab === 'workers' && <WorkerStatusManager />}
            </Suspense>
          </main>
        </div>
      </div>
    </div>
  );
};

export default React.memo(AccountManager);
