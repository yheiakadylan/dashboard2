// api/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Route based on HTTP method
    switch (req.method) {
        case 'POST':
            return handleCreateUser(req, res);
        case 'DELETE':
            return handleDeleteUser(req, res);
        default:
            return res.status(405).json({ message: `Method ${req.method} not allowed.` });
    }
}

// ========================================
// POST /api/users - Create User
// ========================================
async function handleCreateUser(req: VercelRequest, res: VercelResponse) {
    const { email, password, role, teamId } = req.body;
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!email || !password || !role || !teamId || !idToken) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
        const adminApp = initFirebaseAdmin();
        const adminAuth = getAuth(adminApp);
        const adminDb = getDb();

        // 1. Authenticate caller
        let callerUid: string;
        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            callerUid = decodedToken.uid;
        } catch (authError) {
            console.warn("Caller auth failed:", authError);
            return res.status(401).json({ message: 'Unauthorized. Invalid token.' });
        }

        // 2. Verify caller is Owner
        const callerRoleDoc = await adminDb.collection('user_roles').doc(callerUid).get();
        if (!callerRoleDoc.exists || callerRoleDoc.data()?.role !== 'owner' || callerRoleDoc.data()?.teamId !== teamId) {
            return res.status(403).json({ message: 'Forbidden. Only owners can create users.' });
        }

        // 3. Create user in Firebase Authentication
        const newUserRecord = await adminAuth.createUser({
            email,
            password,
            emailVerified: true,
        });

        const newUserUid = newUserRecord.uid;

        // 4. Create user_roles document
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

        // If creating Owner, no need for permissions
        if (role === 'owner') {
            delete newUserRoleDoc.permissions;
        }

        await adminDb.collection('user_roles').doc(newUserUid).set(newUserRoleDoc);

        return res.status(201).json({ message: 'User created successfully.', uid: newUserUid });

    } catch (error: any) {
        console.error('[API POST /users Error]', error);
        let message = 'Internal Server Error';
        if (error.code === 'auth/email-already-exists') {
            message = 'This email is already in use by another account.';
        } else if (error.code === 'auth/invalid-password') {
            message = 'Password must be at least 6 characters long.';
        }
        return res.status(500).json({ message });
    }
}

// ========================================
// DELETE /api/users - Delete User
// ========================================
async function handleDeleteUser(req: VercelRequest, res: VercelResponse) {
    const { userId } = req.body;
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!userId || !idToken) {
        return res.status(400).json({ message: 'Missing required fields: userId.' });
    }

    try {
        const adminApp = initFirebaseAdmin();
        const adminAuth = getAuth(adminApp);
        const adminDb = getDb();

        // 1. Authenticate caller
        let callerUid: string;
        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            callerUid = decodedToken.uid;
        } catch (authError) {
            console.warn("Caller auth failed:", authError);
            return res.status(401).json({ message: 'Unauthorized. Invalid token.' });
        }

        // 2. Verify caller is Owner
        const callerRoleDoc = await adminDb.collection('user_roles').doc(callerUid).get();
        if (!callerRoleDoc.exists || callerRoleDoc.data()?.role !== 'owner') {
            return res.status(403).json({ message: 'Forbidden. Only owners can delete users.' });
        }

        const callerTeamId = callerRoleDoc.data()?.teamId;

        // 3. Get target user info
        const targetUserRoleDoc = await adminDb.collection('user_roles').doc(userId).get();
        if (!targetUserRoleDoc.exists) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const targetUserData = targetUserRoleDoc.data();

        // 4. Verify same team
        if (targetUserData?.teamId !== callerTeamId) {
            return res.status(403).json({ message: 'Cannot delete user from another team.' });
        }

        // 5. Prevent self-deletion
        if (callerUid === userId) {
            return res.status(400).json({ message: 'Cannot delete yourself.' });
        }

        // 6. Check if deleting last owner
        if (targetUserData?.role === 'owner') {
            const ownersQuery = await adminDb.collection('user_roles')
                .where('teamId', '==', callerTeamId)
                .where('role', '==', 'owner')
                .get();

            if (ownersQuery.size <= 1) {
                return res.status(400).json({
                    message: 'Cannot delete the last owner. Promote another user to owner first.'
                });
            }
        }

        // 7. Delete user from Firebase Authentication
        try {
            await adminAuth.deleteUser(userId);
        } catch (authError: any) {
            console.warn("Auth deletion warning:", authError);
            // Continue even if auth delete fails (user might not exist in auth)
        }

        // 8. Delete user_roles document
        await adminDb.collection('user_roles').doc(userId).delete();

        return res.status(200).json({
            message: 'User deleted successfully.',
            deletedUserId: userId
        });

    } catch (error: any) {
        console.error('[API DELETE /users Error]', error);
        return res.status(500).json({ message: 'Internal Server Error' });
    }
}
