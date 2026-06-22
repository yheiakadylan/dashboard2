import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './_lib/googleConfig.js';
import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from './_lib/microsoftConfig.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const { provider, refreshToken } = req.body;

    if (!provider || !refreshToken) {
        return res.status(400).json({ message: 'Provider and refresh token are required.' });
    }

    try {
        if (provider === 'google') {
            return await handleGoogleToken(req, res, refreshToken);
        } else if (provider === 'microsoft') {
            return await handleMicrosoftToken(req, res, refreshToken);
        } else {
            return res.status(400).json({ message: 'Invalid provider. Use "google" or "microsoft".' });
        }
    } catch (error: any) {
        console.error(`[API /oauth-token Error] Provider: ${provider}`, error);
        return res.status(500).json({ message: error.message || 'An internal server error occurred.' });
    }
}

async function handleGoogleToken(req: VercelRequest, res: VercelResponse, refreshToken: string) {
    if (!GOOGLE_CLIENT_SECRET) {
        return res.status(500).json({ message: 'Server configuration error: missing Google client secret.' });
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            refresh_token: refreshToken,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            grant_type: 'refresh_token',
        }),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        console.error('Google token refresh error:', data);
        return res.status(response.status).json({ message: data.error_description || 'Failed to refresh token.' });
    }

    // expires_in is in seconds
    res.status(200).json({ accessToken: data.access_token, expiresIn: data.expires_in });
}

async function handleMicrosoftToken(req: VercelRequest, res: VercelResponse, refreshToken: string) {
    if (!MICROSOFT_CLIENT_SECRET) {
        return res.status(500).json({ message: 'Server configuration error: missing Microsoft client secret.' });
    }
    if (!MICROSOFT_CLIENT_ID) {
        return res.status(500).json({ message: 'Server configuration error: missing Microsoft client ID.' });
    }

    const tokenParams = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        scope: 'openid profile email Mail.Read User.Read offline_access',
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
        client_secret: MICROSOFT_CLIENT_SECRET,
    });

    const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: tokenParams.toString(),
    });

    const data = await response.json();

    if (!response.ok || data.error) {
        console.error('Microsoft token refresh error:', data);
        return res.status(response.status).json({ message: data.error_description || 'Failed to refresh token.' });
    }

    // expires_in is in seconds
    res.status(200).json({ accessToken: data.access_token, expiresIn: data.expires_in });
}
