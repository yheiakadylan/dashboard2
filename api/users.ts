// api/users.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, type DocumentData } from 'firebase-admin/firestore';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';
import { isAuthenticationAdminEmail, syncLegacyAuthenticationUsers } from './_lib/sharedAuthHelper.js';

const SHARED_TEAM_ID = 'jwnm5emo8mdG3gjIlh7CctiVvQO2';
const APP_IDS = ['dashboard', 'workload'] as const;
type AppId = typeof APP_IDS[number];
const SHARED_ROLES = [
    'ADMIN', 'MANAGER',
    'CS_SUPPORT', 'CS_FULFILL',
    'LEADCS_SUPPORT', 'LEADCS_FULFILL',
    'DS_FULFILL', 'DS_IDEA', 'LEADDS_FULFILL', 'LEADDS_IDEA',
    'IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE',
] as const;
const VALID_SHARED_ROLES = new Set<string>(SHARED_ROLES);
const VALID_APP_IDS = new Set<string>(APP_IDS);

const normalizeSharedRole = (role: unknown): string | null => {
    if (typeof role !== 'string') return null;
    return VALID_SHARED_ROLES.has(role) ? role : null;
};

const getDepartmentFromRole = (role: string | null) => {
    if (!role) return null;
    if (['DS_IDEA', 'DS_FULFILL', 'LEADDS_IDEA', 'LEADDS_FULFILL'].includes(role)) return 'Designer';
    if (['IDEA_RD', 'IDEA_SCALE', 'LEADIDEA_RD', 'LEADIDEA_SCALE'].includes(role)) return 'IDEA';
    if (['CS_SUPPORT', 'CS_FULFILL', 'LEADCS_SUPPORT', 'LEADCS_FULFILL'].includes(role)) return 'Customer Service';
    if (['ADMIN', 'MANAGER'].includes(role)) return 'Management';
    return null;
};

const isManagementRole = (role: string): boolean => role === 'ADMIN' || role === 'MANAGER';

const normalizePermissions = (value: unknown): Record<string, boolean> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .filter((entry): entry is [string, boolean] => entry[0].trim().length > 0 && typeof entry[1] === 'boolean'),
    );
};

const getRolePermissionRef = (
    adminDb: ReturnType<typeof getDb>,
    role: string,
    appId: AppId,
) => adminDb.doc(`authentication/_settings/permission_roles/${role}/apps/${appId}`);

const normalizeAllowedAccounts = (value: unknown): string[] => Array.isArray(value)
    ? Array.from(new Set(value.map(String).map(item => item.trim().toLowerCase()).filter(Boolean)))
    : [];

const normalizeNames = (fullName: unknown, displayName: unknown, fallback: string) => {
    const normalizedFullName = typeof fullName === 'string' ? fullName.trim() : '';
    const normalizedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
    return {
        fullName: normalizedFullName || normalizedDisplayName || fallback,
        displayName: normalizedDisplayName || normalizedFullName || fallback,
    };
};

const verifyAuthenticationAdmin = async (req: VercelRequest) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) throw Object.assign(new Error('Unauthorized. Missing token.'), { status: 401 });

    const adminApp = initFirebaseAdmin();
    const adminAuth = getAuth(adminApp);
    const decodedToken = await adminAuth.verifyIdToken(idToken);
    const callerEmail = String(decodedToken.email || '').trim().toLowerCase();
    if (!isAuthenticationAdminEmail(callerEmail)) {
        throw Object.assign(new Error('Forbidden. Only the authentication administrator can manage users.'), { status: 403 });
    }

    return { adminAuth, adminDb: getDb(), callerEmail };
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // Route based on HTTP method
    switch (req.method) {
        case 'GET':
            return handleListAuthenticationUsers(req, res);
        case 'POST':
            return handleCreateUser(req, res);
        case 'DELETE':
            return handleDeleteUser(req, res);
        case 'PATCH':
            return handleUpdateUser(req, res);
        default:
            return res.status(405).json({ message: `Method ${req.method} not allowed.` });
    }
}

async function handleListAuthenticationUsers(req: VercelRequest, res: VercelResponse) {
    try {
        const { adminDb } = await verifyAuthenticationAdmin(req);
        const [authenticationSnapshot, appSnapshot, accountSnapshot] = await Promise.all([
            adminDb.collection('authentication').get(),
            adminDb.collectionGroup('apps').get(),
            adminDb.collection('user').doc(SHARED_TEAM_ID).collection('accounts').get(),
        ]);
        const authenticationByUid = new Map(authenticationSnapshot.docs
            .filter(snapshot => snapshot.id !== '_settings')
            .map(snapshot => [snapshot.id, snapshot.data()]));
        const appsByUid = new Map<string, Partial<Record<AppId, DocumentData>>>();
        const roleApps = new Map<string, Partial<Record<AppId, DocumentData>>>();
        appSnapshot.docs.forEach(snapshot => {
            const segments = snapshot.ref.path.split('/');
            const appId = snapshot.id;
            if (!VALID_APP_IDS.has(appId)) return;
            if (segments.length === 4 && segments[0] === 'authentication' && segments[2] === 'apps') {
                const uid = segments[1];
                appsByUid.set(uid, { ...appsByUid.get(uid), [appId]: snapshot.data() });
                return;
            }
            if (
                segments.length === 6
                && segments[0] === 'authentication'
                && segments[1] === '_settings'
                && segments[2] === 'permission_roles'
                && segments[4] === 'apps'
            ) {
                const configuredRole = segments[3];
                roleApps.set(configuredRole, { ...roleApps.get(configuredRole), [appId]: snapshot.data() });
            }
        });
        const userIds = Array.from(authenticationByUid.keys());

        const profiles = userIds.map(uid => {
            const apps = appsByUid.get(uid) || {};
            return {
                uid,
                authentication: authenticationByUid.get(uid),
                apps: {
                    dashboard: apps.dashboard || null,
                    workload: apps.workload || null,
                },
            };
        });

        const roleConfigurations = SHARED_ROLES.map(role => {
            const apps = roleApps.get(role) || {};
            return {
                role,
                apps: Object.fromEntries(APP_IDS.map(appId => [
                    appId,
                    apps[appId] || null,
                ])),
            };
        });
        const accounts = accountSnapshot.docs.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({ profiles, accounts, roleConfigurations });
    } catch (error: any) {
        console.error('[API GET /users Error]', error);
        return res.status(error?.status || 500).json({ message: error?.message || 'Internal Server Error' });
    }
}

const normalizeAppAuthorization = (value: unknown) => {
    const app = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    return {
        enabled: typeof app.enabled === 'boolean' ? app.enabled : null,
        allowedAccounts: normalizeAllowedAccounts(app.allowedAccounts),
        permissions: normalizePermissions(app.permissions),
    };
};

async function saveAuthenticationRecord(
    adminAuth: ReturnType<typeof getAuth>,
    adminDb: ReturnType<typeof getDb>,
    callerEmail: string,
    record: Record<string, any>,
) {
    const uid = String(record?.uid || record?.common?.uid || '').trim();
    if (!uid) throw Object.assign(new Error('Missing user ID.'), { status: 400 });

    const targetAuthUser = await adminAuth.getUser(uid);
    const authEmail = String(targetAuthUser.email || '').trim().toLowerCase();
    const fallbackName = authEmail.split('@')[0] || uid;
    const names = normalizeNames(record?.common?.fullName, record?.common?.displayName, fallbackName);
    const isAuthenticationAdmin = isAuthenticationAdminEmail(authEmail);
    const role = isAuthenticationAdmin ? 'ADMIN' : normalizeSharedRole(record?.common?.role);
    if (!role) throw Object.assign(new Error('Invalid shared role.'), { status: 400 });

    const empID = typeof record?.common?.empID === 'string' && record.common.empID.trim()
        ? record.common.empID.trim()
        : null;
    if (empID) {
        const authenticationDuplicates = await adminDb.collection('authentication').where('empID', '==', empID).limit(2).get();
        const duplicateIds = new Set(authenticationDuplicates.docs.map(snapshot => snapshot.id));
        duplicateIds.delete(uid);
        if (duplicateIds.size > 0) {
            throw Object.assign(new Error(`Employee ID ${empID} already exists.`), { status: 409 });
        }
    }

    const dashboardApp = normalizeAppAuthorization(record?.apps?.dashboard);
    const workloadApp = normalizeAppAuthorization(record?.apps?.workload);
    if (isAuthenticationAdmin) dashboardApp.enabled = true;
    const active = isAuthenticationAdmin ? true : record?.common?.active !== false;
    const department = getDepartmentFromRole(role);
    const now = FieldValue.serverTimestamp();
    const batch = adminDb.batch();

    batch.set(adminDb.doc(`authentication/${uid}`), {
        uid,
        email: authEmail,
        fullName: names.fullName,
        displayName: names.displayName,
        empID,
        role,
        department,
        teamId: SHARED_TEAM_ID,
        active,
        photoURL: typeof record?.common?.photoURL === 'string' && record.common.photoURL.trim()
            ? record.common.photoURL.trim()
            : null,
        permissions: FieldValue.delete(),
        permissionDefaults: FieldValue.delete(),
        updatedAt: now,
        updatedBy: callerEmail,
    }, { merge: true });

    const appValues: Record<string, ReturnType<typeof normalizeAppAuthorization>> = {
        dashboard: dashboardApp,
        workload: workloadApp,
    };
    Object.entries(appValues).forEach(([appId, app]) => {
        batch.set(adminDb.doc(`authentication/${uid}/apps/${appId}`), {
            appId,
            enabled: app.enabled,
            allowedAccounts: app.allowedAccounts,
            permissions: app.permissions,
            role: FieldValue.delete(),
            permissionDefaults: FieldValue.delete(),
            updatedAt: now,
            updatedBy: callerEmail,
        }, { merge: true });
    });

    await batch.commit();
    const desiredAdminClaim = isManagementRole(role);
    const authUpdates: Promise<void>[] = [];
    if (targetAuthUser.customClaims?.role !== role || targetAuthUser.customClaims?.admin !== desiredAdminClaim) {
        authUpdates.push(adminAuth.setCustomUserClaims(uid, {
            ...(targetAuthUser.customClaims || {}),
            role,
            admin: desiredAdminClaim,
        }));
    }
    if (record?.syncFirebaseAuthName !== false) {
        const photoURL = typeof record?.common?.photoURL === 'string' && record.common.photoURL.trim()
            ? record.common.photoURL.trim()
            : null;
        authUpdates.push(adminAuth.updateUser(uid, { displayName: names.displayName, photoURL }).then(() => undefined));
    }
    await Promise.all(authUpdates);
}

// ... existing code ...

// ========================================
// PATCH /api/users - Update User (Password/Role)
// ========================================
async function handleUpdateUser(req: VercelRequest, res: VercelResponse) {
    const { userId, password, role, fullName, displayName, authenticationRecord, roleConfiguration, syncLegacyAuthentication } = req.body;
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    const effectiveUserId = userId || authenticationRecord?.uid;
    if (!idToken || (!effectiveUserId && !roleConfiguration && !syncLegacyAuthentication)) {
        return res.status(400).json({ message: 'Missing required fields: userId.' });
    }

    // Must have at least one field to update
    const hasNameUpdate = fullName !== undefined || displayName !== undefined;
    if (!password && !role && !hasNameUpdate && !authenticationRecord && !roleConfiguration && !syncLegacyAuthentication) {
        return res.status(400).json({ message: 'Nothing to update.' });
    }

    try {
        const adminApp = initFirebaseAdmin();
        const adminAuth = getAuth(adminApp);
        const adminDb = getDb();

        // 1. Authenticate caller
        let callerEmail: string;
        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            callerEmail = String(decodedToken.email || '').toLowerCase();
        } catch (authError) {
            console.warn("Caller auth failed:", authError);
            return res.status(401).json({ message: 'Unauthorized. Invalid token.' });
        }

        // 2. User administration is centralized in Dashboard /admin.
        if (!isAuthenticationAdminEmail(callerEmail)) {
            return res.status(403).json({ message: 'Forbidden. Only the authentication administrator can update users.' });
        }

        if (syncLegacyAuthentication) {
            const result = await syncLegacyAuthenticationUsers(adminDb, adminAuth, callerEmail);
            return res.status(200).json({
                message: `Legacy sync completed. Synced ${result.synced}, skipped ${result.skipped}.`,
                ...result,
            });
        }

        if (roleConfiguration) {
            const configuredRole = normalizeSharedRole(roleConfiguration.role);
            const appId = typeof roleConfiguration.appId === 'string' && VALID_APP_IDS.has(roleConfiguration.appId)
                ? roleConfiguration.appId as AppId
                : null;
            if (!configuredRole || !appId) {
                return res.status(400).json({ message: 'Invalid role permission configuration.' });
            }
            const permissions = normalizePermissions(roleConfiguration.permissions);
            await getRolePermissionRef(adminDb, configuredRole, appId).set({
                appId,
                permissions,
                updatedAt: FieldValue.serverTimestamp(),
                updatedBy: callerEmail,
            }, { merge: true });
            return res.status(200).json({ message: 'Role permissions updated successfully.' });
        }

        if (authenticationRecord) {
            await saveAuthenticationRecord(adminAuth, adminDb, callerEmail, authenticationRecord);
            return res.status(200).json({ message: 'Authentication record updated successfully.' });
        }

        const targetAuthUser = role || hasNameUpdate ? await adminAuth.getUser(effectiveUserId) : null;

        // 5. Update Password (if provided)
        if (password) {
            if (password.length < 6) {
                return res.status(400).json({ message: 'Password must be at least 6 characters.' });
            }
            await adminAuth.updateUser(effectiveUserId, { password });
        }

        if (role || hasNameUpdate) {
            const authenticationSnapshot = await adminDb.collection('authentication').doc(effectiveUserId).get();
            if (!authenticationSnapshot.exists) {
                return res.status(404).json({ message: 'Authentication profile not found.' });
            }
            const commonData = authenticationSnapshot.data() || {};
            const fallbackName = targetAuthUser?.email?.split('@')[0] || effectiveUserId;
            const inputFullName = String(fullName ?? '').trim();
            const inputDisplayName = String(displayName ?? '').trim();
            const normalizedFullName = inputFullName
                || inputDisplayName
                || String(commonData.fullName || commonData.displayName || targetAuthUser?.displayName || '').trim()
                || fallbackName;
            const normalizedDisplayName = inputDisplayName
                || inputFullName
                || String(commonData.displayName || commonData.fullName || targetAuthUser?.displayName || '').trim()
                || fallbackName;
            const normalizedSharedRole = role && isAuthenticationAdminEmail(targetAuthUser?.email)
                ? 'ADMIN'
                : role ? normalizeSharedRole(role) : null;
            if (role && !normalizedSharedRole) {
                return res.status(400).json({ message: 'Invalid shared role.' });
            }
            const effectiveRole = normalizedSharedRole || normalizeSharedRole(commonData.role);
            const department = getDepartmentFromRole(effectiveRole);
            const now = FieldValue.serverTimestamp();
            const batch = adminDb.batch();
            batch.set(adminDb.collection('authentication').doc(effectiveUserId), {
                uid: effectiveUserId,
                email: String(commonData.email || targetAuthUser?.email || '').trim().toLowerCase(),
                fullName: normalizedFullName,
                displayName: normalizedDisplayName,
                empID: commonData.empID ?? null,
                role: effectiveRole,
                department,
                teamId: SHARED_TEAM_ID,
                active: typeof commonData.active === 'boolean'
                    ? commonData.active
                    : true,
                permissions: FieldValue.delete(),
                permissionDefaults: FieldValue.delete(),
                updatedAt: now,
                updatedBy: callerEmail,
            }, { merge: true });
            if (hasNameUpdate) {
                await adminAuth.updateUser(effectiveUserId, { displayName: normalizedDisplayName });
            }
            if (normalizedSharedRole) {
                APP_IDS.forEach(appId => {
                    batch.set(adminDb.doc(`authentication/${effectiveUserId}/apps/${appId}`), {
                        appId,
                        role: FieldValue.delete(),
                        permissionDefaults: FieldValue.delete(),
                        updatedAt: now,
                        updatedBy: callerEmail,
                    }, { merge: true });
                });
            }
            await batch.commit();
            if (normalizedSharedRole) {
                await adminAuth.setCustomUserClaims(effectiveUserId, {
                    ...(targetAuthUser?.customClaims || {}),
                    role: normalizedSharedRole,
                    admin: isManagementRole(normalizedSharedRole),
                });
            }
        }

        return res.status(200).json({ message: 'User updated successfully.' });

    } catch (error: any) {
        console.error('[API PATCH /users Error]', error);
        return res.status(error?.status || 500).json({ message: error?.message || 'Internal Server Error' });
    }
}

// ========================================
// POST /api/users - Create User
// ========================================
async function handleCreateUser(req: VercelRequest, res: VercelResponse) {
    const { email, password, fullName, displayName, empID, role, nhmediaRole, enabledApps } = req.body;
    const requestedRole = role ?? nhmediaRole;
    const idToken = req.headers.authorization?.split('Bearer ')[1];

    if (!email || !password || (!fullName && !displayName) || !empID || !requestedRole || !idToken) {
        return res.status(400).json({ message: 'Missing required fields.' });
    }

    try {
        const adminApp = initFirebaseAdmin();
        const adminAuth = getAuth(adminApp);
        const adminDb = getDb();

        // 1. Authenticate caller
        let callerEmail: string;
        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            callerEmail = String(decodedToken.email || '').toLowerCase();
        } catch (authError) {
            console.warn("Caller auth failed:", authError);
            return res.status(401).json({ message: 'Unauthorized. Invalid token.' });
        }

        // 2. Verify the fixed authentication administrator.
        if (!isAuthenticationAdminEmail(callerEmail)) {
            return res.status(403).json({ message: 'Forbidden. Only the authentication administrator can create users.' });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const fallbackName = normalizedEmail.split('@')[0];
        const inputFullName = String(fullName || '').trim();
        const inputDisplayName = String(displayName || '').trim();
        const normalizedFullName = inputFullName || inputDisplayName || fallbackName;
        const normalizedDisplayName = inputDisplayName || inputFullName || fallbackName;
        const normalizedEmpID = String(empID || '').trim();
        const normalizedSharedRole = isAuthenticationAdminEmail(normalizedEmail)
            ? 'ADMIN'
            : normalizeSharedRole(requestedRole);
        if (!normalizedSharedRole) {
            return res.status(400).json({ message: 'Invalid shared role.' });
        }
        const normalizedEnabledApps = new Set<AppId>(Array.isArray(enabledApps)
            ? enabledApps.filter((appId): appId is AppId => typeof appId === 'string' && VALID_APP_IDS.has(appId))
            : []);
        if (normalizedEnabledApps.size === 0) {
            return res.status(400).json({ message: 'Select at least one application for the new user.' });
        }
        const authenticationEmpID = await adminDb.collection('authentication').where('empID', '==', normalizedEmpID).limit(1).get();
        if (!authenticationEmpID.empty) {
            return res.status(409).json({ message: `Employee ID ${normalizedEmpID} already exists.` });
        }

        // 3. Create OR Recover user in Firebase Authentication
        let newUserUid: string;

        try {
            const newUserRecord = await adminAuth.createUser({
                email: normalizedEmail,
                password,
                emailVerified: true,
                displayName: normalizedDisplayName,
            });
            newUserUid = newUserRecord.uid;
        } catch (createError: any) {
            if (createError.code === 'auth/email-already-exists') {
                // Handle "Ghost User" case: Exists in Auth but maybe not in DB?
                try {
                    const existingUser = await adminAuth.getUserByEmail(normalizedEmail);
                    newUserUid = existingUser.uid;

                    const existingAuthenticationDoc = await adminDb.collection('authentication').doc(newUserUid).get();
                    if (existingAuthenticationDoc.exists) {
                        // Real duplicate
                        return res.status(409).json({ message: 'This email is already fully registered.' });
                    }

                    // Ghost Account detected (Auth yes, DB no). Recover it!
                    console.log(`[handleCreateUser] Recovering ghost account for ${email} (${newUserUid})`);
                    await adminAuth.updateUser(newUserUid, {
                        password,
                        emailVerified: true,
                        displayName: normalizedDisplayName,
                    });

                    // Proceed to create DB doc below...
                } catch (lookupError) {
                    console.error("Error looking up existing user:", lookupError);
                    throw createError; // Throw original error
                }
            } else {
                throw createError;
            }
        }

        const department = getDepartmentFromRole(normalizedSharedRole);
        const now = FieldValue.serverTimestamp();
        const batch = adminDb.batch();

        // New user authorization is stored only in the shared authentication tree.
        batch.set(adminDb.collection('authentication').doc(newUserUid), {
            uid: newUserUid,
            email: normalizedEmail,
            fullName: normalizedFullName,
            displayName: normalizedDisplayName,
            empID: normalizedEmpID,
            role: normalizedSharedRole,
            department,
            teamId: SHARED_TEAM_ID,
            active: true,
            photoURL: null,
            permissions: FieldValue.delete(),
            permissionDefaults: FieldValue.delete(),
            updatedAt: now,
            updatedBy: callerEmail,
        }, { merge: true });
        batch.set(adminDb.doc(`authentication/${newUserUid}/apps/dashboard`), {
            appId: 'dashboard',
            enabled: normalizedEnabledApps.has('dashboard'),
            allowedAccounts: [],
            permissions: {},
            role: FieldValue.delete(),
            permissionDefaults: FieldValue.delete(),
            updatedAt: now,
            updatedBy: callerEmail,
        }, { merge: true });
        batch.set(adminDb.doc(`authentication/${newUserUid}/apps/workload`), {
            appId: 'workload',
            enabled: normalizedEnabledApps.has('workload'),
            allowedAccounts: [],
            permissions: {},
            role: FieldValue.delete(),
            permissionDefaults: FieldValue.delete(),
            updatedAt: now,
            updatedBy: callerEmail,
        }, { merge: true });
        await batch.commit();
        await adminAuth.setCustomUserClaims(newUserUid, {
            role: normalizedSharedRole,
            admin: isManagementRole(normalizedSharedRole),
        });

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
        let callerEmail: string;
        try {
            const decodedToken = await adminAuth.verifyIdToken(idToken);
            callerUid = decodedToken.uid;
            callerEmail = String(decodedToken.email || '').toLowerCase();
        } catch (authError) {
            console.warn("Caller auth failed:", authError);
            return res.status(401).json({ message: 'Unauthorized. Invalid token.' });
        }

        // 2. Verify the fixed authentication administrator.
        if (!isAuthenticationAdminEmail(callerEmail)) {
            return res.status(403).json({ message: 'Forbidden. Only the authentication administrator can delete users.' });
        }

        // 3. Get target user info from both Firebase Auth and the canonical profile.
        const targetProfileRef = adminDb.collection('authentication').doc(userId);
        const [targetAuthUser, targetProfileSnapshot] = await Promise.all([
            adminAuth.getUser(userId).catch(() => null),
            targetProfileRef.get(),
        ]);
        const targetEmail = String(
            targetAuthUser?.email || targetProfileSnapshot.data()?.email || '',
        ).toLowerCase();
        if (isAuthenticationAdminEmail(targetEmail)) {
            return res.status(400).json({ message: 'Cannot delete the authentication administrator.' });
        }

        // 5. Prevent self-deletion
        if (callerUid === userId) {
            return res.status(400).json({ message: 'Cannot delete yourself.' });
        }

        // 7. Delete user from Firebase Authentication
        try {
            await adminAuth.deleteUser(userId);
        } catch (authError: any) {
            if (authError.code === 'auth/user-not-found') {
                console.warn("User not found in Auth (already deleted?), proceeding to delete role doc.");
            } else {
                console.error("Failed to delete user from Auth:", authError);
                throw new Error(`Failed to delete Auth capability: ${authError.message}`);
            }
        }

        // Remove the complete authentication tree, including future nested documents.
        await adminDb.recursiveDelete(targetProfileRef);

        return res.status(200).json({
            message: 'User deleted successfully.',
            deletedUserId: userId,
            deletedEmail: targetEmail,
        });

    } catch (error: any) {
        console.error('[API DELETE /users Error]', error);
        return res.status(500).json({ message: error?.message || 'Internal Server Error' });
    }
}
