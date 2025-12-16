import type { VercelRequest, VercelResponse } from '@vercel/node';
import { MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET } from './_lib/microsoftConfig.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required.' });
  }
   if (!MICROSOFT_CLIENT_SECRET) {
     return res.status(500).json({ message: 'Server configuration error: missing client secret.' });
  }
   if (!MICROSOFT_CLIENT_ID) {
     return res.status(500).json({ message: 'Server configuration error: missing client ID.' });
  }

  try {
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
  } catch (error: any) {
    console.error('[API /microsoft-get-token Error]', error);
    return res.status(500).json({ message: error.message || 'An internal server error occurred.' });
  }
}