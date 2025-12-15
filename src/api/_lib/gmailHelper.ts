// File: api/_lib/gmailHelper.ts
import { Buffer } from 'buffer';


const urlSafeBase64Decode = (str: string): string => {
    if (!str) return "";
    try {
        let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }
        // This is Node.js environment
        return Buffer.from(base64, 'base64').toString('utf-8');
    } catch (e) {
        console.error("Base64 decode failed:", e, "Input:", str);
        return "";
    }
};

/**
 * Unwrap kiểu quoted-printable đơn giản giống Python
 */
const qpSoftBreak = /=\r?\n/g;
const qpUnwrapHtml = (s: string): string => {
    if (!s) return "";
    s = s.replace(qpSoftBreak, "");
    s = s.replace(/=3D/g, "=");
    return s;
};

/**
 * Unescape HTML đơn giản (Node)
 */
const htmlUnescape = (s: string): string => {
    if (!s) return "";
    return s
        .replace(/&nbsp;/gi, ' ')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&amp;/gi, '&')
        .replace(/&#39;/gi, "'")
        .replace(/&quot;/gi, '"');
};

/**
 * Strip HTML -> text giống bản Python
 */
const stripHtmlToText = (htmlSrc: string): string => {
    if (!htmlSrc) return "";
    let txt = qpUnwrapHtml(htmlSrc);
    txt = htmlUnescape(txt);
    txt = txt.replace(/<br\s*\/?>/gi, "\n");
    txt = txt.replace(/<\/p\s*>/gi, "\n\n");
    txt = txt.replace(/<[^>]+>/g, " ");
    txt = txt.replace(/[ \t]+\n/g, "\n");
    txt = txt.replace(/\n{3,}/g, "\n\n");
    txt = txt.replace(/[ \t]{2,}/g, " ");
    return txt.trim();
};

/**
 * LẤY HTML GỐC từ Gmail payload (giống _extract_html_from_payload bên Python)
 */
const getHtmlFromGmailPayload = (payload: any): string => {
    if (!payload) return "";

    if (payload.body?.data && !payload.parts) {
        if ((payload.mimeType || '').toLowerCase() === 'text/html') {
            return urlSafeBase64Decode(payload.body.data);
        }
        return "";
    }

    const stack = payload.parts ? [...payload.parts] : [];
    const htmlParts: string[] = [];

    while (stack.length > 0) {
        const part = stack.shift();
        if (!part) continue;

        if (part.parts && part.parts.length) {
            stack.push(...part.parts);
            continue;
        }

        const mt = (part.mimeType || '').toLowerCase();
        const data = part.body?.data;
        if (!data) continue;

        if (mt.startsWith('text/html')) {
            const html = urlSafeBase64Decode(data);
            if (html.trim()) htmlParts.push(html);
        }
    }

    return htmlParts.join('\n');
};

/**
 * LẤY PLAIN TEXT (cũ) — vẫn giữ để fallback
 */
const getPlainTextFromGmailPayload = (payload: any): string => {
    if (!payload) return "";
    if (payload.body?.data && !payload.parts) {
        if (payload.mimeType === 'text/plain') return urlSafeBase64Decode(payload.body.data);
        if (payload.mimeType === 'text/html') {
            return stripHtmlToText(urlSafeBase64Decode(payload.body.data));
        }
        return "";
    }
    let plainText = "";
    const stack = payload.parts ? [...payload.parts] : [];
    while (stack.length > 0) {
        const part = stack.shift();
        if (!part) continue;
        if (part.parts) {
            stack.push(...part.parts);
        } else if (part.mimeType?.toLowerCase() === 'text/plain' && part.body?.data) {
            plainText += urlSafeBase64Decode(part.body.data) + "\n";
        }
    }
    if (plainText.trim()) return plainText.trim();
    const htmlPart = (payload.parts || []).find((p: any) => p.mimeType === 'text/html' && p.body?.data);
    if (htmlPart) {
        const htmlText = urlSafeBase64Decode(htmlPart.body.data);
        return stripHtmlToText(htmlText);
    }
    return "";
};


export {
    urlSafeBase64Decode,
    qpUnwrapHtml,
    htmlUnescape,
    stripHtmlToText,
    getHtmlFromGmailPayload,
    getPlainTextFromGmailPayload
};