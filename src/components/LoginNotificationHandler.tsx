import React from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../hooks/useAuthLogic';

import { sendLarkLoginNotification } from '../services/notificationService';

interface LoginNotificationHandlerProps {
    user: User;
    userProfile: UserProfile;
}

const LoginNotificationHandler: React.FC<LoginNotificationHandlerProps> = ({ user, userProfile }) => {

    const hasShownNotification = React.useRef(false);

    React.useEffect(() => {
        if (user && userProfile && !hasShownNotification.current) {
            // Only show notification for user role (owner will see this notification)
            // Notification logic managed via Lark or other channels

            sendLarkLoginNotification(user.email, userProfile.role, userProfile.teamId);
            hasShownNotification.current = true;
        }
        if (!user) {
            hasShownNotification.current = false;
        }
    }, [user, userProfile]);

    return null;
};

export default LoginNotificationHandler;
