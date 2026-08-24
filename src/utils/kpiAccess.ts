export interface KpiAccountProfile {
  allowedAccounts?: string[];
  hasFullAccountAccess?: boolean;
}

export type KpiAccountFilter = Set<string> | null | 'NONE';

export const getKpiAccountFilter = (
  profile: KpiAccountProfile | undefined,
  viewerAllowedAccounts: string[] | undefined,
  viewerHasFullAccountAccess: boolean,
): KpiAccountFilter => {
  const profileAccounts = profile?.allowedAccounts || [];
  const profileFilter: KpiAccountFilter = profileAccounts.length > 0
    ? new Set(profileAccounts)
    : profile?.hasFullAccountAccess ? null : 'NONE';
  const viewerFilter: KpiAccountFilter = viewerAllowedAccounts?.length
    ? new Set(viewerAllowedAccounts)
    : viewerHasFullAccountAccess ? null : 'NONE';

  if (profileFilter === 'NONE' || viewerFilter === 'NONE') return 'NONE';
  if (profileFilter === null) return viewerFilter;
  if (viewerFilter === null) return profileFilter;
  const intersection = new Set([...profileFilter].filter(account => viewerFilter.has(account)));
  return intersection.size > 0 ? intersection : 'NONE';
};
