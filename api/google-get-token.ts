import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './_lib/googleConfig.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const { refreshToken } = req.body;

  if (!refreshToken) {
    return res.status(400).json({ message: 'Refresh token is required.' });
  }
   if (!GOOGLE_CLIENT_SECRET) {
     return res.status(500).json({ message: 'Server configuration error: missing client secret.' });
  }

  try {
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
  } catch (error: any) {
    console.error('[API /google-get-token Error]', error);
    return res.status(500).json({ message: error.message || 'An internal server error occurred.' });
  }
}
