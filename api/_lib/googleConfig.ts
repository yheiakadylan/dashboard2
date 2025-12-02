// This file is intended for server-side use only (in /api routes).
// It safely reads credentials from Vercel environment variables.

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ;
export const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
