import { getMessaging, isSupported } from 'firebase/messaging';
import { firebaseApp } from './firebaseService';

export const getMessagingInstance = async () => {
  try {
    return await isSupported() ? getMessaging(firebaseApp) : null;
  } catch (error) {
    console.error('Error checking messaging support:', error);
    return null;
  }
};
