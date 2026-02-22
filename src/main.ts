import "./style.css";

// TypeScript interfaces for WordPress plugin data
interface PluginBlock {
    apiVersion: string;
    name: string;
    title: string;
    description: string;
    category: string;
    keywords: string[];
    textdomain: string;
    attributes: Record<string, any>;
    supports: Record<string, any>;
    example: Record<string, any>;
    editorScript: string;
}

interface PluginIcons {
    "1x"?: string;
    "2x"?: string;
    default?: string;
}

interface PluginRatings {
    1: number;
    2: number;
    3: number;
    4: number;
    5: number;
}

interface PluginTags {
    [key: string]: string;
}

interface Plugin {
    name: string;
    slug: string;
    version: string;
    author: string;
    author_profile: string;
    requires: string;
    tested: string;
    requires_php: string;
    requires_plugins: any[];
    rating: number;
    ratings: PluginRatings;
    num_ratings: number;
    support_threads: number;
    support_threads_resolved: number;
    active_installs: number;
    downloaded: number;
    last_updated: string;
    added: string;
    homepage: string;
    short_description: string;
    description: string;
    download_link: string;
    tags: PluginTags;
    donate_link: string;
    icons: PluginIcons;
    blocks: Record<string, PluginBlock>;
    block_assets: string[];
    author_block_count: string;
    author_block_rating: number;
}

const gridContainer = document.getElementById("block-grid");
const loadingText = document.getElementById("loading");
const searchInput = document.getElementById("search-input") as HTMLInputElement;
const modal = document.getElementById("playground-modal");
const iframe = document.getElementById("playground-iframe") as HTMLIFrameElement;
const closeBtn = document.getElementById("close-modal");

if (
    !gridContainer ||
    !loadingText ||
    !searchInput ||
    !modal ||
    !iframe ||
    !closeBtn
) {
    throw new Error("Missing required elements");
}

let currentPage = 1;
let isLoading = false;
let allPlugins: Plugin[] = [];
let searchTerm = "";

// Build API URL with search and pagination
function buildApiUrl(page = 1, search = "") {
    const baseUrl =
        "https://api.wordpress.org/plugins/info/1.2/?action=query_plugins";
    const params = new URLSearchParams();
    if (search) {
        // When searching, don't filter by blocks to get all matching plugins
        params.append("request[block]", search);
    } else {
        // Only filter by blocks when not searching
        params.append("request[block]", "block");
        params.append("request[browse]", "popular");
    }
    params.append("request[per_page]", "15");
    params.append("request[page]", page.toString());
    return `${baseUrl}&${params.toString()}`;
}

let hasReachedEnd = false;

// Fetch the blocks from WordPress.org
async function fetchBlocks(page = 1, search = "", append = false) {
    // If already loading OR we reached the end (and we are trying to append), stop.
    if (isLoading || (append && hasReachedEnd)) return;

    isLoading = true;

    if (!append) {
        loadingText.style.display = "block";
        gridContainer.innerHTML = "";
        allPlugins = [];
        hasReachedEnd = false; // Reset for new searches
    }

    try {
        const url = buildApiUrl(page, search);
        const response = await fetch(url);
        const data = await response.json();
        const newPlugins = data.plugins || [];

        // 1. Update "Reached End" state
        // If we get fewer than 15, or zero, there's no more data
        if (newPlugins.length < 15) {
            hasReachedEnd = true;
        }

        // 2. Update the master lists
        allPlugins = [...allPlugins, ...newPlugins];

        // 3. Filter plugins that have blocks
        const pluginsWithBlocks = newPlugins.filter(plugin =>
            plugin.blocks && Object.keys(plugin.blocks).length > 0
        );

        // 4. Check if we need to fetch more data (only for non-search requests)
        const minPluginsNeeded = 3; // Minimum plugins needed to show at least one row
        const currentBlockPlugins = allPlugins.filter(plugin =>
            plugin.blocks && Object.keys(plugin.blocks).length > 0
        ).length;

        // If this is the first page, not a search, and we don't have enough block plugins, fetch more
        if (!append && !search && currentBlockPlugins < minPluginsNeeded && !hasReachedEnd) {
            console.log(`Only ${currentBlockPlugins} plugins with blocks found, fetching more...`);
            await fetchBlocks(page + 1, search, true);
            return;
        }

        // 5. ONLY pass the NEW plugins with blocks to the renderer to avoid duplicates
        renderBlocks(pluginsWithBlocks, append);

        loadingText.style.display = "none";
        updateLoadMoreIndicator(!hasReachedEnd);
    } catch (error) {
        loadingText.innerText = "Error loading blocks.";
        console.error("API Fetch Error:", error);
    } finally {
        isLoading = false;
    }
}

// Render the blocks into the HTML grid
function renderBlocks(pluginsToRender: Plugin[], append = false) {
    // If it's a fresh search/load and no plugins found
    if (pluginsToRender.length === 0 && !append) {
        gridContainer.innerHTML =
            "<div class='no-results'>No plugins found matching your search.</div>";
        return;
    }

    // If we aren't appending (like a new search), clear the grid first
    if (!append) {
        gridContainer.innerHTML = "";
    }

    pluginsToRender.forEach((plugin: Plugin) => {
        // Icon fallback logic
        const iconUrl =
            plugin.icons["1x"] ||
            plugin.icons["default"] ||
            "https://s.w.org/plugins/geopattern-icon/block-default.svg";

        // Format rating stars
        const rating = plugin.rating || 0;
        const stars = Array.from({length: 5}, (_, i) =>
            i < Math.round(rating / 20) ? "★" : "☆",
        ).join("");

        // Format active installs
        const activeInstalls = plugin.active_installs || 0;
        let installsText = "";
        if (activeInstalls >= 1000000) {
            installsText = `${(activeInstalls / 1000000).toFixed(1)}M+`;
        } else if (activeInstalls >= 1000) {
            installsText = `${(activeInstalls / 1000).toFixed(1)}K+`;
        } else {
            installsText = `${activeInstalls}+`;
        }

        // Extract clean author name
        const authorName = plugin.author.replace(/<[^>]*>/g, "").trim();

        // Generate WordPress plugin page URL
        const pluginPageUrl = `https://wordpress.org/plugins/${plugin.slug}/`;

        // Generate formatted list of blocks
        const blocksList = Object.values(plugin.blocks).map(block =>
            `<div class="block-item">
                <span class="block-name">${block.title}</span>
                <span class="block-category">${block.category}</span>
            </div>`
        ).join('');

        const card = document.createElement("div");
        card.className = "block-card";

        card.innerHTML = `
                <div class="card-header">
                    <img src="${iconUrl}" alt="${plugin.name} icon" class="block-icon">
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

        // Add click event to launch the playground
        card.addEventListener("click", () => openPlayground(plugin.slug));

        gridContainer.appendChild(card);
    });
}

// Generate Blueprint JSON and launch the iframe
function openPlayground(pluginSlug: string) {
    // Show the modal
    modal.style.display = "block";

    // Define the Blueprint object
    const blueprint = {
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

    // Convert the Blueprint to a Base64 string for the URL fragment
    const blueprintJsonString = JSON.stringify(blueprint);
    const encodedBlueprint = btoa(blueprintJsonString);

    // Set the iframe source with the encoded Blueprint
    const playgroundBaseUrl = "https://playground.wordpress.net/";
    iframe.src = `${playgroundBaseUrl}#${encodedBlueprint}`;
}

// Update load more indicator
function updateLoadMoreIndicator(hasMore) {
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
        // Optional: Tell the user they've seen it all
        indicator.innerHTML = "<p>You've reached the end of the list.</p>";
        indicator.style.display = "block";
    }
}

// Infinite scroll handler
function handleScroll() {
    if (isLoading) return;

    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const windowHeight = window.innerHeight;
    const documentHeight = document.documentElement.scrollHeight;

    // Load more when user is within 200px of the bottom
    if (scrollTop + windowHeight >= documentHeight - 200) {
        currentPage++;
        fetchBlocks(currentPage, searchTerm, true);
    }
}

// Live search handler
function handleSearch(event) {
    const value = event.target.value;
    searchTerm = value;

    // Debounce search
    clearTimeout((window as any).searchTimeout);
    (window as any).searchTimeout = setTimeout(() => {
        currentPage = 1;
        fetchBlocks(1, value, false);
    }, 300);
}

// Close modal and reset iframe (to free up memory)
closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
    iframe.src = "";
});

// Add event listeners
window.addEventListener("scroll", handleScroll);
searchInput.addEventListener("input", handleSearch);

// Initialize the app
fetchBlocks().catch(console.log);
