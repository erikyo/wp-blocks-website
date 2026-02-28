/**
 * WordPress Block Browser
 *
 * A modern web application for browsing and testing WordPress block plugins.
 * Features include:
 * - Search and filter WordPress block plugins
 * - Masonry grid layout with lazy loading
 * - Interactive playground testing via WordPress Playground
 * - Infinite scroll and pagination
 * - Responsive design with performance optimizations
 *
 * @author WordPress Block Browser Team
 * @version 1.0.0
 */

// Import external dependencies
import MiniMasonry from "minimasonry";

// Import internal modules
import "./style.css";
import type { Plugin, PluginBlock, PluginIcons } from "./types.ts";
import { DOMCache } from "./DOMCache.ts";

// ====================================================================
// CONSTANTS AND CONFIGURATION
// ====================================================================

/** API endpoints */
const API_BASE_URL = "https://api.wordpress.org/plugins/info/1.2/?action=query_plugins";
const PLAYGROUND_BASE_URL = "https://playground.wordpress.net/";

/** Pagination and display settings */
const PLUGINS_PER_PAGE = 20;
const MIN_BLOCK_PLUGINS_NEEDED = 3;
const MAX_EMPTY_RESPONSES = 5;

/** Scroll and interaction thresholds */
const SCROLL_THRESHOLD = 200;
const SCROLL_UP_THRESHOLD = 300;
const SEARCH_DEBOUNCE_DELAY = 300;

/** Default assets */
const DEFAULT_ICON = "https://s.w.org/plugins/geopattern-icon/block-default.svg";

// ====================================================================
// DOM ELEMENT CACHING
// ====================================================================

// Initialize cached DOM elements with error handling
const gridContainer = DOMCache.getElement("block-grid");
const loadingText = DOMCache.getElement("loading");
const searchInput = DOMCache.getTypedElement("search-input", HTMLInputElement);
const modal = DOMCache.getElement("playground-modal");
const iframe = DOMCache.getTypedElement("playground-iframe", HTMLIFrameElement);
const closeBtn = DOMCache.getElement("close-modal");

// ====================================================================
// GLOBAL STATE VARIABLES
// ====================================================================

/** MiniMasonry instance for masonry layout */
let masonryInstance: MiniMasonry | null = null;

/** Track last scroll position for scroll direction detection */
let lastScrollTop = 0;

/** Track the maximum page number reached for proper scroll-down behavior */
let maxPageReached = 1;

/** Track last scroll trigger time to prevent rapid triggers */
let lastScrollTriggerTime = 0;

/**
 * Validates that all required DOM elements are present
 * @throws Error if any required element is missing
 */
function validateDOMElements(): void {
    const requiredElements = [
        { element: gridContainer, name: "block-grid" },
        { element: loadingText, name: "loading" },
        { element: searchInput, name: "search-input" },
        { element: modal, name: "playground-modal" },
        { element: iframe, name: "playground-iframe" },
        { element: closeBtn, name: "close-modal" }
    ];

    const missingElements = requiredElements
        .filter(({ element }) => !element)
        .map(({ name }) => name);

    if (missingElements.length > 0) {
        throw new Error(`Missing required DOM elements: ${missingElements.join(", ")}`);
    }
}

// Validate DOM elements on initialization
validateDOMElements();

// ====================================================================
// APPLICATION STATE MANAGEMENT
// ====================================================================

/**
 * Application state management
 *
 * Centralizes global state variables for better maintainability and prevents
 * state-related bugs by providing controlled access to application data.
 * Uses static class pattern to ensure single source of truth for all state.
 */
class AppState {
    private static _currentPage: number = 1;
    private static _isLoading: boolean = false;
    private static _allPlugins: Plugin[] = [];
    private static _searchTerm: string = "";
    private static _hasReachedEnd: boolean = false;
    private static _currentAbortController: AbortController | null = null;
    private static _emptyResponseCount: number = 0;

    static get currentPage(): number { return this._currentPage; }
    static set currentPage(value: number) { this._currentPage = Math.max(1, value); }

    static get isLoading(): boolean { return this._isLoading; }
    static set isLoading(value: boolean) { this._isLoading = value; }

    static get allPlugins(): Plugin[] { return this._allPlugins; }
    static set allPlugins(value: Plugin[]) { this._allPlugins = value; }

    static get searchTerm(): string { return this._searchTerm; }
    static set searchTerm(value: string) { this._searchTerm = InputValidator.sanitizeSearchTerm(value); }

    static get hasReachedEnd(): boolean { return this._hasReachedEnd; }
    static set hasReachedEnd(value: boolean) { this._hasReachedEnd = value; }

    static get currentAbortController(): AbortController | null { return this._currentAbortController; }
    static set currentAbortController(value: AbortController | null) { this._currentAbortController = value; }

    static get emptyResponseCount(): number { return this._emptyResponseCount; }
    static set emptyResponseCount(value: number) { this._emptyResponseCount = Math.max(0, value); }

    /**
     * Resets state for new searches
     */
    static resetForNewSearch(): void {
        this._allPlugins = [];
        this._hasReachedEnd = false;
        this._currentPage = 1;
        this._emptyResponseCount = 0;
    }
}

// ====================================================================
// INPUT VALIDATION AND SECURITY
// ====================================================================
/**
 * Input validation and sanitization utilities
 *
 * Ensures data integrity and security by validating and sanitizing all user inputs.
 * Prevents XSS attacks and malformed data from affecting the application.
 */
class InputValidator {
    /**
     * Sanitizes search term input
     * @param term - Raw search input
     * @returns Sanitized search term
     */
    static sanitizeSearchTerm(term: string): string {
        if (!term || typeof term !== 'string') return '';

        return term
            .trim()
            .replace(/[<>"']/g, '') // Remove potentially dangerous characters
            .slice(0, 100); // Limit length to prevent abuse
    }

    /**
     * Validates page number
     * @param page - Page number to validate
     * @returns Validated page number
     */
    static validatePageNumber(page: string | number): number {
        const pageNum = typeof page === 'string' ? parseInt(page, 10) : page;
        return isNaN(pageNum) || pageNum < 1 ? 1 : pageNum;
    }

    /**
     * Validates URL parameters
     * @param params - URLSearchParams object
     * @returns Validated parameters object
     */
    static validateURLParams(params: URLSearchParams): { search: string; page: number } {
        return {
            search: this.sanitizeSearchTerm(params.get("search") || ""),
            page: this.validatePageNumber(params.get("page") || "1")
        };
    }
}

// ====================================================================
// ERROR HANDLING UTILITIES
// ====================================================================
/**
 * Error handling utilities
 *
 * Provides centralized error management with user-friendly error messages.
 * Handles different types of errors appropriately and ensures graceful degradation.
 */
class ErrorHandler {
    /**
     * Handles API errors with appropriate user feedback
     * @param error - Error object
     * @param context - Context where error occurred
     */
    static handleAPIError(error: unknown, context: string): void {
        console.error(`API Error in ${context}:`, error);

        if (loadingText) {
            if (error instanceof Error && error.name === 'AbortError') {
                // Don't show "Request cancelled" message for intentional cancellations
                // These are normal user actions (typing in search, scrolling, etc.)
                // Only show error message for unexpected aborts
                // For now, we'll silently ignore AbortError as it's expected behavior
                setTimeout(() => {
                    if (loadingText) loadingText.style.display = "none";
                }, 100);
            } else if (error instanceof Error && error.message.includes('Failed to fetch')) {
                loadingText.innerText = "Network error. Please check your connection.";
                setTimeout(() => {
                    if (loadingText) loadingText.style.display = "none";
                }, 3000);
            } else {
                loadingText.innerText = "Error loading plugins. Please try again.";
                setTimeout(() => {
                    if (loadingText) loadingText.style.display = "none";
                }, 3000);
            }
        }

        // Ensure loading state is reset
        AppState.isLoading = false;
    }

    /**
     * Handles unexpected errors gracefully
     * @param error - Error object
     * @param fallback - Fallback action
     */
    static handleUnexpectedError(error: unknown, fallback: () => void): void {
        console.error('Unexpected error:', error);
        try {
            fallback();
        } catch (fallbackError) {
            console.error('Fallback also failed:', fallbackError);
        }
    }
}

// ====================================================================
// URL AND HISTORY MANAGEMENT
// ====================================================================

// Initialize application state with validated parameters
const urlParams = new URLSearchParams(window.location.search);
const validatedParams = InputValidator.validateURLParams(urlParams);

AppState.currentPage = validatedParams.page;
AppState.searchTerm = validatedParams.search;

if (AppState.searchTerm && searchInput) {
    searchInput.value = AppState.searchTerm;
}

// Ensure the initial state is saved in the history object
window.history.replaceState({
    search: AppState.searchTerm,
    page: AppState.currentPage
}, "", window.location.href);

/**
 * Updates browser history and URL parameters
 * @param search - Search term to update
 * @param page - Page number to update
 * @param push - Whether to push new state or replace current
 */
function updateHistory(search: string, page: number, push = false): void {
    const sanitizedSearch = InputValidator.sanitizeSearchTerm(search);
    const validatedPage = InputValidator.validatePageNumber(page);

    const url = new URL(window.location.href);
    if (sanitizedSearch) {
        url.searchParams.set("search", sanitizedSearch);
    } else {
        url.searchParams.delete("search");
    }

    // Always set page parameter to ensure it's properly tracked
    // This fixes the issue where page parameter gets lost during search
    url.searchParams.set("page", validatedPage.toString());

    const state = { search: sanitizedSearch, page: validatedPage };
    if (push) {
        window.history.pushState(state, "", url.toString());
    } else {
        window.history.replaceState(state, "", url.toString());
    }
}

/**
 * Reloads the current state from URL parameters
 *
 * Handles aborting operations and scroll management. Implements intelligent page loading
 * with scroll-based abort functionality to provide responsive user experience.
 *
 * @returns Promise that resolves when state is fully reloaded
 */
async function reloadToCurrentState(): Promise<void> {
    AppState.isLoading = false;
    AppState.emptyResponseCount = 0; // Reset empty response counter for reload

    // Update max page reached to match the target page we're loading
    maxPageReached = Math.max(maxPageReached, AppState.currentPage);

    // Create new abort controller for this reload operation
    AppState.currentAbortController = new AbortController();
    const { signal } = AppState.currentAbortController;

    // Function to abort on user scroll
    const abortOnScroll = () => {
        if (AppState.currentAbortController) {
            AppState.currentAbortController.abort();
            console.log('Reload operation aborted due to user scroll');
        }
    };

    // Use wheel and touchmove to detect actual user interaction, ignoring programmatic scrolls
    window.addEventListener('wheel', abortOnScroll, { once: true });
    window.addEventListener('touchmove', abortOnScroll, { once: true });

    try {
        const targetPage = AppState.currentPage;
        let fetchedUpTo = 1;

        for (let p = 1; p <= targetPage; p++) {
            // Check if request was aborted before starting new fetch
            if (signal.aborted) {
                console.log('Reload operation was aborted');
                return;
            }

            const previousChildCount = gridContainer?.children.length || 0;

            await fetchBlocks(p, AppState.searchTerm, p > 1, signal);

            // fetchBlocks(1) with append=false resets AppState.currentPage to 1
            // We update it to reflect the pages we've successfully loaded so far
            fetchedUpTo = p;
            AppState.currentPage = fetchedUpTo;

            // Check if request was aborted after fetch
            if (signal.aborted) {
                console.log('Reload operation was aborted during fetch');
                return;
            }

            // Mark the first block of the current initialized page to scroll into view
            if (p > 1 && gridContainer && gridContainer.children.length > previousChildCount) {
                const elementToScrollTo = gridContainer.children[previousChildCount] as HTMLElement;
                if (elementToScrollTo) {
                    // Wait for masonry layout to be calculated before scrolling
                    await new Promise(resolve => setTimeout(resolve, 150));

                    // Force masonry layout recalculation to ensure proper positioning
                    if (masonryInstance) {
                        masonryInstance.layout();
                    }

                    // Additional delay to ensure DOM is fully updated
                    await new Promise(resolve => setTimeout(resolve, 100));

                    // Scroll to the bottom of the page instead of specific element
                    // This works better with masonry layout
                    window.scrollTo({
                        top: document.documentElement.scrollHeight,
                        behavior: "smooth"
                    });
                }
            }

            if (AppState.hasReachedEnd) break;
        }

        // Ensure the final state reflects what we aimed to load
        AppState.currentPage = Math.max(fetchedUpTo, AppState.currentPage);
    } catch (error) {
        ErrorHandler.handleAPIError(error, 'reloadToCurrentState');
    } finally {
        // Clean up: remove scroll listener and reset abort controller
        window.removeEventListener('wheel', abortOnScroll);
        window.removeEventListener('touchmove', abortOnScroll);
        AppState.currentAbortController = null;
    }
}

// ====================================================================
// API AND DATA FETCHING
// ====================================================================
/**
 * Constructs the WordPress.org API URL for fetching plugins
 * @param page - The page number to fetch (default: 1)
 * @param search - The search term to filter plugins (default: "")
 * @returns The complete API URL with query parameters
 */
function buildApiUrl(page = 1, search = ""): string {
    const params = new URLSearchParams();

    if (search) {
        // When searching, don't filter by blocks to get all matching plugins
        params.append("request[block]", search);
    } else {
        // Only filter by blocks when not searching
        params.append("request[block]", "block");
        params.append("request[browse]", "popular");
    }

    params.append("request[per_page]", PLUGINS_PER_PAGE.toString());
    params.append("request[page]", page.toString());

    return `${API_BASE_URL}&${params.toString()}`;
}

// Fetch the blocks from WordPress.org
/**
 * Fetches WordPress plugins from the API with optional search and pagination
 *
 * Handles complex pagination logic including auto-fetching when plugins don't contain blocks,
 * and manages loading states and error scenarios. Implements intelligent fetching strategies
 * to ensure users always see block plugins even when API returns non-block plugins.
 *
 * @param page - The page number to fetch (default: 1)
 * @param search - The search term to filter plugins (default: "")
 * @param append - Whether to append to existing results or replace them (default: false)
 * @param abortSignal - AbortSignal to cancel the request (optional)
 * @returns Promise that resolves when fetching is complete
 */
async function fetchBlocks(page = 1, search = "", append = false, abortSignal?: AbortSignal): Promise<void> {
    // Prevent duplicate requests and unnecessary API calls
    if (AppState.isLoading || (append && AppState.hasReachedEnd)) return;

    AppState.isLoading = true;

    // Reset state for fresh searches
    if (!append) {
        AppState.resetForNewSearch();
        maxPageReached = page; // Reset maxPageReached to current page for fresh searches
        if (loadingText) loadingText.style.display = "block";
        if (gridContainer) gridContainer.innerHTML = "";
    } else if (loadingText && loadingText.style.display === "none") {
        // For recursive calls, ensure loading text is visible if it was hidden
        loadingText.style.display = "block";
    }

    try {
        const url = buildApiUrl(page, search);
        const response = await fetch(url, { signal: abortSignal });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        const newPlugins = data.plugins || [];

        // Update pagination state
        // Only mark as reached end if we get fewer plugins than expected AND we're not on the first page
        // This handles cases where API might return empty results temporarily
        if (newPlugins.length < PLUGINS_PER_PAGE && page > 1) {
            AppState.hasReachedEnd = true;
        }

        // Update master plugin list
        AppState.allPlugins = [...AppState.allPlugins, ...newPlugins];

        // Filter plugins that contain blocks
        const pluginsWithBlocks = newPlugins.filter(plugin =>
            plugin.blocks && Object.keys(plugin.blocks).length > 0
        );

        // Render only the new plugins with blocks to avoid duplicates
        renderBlocks(pluginsWithBlocks, append);

        // Don't hide loading text yet - we might continue fetching
        updateLoadMoreIndicator(!AppState.hasReachedEnd);

        // Auto-fetch more data if no plugins with blocks were found in this batch
        // or if it is the initial load and we don't have enough block plugins yet
        const currentBlockPlugins = AppState.allPlugins.filter(plugin =>
            plugin.blocks && Object.keys(plugin.blocks).length > 0
        ).length;

        const needsMoreInitialPlugins = !append && !search && currentBlockPlugins < MIN_BLOCK_PLUGINS_NEEDED;
        const noBlocksInBatch = pluginsWithBlocks.length === 0; // This is the key condition - plugins exist but none have blocks
        const hasPlugins = newPlugins.length > 0;

        // Update counter for responses with plugins but no blocks
        if (hasPlugins && noBlocksInBatch) {
            AppState.emptyResponseCount++;
            console.log(`Response with plugins but no blocks #${AppState.emptyResponseCount} for page ${page} (${newPlugins.length} plugins)`);
        } else if (noBlocksInBatch && !hasPlugins) {
            // True empty response
            AppState.emptyResponseCount++;
            console.log(`Truly empty response #${AppState.emptyResponseCount} for page ${page}`);
        } else {
            AppState.emptyResponseCount = 0; // Reset counter when we get plugins with blocks
        }

        // Continue fetching if we got plugins but no blocks, or need more initial plugins
        // but haven't reached end and haven't exceeded max empty responses
        const shouldContinueFetching = (noBlocksInBatch) &&
                                     !AppState.hasReachedEnd &&
                                     AppState.emptyResponseCount < MAX_EMPTY_RESPONSES;

        // Also continue if we need more initial plugins
        const shouldContinueForInitialLoad = needsMoreInitialPlugins && !AppState.hasReachedEnd;

        if (shouldContinueFetching || shouldContinueForInitialLoad) {
            console.log(`Auto-fetching page ${page + 1} - no blocks: ${noBlocksInBatch}, has plugins: ${hasPlugins}, needs initial: ${needsMoreInitialPlugins}, empty count: ${AppState.emptyResponseCount}`);

            AppState.currentPage = page + 1;
            updateHistory(AppState.searchTerm, AppState.currentPage, false);

            // Update maxPageReached for auto-fetched pages
            if (AppState.currentPage > maxPageReached) {
                maxPageReached = AppState.currentPage;
            }

            try {
                AppState.isLoading = false; // Allow recursive call
                await fetchBlocks(AppState.currentPage, search, true, abortSignal);
            } catch (error) {
                // Ensure loading state is reset if recursive call fails
                AppState.isLoading = false;
                throw error;
            }
            return;
        } else if (AppState.emptyResponseCount >= MAX_EMPTY_RESPONSES) {
            console.log(`Reached maximum responses with no blocks (${MAX_EMPTY_RESPONSES}), stopping auto-fetch`);
            AppState.hasReachedEnd = true;
        }

        // Only hide loading text when we're actually done fetching
        if (loadingText) loadingText.style.display = "none";
    } catch (error) {
        ErrorHandler.handleAPIError(error, 'fetchBlocks');
    } finally {
        AppState.isLoading = false;
    }
}

// ====================================================================
// UI RENDERING AND DISPLAY UTILITIES
// ====================================================================

/**
 * Formats the plugin rating into star display
 * @param rating - The plugin rating (0-100)
 * @returns Formatted star string
 */
function formatRatingStars(rating: number): string {
    return Array.from({ length: 5 }, (_, i) =>
        i < Math.round(rating / 20) ? "★" : "☆"
    ).join("");
}

/**
 * Formats the active installs count into human-readable format
 * @param activeInstalls - Number of active installations
 * @returns Formatted installs string
 */
function formatActiveInstalls(activeInstalls: number): string {
    if (activeInstalls >= 1000000) {
        return `${(activeInstalls / 1000000).toFixed(1)}M+`;
    } else if (activeInstalls >= 1000) {
        return `${(activeInstalls / 1000).toFixed(1)}K+`;
    }
    return `${activeInstalls}+`;
}

/**
 * Extracts clean author name from HTML string
 * @param authorHtml - HTML string containing author name
 * @returns Clean author name
 */
function extractAuthorName(authorHtml: string): string {
    return authorHtml.replace(/<[^>]*>/g, "").trim();
}

/**
 * Gets the best available icon URL for a plugin
 * @param icons - Plugin icons object
 * @returns Best available icon URL
 */
function getPluginIcon(icons: PluginIcons): string {
    return icons["1x"] || icons["default"] || DEFAULT_ICON;
}

/**
 * Generates HTML for blocks list
 * @param blocks - Plugin blocks object
 * @returns HTML string for blocks list
 */
function generateBlocksList(blocks: Record<string, PluginBlock>): string {
    const blocksArray = Object.values(blocks);
    const displayBlocks = blocksArray.slice(0, 8);
    const remainingCount = blocksArray.length - 8;

    let html = displayBlocks.map(block =>
        `<div class="block-item">
            <span class="block-name">${block.title}</span>
            <span class="block-category">${block.category}</span>
        </div>`
    ).join('');

    // Add "and other X blocks" tag if there are more than 8 blocks
    if (remainingCount > 0) {
        html += `<div class="block-item more-blocks-tag">
            <span class="block-name">and other ${remainingCount} blocks</span>
            <span class="block-category">more</span>
        </div>`;
    }

    return html;
}

// ====================================================================
// MASONRY LAYOUT MANAGEMENT
// ====================================================================
/**
 * Initializes MiniMasonry layout
 */
function initializeMasonry(): void {
    if (!gridContainer) return;

    masonryInstance = new MiniMasonry({
        container: gridContainer,
        baseWidth: 360,
        gutterX: 24,
        gutterY: 24,
        surroundingGutter: true,
        wedge: false,
        minify: true
    });
}

/**
 * Renders plugin cards into the grid container
 *
 * Handles both fresh renders and append operations for infinite scroll.
 * Manages masonry layout initialization and updates for optimal visual presentation.
 *
 * @param pluginsToRender - Array of plugins to render
 * @param append - Whether to append to existing content or replace it (default: false)
 */
function renderBlocks(pluginsToRender: Plugin[], append = false): void {
    if (!gridContainer) {
        console.error('Grid container not found');
        return;
    }

    // Handle empty results for fresh searches
    if (pluginsToRender.length === 0 && !append) {
        if (AppState.hasReachedEnd) {
            gridContainer.innerHTML =
                "<div class='no-results'>No plugins found matching your search.</div>";
        } else {
            gridContainer.innerHTML = "";
        }
        if (masonryInstance) {
            masonryInstance.destroy();
            masonryInstance = null;
        }
        return;
    }

    // Clear grid for fresh searches
    if (!append) {
        gridContainer.innerHTML = "";
        if (masonryInstance) {
            masonryInstance.destroy();
            masonryInstance = null;
        }
    }

    // Create document fragment for better performance
    const fragment = document.createDocumentFragment();

    pluginsToRender.forEach((plugin: Plugin) => {
        const card = createPluginCard(plugin);
        fragment.appendChild(card);
    });

    gridContainer.appendChild(fragment);

    // Initialize or update masonry layout
    if (!masonryInstance) {
        initializeMasonry();
    } else {
        // Force layout recalculation after adding new items
        setTimeout(() => {
            if (masonryInstance) {
                masonryInstance.layout();
            }
        }, 100);
    }
}

// ====================================================================
// PERFORMANCE OPTIMIZATION UTILITIES
// ====================================================================
/**
 * Performance utilities for optimizing application behavior
 *
 * Provides performance optimization tools including lazy loading, debouncing,
 * and throttling to ensure smooth user experience and efficient resource usage.
 */
class PerformanceUtils {
    /**
     * Implements lazy loading for images using Intersection Observer
     * @param image - Image element to lazy load
     * @param src - Image source URL
     */
    static lazyLoadImage(image: HTMLImageElement, src: string): void {
        if (!('IntersectionObserver' in window)) {
            // Fallback for browsers that don't support Intersection Observer
            image.src = src;
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target as HTMLImageElement;
                    img.src = src;
                    img.classList.remove('lazy-loading');
                    img.classList.add('lazy-loaded');
                    observer.unobserve(img);
                }
            });
        }, {
            rootMargin: '50px' // Start loading 50px before image comes into view
        });

        image.classList.add('lazy-loading');
        observer.observe(image);
    }

    /**
     * Debounces function calls to improve performance
     * @param func - Function to debounce
     * @param wait - Wait time in milliseconds
     * @returns Debounced function
     */
    static debounce<T extends (...args: any[]) => any>(func: T, wait: number): (...args: Parameters<T>) => void {
        let timeout: number;
        return (...args: Parameters<T>) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func(...args), wait);
        };
    }

    /**
     * Throttles function calls to improve performance
     * @param func - Function to throttle
     * @param limit - Time limit in milliseconds
     * @returns Throttled function
     */
    static throttle<T extends (...args: any[]) => any>(func: T, limit: number): (...args: Parameters<T>) => void {
        let inThrottle: boolean;
        return (...args: Parameters<T>) => {
            if (!inThrottle) {
                func(...args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        };
    }
}
// ====================================================================
// PLUGIN CARD CREATION
// ====================================================================
/**
 * Creates a plugin card element with lazy loading for images
 * @param plugin - Plugin data
 * @returns Plugin card DOM element
 */
function createPluginCard(plugin: Plugin): HTMLElement {
    const card = document.createElement("div");
    card.className = "block-card";

    // Extract and format plugin data
    const iconUrl = getPluginIcon(plugin.icons);
    const rating = plugin.rating || 0;
    const stars = formatRatingStars(rating);
    const installsText = formatActiveInstalls(plugin.active_installs || 0);
    const authorName = extractAuthorName(plugin.author);
    const pluginPageUrl = `https://wordpress.org/plugins/${plugin.slug}/`;
    const blocksList = generateBlocksList(plugin.blocks);

    // Generate card HTML with placeholder for lazy-loaded image
    card.innerHTML = `
        <div class="card-header">
            <div class="block-icon-container">
                <div class="icon-placeholder">Loading...</div>
                <img class="block-icon lazy-loading" alt="${plugin.name} icon" data-src="${iconUrl}">
            </div>
            <div class="plugin-info">
                <h3 class="plugin-name">${plugin.name}</h3>
                <p class="plugin-author">by ${authorName}</p>
            </div>
        </div>
        <div class="card-body">
            <p class="plugin-description">${plugin.short_description || "No description available"}</p>
            <div class="blocks-section">
                <h4 class="blocks-title">Blocks Provided</h4>
                <div class="blocks-list">
                    ${blocksList}
                </div>
            </div>
            <div class="plugin-stats">
                <div class="rating">
                    <span class="stars">${stars}</span>
                    <span class="rating-number">${rating}%</span>
                </div>
                <div class="installs">
                    <span class="install-count">${installsText}</span>
                    <span class="install-label">active installs</span>
                </div>
            </div>
            <div class="plugin-meta">
                <span class="version">v${plugin.version}</span>
                <span class="tested">Tested up to ${plugin.tested}</span>
            </div>
            <div class="plugin-links">
                <a href="${pluginPageUrl}" target="_blank" rel="noopener noreferrer" class="plugin-link plugin-page-link" onclick="event.stopPropagation()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15,3 21,3 21,9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    WordPress Page
                </a>
                <a href="${plugin.download_link}" target="_blank" rel="noopener noreferrer" class="plugin-link download-link" onclick="event.stopPropagation()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                        <polyline points="7,10 12,15 17,10"></polyline>
                        <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                    Download
                </a>
            </div>
        </div>
    `;

    // Setup lazy loading for the plugin icon
    const iconImg = card.querySelector('.block-icon') as HTMLImageElement;
    const placeholder = card.querySelector('.icon-placeholder') as HTMLElement;

    if (iconImg) {
        PerformanceUtils.lazyLoadImage(iconImg, iconUrl);

        // Hide placeholder when image loads
        iconImg.addEventListener('load', () => {
            if (placeholder) placeholder.style.display = 'none';
            // Trigger masonry layout recalculation when image loads
            if (masonryInstance) {
                setTimeout(() => {
                    masonryInstance.layout();
                }, 50);
            }
        });

        // Handle image load errors
        iconImg.addEventListener('error', () => {
            if (placeholder) {
                placeholder.textContent = '⚠️';
                placeholder.style.display = 'flex';
            }
        });
    }

    // Add click event to launch the playground
    card.addEventListener("click", () => openPlayground(plugin.slug));

    return card;
}

// ====================================================================
// WORDPRESS PLAYGROUND INTEGRATION
// ====================================================================

// Blueprint interface for WordPress Playground
interface PlaygroundBlueprint {
    landingPage: string;
    preferredVersions: {
        php: string;
        wp: string;
    };
    login: boolean;
    features: {
        networking: boolean;
    };
    steps: Array<{
        step: string;
        pluginData?: {
            resource: string;
            slug: string;
        };
    }>;
}

/**
 * Creates a standard WordPress Playground blueprint
 * @param pluginSlug - The plugin slug to install
 * @returns Standard playground blueprint
 */
function createStandardBlueprint(pluginSlug: string): PlaygroundBlueprint {
    return {
        landingPage: "/wp-admin/post-new.php",
        preferredVersions: {
            php: "8.3",
            wp: "latest",
        },
        login: true,
        features: {
            networking: true,
        },
        steps: [
            {
                step: "installPlugin",
                pluginData: {
                    resource: "wordpress.org/plugins",
                    slug: pluginSlug,
                },
            },
        ],
    };
}

/**
 * Encodes a blueprint to Base64 for URL usage
 * @param blueprint - The blueprint object to encode
 * @returns Base64 encoded blueprint string
 */
function encodeBlueprint(blueprint: PlaygroundBlueprint): string {
    const blueprintJsonString = JSON.stringify(blueprint);
    return btoa(blueprintJsonString);
}

/**
 * Sets up the playground iframe with the encoded blueprint
 * @param encodedBlueprint - Base64 encoded blueprint
 */
function setupPlaygroundIframe(encodedBlueprint: string): void {
    iframe.src = `${PLAYGROUND_BASE_URL}#${encodedBlueprint}`;
}

// Generate Blueprint JSON and launch the iframe
/**
 * Opens the WordPress Playground for a specific plugin
 * @param pluginSlug - The WordPress plugin slug
 */
async function openPlayground(pluginSlug: string): Promise<void> {
    modal.style.display = "block";

    try {
        // Try to fetch custom blueprint from WordPress plugin directory
        const blueprintUrl = `https://wordpress.org/plugins/wp-json/plugins/v1/plugin/${pluginSlug}/blueprint.json`;
        const response = await fetch(blueprintUrl);

        let blueprint: PlaygroundBlueprint;

        if (response.ok) {
            // Use custom blueprint if available
            blueprint = await response.json();
            console.log(`Using custom blueprint for ${pluginSlug}`);
        } else {
            // Use standard blueprint if custom one is not available
            blueprint = createStandardBlueprint(pluginSlug);
            console.log(`Using standard blueprint for ${pluginSlug}`);
        }

        const encodedBlueprint = encodeBlueprint(blueprint);
        setupPlaygroundIframe(encodedBlueprint);

    } catch (error) {
        console.error(`Error fetching blueprint for ${pluginSlug}:`, error);

        // Fallback to standard blueprint on error
        const fallbackBlueprint = createStandardBlueprint(pluginSlug);
        const encodedBlueprint = encodeBlueprint(fallbackBlueprint);
        setupPlaygroundIframe(encodedBlueprint);
    }
}

// ====================================================================
// USER INTERFACE CONTROLS
// ====================================================================
/**
 * Updates the load more indicator visibility and message
 * @param hasMore - Whether there are more plugins to load
 */
function updateLoadMoreIndicator(hasMore: boolean): void {
    let indicator = document.getElementById("load-more-indicator");

    if (!indicator) {
        indicator = document.createElement("div");
        indicator.id = "load-more-indicator";
        indicator.className = "load-more-indicator";
        indicator.innerHTML =
            "<div class='spinner'></div><p>Loading more blocks...</p>";
        gridContainer.parentNode.insertBefore(indicator, gridContainer.nextSibling);
    }

    if (hasMore) {
        indicator.innerHTML = "<div class='spinner'></div><p>Loading more...</p>";
        indicator.style.display = "block";
    } else {
        indicator.innerHTML = "<p>You've reached the end of the list.</p>";
        indicator.style.display = "block";
    }
}

// ====================================================================
// EVENT HANDLERS AND INTERACTIONS
// ====================================================================
/**
 * Handles infinite scroll functionality to load more plugins
 * Uses throttling to improve performance
 */
const handleScroll = PerformanceUtils.throttle(() => {
    if (AppState.isLoading || AppState.hasReachedEnd) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;
    const scrollDirection = scrollTop > lastScrollTop ? 'down' : 'up';
    const currentTime = Date.now();

    // Update last scroll position
    lastScrollTop = scrollTop;

    // Load more when user is within threshold distance of the bottom (scrolling down)
    if (scrollDirection === 'down' && scrollTop + windowHeight >= documentHeight - SCROLL_THRESHOLD) {
        // Add additional debounce to prevent rapid triggers
        if (currentTime - lastScrollTriggerTime < 500) {
            return; // Skip if triggered too recently
        }

        // Only load if we haven't already loaded this page
        // Check if current page is less than or equal to max page reached
        if (AppState.currentPage <= maxPageReached) {
            AppState.currentPage = maxPageReached + 1;
            maxPageReached = AppState.currentPage; // Update max page reached
            lastScrollTriggerTime = currentTime; // Update trigger time
            updateHistory(AppState.searchTerm, AppState.currentPage, false);

            console.log(`Loading page ${AppState.currentPage} for infinite scroll`);
            AppState.currentAbortController = new AbortController();
            fetchBlocks(AppState.currentPage, AppState.searchTerm, true, AppState.currentAbortController.signal);
        }
    }
    // Decrease page when user scrolls up significantly and is not at the top
    else if (scrollDirection === 'up' && scrollTop > SCROLL_UP_THRESHOLD && AppState.currentPage > 1) {
        // Calculate approximate page based on scroll position
        const scrollPercentage = scrollTop / documentHeight;
        const approximatePage = Math.max(1, Math.ceil(scrollPercentage * maxPageReached));

        if (approximatePage < AppState.currentPage) {
            AppState.currentPage = approximatePage;
            updateHistory(AppState.searchTerm, AppState.currentPage, false);
        }
    }
}, 100); // Throttle to once every 100ms

/**
 * Handles search input with debouncing using PerformanceUtils
 * @param event - The input event from the search field
 */
const handleSearch = PerformanceUtils.debounce((event: Event) => {
    const target = event.target as HTMLInputElement;
    const value = target.value;
    AppState.searchTerm = value;

    // Cancel any ongoing request when starting a new search
    if (AppState.currentAbortController) {
        AppState.currentAbortController.abort();
    }

    // Reset page to 1 for new search and update history immediately
    AppState.currentPage = 1;
    maxPageReached = 1; // Reset max page reached for new search
    updateHistory(AppState.searchTerm, AppState.currentPage, true);

    // Fetch blocks with explicit page 1 to ensure consistency
    fetchBlocks(1, AppState.searchTerm, false);
}, SEARCH_DEBOUNCE_DELAY);

/**
 * Closes the playground modal and resets the iframe
 */
function closeModal(): void {
    if (modal) modal.style.display = "none";
    if (iframe) iframe.src = ""; // Reset iframe to free up memory
}

/**
 * Handles window resize events to recalculate masonry layout
 */
const handleResize = PerformanceUtils.debounce(() => {
    if (masonryInstance) {
        masonryInstance.layout();
    }
}, 250);

// ====================================================================
// APPLICATION INITIALIZATION
// ====================================================================
/**
 * Sets up event listeners with proper error handling
 */
function setupEventListeners(): void {
    if (closeBtn) {
        closeBtn.addEventListener("click", closeModal);
    }

    window.addEventListener("scroll", handleScroll);
    window.addEventListener("resize", handleResize);

    if (searchInput) {
        searchInput.addEventListener("input", handleSearch);
    }

    window.addEventListener("popstate", (event) => {
        const state = event.state;
        if (state) {
            AppState.searchTerm = state.search || "";
            AppState.currentPage = state.page || 1;
        } else {
            const params = new URLSearchParams(window.location.search);
            const validatedParams = InputValidator.validateURLParams(params);
            AppState.searchTerm = validatedParams.search;
            AppState.currentPage = validatedParams.page;
        }

        if (searchInput) {
            searchInput.value = AppState.searchTerm;
        }

        reloadToCurrentState().catch(error => {
            ErrorHandler.handleUnexpectedError(error, () => {
                console.error('Failed to reload state on popstate');
            });
        });
    });
}

/**
 * Initializes the application with proper error handling
 */
function initializeApp(): void {
    try {
        // Initialize scroll position tracking
        lastScrollTop = window.pageYOffset || document.documentElement.scrollTop;

        // Initialize max page reached with current page from URL
        maxPageReached = AppState.currentPage;

        setupEventListeners();
        reloadToCurrentState().catch(error => {
            ErrorHandler.handleUnexpectedError(error, () => {
                console.error('Failed to initialize app state');
                if (loadingText) {
                    loadingText.innerText = "Failed to initialize. Please refresh the page.";
                }
            });
        });
    } catch (error) {
        ErrorHandler.handleUnexpectedError(error, () => {
            console.error('Critical initialization error');
            if (loadingText) {
                loadingText.innerText = "Application failed to load. Please refresh the page.";
            }
        });
    }
}

// Initialize the application
initializeApp();
