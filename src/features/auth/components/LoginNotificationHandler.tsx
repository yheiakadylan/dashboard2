import React from 'react';
import { User } from 'firebase/auth';
import { UserProfile } from '../hooks/useAuthLogic';

import { sendLoginNotification } from '../../notifications/services/notificationService';

interface LoginNotificationHandlerProps {
    user: User;
    userProfile: UserProfile;
}

const LoginNotificationHandler: React.FC<LoginNotificationHandlerProps> = ({ user, userProfile }) => {

    const hasShownNotification = React.useRef(false);

    React.useEffect(() => {
        if (user && userProfile && !hasShownNotification.current) {
            // Only show notification for user role (owner will see this notification)
            // Notification logic managed by the server.

            sendLoginNotification(user.email, userProfile.role, userProfile.teamId, userProfile.displayName || user.displayName);
            hasShownNotification.current = true;
        }
        if (!user) {
            hasShownNotification.current = false;
        }
    }, [user, userProfile]);

    return null;
};

export default LoginNotificationHandler;
