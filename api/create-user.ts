// api/create-user.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Only POST requests are allowed.' });
  }

  const { email, password, role, teamId } = req.body;
  const idToken = req.headers.authorization?.split('Bearer ')[1];

  if (!email || !password || !role || !teamId || !idToken) {
    return res.status(400).json({ message: 'Missing required fields.' });
  }

  try {
    const adminApp = initFirebaseAdmin();
    // FIX: Replaced `adminApp.auth()` with `getAuth(adminApp)` for compatibility with Firebase Admin SDK v10+.
    const adminAuth = getAuth(adminApp);
    const adminDb = getDb();

    // 1. Xác thực người gọi (Caller)
    let callerUid: string;
    try {
      const decodedToken = await adminAuth.verifyIdToken(idToken);
      callerUid = decodedToken.uid;
    } catch (authError) {
      console.warn("Caller auth failed:", authError);
      return res.status(401).json({ message: 'Unauthorized. Invalid token.' });
    }
    
    // 2. Kiểm tra xem người gọi có phải là Owner không
    const callerRoleDoc = await adminDb.collection('user_roles').doc(callerUid).get();
    if (!callerRoleDoc.exists || callerRoleDoc.data()?.role !== 'owner' || callerRoleDoc.data()?.teamId !== teamId) {
       return res.status(403).json({ message: 'Forbidden. Only owners can create users.' });
    }

    // 3. Tạo user mới trong Authentication
    const newUserRecord = await adminAuth.createUser({
      email,
      password,
      emailVerified: true,
    });
    
    const newUserUid = newUserRecord.uid;

    // 4. Tạo document trong 'user_roles' cho user mới
    const newUserRoleDoc: any = {
      email,
      role,
      teamId,
      permissions: { 
        viewSales: true,
        viewFunds: false,
        viewFulfill: false,
        viewSummary: false,
        canManageSettings: false,
      }
    };
    
    // Nếu tạo Owner mới, không cần 'permissions'
    if (role === 'owner') {
      delete newUserRoleDoc.permissions;
    }

    await adminDb.collection('user_roles').doc(newUserUid).set(newUserRoleDoc);

    return res.status(201).json({ message: 'User created successfully.', uid: newUserUid });

  } catch (error: any) {
    console.error('[API /create-user Error]', error);
    let message = 'Internal Server Error';
    if (error.code === 'auth/email-already-exists') {
      message = 'This email is already in use by another account.';
    } else if (error.code === 'auth/invalid-password') {
      message = 'Password must be at least 6 characters long.';
    }
    return res.status(500).json({ message });
  }
}