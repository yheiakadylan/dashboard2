import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from './_lib/microsoftConfig.js';
import type { Account } from './_lib/types.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { code, redirectUri, codeVerifier } = req.body;

  if (!code) {
    return res.status(400).json({ message: 'Authorization code is required.' });
  }
  if (!redirectUri) {
    return res.status(400).json({ message: 'Redirect URI is required.' });
  }
  // THÊM: Kiểm tra verifier
  if (!codeVerifier) {
    return res.status(400).json({ message: 'PKCE code verifier is required.' });
  }
  if (!MICROSOFT_CLIENT_SECRET) {
    return res.status(500).json({ message: 'Server configuration error: missing client secret.' });
  }
  if (!MICROSOFT_CLIENT_ID) {
    return res.status(500).json({ message: 'Server configuration error: missing client ID.' });
  }

  try {
    // Step 1: Exchange authorization code for tokens
    const tokenParams = new URLSearchParams({
      client_id: MICROSOFT_CLIENT_ID,
      scope: 'openid profile email Mail.Read User.Read offline_access',
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      client_secret: MICROSOFT_CLIENT_SECRET,

      // 2. Thêm verifier vào request gửi tới Microsoft
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

    // Step 2: Get user profile information (Giữ nguyên)
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
  } catch (error: any) {
    console.error('[API /microsoft-auth-callback Error]', error);
    return res.status(500).json({ message: error.message || 'An internal server error occurred.' });
  }
}