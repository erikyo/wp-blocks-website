import "./style.css";
import type {Plugin, PluginBlock, PluginIcons} from "./types.ts";
import {DOMCache} from "./DOMCache.ts";

// Initialize cached DOM elements with error handling
const gridContainer = DOMCache.getElement("block-grid");
const loadingText = DOMCache.getElement("loading");
const searchInput = DOMCache.getTypedElement("search-input", HTMLInputElement);
const modal = DOMCache.getElement("playground-modal");
const iframe = DOMCache.getTypedElement("playground-iframe", HTMLIFrameElement);
const closeBtn = DOMCache.getElement("close-modal");


// Constants for better maintainability
const API_BASE_URL = "https://api.wordpress.org/plugins/info/1.2/?action=query_plugins";
const PLAYGROUND_BASE_URL = "https://playground.wordpress.net/";
const PLUGINS_PER_PAGE = 15;
const MIN_BLOCK_PLUGINS_NEEDED = 3;
const SCROLL_THRESHOLD = 200;
const SEARCH_DEBOUNCE_DELAY = 300;
const DEFAULT_ICON = "https://s.w.org/plugins/geopattern-icon/block-default.svg";

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

/**
 * Application state management
 * Centralizes global state variables for better maintainability
 */
class AppState {
    private static _currentPage: number = 1;
    private static _isLoading: boolean = false;
    private static _allPlugins: Plugin[] = [];
    private static _searchTerm: string = "";
    private static _hasReachedEnd: boolean = false;
    private static _currentAbortController: AbortController | null = null;

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

    /**
     * Resets state for new searches
     */
    static resetForNewSearch(): void {
        this._allPlugins = [];
        this._hasReachedEnd = false;
        this._currentPage = 1;
    }
}

/**
 * Input validation and sanitization utilities
 * Ensures data integrity and security
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

/**
 * Error handling utilities
 * Provides centralized error management
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
                loadingText.innerText = "Request cancelled.";
            } else if (error instanceof Error && error.message.includes('Failed to fetch')) {
                loadingText.innerText = "Network error. Please check your connection.";
            } else {
                loadingText.innerText = "Error loading plugins. Please try again.";
            }
        }
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

    if (validatedPage > 1) {
        url.searchParams.set("page", validatedPage.toString());
    } else {
        url.searchParams.delete("page");
    }

    const state = { search: sanitizedSearch, page: validatedPage };
    if (push) {
        window.history.pushState(state, "", url.toString());
    } else {
        window.history.replaceState(state, "", url.toString());
    }
}

/**
 * Reloads the current state from URL parameters
 * Handles aborting operations and scroll management
 */
async function reloadToCurrentState(): Promise<void> {
    AppState.isLoading = false;

    // Create new abort controller for this reload operation
    AppState.currentAbortController = new AbortController();
    const { signal } = AppState.currentAbortController;

    // Function to abort on scroll
    const abortOnScroll = () => {
        if (AppState.currentAbortController) {
            AppState.currentAbortController.abort();
            console.log('Reload operation aborted due to scroll');
        }
    };

    // Add scroll listener to abort on user scroll
    window.addEventListener('scroll', abortOnScroll, { once: true });

    try {
        for (let p = 1; p <= AppState.currentPage; p++) {
            // Check if request was aborted before starting new fetch
            if (signal.aborted) {
                console.log('Reload operation was aborted');
                return;
            }

            const previousChildCount = gridContainer?.children.length || 0;

            await fetchBlocks(p, AppState.searchTerm, p > 1, signal);

            // Check if request was aborted after fetch
            if (signal.aborted) {
                console.log('Reload operation was aborted during fetch');
                return;
            }

            // Mark the first block of the current initialized page to scroll into view
            if (p > 1 && gridContainer && gridContainer.children.length > previousChildCount) {
                const elementToScrollTo = gridContainer.children[previousChildCount] as HTMLElement;
                if (elementToScrollTo) {
                    // Use a small delay to ensure DOM is updated before scrolling
                    await new Promise(resolve => setTimeout(resolve, 100));
                    elementToScrollTo.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            }

            if (AppState.hasReachedEnd) break;
        }
    } catch (error) {
        ErrorHandler.handleAPIError(error, 'reloadToCurrentState');
    } finally {
        // Clean up: remove scroll listener and reset abort controller
        window.removeEventListener('scroll', abortOnScroll);
        AppState.currentAbortController = null;
    }
}

// Build API URL with search and pagination
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
        if (loadingText) loadingText.style.display = "block";
        if (gridContainer) gridContainer.innerHTML = "";
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
        if (newPlugins.length < PLUGINS_PER_PAGE) {
            AppState.hasReachedEnd = true;
        }

        // Update master plugin list
        AppState.allPlugins = [...AppState.allPlugins, ...newPlugins];

        // Filter plugins that contain blocks
        const pluginsWithBlocks = newPlugins.filter(plugin =>
            plugin.blocks && Object.keys(plugin.blocks).length > 0
        );

        // Auto-fetch more data if needed (only for initial non-search requests)
        const currentBlockPlugins = AppState.allPlugins.filter(plugin =>
            plugin.blocks && Object.keys(plugin.blocks).length > 0
        ).length;

        if (!append && !search && currentBlockPlugins < MIN_BLOCK_PLUGINS_NEEDED && !AppState.hasReachedEnd) {
            console.log(`Only ${currentBlockPlugins} plugins with blocks found, fetching more...`);
            await fetchBlocks(page + 1, search, true, abortSignal);
            return;
        }

        // Render only the new plugins with blocks to avoid duplicates
        renderBlocks(pluginsWithBlocks, append);

        if (loadingText) loadingText.style.display = "none";
        updateLoadMoreIndicator(!AppState.hasReachedEnd);
    } catch (error) {
        ErrorHandler.handleAPIError(error, 'fetchBlocks');
    } finally {
        AppState.isLoading = false;
    }
}

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
    return Object.values(blocks).map(block =>
        `<div class="block-item">
            <span class="block-name">${block.title}</span>
            <span class="block-category">${block.category}</span>
        </div>`
    ).join('');
}

// Render the blocks into the HTML grid
/**
 * Renders plugin cards into the grid container
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
        gridContainer.innerHTML =
            "<div class='no-results'>No plugins found matching your search.</div>";
        return;
    }

    // Clear grid for fresh searches
    if (!append) {
        gridContainer.innerHTML = "";
    }

    // Create document fragment for better performance
    const fragment = document.createDocumentFragment();

    pluginsToRender.forEach((plugin: Plugin) => {
        const card = createPluginCard(plugin);
        fragment.appendChild(card);
    });

    gridContainer.appendChild(fragment);
}

/**
 * Performance utilities for optimizing application behavior
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

// Update load more indicator
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

/**
 * Handles infinite scroll functionality to load more plugins
 * Uses throttling to improve performance
 */
const handleScroll = PerformanceUtils.throttle(() => {
    if (AppState.isLoading) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    // Load more when user is within threshold distance of the bottom
    if (scrollTop + windowHeight >= documentHeight - SCROLL_THRESHOLD) {
        AppState.currentPage++;
        updateHistory(AppState.searchTerm, AppState.currentPage, false);
        fetchBlocks(AppState.currentPage, AppState.searchTerm, true);
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

    AppState.currentPage = 1;
    updateHistory(AppState.searchTerm, AppState.currentPage, true);
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
 * Sets up event listeners with proper error handling
 */
function setupEventListeners(): void {
    if (closeBtn) {
        closeBtn.addEventListener("click", closeModal);
    }

    window.addEventListener("scroll", handleScroll);

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
