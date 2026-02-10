/**
 * Extension Crawler Service
 * Communicates with Chrome Extension to crawl Etsy listings
 */

import type { Account } from '../types';

const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || 'maicjcpkmnmnapaegmfopicgkmfhopgb';

declare const chrome: any;

export interface ScrapedListing {
    listing_id: string;
    title: string;
    image: string;
    url: string;
}

/**
 * Check if extension is installed and available
 */
export async function isExtensionInstalled(): Promise<boolean> {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        return false;
    }

    try {
        // Try to ping the extension
        const response = await chrome.runtime.sendMessage(EXTENSION_ID, { type: 'PING' });
        return response && response.status === 'ok';
    } catch (error) {
        console.warn('Extension not found:', error);
        return false;
    }
}

/**
 * Crawl a single Etsy shop using extension
 */
export const crawlShopViaExtension = async (shopName: string, startPage: number = 1): Promise<any[]> => {
    // Check if extension is installed
    const isInstalled = await isExtensionInstalled();
    if (!isInstalled) {
        throw new Error('Extension not installed or not connecting');
    }

    return new Promise((resolve, reject) => {
        // Send message to extension
        // Using "cpc..." ID from env or hardcoded if needed, but here we likely rely on
        // window.chrome.runtime.sendMessage if valid, OR we use the specific ID.
        // The previous code used EXTENSION_ID constant.

        const chromeApi = (window as any).chrome;
        if (!chromeApi || !chromeApi.runtime) {
            reject(new Error('Chrome runtime not available'));
            return;
        }

        console.log(`Sending crawl request for ${shopName} starting at page ${startPage} to ${EXTENSION_ID}`);

        chromeApi.runtime.sendMessage(
            EXTENSION_ID,
            { type: 'CRAWL_REQUEST', shopName: shopName, startPage: startPage },
            (response: any) => {
                if (chromeApi.runtime.lastError) {
                    console.error('Runtime error:', chromeApi.runtime.lastError);
                    reject(new Error(chromeApi.runtime.lastError.message));
                    return;
                }

                if (response && response.success) {
                    resolve(response.listings);
                } else {
                    reject(new Error(response?.error || 'Unknown error from extension'));
                }
            }
        );
    });
};

/**
 * Sync configuration to extension
 */
export async function syncConfigToExtension(config: any): Promise<boolean> {
    const isInstalled = await isExtensionInstalled();
    if (!isInstalled) return false;

    const chromeApi = (window as any).chrome;
    return new Promise((resolve) => {
        chromeApi.runtime.sendMessage(
            EXTENSION_ID,
            {
                type: 'SET_CONFIG',
                config: {
                    ...config,
                    appUrl: window.location.origin
                }
            },
            (response: any) => {
                resolve(response && response.success);
            }
        );
    });
}

/**
 * Send stop signal to extension
 */
export async function stopExtensionCrawl(): Promise<boolean> {
    const isInstalled = await isExtensionInstalled();
    if (!isInstalled) return false;

    const chromeApi = (window as any).chrome;
    return new Promise((resolve) => {
        chromeApi.runtime.sendMessage(
            EXTENSION_ID,
            { type: 'STOP_CRAWL' },
            (response: any) => {
                resolve(response && response.success);
            }
        );
    });
}


/**
 * Crawl all enabled Etsy accounts
 */
export async function crawlAllShopsViaExtension(
    accounts: Account[],
    onProgress?: (current: number, total: number, status: string) => void
): Promise<void> {
    const etsyAccounts = accounts.filter(
        acc => acc.platforms.includes('etsy') && acc.listing_tracking_enabled
    );

    if (etsyAccounts.length === 0) {
        throw new Error('No Etsy accounts with tracking enabled');
    }

    onProgress?.(0, etsyAccounts.length, 'Starting extension crawl...');

    for (let i = 0; i < etsyAccounts.length; i++) {
        const account = etsyAccounts[i];
        onProgress?.(i + 1, etsyAccounts.length, `Crawling ${account.label}...`);

        try {
            const listings = await crawlShopViaExtension(account.label);
            onProgress?.(i + 1, etsyAccounts.length, `Found ${listings.length} listings for ${account.label}`);

            // Note: Firestore update logic should be in the component
            // This service just returns the scraped data

            // Small delay between shops to avoid overwhelming the extension
            if (i < etsyAccounts.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        } catch (error: any) {
            console.error(`Failed to crawl ${account.label}:`, error);
            onProgress?.(i + 1, etsyAccounts.length, `Error: ${error.message}`);
            // Continue with next shop
        }
    }

    onProgress?.(etsyAccounts.length, etsyAccounts.length, 'Crawl complete!');
}

/**
 * Get extension installation instructions
 */
export function getInstallInstructions(): string {
    const baseUrl = window.location.origin;
    return `
To use the extension crawler:

1. **Download the extension**: [Click here to download](${baseUrl}/extension.zip)
2. **Unzip the file**: Extract the downloaded zip file to a folder.
3. Open chrome://extensions/
4. Enable "Developer mode" (top right toggle)
5. Click "Load unpacked"
6. Select the extracted 'extension' folder
7. Refresh this page

The extension will automatically connect with ID: ${EXTENSION_ID}
    `.trim();
}

/**
 * Trigger extension to run crawl immediately (Run Now)
 */
export async function triggerExtensionCrawl(): Promise<void> {
    if (typeof chrome === 'undefined' || !chrome.runtime) {
        throw new Error('Chrome Runtime not available');
    }

    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(EXTENSION_ID, { type: 'TRIGGER_CRAWL_NOW' }, (response: any) => {
            if (chrome.runtime.lastError) {
                console.error('Extension Trigger Error:', chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else if (response && response.success) {
                resolve();
            } else {
                reject(new Error(response?.message || 'Unknown error'));
            }
        });
    });
}
