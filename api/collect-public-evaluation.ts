import type { VercelRequest, VercelResponse } from '@vercel/node';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getAuth } from 'firebase-admin/auth';
import { getDb, initFirebaseAdmin } from './_lib/firebaseAdminHelper.js';

export const config = { maxDuration: 300 };

const MAX_PAGES = 30;
const MIN_DELAY_MS = 5_000;
const MAX_DELAY_MS = 8_000;
const CAPTCHA_WAIT_MS = 180_000;

const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

function errorData(error: unknown) {
  if (!(error instanceof Error)) return { message: String(error).slice(0, 2_000) };
  return { name: error.name, message: error.message.slice(0, 2_000), stack: error.stack?.slice(0, 8_000) };
}

async function writeRunLog(runRef: FirebaseFirestore.DocumentReference, entry: Record<string, unknown>) {
  try { await runRef.collection('logs').add(JSON.parse(JSON.stringify({ timestamp: new Date().toISOString(), source: 'localhost-visible-chrome', version: '1', ...entry }))); } catch {}
}

function forceUsdUrl(value: string): string {
  const url = new URL(value);
  url.searchParams.set('currency', 'USD');
  url.searchParams.set('ship_to', 'US');
  url.searchParams.set('language', 'en-US');
  return url.toString();
}

function chromeExecutable(): string {
  const candidates = [
    process.env.CHROME_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter((value): value is string => Boolean(value));
  const executable = candidates.find(candidate => existsSync(candidate));
  if (!executable) throw new Error('Không tìm thấy Google Chrome. Cấu hình CHROME_EXECUTABLE_PATH.');
  return executable;
}

async function waitForHumanVerification(page: any, runRef: FirebaseFirestore.DocumentReference): Promise<void> {
  const startedAt = Date.now();
  let logged = false;
  while (Date.now() - startedAt < CAPTCHA_WAIT_MS) {
    const challenged = await page.evaluate(() => {
      const body = document.body?.innerText.toLowerCase() || '';
      return Boolean(document.querySelector('#ddv1-captcha-container, [data-dd-ddv1-captcha-container], iframe[src*="captcha"], #captcha, [class*="captcha"], [data-captcha]'))
        || body.includes('verify you are human') || body.includes('are you a robot') || body.includes('security check');
    });
    if (!challenged) return;
    if (!logged) { logged = true; await writeRunLog(runRef, { level: 'warn', stage: 'waiting-human-verification', message: 'Etsy/DataDome CAPTCHA detected.', request: { method: 'GET', url: page.url() } }); }
    await runRef.set({ stage: 'waiting-human-verification', warnings: ['Etsy yêu cầu xác minh trong cửa sổ Chrome đang mở.'], updatedAt: new Date().toISOString() }, { merge: true });
    await sleep(3_000);
  }
  throw new Error('Hết 180 giây chờ xác minh Etsy trên Chrome.');
}

async function connectToRegularChrome(chromium: any, executablePath: string, profilePath: string): Promise<{ browser: any; process: ChildProcess }> {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chromeProcess = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    '--start-maximized',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: false });
  const endpoint = `http://127.0.0.1:${port}`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 20_000) {
    if (chromeProcess.exitCode != null) throw new Error(`Chrome đã thoát trước khi CDP sẵn sàng (${chromeProcess.exitCode}).`);
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return { browser: await chromium.connectOverCDP(endpoint), process: chromeProcess };
    } catch {}
    await sleep(500);
  }
  chromeProcess.kill();
  throw new Error('Không kết nối được Chrome qua CDP sau 20 giây.');
}

async function gradualScroll(page: any): Promise<void> {
  await page.evaluate(async () => {
    for (let index = 0; index < 10; index += 1) {
      window.scrollBy(0, Math.max(500, window.innerHeight * 0.8));
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    window.scrollTo(0, 0);
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method not allowed.' });
  if (process.env.NODE_ENV === 'production' && process.env.VERCEL) {
    return res.status(501).json({ message: 'Public Chrome crawler chỉ chạy trên localhost. Production phải dùng extension worker.' });
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const { teamId, accountId, shopLabel } = req.body || {};
  if (!token || !teamId || !accountId || !shopLabel) return res.status(400).json({ message: 'Missing token, teamId, accountId or shopLabel.' });

  const app = initFirebaseAdmin();
  const decoded = await getAuth(app).verifyIdToken(token);
  const db = getDb();
  const roleDoc = await db.collection('user_roles').doc(decoded.uid).get();
  const profile = roleDoc.data();
  if (!roleDoc.exists || profile?.teamId !== teamId) return res.status(403).json({ message: 'Forbidden.' });
  const hasFullAccess = profile?.role === 'owner' || profile?.permissions?.canManageSettings === true;
  const allowed = new Set(Array.isArray(profile?.allowedAccounts) ? profile.allowedAccounts.map(String) : []);
  if (!hasFullAccess && !allowed.has(String(accountId)) && !allowed.has(String(shopLabel))) return res.status(403).json({ message: 'No access to this shop.' });

  const slug = String(shopLabel).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!slug) return res.status(400).json({ message: 'Invalid Etsy shop label.' });
  const publicUrl = `https://www.etsy.com/shop/${slug}`;
  const runRef = db.collection('user').doc(teamId).collection('evaluation_runs').doc();
  const runId = runRef.id;
  const warnings: string[] = [];
  const listingIds = new Set<string>();
  let browser: any;
  let chromeProcess: ChildProcess | undefined;

  await runRef.set({ id: runId, accountId, shopLabel, publicUrl, currency: 'USD', shipTo: 'US', workerId: 'localhost-visible-chrome', type: 'public-shop-collection', status: 'running', stage: 'opening-visible-chrome', coverage: { shopPages: 0, listings: 0, reviews: 0 }, requestedBy: decoded.uid, createdAt: new Date(), startedAt: new Date().toISOString() });
  await writeRunLog(runRef, { level: 'info', stage: 'run-start', message: 'Visible Chrome public crawl started.', context: { shopLabel, publicUrl, maxPages: MAX_PAGES, delayMs: [MIN_DELAY_MS, MAX_DELAY_MS], currency: 'USD', shipTo: 'US' } });

  try {
    const { chromium } = await import('playwright-core');
    const connection = await connectToRegularChrome(chromium, chromeExecutable(), join(homedir(), '.dashboard2-public-chrome-profile'));
    browser = connection.browser;
    chromeProcess = connection.process;
    const context = browser.contexts()[0];
    if (!context) throw new Error('Chrome không tạo browser context.');
    const page = context.pages()[0] || await context.newPage();
    await writeRunLog(runRef, { level: 'info', stage: 'chrome-connected', message: 'Connected to regular Chrome over CDP.', context: { profilePath: '~/.dashboard2-public-chrome-profile' } });
    await page.goto(forceUsdUrl('https://www.etsy.com/'), { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await waitForHumanVerification(page, runRef);
    await sleep(3_000 + Math.floor(Math.random() * 3_000));
    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      const requestStarted = Date.now();
      const pageUrl = new URL(publicUrl);
      if (pageNumber > 1) pageUrl.searchParams.set('page', String(pageNumber));
      const forcedPageUrl = forceUsdUrl(pageUrl.toString());
      const response = await page.goto(forcedPageUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      if (response?.status() === 429) { warnings.push(`Etsy trả 429 ở trang ${pageNumber}; crawler đã dừng.`); break; }
      if (response && response.status() >= 400) throw new Error(`Etsy public HTTP ${response.status()} ở trang ${pageNumber}.`);
      await waitForHumanVerification(page, runRef);
      await gradualScroll(page);
      const pageData = await page.evaluate((sourcePage: number) => {
        const seen = new Set<string>();
        const listings = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/listing/"]')).flatMap(link => {
          const match = link.href.match(/\/listing\/(\d+)/);
          const listingId = match?.[1];
          if (!listingId || seen.has(listingId)) return [];
          const card = link.closest('li, article, [data-listing-id], .wt-grid__item-xs-6') || link.parentElement;
          const image = card?.querySelector<HTMLImageElement>('img');
          const title = link.title || image?.alt || card?.querySelector('h2,h3')?.textContent?.trim() || link.textContent?.trim() || `Listing ${listingId}`;
          if (title.length < 3) return [];
          seen.add(listingId);
          return [{ listingId, url: link.href.split('?')[0], title: title.replace(/\s+/g, ' ').trim(), price: card?.querySelector('[data-buy-box-region="price"], .currency-value, p.wt-text-title-01')?.textContent?.replace(/\s+/g, ' ').trim() || null, imageUrl: image?.currentSrc || image?.src || null, sourcePage, capturedAt: new Date().toISOString() }];
        });
        const next = document.querySelector<HTMLAnchorElement>('a[aria-label*="next" i], a[rel="next"]');
        const hasNextPage = Boolean(next && next.getAttribute('aria-disabled') !== 'true' && !next.hasAttribute('disabled') && next.href);
        const priceSamples = Array.from(document.querySelectorAll<HTMLElement>('[data-buy-box-region="price"], .currency-value, p.wt-text-title-01')).map(item => item.textContent?.replace(/\s+/g, ' ').trim() || '').filter(Boolean).slice(0, 20);
        const hasNonUsdCurrency = priceSamples.some(price => /₫|\bVND\b|€|£|\bEUR\b|\bGBP\b|\bCAD\b|\bAUD\b/i.test(price));
        return { listings, hasNextPage, priceSamples, currencyIsUsd: !hasNonUsdCurrency };
      }, pageNumber);
      if (!pageData.currencyIsUsd) throw new Error(`Etsy không hiển thị USD ở trang ${pageNumber}. Mẫu giá: ${pageData.priceSamples.slice(0, 3).join(' | ')}`);
      let newCount = 0;
      for (const listing of pageData.listings) {
        if (listingIds.has(listing.listingId)) continue;
        listingIds.add(listing.listingId); newCount += 1;
        await runRef.collection('public_listings').doc(listing.listingId).set(listing, { merge: true });
      }
      await runRef.collection('public_pages').doc(String(pageNumber).padStart(3, '0')).set({ url: forcedPageUrl, currency: 'USD', shipTo: 'US', pageIndex: pageNumber - 1, listingCount: pageData.listings.length, newListingCount: newCount, hasNextPage: pageData.hasNextPage, capturedAt: new Date().toISOString() });
      await runRef.set({ stage: 'collecting-public-visible-chrome', coverage: { shopPages: pageNumber, listings: listingIds.size, reviews: 0 }, updatedAt: new Date().toISOString() }, { merge: true });
      await writeRunLog(runRef, { level: 'info', stage: 'collecting-public-visible-chrome', message: `Collected public page ${pageNumber}.`, request: { method: 'GET', url: forcedPageUrl, status: response?.status() || 200, durationMs: Date.now() - requestStarted }, context: { listingCards: pageData.listings.length, newListings: newCount, totalListings: listingIds.size, hasNextPage: pageData.hasNextPage, priceSamples: pageData.priceSamples.slice(0, 3) } });
      if (newCount === 0 || !pageData.hasNextPage) break;
      if (pageNumber < MAX_PAGES) await sleep(MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS + 1)));
    }
    if (listingIds.size === 0) throw new Error('Không tìm thấy listing public nào trong Chrome.');
    const status = warnings.length > 0 ? 'partial' : 'collected';
    await writeRunLog(runRef, { level: status === 'collected' ? 'info' : 'warn', stage: 'run-complete', message: `Visible Chrome crawl completed with status ${status}.`, context: { listings: listingIds.size, warnings } });
    await runRef.set({ status, stage: 'ready-for-analysis', coverage: { listings: listingIds.size, reviews: 0 }, warnings, completedAt: new Date().toISOString() }, { merge: true });
    return res.status(200).json({ success: true, runId, status, listings: listingIds.size, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Visible Chrome crawler failed.';
    await writeRunLog(runRef, { level: 'error', stage: 'failed', message, error: errorData(error), context: { listingsCollected: listingIds.size, warnings } });
    await runRef.set({ status: 'failed', stage: 'failed', error: message, warnings, completedAt: new Date().toISOString() }, { merge: true });
    await sleep(10_000);
    return res.status(502).json({ message, runId });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
    if (chromeProcess && chromeProcess.exitCode == null) chromeProcess.kill();
  }
}
