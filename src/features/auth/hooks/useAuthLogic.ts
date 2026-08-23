import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../../../services/firebaseService';
import { requestForToken } from '../../notifications/services/notificationService';
import {
    AUTHENTICATION_ADMIN_EMAIL,
    normalizeSharedRole,
    type SharedRole,
} from '../../admin/authenticationTypes';
import { getDashboardPermissionsForRole } from '../../../utils/permissionHelper';


export interface UserProfile {
    teamId: string;
    role: 'owner' | 'user';
    permissions: { [key: string]: boolean };
    allowedAccounts?: string[];
    email?: string;
    sharedRole?: SharedRole | null;
    [key: string]: any;
}

const normalizeAllowedAccounts = (value: unknown): string[] =>
    Array.isArray(value)
        ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];

const normalizePermissions = (value: unknown): Record<string, boolean> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
    );
};

export const useAuthLogic = () => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);

    // We can't use useNotification here easily if this hook is used OUTSIDE NotificationProvider
    // But based on App.tsx structure, Auth check happens before DashboardProvider.
    // So we'll return the error/state and let the component handle UI.

    useEffect(() => {
        let unsubscribeSnapshots: (() => void)[] = [];
        let unsubscribeRolePermissions: (() => void) | null = null;
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            unsubscribeSnapshots.forEach(unsubscribeSnapshot => unsubscribeSnapshot());
            unsubscribeSnapshots = [];
            unsubscribeRolePermissions?.();
            unsubscribeRolePermissions = null;
            setAuthLoading(true);
            setUser(currentUser);
            setUserProfile(null);
            if (currentUser) setAuthError(null);

            if (currentUser) {
                try {
                    let commonLoaded = false;
                    let appLoaded = false;
                    let commonData: Record<string, any> | null = null;
                    let appData: Record<string, any> | null = null;
                    let appDocumentExists = false;
                    let rolePermissions: Record<string, boolean> = {};
                    let rolePermissionsLoaded = false;
                    let subscribedRole = '';
                    let accessRejected = false;
                    let notificationTokenRequested = false;

                    const rejectAccess = (message: string) => {
                        if (accessRejected) return;
                        accessRejected = true;
                        setAuthError(message);
                        setUserProfile(null);
                        setUser(null);
                        setAuthLoading(false);
                        void signOut(auth);
                    };

                    function subscribeRolePermissions(role: SharedRole) {
                        if (subscribedRole === role) return;
                        unsubscribeRolePermissions?.();
                        subscribedRole = role;
                        rolePermissions = {};
                        rolePermissionsLoaded = false;
                        unsubscribeRolePermissions = onSnapshot(
                            doc(db, 'authentication', '_settings', 'permission_roles', role, 'apps', 'dashboard'),
                            snapshot => {
                                rolePermissions = normalizePermissions(snapshot.data()?.permissions);
                                rolePermissionsLoaded = true;
                                applyProfile();
                            },
                            error => {
                                console.warn('[Auth] Cannot read Dashboard role permissions; using role defaults.', error);
                                rolePermissions = {};
                                rolePermissionsLoaded = true;
                                applyProfile();
                            },
                        );
                    }

                    function applyProfile() {
                        if (!commonLoaded || !appLoaded || accessRejected) return;

                        const email = String(commonData?.email || currentUser.email || '')
                            .trim()
                            .toLowerCase();
                        const isAuthenticationAdmin = email === AUTHENTICATION_ADMIN_EMAIL;

                        if (!commonData) {
                            rejectAccess('Tài khoản chưa có hồ sơ authentication. Vui lòng liên hệ quản trị viên.');
                            return;
                        }
                        if (commonData.active !== true && !isAuthenticationAdmin) {
                            rejectAccess('Tài khoản của bạn đang bị tạm khóa.');
                            return;
                        }
                        if ((!appDocumentExists || appData?.enabled !== true) && !isAuthenticationAdmin) {
      rejectAccess('Tài khoản của bạn chưa được cấp quyền truy cập Dashboard.');
                            return;
                        }

                        const sharedRole = isAuthenticationAdmin
                            ? 'ADMIN'
                            : normalizeSharedRole(commonData.role);

                        if (!sharedRole) {
                            rejectAccess('Role dùng chung chưa được cấu hình.');
                            return;
                        }
                        if (subscribedRole !== sharedRole) {
                            subscribeRolePermissions(sharedRole);
                            return;
                        }
                        if (!rolePermissionsLoaded) return;

                        const defaultPermissions = getDashboardPermissionsForRole(sharedRole);
                        const userPermissions = normalizePermissions(appData?.permissions);
                        setUserProfile({
                            ...commonData,
                            teamId: commonData.teamId || '',
                            role: isAuthenticationAdmin || sharedRole === 'ADMIN' ? 'owner' : 'user',
                            sharedRole,
                            permissions: {
                                ...defaultPermissions,
                                ...rolePermissions,
                                ...userPermissions,
                            },
                            allowedAccounts: normalizeAllowedAccounts(appData?.allowedAccounts),
                            email,
                        });
                        setAuthError(null);
                        setAuthLoading(false);
                        if (!notificationTokenRequested) {
                            notificationTokenRequested = true;
                            void requestForToken(currentUser.uid);
                        }
                    }

                    const subscribe = (
                        path: string[],
                        onValue: (exists: boolean, data: Record<string, any> | null) => void,
                    ) => onSnapshot(doc(db, path[0], ...path.slice(1)), snapshot => {
                        onValue(snapshot.exists(), snapshot.exists() ? snapshot.data() : null);
                        applyProfile();
                    }, error => {
                        console.warn(`[Auth] Cannot read ${path.join('/')}.`, error);
                        onValue(false, null);
                        applyProfile();
                    });

                    unsubscribeSnapshots = [
                        subscribe(['authentication', currentUser.uid], (_exists, data) => {
                            commonLoaded = true;
                            commonData = data;
                        }),
                        subscribe(['authentication', currentUser.uid, 'apps', 'dashboard'], (exists, data) => {
                            appLoaded = true;
                            appDocumentExists = exists;
                            appData = data;
                        }),
                    ];
                } catch (err) {
                    console.error("Auth check error:", err);
                    setAuthError("Lỗi khi kiểm tra quyền truy cập.");
                    await signOut(auth);
                    setUser(null);
                    setAuthLoading(false);
                }
            } else {
                setAuthLoading(false);
            }
        });
        return () => {
            unsubscribe();
            unsubscribeSnapshots.forEach(unsubscribeSnapshot => unsubscribeSnapshot());
            unsubscribeRolePermissions?.();
        };
    }, []);

    const logout = async () => {
        try {
            setAuthError(null);
            await signOut(auth);
            setUser(null);
            setUserProfile(null);
        } catch (error) {
            console.error("Logout failed:", error);
            throw error;
        }
    };

    return {
        user,
        userProfile,
        authLoading,
        authError,
        logout
    };
};
