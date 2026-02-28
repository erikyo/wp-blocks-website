/**
 * Represents a WordPress block within a plugin
 * Contains metadata about the block's functionality and configuration
 */
export interface PluginBlock {
    /** WordPress API version compatibility */
    apiVersion: string;
    /** Unique block identifier in format 'namespace/block-name' */
    name: string;
    /** Human-readable block title */
    title: string;
    /** Detailed description of block functionality */
    description: string;
    /** Block category for organization in block inserter */
    category: string;
    /** Search terms and keywords for block discovery */
    keywords: string[];
    /** Text domain for internationalization */
    textdomain: string;
    /** Block attributes schema and default values */
    attributes: Record<string, any>;
    /** Block editor features and capabilities */
    supports: Record<string, any>;
    /** Example data for block preview */
    example: Record<string, any>;
    /** Editor script handle for block registration */
    editorScript: string;
}

/**
 * Represents plugin icons in different sizes
 * Icons are used for plugin directory listings and UI elements
 */
export interface PluginIcons {
    /** Standard resolution icon (typically 128x128px) */
    "1x"?: string;
    /** High resolution icon for retina displays (typically 256x256px) */
    "2x"?: string;
    /** Fallback icon if specific sizes are not available */
    default?: string;
}

/**
 * Represents the distribution of user ratings for a plugin
 * Keys are star ratings (1-5), values are count of ratings
 */
interface PluginRatings {
    /** Number of 1-star ratings */
    1: number;
    /** Number of 2-star ratings */
    2: number;
    /** Number of 3-star ratings */
    3: number;
    /** Number of 4-star ratings */
    4: number;
    /** Number of 5-star ratings */
    5: number;
}

/**
 * Represents plugin tags for categorization and search
 * Key-value pairs where keys are tag slugs and values are display names
 */
interface PluginTags {
    [key: string]: string;
}

/**
 * Represents a WordPress plugin with comprehensive metadata
 * Contains all information needed for display, installation, and playground integration
 */
export interface Plugin {
    /** Plugin display name */
    name: string;
    /** Unique plugin identifier used in URLs */
    slug: string;
    /** Current plugin version following semantic versioning */
    version: string;
    /** Plugin author name (may contain HTML) */
    author: string;
    /** URL to author's WordPress.org profile */
    author_profile: string;
    /** Minimum WordPress version required */
    requires: string;
    /** Latest WordPress version tested against */
    tested: string;
    /** Minimum PHP version required */
    requires_php: string;
    /** List of required plugin dependencies */
    requires_plugins: any[];
    /** Overall rating percentage (0-100) */
    rating: number;
    /** Detailed rating breakdown by star count */
    ratings: PluginRatings;
    /** Total number of user ratings */
    num_ratings: number;
    /** Number of active support threads */
    support_threads: number;
    /** Number of resolved support threads */
    support_threads_resolved: number;
    /** Number of active installations */
    active_installs: number;
    /** Total download count */
    downloaded: number;
    /** Last updated date in ISO format */
    last_updated: string;
    /** Date plugin was added to directory */
    added: string;
    /** Plugin homepage URL */
    homepage: string;
    /** Brief description for plugin listings */
    short_description: string;
    /** Full plugin description (may contain HTML) */
    description: string;
    /** Direct download URL for plugin zip file */
    download_link: string;
    /** Plugin tags for categorization */
    tags: PluginTags;
    /** Donation link for plugin support */
    donate_link: string;
    /** Plugin icons in various sizes */
    icons: PluginIcons;
    /** Blocks provided by this plugin */
    blocks: Record<string, PluginBlock>;
    /** List of block asset files */
    block_assets: string[];
    /** Total number of blocks by this author */
    author_block_count: string;
    /** Average rating of blocks by this author */
    author_block_rating: number;
}
