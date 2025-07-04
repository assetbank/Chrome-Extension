// Background service worker for network interception only
class NetworkInterceptor {
    constructor() {
        this.filterState = new Map(); // Track filter state by tabId
        this.init();
    }

    async init() {
        console.log('🚀 Bynder Network Interceptor loading...');
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
                console.log('📥 Loaded saved filter state:', this.filterState.size, 'tabs');
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
            console.log('💾 Filter state saved to storage');
        } catch (error) {
            console.error('❌ Error saving filter state:', error);
        }
    }

    setupNetworkInterception() {
        console.log('🌐 Setting up network interception...');
        
        chrome.webRequest.onBeforeRequest.addListener(
            (details) => {
                if (this.isBynderFilterRequest(details.url)) {
                    console.log('✅ Bynder filter request intercepted:', details.url);
                    this.parseFilterRequest(details.url, details.tabId);
                }
            },
            {
                urls: ['*://*.bynder.com/*']
            }
        );
        
        console.log('💾 Network interception setup complete');
    }

    setupMessageHandler() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'getFilters') {
                console.log('📋 Getting filters request from popup');
                
                // Get current active tab to compare with stored data
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const activeTab = tabs[0];
                    
                    const tabId = activeTab?.id;
                    const tabFilterState = this.filterState.get(tabId);
                    
                    console.log('🔍 Checking filter data:', {
                        hasData: !!tabFilterState,
                        activeTabId: tabId,
                        timestamp: tabFilterState?.timestamp,
                        age: tabFilterState ? Date.now() - tabFilterState.timestamp : 'no data'
                    });
                    
                    if (tabFilterState && tabId) {
                        const activeFilters = this.getActiveFilters(tabFilterState);
                        
                        console.log('📊 Returning current filter state:', JSON.stringify({
                            filters: activeFilters,
                            portalUrl: tabFilterState.portalUrl,
                            hasFilters: this.hasFilters(activeFilters)
                        }, null, 2));
                        
                        sendResponse({
                            filters: activeFilters,
                            portalUrl: tabFilterState.portalUrl,
                            hasFilters: this.hasFilters(activeFilters),
                            source: 'state-tracked'
                        });
                    } else {
                        console.log('⚠️ No filter state available for tab');
                        sendResponse({
                            filters: { metaproperties: [], tags: [], search: [], status: [] },
                            portalUrl: null,
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
        return url.includes('/search/assets/') && 
               (url.includes('field=metaproperty_') || 
                url.includes('field=tags') || 
                url.includes('field=text'));
    }

    parseFilterRequest(url, tabId) {
        try {
            const urlObj = new URL(url);
            const params = urlObj.searchParams;
            
            console.log('🔍 Parsing:', Array.from(params.entries()));

            const field = params.get('field');
            const value = params.get('value');
            const filterType = params.get('filterType');

            if (!field || !value || !filterType) {
                console.log('⏭️ Skipping incomplete filter request');
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
                } else if (field === 'text') {
                    filterData = {
                        type: 'search',
                        value: value
                    };
                }

                tabState.activeFilters.set(filterKey, filterData);
                
            } else if (filterType === 'remove') {
                console.log(`➖ Removing filter: ${filterKey}`);
                tabState.activeFilters.delete(filterKey);
            }

            console.log('✅ Filter state updated:', {
                tabId,
                activeFilterCount: tabState.activeFilters.size,
                activeFilters: Array.from(tabState.activeFilters.entries())
            });

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
        
        console.log('🔍 hasFilters check:', {
            metaproperties: filters.metaproperties.length,
            tags: filters.tags.length,
            search: filters.search.length,
            status: filters.status.length,
            result: hasFilters
        });
        
        return hasFilters;
    }

    setupTabCleanup() {
        // Clean up filter data when tabs are closed
        chrome.tabs.onRemoved.addListener(async (tabId) => {
            if (this.filterState.has(tabId)) {
                console.log(`🧹 Cleaning up filter data for closed tab ${tabId}`);
                this.filterState.delete(tabId);
                await this.saveFilterState();
            }
        });

        // Also clean up old data on startup (tabs that might have been closed while extension was inactive)
        chrome.tabs.query({}, (tabs) => {
            const activeTabIds = new Set(tabs.map(tab => tab.id));
            let cleanedAny = false;
            
            for (const tabId of this.filterState.keys()) {
                if (!activeTabIds.has(tabId)) {
                    console.log(`🧹 Cleaning up stale filter data for non-existent tab ${tabId}`);
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