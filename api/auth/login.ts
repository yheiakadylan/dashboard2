import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from '../_lib/firebaseAdminHelper.js';
import {
  authenticateWithPassword,
  type AppAccessProfile,
  isManagementRole,
  isAuthenticationAdminEmail,
  loadAppAccessProfile,
  resolveEmailFromIdentifier,
  SharedAuthError,
  syncLegacyAuthenticationProfile,
} from '../_lib/sharedAuthHelper.js';

const sendError = (res: VercelResponse, error: SharedAuthError) =>
  res.status(error.status).json({
    success: false,
    code: error.code,
    error: error.message,
    message: error.message,
    field: error.field,
  });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed.' });
  }

  const identifier = typeof req.body?.identifier === 'string' ? req.body.identifier.trim() : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';

  if (!identifier) {
    return sendError(res, new SharedAuthError('Please enter an email or employee ID.', {
      code: 'VALIDATION_ERROR',
      status: 400,
      field: 'identifier',
    }));
  }
  if (!password) {
    return sendError(res, new SharedAuthError('Please enter your password.', {
      code: 'VALIDATION_ERROR',
      status: 400,
      field: 'password',
    }));
  }
  try {
    const adminApp = initFirebaseAdmin();
    const adminAuth = getAuth(adminApp);
    const db = getDb();
    const email = await resolveEmailFromIdentifier(db, identifier);
    const requestOrigin = typeof req.headers.origin === 'string'
      ? req.headers.origin
      : 'https://dashboard2-alpha-bay.vercel.app';
    const { localId } = await authenticateWithPassword(email, password, requestOrigin);
    const userRecord = await adminAuth.getUser(localId);

    if (userRecord.disabled) {
      throw new SharedAuthError('This account is disabled. Please contact an administrator.', {
        code: 'USER_DISABLED',
        status: 403,
        field: 'identifier',
      });
    }

    const isAuthenticationAdmin = isAuthenticationAdminEmail(userRecord.email || email);
    let profile: AppAccessProfile | null = isAuthenticationAdmin
      ? {
        uid: localId,
        email: userRecord.email || email,
        displayName: userRecord.displayName || 'Authentication Admin',
        empID: null,
        role: 'ADMIN' as const,
        commonData: {},
        appData: {},
      }
      : null;
    if (!profile) {
      try {
        profile = await loadAppAccessProfile(db, localId, 'dashboard', email);
      } catch (error) {
        if (
          error instanceof SharedAuthError
          && ['USER_PROFILE_MISSING', 'APP_ACCESS_DENIED'].includes(error.code)
        ) {
          profile = await syncLegacyAuthenticationProfile(
            db,
            {
              uid: userRecord.uid,
              email: userRecord.email,
              displayName: userRecord.displayName,
              photoURL: userRecord.photoURL,
              customClaims: userRecord.customClaims,
            },
            'login:legacy-sync',
            email,
          );
        } else {
          throw error;
        }
      }
    }
    const customToken = await adminAuth.createCustomToken(localId, {
      role: profile.role,
      admin: isManagementRole(profile.role),
    });
    return res.status(200).json({
      success: true,
      customToken,
      user: {
        uid: localId,
        email: userRecord.email || profile.email || email,
        displayName: profile.displayName || userRecord.displayName || '',
        empID: profile.empID,
        role: profile.role,
      },
    });
  } catch (error) {
    if (error instanceof SharedAuthError) return sendError(res, error);
    console.error('[Dashboard login] Unexpected error:', error);
    return sendError(res, new SharedAuthError('Unable to sign in right now.', {
      code: 'FIREBASE_AUTH_ERROR',
      status: 500,
      field: 'server',
    }));
  }
}
