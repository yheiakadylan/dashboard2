// This file is intended for server-side use only (in /api routes).
// It safely reads credentials from Vercel environment variables.

export const MICROSOFT_CLIENT_ID = process.env.MSAL_CLIENT_ID;
export const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;