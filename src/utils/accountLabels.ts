import type { Account } from '../types';

export const buildAccountLabelMap = (accounts: Account[]) => {
  const map = new Map<string, string>();

  accounts.forEach(account => {
    const email = String(account.email || '').trim();
    const label = String(account.label || email).trim();
    const displayLabel = label || email;

    [account.id, email, label].forEach(value => {
      const key = String(value || '').trim().toLowerCase();
      if (key) map.set(key, displayLabel);
    });
  });

  return map;
};

export const resolveAccountLabel = (accountLabelMap: Map<string, string>, value?: string | number | null, fallback = 'Unknown') => {
  const raw = String(value || '').trim();
  if (!raw) return fallback;
  return accountLabelMap.get(raw.toLowerCase()) || raw;
};
