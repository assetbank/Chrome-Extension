// Content script for direct DOM analysis of Bynder filters
class BynderFilterDetector {
    constructor() {
        this.filters = {
            metaproperties: [],
            tags: [],
            search: [],
            status: []
        };
        this.observer = null;
        this.portalUrl = window.location.hostname;
        this.init();
    }

    init() {
        console.log('🔍 Bynder Filter Detector initialized');
        
        // Initial detection
        this.detectFilters();
        
        // Set up mutation observer for dynamic content
        this.setupObserver();
        
        // Listen for requests from popup
        this.setupMessageListener();
    }

    setupObserver() {
        // Observe changes to detect filter updates
        this.observer = new MutationObserver(() => {
            this.detectFilters();
        });

        // Start observing when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                this.startObserving();
            });
        } else {
            this.startObserving();
        }
    }

    startObserving() {
        const targetNode = document.body;
        const config = {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'data-filter', 'aria-selected', 'aria-checked']
        };
        
        this.observer.observe(targetNode, config);
    }

    detectFilters() {
        console.log('🔎 Detecting filters from DOM...');
        
        // Reset filters
        this.filters = {
            metaproperties: [],
            tags: [],
            search: [],
            status: []
        };

        // Strategy 1: Look for filter pills/chips (common UI pattern)
        this.detectFilterPills();
        
        // Strategy 2: Look for active filter sidebar items
        this.detectSidebarFilters();
        
        // Strategy 3: Check URL parameters
        this.detectUrlFilters();
        
        // Strategy 4: Look for search input
        this.detectSearchInput();
        
        // Send updated filters to background
        this.sendFiltersToBackground();
    }

    detectFilterPills() {
        // Common selectors for filter pills/chips
        const pillSelectors = [
            '[data-testid*="filter-pill"]',
            '[data-testid*="filter-chip"]',
            '.filter-pill',
            '.filter-chip',
            '.applied-filter',
            '.active-filter',
            '[class*="filterPill"]',
            '[class*="filterChip"]',
            '[class*="appliedFilter"]',
            // Bynder specific patterns
            '.filters-applied-list li',
            '.filter-tags .tag',
            '.selected-filters .filter-item'
        ];

        pillSelectors.forEach(selector => {
            const pills = document.querySelectorAll(selector);
            pills.forEach(pill => {
                const text = pill.textContent.trim();
                if (text) {
                    console.log(`💊 Found filter pill: ${text}`);
                    this.parseFilterPill(text, pill);
                }
            });
        });
    }

    detectSidebarFilters() {
        // Look for active filters in sidebars
        const sidebarSelectors = [
            // Checkbox/radio inputs
            'input[type="checkbox"]:checked',
            'input[type="radio"]:checked',
            // Active list items
            'li.active[data-filter]',
            'li.selected[data-filter]',
            '[aria-selected="true"]',
            '[aria-checked="true"]',
            // Bynder specific
            '.filter-section input:checked',
            '.facet-item.selected',
            '.filter-option.active'
        ];

        sidebarSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                this.extractFilterFromElement(element);
            });
        });
    }

    detectUrlFilters() {
        const urlParams = new URLSearchParams(window.location.search);
        const hash = window.location.hash;
        
        // Check URL parameters
        urlParams.forEach((value, key) => {
            if (key.includes('filter') || key.includes('metaproperty') || key === 'tags' || key === 'search') {
                console.log(`🔗 URL filter found: ${key}=${value}`);
                this.addFilterFromUrl(key, value);
            }
        });
        
        // Check hash for filters (some SPAs use this)
        if (hash && hash.includes('filter')) {
            console.log(`#️⃣ Hash filter found: ${hash}`);
            this.parseHashFilters(hash);
        }
    }

    detectSearchInput() {
        const searchSelectors = [
            'input[type="search"]',
            'input[placeholder*="search" i]',
            'input[placeholder*="find" i]',
            'input[name="search"]',
            'input[name="q"]',
            '[data-testid*="search-input"]',
            '.search-input',
            '#search'
        ];

        searchSelectors.forEach(selector => {
            const inputs = document.querySelectorAll(selector);
            inputs.forEach(input => {
                const value = input.value.trim();
                if (value) {
                    console.log(`🔍 Search term found: ${value}`);
                    this.filters.search.push({ value });
                }
            });
        });
    }

    parseFilterPill(text, element) {
        // Try to determine filter type from pill text or attributes
        const lowerText = text.toLowerCase();
        
        // Check element attributes for hints
        const filterType = element.getAttribute('data-filter-type') || 
                          element.getAttribute('data-filter') ||
                          element.closest('[data-filter-type]')?.getAttribute('data-filter-type');
        
        if (filterType) {
            if (filterType.includes('metaproperty')) {
                // Extract property and value
                const parts = text.split(':').map(p => p.trim());
                if (parts.length >= 2) {
                    this.filters.metaproperties.push({
                        property: parts[0],
                        value: parts.slice(1).join(':'),
                        rawProperty: this.sanitizeProperty(parts[0])
                    });
                }
            } else if (filterType === 'tag') {
                this.filters.tags.push({ value: text });
            }
        } else {
            // Guess based on content
            if (text.includes(':')) {
                // Likely a metaproperty
                const parts = text.split(':').map(p => p.trim());
                if (parts.length >= 2) {
                    this.filters.metaproperties.push({
                        property: parts[0],
                        value: parts.slice(1).join(':'),
                        rawProperty: this.sanitizeProperty(parts[0])
                    });
                }
            } else if (lowerText.includes('tag:') || element.className.includes('tag')) {
                this.filters.tags.push({ value: text.replace(/^tag:\s*/i, '') });
            } else {
                // Default to tag
                this.filters.tags.push({ value: text });
            }
        }
    }

    extractFilterFromElement(element) {
        // Get label or associated text
        let filterText = '';
        let filterType = '';
        
        // Try to find associated label
        if (element.id) {
            const label = document.querySelector(`label[for="${element.id}"]`);
            if (label) filterText = label.textContent.trim();
        }
        
        // Check parent label
        if (!filterText) {
            const parentLabel = element.closest('label');
            if (parentLabel) filterText = parentLabel.textContent.trim();
        }
        
        // Check data attributes
        if (!filterText) {
            filterText = element.getAttribute('data-filter-value') || 
                        element.getAttribute('value') || 
                        element.textContent.trim();
        }
        
        // Determine type
        const container = element.closest('[data-filter-type], .filter-section, .facet-section');
        if (container) {
            const typeAttr = container.getAttribute('data-filter-type') || 
                           container.className || 
                           container.querySelector('h3, h4, .section-title')?.textContent;
            
            if (typeAttr) {
                if (typeAttr.match(/metapropert|custom|attribute/i)) {
                    filterType = 'metaproperty';
                } else if (typeAttr.match(/tag/i)) {
                    filterType = 'tag';
                } else if (typeAttr.match(/status|state/i)) {
                    filterType = 'status';
                }
            }
        }
        
        // Add filter based on type
        if (filterText) {
            console.log(`✅ Found active filter: ${filterType} - ${filterText}`);
            
            if (filterType === 'metaproperty' && filterText.includes(':')) {
                const parts = filterText.split(':').map(p => p.trim());
                if (parts.length >= 2) {
                    this.filters.metaproperties.push({
                        property: parts[0],
                        value: parts.slice(1).join(':'),
                        rawProperty: this.sanitizeProperty(parts[0])
                    });
                }
            } else if (filterType === 'tag') {
                this.filters.tags.push({ value: filterText });
            } else if (filterType === 'status') {
                this.filters.status.push({ 
                    field: element.getAttribute('data-field') || 'status',
                    value: element.getAttribute('data-value') || filterText 
                });
            }
        }
    }

    addFilterFromUrl(key, value) {
        if (key.startsWith('metaproperty_')) {
            const property = key.replace('metaproperty_', '').replace(/_/g, ' ');
            this.filters.metaproperties.push({
                property: property,
                value: value,
                rawProperty: key.replace('metaproperty_', '')
            });
        } else if (key === 'tags') {
            value.split(',').forEach(tag => {
                this.filters.tags.push({ value: tag.trim() });
            });
        } else if (key === 'search' || key === 'q') {
            this.filters.search.push({ value });
        }
    }

    parseHashFilters(hash) {
        // Parse filters from URL hash (for SPAs)
        try {
            const filterMatch = hash.match(/filters=([^&]+)/);
            if (filterMatch) {
                const filters = JSON.parse(decodeURIComponent(filterMatch[1]));
                // Merge with existing filters
                if (filters.metaproperties) this.filters.metaproperties.push(...filters.metaproperties);
                if (filters.tags) this.filters.tags.push(...filters.tags);
                if (filters.search) this.filters.search.push(...filters.search);
            }
        } catch (e) {
            console.error('Error parsing hash filters:', e);
        }
    }

    sanitizeProperty(property) {
        return property.replace(/[^a-zA-Z0-9-]/g, "_");
    }

    sendFiltersToBackground() {
        const hasFilters = this.filters.metaproperties.length > 0 ||
                          this.filters.tags.length > 0 ||
                          this.filters.search.length > 0 ||
                          this.filters.status.length > 0;
        
        const message = {
            action: 'filtersDetected',
            filters: this.filters,
            portalUrl: this.portalUrl,
            hasFilters: hasFilters,
            source: 'content-script'
        };
        
        console.log('📤 Sending filters to background:', message);
        chrome.runtime.sendMessage(message);
    }

    setupMessageListener() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'getFiltersFromContent') {
                console.log('📥 Popup requested filters');
                
                // Re-detect filters to ensure we have the latest
                this.detectFilters();
                
                const hasFilters = this.filters.metaproperties.length > 0 ||
                                  this.filters.tags.length > 0 ||
                                  this.filters.search.length > 0 ||
                                  this.filters.status.length > 0;
                
                sendResponse({
                    filters: this.filters,
                    portalUrl: this.portalUrl,
                    hasFilters: hasFilters,
                    source: 'content-direct'
                });
            }
        });
    }
}

// Initialize only on Bynder pages
if (window.location.hostname.includes('.bynder.com')) {
    new BynderFilterDetector();
}