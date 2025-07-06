// Background service worker for network interception only
class NetworkInterceptor {
    constructor() {
        this.filterState = new Map(); // Track filter state by tabId
        this.init();
    }

    async init() {
        await this.loadSavedFilters(); // Load persisted filter data
        this.setupNetworkInterception();
        this.setupMessageHandler();
        this.setupTabCleanup();
    }

    async loadSavedFilters() {
        try {
            const result = await chrome.storage.local.get(['filterState']);
            if (result.filterState) {
                // Convert the saved object back to a Map
                const savedState = result.filterState;
                for (const [tabId, tabData] of Object.entries(savedState)) {
                    // Convert activeFilters array back to Map
                    const activeFiltersMap = new Map();
                    if (tabData.activeFilters && Array.isArray(tabData.activeFilters)) {
                        for (const [key, value] of tabData.activeFilters) {
                            activeFiltersMap.set(key, value);
                        }
                    }
                    
                    this.filterState.set(parseInt(tabId), {
                        ...tabData,
                        activeFilters: activeFiltersMap
                    });
                }
            }
        } catch (error) {
            console.error('❌ Error loading saved filters:', error);
        }
    }

    async saveFilterState() {
        try {
            // Convert Map to a serializable object
            const stateToSave = {};
            for (const [tabId, tabData] of this.filterState.entries()) {
                stateToSave[tabId] = {
                    ...tabData,
                    // Convert the Map to an array for serialization
                    activeFilters: Array.from(tabData.activeFilters.entries())
                };
            }
            
            await chrome.storage.local.set({ filterState: stateToSave });
        } catch (error) {
            console.error('❌ Error saving filter state:', error);
        }
    }

    setupNetworkInterception() {
        chrome.webRequest.onBeforeRequest.addListener(
            (details) => {
                // Add back essential logging for debugging search issues
                if (details.url.includes('/search/assets/')) {
                    console.log('🔍 Search request:', details.url);
                }
                
                if (this.isBynderFilterRequest(details.url)) {
                    console.log('✅ Filter request intercepted:', details.url);
                    this.parseFilterRequest(details.url, details.tabId);
                } else if (details.url.includes('/search/assets/') && details.url.includes('field=')) {
                    console.log('⚠️ Missed filter request:', details.url);
                    console.log('🔍 Detection check:', {
                        hasMetaproperty: details.url.includes('field=metaproperty_'),
                        hasTags: details.url.includes('field=tags'),
                        hasText: details.url.includes('field=text'),
                        hasSingletext: details.url.includes('field=singletext')
                    });
                }
            },
            {
                urls: ['*://*.bynder.com/*']
            }
        );
    }

    setupMessageHandler() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'getFilters') {
                
                // Get current active tab to compare with stored data
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const activeTab = tabs[0];
                    
                    const tabId = activeTab?.id;
                    const tabFilterState = this.filterState.get(tabId);
                    
                    
                    if (tabFilterState && tabId) {
                        const activeFilters = this.getActiveFilters(tabFilterState);
                        
                        
                        sendResponse({
                            filters: activeFilters,
                            portalUrl: tabFilterState.portalUrl,
                            hasFilters: this.hasFilters(activeFilters),
                            source: 'state-tracked'
                        });
                    } else {
                        
                        // Still try to get portal URL from current tab
                        let portalUrl = null;
                        if (activeTab && activeTab.url && activeTab.url.includes('.bynder.com')) {
                            try {
                                const url = new URL(activeTab.url);
                                portalUrl = url.hostname;
                            } catch (e) {
                                console.error('Error parsing URL:', e);
                            }
                        }
                        
                        sendResponse({
                            filters: { metaproperties: [], tags: [], search: [], status: [] },
                            portalUrl: portalUrl,
                            hasFilters: false,
                            source: 'no-data'
                        });
                    }
                });
            }
            return true; // Keep the messaging channel open for async response
        });
    }

    isBynderFilterRequest(url) {
        // Check for filter requests
        if (url.includes('/search/assets/') && 
            (url.includes('field=metaproperty_') || 
             url.includes('field=tags') || 
             url.includes('field=text') ||
             url.includes('field=singletext'))) {
            return true;
        }
        
        // Also check for reset/clear requests (case insensitive)
        const lowerUrl = url.toLowerCase();
        if (url.includes('/search/assets/') && 
            (lowerUrl.includes('resetsearch') || 
             url.includes('resetSearch') ||
             url.includes('clearfilters') ||
             url.includes('reset=true'))) {
            return true;
        }
        
        return false;
    }

    parseFilterRequest(url, tabId) {
        try {
            const urlObj = new URL(url);
            const params = urlObj.searchParams;
            
            console.log('🔍 Parsing filter request:', Array.from(params.entries()));
            
            // Check for reset/clear all filters (handle both resetSearch and resetsearch)
            if (params.has('resetSearch') || 
                params.has('resetsearch') ||
                url.toLowerCase().includes('resetsearch') || 
                url.includes('clearfilters') || 
                params.get('reset') === 'true') {
                
                // Clear all filters for this tab
                if (this.filterState.has(tabId)) {
                    const tabState = this.filterState.get(tabId);
                    tabState.activeFilters.clear();
                    tabState.timestamp = Date.now();
                    this.saveFilterState();
                }
                return;
            }

            const field = params.get('field');
            const value = params.get('value');
            const filterType = params.get('filterType');

            console.log('🔍 Extracted params:', { field, value, filterType });

            if (!field || !value || !filterType) {
                console.log('❌ Missing required params - skipping');
                return;
            }

            // Initialize tab state if it doesn't exist
            if (!this.filterState.has(tabId)) {
                this.filterState.set(tabId, {
                    portalUrl: urlObj.hostname,
                    timestamp: Date.now(),
                    activeFilters: new Map() // Map<filterKey, filterData>
                });
            }

            const tabState = this.filterState.get(tabId);
            tabState.timestamp = Date.now();

            // Create unique filter key for tracking
            const filterKey = `${field}:${value}`;

            if (filterType === 'add') {
                console.log(`➕ Adding filter: ${filterKey}`);
                
                let filterData;
                if (field.startsWith('metaproperty_')) {
                    const propertyName = field.replace('metaproperty_', '').replace(/_/g, ' ');
                    filterData = {
                        type: 'metaproperty',
                        property: propertyName,
                        value: value,
                        rawProperty: field.replace('metaproperty_', '')
                    };
                } else if (field === 'tags') {
                    filterData = {
                        type: 'tag',
                        value: value
                    };
                } else if (field === 'text' || field === 'singletext') {
                    filterData = {
                        type: 'search',
                        value: value
                    };
                }

                tabState.activeFilters.set(filterKey, filterData);
                
            } else if (filterType === 'remove') {
                tabState.activeFilters.delete(filterKey);
                
                // If no filters remain, clear the timestamp to indicate empty state
                if (tabState.activeFilters.size === 0) {
                    tabState.timestamp = Date.now();
                }
            }

            // Save the updated filter state to persistent storage
            this.saveFilterState();

        } catch (error) {
            console.error('❌ Error parsing filter:', error);
        }
    }

    getActiveFilters(tabState) {
        const filters = {
            metaproperties: [],
            tags: [],
            search: [],
            status: []
        };


        for (const [filterKey, filterData] of tabState.activeFilters) {
            switch (filterData.type) {
                case 'metaproperty':
                    filters.metaproperties.push({
                        property: filterData.property,
                        value: filterData.value,
                        rawProperty: filterData.rawProperty
                    });
                    break;
                case 'tag':
                    filters.tags.push({ value: filterData.value });
                    break;
                case 'search':
                    filters.search.push({ value: filterData.value });
                    break;
            }
        }


        return filters;
    }

    hasFilters(filters) {
        const hasFilters = filters.metaproperties.length > 0 ||
               filters.tags.length > 0 ||
               filters.search.length > 0 ||
               filters.status.length > 0;
        
        
        return hasFilters;
    }

    setupTabCleanup() {
        // Clean up filter data when tabs are closed
        chrome.tabs.onRemoved.addListener(async (tabId) => {
            if (this.filterState.has(tabId)) {
                this.filterState.delete(tabId);
                await this.saveFilterState();
            }
        });

        // Monitor tab updates for navigation changes
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            if (changeInfo.url && tab.url.includes('.bynder.com')) {
                const url = new URL(tab.url);
                const searchParams = new URLSearchParams(url.search);
                
                // Skip if this navigation happened very recently after adding a filter
                // (Bynder sometimes redirects after applying filters)
                const tabState = this.filterState.get(tabId);
                if (tabState) {
                    const timeSinceLastUpdate = Date.now() - tabState.timestamp;
                    if (timeSinceLastUpdate < 5000) { // 5 second grace period
                        return;
                    }
                }
                
                // Check if navigating to a URL without filters
                // Only viewType=grid or similar UI params, no actual filters
                const hasOnlyViewParams = url.search && 
                    searchParams.has('viewType') && 
                    !searchParams.has('field') && 
                    !searchParams.has('metaproperty') &&
                    !searchParams.has('tags') &&
                    !searchParams.has('text');
                
                if ((url.pathname === '/' || url.pathname === '/media/' || url.pathname === '/media') && 
                    (!url.search || hasOnlyViewParams)) {
                    
                    // Only clear if we actually have no filters in the tab state
                    if (this.filterState.has(tabId) && tabState.activeFilters.size === 0) {
                        tabState.timestamp = Date.now();
                        this.saveFilterState();
                    }
                }
            }
        });

        // Also clean up old data on startup (tabs that might have been closed while extension was inactive)
        chrome.tabs.query({}, (tabs) => {
            const activeTabIds = new Set(tabs.map(tab => tab.id));
            let cleanedAny = false;
            
            for (const tabId of this.filterState.keys()) {
                if (!activeTabIds.has(tabId)) {
                    this.filterState.delete(tabId);
                    cleanedAny = true;
                }
            }
            
            if (cleanedAny) {
                this.saveFilterState();
            }
        });
    }
}

// Initialize
new NetworkInterceptor();