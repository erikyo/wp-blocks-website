/**
 * Cached DOM elements manager for performance optimization
 * Provides centralized access to frequently accessed DOM elements
 */
export class DOMCache {
    private static elements: Map<string, HTMLElement> = new Map();

    /**
     * Gets a cached DOM element or caches it if not already stored
     * @param id - Element ID to retrieve
     * @returns HTMLElement or null if not found
     */
    static getElement(id: string): HTMLElement | null {
        if (!this.elements.has(id)) {
            const element = document.getElementById(id);
            if (element) {
                this.elements.set(id, element);
            }
            return element;
        }
        return this.elements.get(id) || null;
    }

    /**
     * Gets a cached typed element
     * @param id - Element ID to retrieve
     * @param type - Expected element type constructor
     * @returns Typed element or null if not found
     */
    static getTypedElement<T extends HTMLElement>(id: string, type: new () => T): T | null {
        const element = this.getElement(id);
        return element instanceof type ? element : null;
    }

    /**
     * Clears all cached elements (useful for testing or cleanup)
     */
    static clearCache(): void {
        this.elements.clear();
    }
}
