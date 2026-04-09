import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { auth, db } from '../services/firebaseService';
import { requestForToken } from '../services/notificationService';

export interface UserProfile {
    teamId: string;
    role: 'owner' | 'user';
    permissions: { [key: string]: boolean };
    allowedAccounts?: string[];
    email?: string;
    [key: string]: any;
}

export const useAuthLogic = () => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [authError, setAuthError] = useState<string | null>(null);

    // We can't use useNotification here easily if this hook is used OUTSIDE NotificationProvider
    // But based on App.tsx structure, Auth check happens before DashboardProvider.
    // So we'll return the error/state and let the component handle UI.

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            setAuthLoading(true);
            setUser(currentUser);
            setUserProfile(null);
            setAuthError(null);

            if (currentUser) {
                try {
                    const roleDocRef = doc(db, "user_roles", currentUser.uid);
                    const roleDoc = await getDoc(roleDocRef);

                    if (!roleDoc.exists()) {
                        setAuthError("Tài khoản của bạn không được cấp quyền truy cập.");
                        await signOut(auth);
                        setUser(null);
                    } else {
                        const profile = roleDoc.data() as UserProfile;
                        setUserProfile(profile);
                    }
                } catch (err) {
                    console.error("Auth check error:", err);
                    setAuthError("Lỗi khi kiểm tra quyền truy cập.");
                    await signOut(auth);
                    setUser(null);
                }

                // Request FCM Token
                requestForToken(currentUser.uid);
            }
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    const logout = async () => {
        try {
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
