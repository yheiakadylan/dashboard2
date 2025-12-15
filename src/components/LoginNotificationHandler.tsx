import React from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../hooks/useAuthLogic';
import { useNotification } from '../contexts/NotificationContext';
import { sendLarkLoginNotification } from '../services/notificationService';

interface LoginNotificationHandlerProps {
    user: User;
    userProfile: UserProfile;
}

const LoginNotificationHandler: React.FC<LoginNotificationHandlerProps> = ({ user, userProfile }) => {
    const { addNotification } = useNotification();
    const hasShownNotification = React.useRef(false);

    React.useEffect(() => {
        if (user && userProfile && !hasShownNotification.current) {
            // Only show notification for user role (owner will see this notification)
            if (userProfile.role === 'user') {
                addNotification(
                    `🔔 Người dùng ${user.email} đã đăng nhập vào dashboard`,
                    'info'
                );
            }
            sendLarkLoginNotification(user.email, userProfile.role, userProfile.teamId);
            hasShownNotification.current = true;
        }
        if (!user) {
            hasShownNotification.current = false;
        }
    }, [user, userProfile, addNotification]);

    return null;
};

export default LoginNotificationHandler;
