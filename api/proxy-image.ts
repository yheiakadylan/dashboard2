import type { VercelRequest, VercelResponse } from '@vercel/node';
import fetch from 'node-fetch';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    const { url } = req.query;

    if (!url || typeof url !== 'string') {
        return res.status(400).send('Missing url parameter');
    }

    try {
        const targetUrl = new URL(url);
        const allowedDomains = [
            'i.etsystatic.com',
            'i.ebayimg.com',
            'ebay.com',
            'googleusercontent.com',
            'lh3.googleusercontent.com',
            'drive.google.com'
        ];

        // Check if hostname ends with any of the allowed domains
        // This handles subdomains automatically (e.g., 'a.i.etsystatic.com' is valid if 'etsystatic.com' was allowed, 
        // but here we are specific with 'i.etsystatic.com')
        const isAllowed = allowedDomains.some(domain =>
            targetUrl.hostname === domain || targetUrl.hostname.endsWith('.' + domain)
        );

        if (!isAllowed) {
            console.warn(`[Proxy] Blocked request to unauthorized domain: ${targetUrl.hostname}`);
            return res.status(403).send('Forbidden: Domain not allowed');
        }

        const response = await fetch(url);
        if (!response.ok) {
            return res.status(response.status).send('Failed to fetch image');
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(buffer);
    } catch (error) {
        console.error('Proxy Image Error:', error);
        res.status(500).send('Internal Server Error');
    }
}
