// File: api/_lib/googleAuthHelper.ts
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from './googleConfig.js';

export async function getAccessTokenFromRefreshToken(refreshToken: string): Promise<string> {
  if (!GOOGLE_CLIENT_SECRET) {
    throw new Error('Server configuration error: missing GOOGLE_CLIENT_SECRET.');
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
    // Specific check for revoked token
    if (data.error === 'invalid_grant') {
       throw new Error(`Token has been expired or revoked for refresh token: ${refreshToken.substring(0, 10)}...`);
    }
    throw new Error(data.error_description || 'Failed to refresh token.');
  }

  return data.access_token;
}
