import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './_lib/googleConfig.js';
import type { Account } from './_lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { code, redirectUri } = req.body;

  if (!code) {
    return res.status(400).json({ message: 'Authorization code is required.' });
  }
  if (!redirectUri) {
    return res.status(400).json({ message: 'Redirect URI is required.' });
  }
  if (!GOOGLE_CLIENT_SECRET) {
     return res.status(500).json({ message: 'Server configuration error: missing client secret.' });
  }

  try {
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
  } catch (error: any) {
    console.error('[API /google-auth-callback Error]', error);
    return res.status(500).json({ message: error.message || 'An internal server error occurred.' });
  }
}
