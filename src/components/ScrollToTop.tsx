import React, { useState, useEffect } from 'react';

const ScrollToTop = () => {
    const [isVisible, setIsVisible] = useState(false);
    // Stores the last element that was scrolled past the threshold.
    // This will be the target for scrolling back to top.
    const [activeScrollTarget, setActiveScrollTarget] = useState<Element | Window | null>(null);

    // Global scroll listener (capturing phase) to detect ANY scrollable area
    useEffect(() => {
        const handleScroll = (e: Event) => {
            let currentScrollTop = 0;
            let currentTarget: Element | Window = window;

            // Determine the actual scroll target and its scrollTop
            if (e.target === document) {
                // This is a scroll event on the document (usually means window scroll)
                currentScrollTop = window.scrollY;
                currentTarget = window;
            } else if (e.target instanceof Element) {
                // This is a scroll event on a specific element (e.g., a div with overflow: auto)
                const targetElement = e.target as Element;
                // Check if the element itself is scrollable (has a scrollbar)
                // We can approximate this by checking if scrollHeight > clientHeight
                if (targetElement.scrollHeight > targetElement.clientHeight) {
                    currentScrollTop = targetElement.scrollTop;
                    currentTarget = targetElement;
                } else {
                    // If the target element isn't scrollable, it might be a child of a scrollable element.
                    // For simplicity, we'll ignore non-scrollable elements as direct targets for now.
                    // The window scroll will still be caught by the `e.target === document` case.
                    return;
                }
            } else {
                // Fallback for other event targets, assume window
                currentScrollTop = window.scrollY;
                currentTarget = window;
            }

            if (currentScrollTop > 300) {
                setIsVisible(true);
                setActiveScrollTarget(currentTarget);
            } else {
                // Only hide the button if the currently active target has scrolled back up.
                // This prevents the button from disappearing if another element is scrolled up,
                // but the main active target is still scrolled down.
                if (currentTarget === activeScrollTarget) {
                    setIsVisible(false);
                    // If the active target scrolled back up, clear it.
                    // We might need to re-evaluate if another element is still scrolled.
                    // For simplicity, we'll let the next scroll event set a new active target.
                    setActiveScrollTarget(null);
                }
            }
        };

        // Use capture: true to catch scroll events from children (divs, tables)
        // This ensures we detect scrolls on elements with `overflow: auto`
        window.addEventListener('scroll', handleScroll, { capture: true });

        return () => {
            window.removeEventListener('scroll', handleScroll, { capture: true });
        };
    }, [activeScrollTarget]); // Re-run effect if activeScrollTarget changes to update closure

    // Scroll to top smoothly
    const scrollToTop = () => {
        if (activeScrollTarget) {
            if (activeScrollTarget === window) {
                window.scrollTo({
                    top: 0,
                    behavior: 'smooth',
                });
            } else {
                (activeScrollTarget as Element).scrollTo({
                    top: 0,
                    behavior: 'smooth',
                });
            }
        } else {
            // Fallback to window scroll if no specific active target was identified
            window.scrollTo({
                top: 0,
                behavior: 'smooth',
            });
        }
    };

    return (
        <div
            className={`fixed bottom-24 md:bottom-8 right-8 z-50 transition-all duration-300 transform ${isVisible ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'
                }`}
        >
            <button
                type="button"
                onClick={scrollToTop}
                className="p-3 rounded-full bg-blue-600 dark:bg-blue-500 text-white shadow-lg hover:bg-blue-700 dark:hover:bg-blue-400 transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group"
                aria-label="Scroll to top"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 group-hover:animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
            </button>
        </div>
    );
};

export default ScrollToTop;
