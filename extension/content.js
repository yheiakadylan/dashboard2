// Content Script - Runs on Etsy shop pages to extract listing data

(function () {
    'use strict';
    console.log('Etsy Listing Tracker content script loaded v3');

    const shopNameMatch = window.location.pathname.match(/\/shop\/([^\/]+)/);
    const shopName = shopNameMatch ? shopNameMatch[1] : 'Unknown Shop';

    // Wait for content (sometimes dynamic)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(crawlPage, 2000));
    } else {
        setTimeout(crawlPage, 2000);
    }

    function crawlPage() {
        try {
            const listings = extractListings();
            console.log(`[Crawler] Found ${listings.length} listings`);

            // FORCE URL PAGINATION LOGIC (Simplified - Direct URL Construction)
            let nextPageUrl = null;

            // Rule: If current page has listings, assume there's a next page
            if (listings.length > 0) {
                // Extract current page number from URL
                const urlParams = new URLSearchParams(window.location.search);
                const currentPage = parseInt(urlParams.get('page') || '1', 10);
                const nextPageIndex = currentPage + 1;

                // Construct simple URL directly (matching user's pattern)
                const baseUrl = window.location.origin + window.location.pathname;
                nextPageUrl = `${baseUrl}?page=${nextPageIndex}#items`;

                console.log(`[Crawler] Page ${currentPage}: Found ${listings.length} items → Next: ${nextPageUrl}`);
            } else {
                console.log('[Crawler] No listings found. Reached end of shop.');
                nextPageUrl = null;
            }

            console.log(`[Crawler] Sending CRAWL_RESULT: listings=${listings.length}, nextPageUrl=${nextPageUrl}`);

            chrome.runtime.sendMessage({
                type: 'CRAWL_RESULT',
                shopName: shopName,
                listings: listings,
                nextPageUrl: nextPageUrl
            });

        } catch (error) {
            console.error('[Crawler] Error:', error);
            chrome.runtime.sendMessage({
                type: 'CRAWL_ERROR',
                shopName: shopName,
                error: error.message
            });
        }
    }

    function extractListings() {
        const listings = [];
        const cards = document.querySelectorAll('.v2-listing-card');

        cards.forEach(card => {
            try {
                const data = extractCardData(card);
                if (data) listings.push(data);
            } catch (e) { console.error('Error parsing card:', e); }
        });

        return listings;
    }

    function extractCardData(card) {
        const id = card.getAttribute('data-listing-id') || card.getAttribute('data-palette-listing-id');
        if (!id) return null;

        let title = '';
        const titleEl = card.querySelector('.v2-listing-card__title');
        if (titleEl) title = titleEl.textContent.trim();
        else {
            const link = card.querySelector('a.listing-link');
            if (link && link.title) title = link.title;
        }

        let image = '';
        const imgEl = card.querySelector('img.wt-image') || card.querySelector('img');
        if (imgEl) {
            if (imgEl.srcset) {
                const candidates = imgEl.srcset.split(',').map(s => s.trim());
                if (candidates.length > 0) image = candidates[candidates.length - 1].split(' ')[0];
            }
            if (!image) image = imgEl.src;
            image = image.replace(/il_\d+x\d+\./, 'il_fullxfull.');
        }

        let url = '';
        const linkEl = card.querySelector('a.listing-link') || card.querySelector('a[href*="/listing/"]');
        if (linkEl) url = linkEl.href.split('?')[0];
        else url = `https://www.etsy.com/listing/${id}`;

        let price = '';
        const symbol = card.querySelector('.currency-symbol')?.textContent || '';
        const value = card.querySelector('.currency-value')?.textContent || '';
        if (value) price = symbol + value;

        return { listing_id: id, title: title || `Listing ${id}`, image: image, url: url, price: price };
    }

    // ✅ NEW: Listen for messages from background script
    // Forward crawl start notification to window/page so Dashboard can detect it
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'EXTENSION_CRAWL_START') {
            console.log('[Content] Forwarding EXTENSION_CRAWL_START to window');
            window.postMessage({
                type: 'EXTENSION_CRAWL_START',
                totalShops: message.totalShops
            }, '*');
            sendResponse({ received: true });
        }
        return true;
    });

})();
