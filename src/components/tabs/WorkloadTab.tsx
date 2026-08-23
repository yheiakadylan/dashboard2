import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDashboard } from '../../contexts/DashboardContext';

const WORKLOAD_URL = (import.meta.env.VITE_WORKLOAD_URL || 'https://workload-seven.vercel.app').replace(/\/+$/, '');

const WorkloadTab: React.FC = () => {
  const { user, handleLogout } = useDashboard();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  const workloadOrigin = useMemo(() => {
    try {
      return new URL(WORKLOAD_URL).origin;
    } catch {
      return '*';
    }
  }, []);

  const sendSession = useCallback(async () => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame) return;
    const idToken = await user.getIdToken();
    frame.postMessage({
      source: 'dashboard2',
      type: 'WORKLOAD_AUTH_TOKEN',
      idToken,
    }, workloadOrigin);
  }, [user, workloadOrigin]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== workloadOrigin) return;
      if (event.data?.source === 'workload' && event.data?.type === 'WORKLOAD_AUTH_READY') {
        void sendSession();
      } else if (event.data?.source === 'workload' && event.data?.type === 'WORKLOAD_LOGOUT_REQUEST') {
        void handleLogout();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleLogout, sendSession, workloadOrigin]);

  useEffect(() => {
    if (!loaded) return;
    void sendSession();
    const intervalId = window.setInterval(() => void sendSession(), 10 * 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [loaded, sendSession]);

  return (
    <div className="h-full w-full overflow-hidden bg-white dark:bg-gray-950">
      <iframe
        ref={iframeRef}
        title="Workload"
        src={WORKLOAD_URL}
        onLoad={() => setLoaded(true)}
        className="h-full w-full border-0 bg-white dark:bg-gray-950"
        allow="clipboard-read; clipboard-write; fullscreen"
      />
    </div>
  );
};

export default WorkloadTab;
