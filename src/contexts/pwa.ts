import { createContext, useContext } from 'react';

export interface PWAContextValue {
  canInstall: boolean;
  installApp: () => Promise<boolean>;
}

export const PWAContext = createContext<PWAContextValue>({
  canInstall: false,
  installApp: async () => false,
});

export const usePWA = () => useContext(PWAContext);
