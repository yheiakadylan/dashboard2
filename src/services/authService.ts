import { GOOGLE_CLIENT_ID, MSAL_CLIENT_ID, MSAL_AUTHORITY, MSAL_SCOPES } from '../config';
import { Account } from '../types';

// Extend the Window interface to include the google object from GSI script
declare global {
  interface Window {
    google: any;
  }
}
//HELPER
// Helper 1: Tạo một chuỗi ngẫu nhiên an toàn (code verifier)
function generateCodeVerifier(): string {
  const S4 = () => (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
  return S4() + S4() + S4() + S4() + S4() + S4() + S4() + S4();
}

// Helper 2: Tạo code challenge từ verifier (SHA-256 -> base64url)
async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await window.crypto.subtle.digest('SHA-256', data);

  // Chuyển ArrayBuffer sang string
  const base64 = window.btoa(String.fromCharCode(...new Uint8Array(digest)));

  // Chuyển từ Base64 sang Base64URL
  return base64
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
// --- Microsoft Server-Side Authentication Flow ---

export const signInWithMicrosoft = (): Promise<Account> => {
  // BẮT BUỘC: Hàm này giờ phải là async
  return new Promise(async (resolve, reject) => {
    const redirectUri = window.location.origin;

    // === START: THAY ĐỔI PKCE ===
    const storageKey = 'ms_pkce_verifier';
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);

    // 1. Lưu verifier vào localStorage
    localStorage.setItem(storageKey, codeVerifier);
    // === END: THAY ĐỔI PKCE ===

    const oauth2Endpoint = `${MSAL_AUTHORITY}/oauth2/v2.0/authorize`;
    const params: { [key: string]: string } = { // Sửa kiểu
      client_id: MSAL_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: MSAL_SCOPES.join(' '),
      state: 'microsoft',

      // === START: THAY ĐỔI PKCE ===
      // 2. Gửi challenge và method trong URL
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      // === END: THAY ĐỔI PKCE ===
    };

    const url = `${oauth2Endpoint}?${new URLSearchParams(params)}`;
    const popup = window.open(url, 'microsoft-signin', 'width=500,height=600');

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return;
      }
      if (event.data.type === 'microsoft-auth-callback' && event.data.code) {
        window.removeEventListener('message', handleMessage);
        if (popup) popup.close();

        // === START: THAY ĐỔI PKCE ===
        // 3. Lấy lại verifier từ localStorage
        const codeVerifier = localStorage.getItem(storageKey);
        localStorage.removeItem(storageKey); // Xóa ngay

        if (!codeVerifier) {
          reject(new Error('Microsoft PKCE verifier not found. Authentication failed.'));
          return;
        }
        // === END: THAY ĐỔI PKCE ===

        try {
          const response = await fetch('/api/oauth-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: 'microsoft',
              code: event.data.code,
              redirectUri: redirectUri,
              // === START: THAY ĐỔI PKCE ===
              // 4. Gửi verifier lên server
              codeVerifier: codeVerifier
              // === END: THAY ĐỔI PKCE ===
            }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to exchange authorization code.');
          }

          const { account } = await response.json();
          resolve(account);
        } catch (error) {
          reject(error);
        }
      }
    };

    window.addEventListener('message', handleMessage);
  });
};

export const getMicrosoftToken = async (account: Account): Promise<string> => {
  if (account.provider !== 'outlook' || !account.token) {
    throw new Error('Invalid account type or missing refresh token for Microsoft account.');
  }

  // Fetch a new token from our backend using the refresh token
  try {
    const response = await fetch('/api/oauth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'microsoft', refreshToken: account.token }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.message || 'Failed to get new access token.');
    }

    const { accessToken } = await response.json();
    return accessToken;
  } catch (error) {
    console.error(`Failed to refresh Microsoft token for ${account.email}`, error);
    throw error;
  }
};


// --- Google Server-Side Authentication Flow ---

export const signInWithGoogle = (): Promise<Account> => {
  return new Promise((resolve, reject) => {
    const GOOGLE_SCOPES = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/spreadsheets";
    const redirectUri = window.location.origin;

    const oauth2Endpoint = 'https://accounts.google.com/o/oauth2/v2/auth';
    const params = {
      client_id: GOOGLE_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline', // Request refresh token
      prompt: 'consent',      // Ensure refresh token is always sent
      state: 'google',       // Add state to identify the provider on callback
    };

    const url = `${oauth2Endpoint}?${new URLSearchParams(params)}`;
    const popup = window.open(url, 'google-signin', 'width=500,height=600');

    const handleMessage = async (event: MessageEvent) => {
      if (event.origin !== window.location.origin) {
        return; // Security: ignore messages from other origins
      }
      if (event.data.type === 'google-auth-callback' && event.data.code) {
        // Cleanup listener and popup
        window.removeEventListener('message', handleMessage);
        if (popup) popup.close();

        try {
          // Exchange the code for tokens via our backend
          const response = await fetch('/api/oauth-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ provider: 'google', code: event.data.code, redirectUri: redirectUri }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.message || 'Failed to exchange authorization code.');
          }

          const { account } = await response.json();
          resolve(account);
        } catch (error) {
          reject(error);
        }
      }
    };

    window.addEventListener('message', handleMessage);
  });
};

const googleAccessTokenCache = new Map<string, { token: string, expiresAt: number }>();

/**
 * Gets a valid Google access token, fetching a new one from the backend if needed.
 * @param account - The Google account, containing the refresh token in `account.token`.
 * @param options - Options like `forceRefresh` to bypass the cache.
 * @returns A promise that resolves to a valid access token.
 */
export const getGoogleAccessToken = async (account: Account, options: { forceRefresh?: boolean } = {}): Promise<string> => {
  if (account.provider !== 'gmail' || !account.token) {
    throw new Error('Invalid account type or missing refresh token for Google account.');
  }

  const cacheKey = account.id;
  const cached = googleAccessTokenCache.get(cacheKey);

  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) {
    return cached.token;
  }

  // Fetch a new token from our backend using the refresh token
  try {
    const response = await fetch('/api/oauth-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', refreshToken: account.token }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      googleAccessTokenCache.delete(cacheKey); // Invalidate cache on failure
      throw new Error(errorData.message || 'Failed to get new access token.');
    }

    const { accessToken, expiresIn } = await response.json();

    // Cache the new token. expiresIn is in seconds.
    const expiresAt = Date.now() + (expiresIn - 60) * 1000; // Subtract 60s buffer
    googleAccessTokenCache.set(cacheKey, { token: accessToken, expiresAt });

    return accessToken;
  } catch (error) {
    console.error(`Failed to refresh Google token for ${account.email}`, error);
    googleAccessTokenCache.delete(cacheKey);
    throw error;
  }
};
