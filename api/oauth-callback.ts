import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './_lib/googleConfig.js';
import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from './_lib/microsoftConfig.js';
import type { Account } from './_lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { provider, code, redirectUri, codeVerifier } = req.body;

    if (!provider || !code || !redirectUri) {
        return res.status(400).json({ message: 'Provider, code, and redirectUri are required.' });
    }

    try {
        if (provider === 'google') {
            return await handleGoogleCallback(req, res, code, redirectUri);
        } else if (provider === 'microsoft') {
            if (!codeVerifier) {
                return res.status(400).json({ message: 'PKCE code verifier is required for Microsoft.' });
            }
            return await handleMicrosoftCallback(req, res, code, redirectUri, codeVerifier);
        } else {
            return res.status(400).json({ message: 'Invalid provider. Use "google" or "microsoft".' });
        }
    } catch (error: any) {
        console.error(`[API /oauth-callback Error] Provider: ${provider}`, error);
        return res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    }
}

async function handleGoogleCallback(req: VercelRequest, res: VercelResponse, code: string, redirectUri: string) {
    if (!GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ message: 'Server configuration error: missing Google client secret.' });
    }

    // Step 1: Exchange authorization code for tokens
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || tokens.error) {
        console.error('Google token exchange error:', tokens);
        throw new Error(tokens.error_description || 'Failed to exchange authorization code for tokens.');
    }

    const { access_token, refresh_token } = tokens;

    if (!refresh_token) {
        throw new Error('Google did not return a refresh token. Please ensure "access_type=offline" and "prompt=consent" were used.');
    }

    // Step 2: Get user profile information
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { 'Authorization': `Bearer ${access_token}` },
    });

    if (!userinfoResponse.ok) {
        const errorData = await userinfoResponse.json();
        console.error('Google userinfo error:', errorData);
        throw new Error('Failed to fetch user information from Google.');
    }

    const userInfo = await userinfoResponse.json();

    const newAccount: Account = {
        id: userInfo.sub,
        email: userInfo.email,
        label: userInfo.name || userInfo.email,
        provider: 'gmail',
        token: refresh_token, // IMPORTANT: Store the long-lived refresh token
    };

    return res.status(200).json({ account: newAccount });
}

async function handleMicrosoftCallback(req: VercelRequest, res: VercelResponse, code: string, redirectUri: string, codeVerifier: string) {
    if (!MICROSOFT_CLIENT_SECRET) {
        return res.status(500).json({ message: 'Server configuration error: missing Microsoft client secret.' });
    }
    if (!MICROSOFT_CLIENT_ID) {
        return res.status(500).json({ message: 'Server configuration error: missing Microsoft client ID.' });
    }

    // Step 1: Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        scope: 'openid profile email Mail.Read User.Read offline_access',
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        client_secret: MICROSOFT_CLIENT_SECRET,
        code_verifier: codeVerifier,
    });

    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
    });

    const tokens = await tokenResponse.json();

    if (!tokenResponse.ok || tokens.error) {
        console.error('Microsoft token exchange error:', tokens);
        throw new Error(tokens.error_description || 'Failed to exchange authorization code for tokens.');
    }

    const { access_token, refresh_token } = tokens;

    if (!refresh_token) {
        throw new Error('Microsoft did not return a refresh token. Please ensure "offline_access" scope was requested.');
    }

    // Step 2: Get user profile information
    const userinfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { 'Authorization': `Bearer ${access_token}` },
    });

    if (!userinfoResponse.ok) {
        const errorData = await userinfoResponse.json();
        console.error('Microsoft userinfo error:', errorData);
        throw new Error('Failed to fetch user information from Microsoft Graph.');
    }

    const userInfo = await userinfoResponse.json();
    const uniqueId = userInfo.id;

    const newAccount: Account = {
        id: uniqueId,
        email: userInfo.userPrincipalName,
        label: userInfo.displayName || userInfo.userPrincipalName,
        provider: 'outlook',
        token: refresh_token,
    };

    return res.status(200).json({ account: newAccount });
}
