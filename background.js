console.log('🚀 Bynder Filter Extension Background Script Started');

// Background service worker for network interception only
class NetworkInterceptor {
    constructor() {
        console.log('🔧 NetworkInterceptor initializing...');
        this.filterState = new Map(); // Track filter state by tabId
        this.init();
    }

    async init() {
        console.log('📋 Initializing extension components...');
        await this.loadSavedFilters(); // Load persisted filter data
        this.setupNetworkInterception();
        this.setupMessageHandler();
        this.setupTabCleanup();
        console.log('✅ Extension initialization complete');
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
                // Check for any Bynder URLs with filter parameters
                if (details.url.includes('bynder.com') && details.url.includes('field=') && details.url.includes('filterType=')) {
                    console.log('🎯 Bynder filter URL detected:', details.url);
                    try {
                        const url = new URL(details.url);
                        console.log('📍 Filter URL navigation detected, parsing filters');
                        this.parseFiltersFromSearchUrl(url, details.tabId);
                    } catch (e) {
                        console.error('Error parsing filter URL:', e);
                    }
                }
                
                // Add back essential logging for debugging search issues
                if (details.url.includes('/search/assets/')) {
                    console.log('🔍 Search request:', details.url);
                }
                
                // Log ALL Bynder requests to see what's happening with Advanced Rights
                if (details.url.includes('bynder.com')) {
                    console.log('🌐 All Bynder request:', details.url);
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
                        hasSingletext: details.url.includes('field=singletext'),
                        hasFilterTypeAdd: details.url.includes('filterType=add'),
                        hasFilterTypeRemove: details.url.includes('filterType=remove')
                    });
                }
            },
            {
                urls: ['*://*/*']
            }
        );
    }

    setupMessageHandler() {
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'getFilters') {
                console.log('📥 Popup requesting filters');
                
                // Get current active tab to compare with stored data
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const activeTab = tabs[0];
                    
                    const tabId = activeTab?.id;
                    const tabFilterState = this.filterState.get(tabId);
                    
                    console.log('🔍 Tab filter state:', {
                        tabId,
                        activeTabUrl: activeTab?.url,
                        hasState: !!tabFilterState,
                        activeFilters: tabFilterState?.activeFilters?.size || 0,
                        filterStateKeys: Array.from(this.filterState.keys()),
                        allTabStates: Object.fromEntries(
                            Array.from(this.filterState.entries()).map(([id, state]) => [
                                id, 
                                { activeFilters: state.activeFilters.size, portalUrl: state.portalUrl }
                            ])
                        )
                    });
                    
                    if (tabFilterState && tabId) {
                        const activeFilters = this.getActiveFilters(tabFilterState);
                        
                        console.log('✅ Sending active filters:', {
                            metaproperties: activeFilters.metaproperties.length,
                            tags: activeFilters.tags.length,
                            search: activeFilters.search.length,
                            status: activeFilters.status.length,
                            statusDetails: activeFilters.status
                        });
                        
                        sendResponse({
                            filters: activeFilters,
                            portalUrl: tabFilterState.portalUrl,
                            hasFilters: this.hasFilters(activeFilters),
                            source: 'state-tracked'
                        });
                    } else {
                        console.log('❌ No filter state found for tab');
                        
                        // Still try to get portal URL from current tab
                        let portalUrl = null;
                        if (activeTab && activeTab.url) {
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
        // Check for filter requests (both add and remove)
        if (url.includes('/search/assets/') && 
            (url.includes('field=metaproperty_') || 
             url.includes('field=tags') || 
             url.includes('field=autotags') || 
             url.includes('field=text') ||
             url.includes('field=singletext') ||
             url.includes('field=isActive') || 
             url.includes('field=archive') || 
             url.includes('field=isPublic') || 
             url.includes('field=isDownloadable') || 
             url.includes('field=keyVisual') || 
             url.includes('field=audit') || 
             url.includes('field=watermark') ||
             url.includes('field=orientation') ||
             url.includes('field=duration') ||
             url.includes('field=resolution') ||
             url.includes('field=dpi') ||
             url.includes('field=dateCreated') ||
             url.includes('field=datePublished') ||
             url.includes('field=dateArchived') ||
             url.includes('field=scheduledArchiveDate') ||
             url.includes('field=userCreated') ||
             url.includes('field=type')) &&
            (url.includes('filterType=add') || url.includes('filterType=remove'))) {
            return true;
        }
        
        // Also check for reset/clear requests (case insensitive)
        if (url.includes('/search/assets/') && 
            (url.includes('resetSearch=true') || 
             url.toLowerCase().includes('resetsearch') ||
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
            
            // Check for reset/clear all filters
            if (params.get('resetSearch') === 'true' || 
                params.has('resetSearch') || 
                params.has('resetsearch') ||
                url.toLowerCase().includes('resetsearch') || 
                url.includes('clearfilters') || 
                params.get('reset') === 'true') {
                
                console.log('🧹 Reset/clear filters detected');
                
                // Clear all filters for this tab
                if (this.filterState.has(tabId)) {
                    const tabState = this.filterState.get(tabId);
                    tabState.activeFilters.clear();
                    tabState.timestamp = Date.now();
                    tabState.lastResetTime = Date.now(); // Track when filters were reset
                    this.saveFilterState();
                }
                
                // Notify popup to refresh
                chrome.runtime.sendMessage({
                    action: 'filtersCleared',
                    tabId: tabId
                }).catch(() => {
                    // Popup might not be open, that's ok
                });
                
                return;
            }

            const field = params.get('field');
            let value = params.get('value');
            const filterType = params.get('filterType');
            
            // Handle array values (for custom date ranges, resolution, etc.)
            const allValues = params.getAll('value[]');
            if (allValues.length > 0) {
                // Skip custom date ranges and custom resolution to prevent broken URLs
                if (field === 'dateCreated' || field === 'datePublished' || field === 'dateArchived' || field === 'scheduledArchiveDate' || field === 'resolution') {
                    console.log('⚠️ Skipping custom range filter to prevent broken URL:', { field, values: allValues });
                    return; // Skip this filter entirely
                }
                value = allValues.join(' - '); // Display range as "start - end" for other array values
                console.log('📊 Array values detected:', allValues);
            }

            console.log('🔍 Extracted params:', { field, value, filterType, arrayValues: allValues });

            if (!field || !filterType) {
                console.log('❌ Missing required params - skipping');
                return;
            }
            
            // For remove operations, value can be empty (means remove all of that type)
            if (filterType === 'add' && !value) {
                console.log('❌ Add operation requires value - skipping');
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
                        value: value,
                        tagType: 'manual'
                    };
                } else if (field === 'autotags') {
                    filterData = {
                        type: 'tag',
                        value: value,
                        tagType: 'automated'
                    };
                } else if (field === 'text' || field === 'singletext') {
                    filterData = {
                        type: 'search',
                        value: value
                    };
                } else if (
                    field === 'isActive' || 
                    field === 'archive' || 
                    field === 'isPublic' || 
                    field === 'isDownloadable' || 
                    field === 'keyVisual' || 
                    field === 'audit' || 
                    field === 'watermark' ||
                    field === 'orientation' ||
                    field === 'duration' ||
                    field === 'resolution' ||
                    field === 'dpi' ||
                    field === 'dateCreated' ||
                    field === 'datePublished' ||
                    field === 'dateArchived' ||
                    field === 'scheduledArchiveDate' ||
                    field === 'userCreated' ||
                    field === 'type'
                ) {
                    // Advanced Rights and other advanced filters
                    console.log(`📊 Advanced filter detected in network request: ${field}=${value}`);
                    filterData = {
                        type: 'status',
                        field: field,
                        value: value
                    };
                }

                if (filterData) {
                    tabState.activeFilters.set(filterKey, filterData);
                }
                
            } else if (filterType === 'remove') {
                console.log(`➖ Removing filter: ${filterKey}`);
                console.log(`📋 Field: ${field}, Value: "${value}", Value length: ${value.length}`);
                
                if (field === 'singletext' && value === '') {
                    // Special case: removing all keywords (search bar X button)
                    console.log('🧹 Clearing all keywords from search bar');
                    console.log('📊 Current filters before removal:', Array.from(tabState.activeFilters.entries()));
                    
                    // Remove all search filters
                    const filtersToRemove = [];
                    for (const [key, data] of tabState.activeFilters) {
                        if (data.type === 'search') {
                            filtersToRemove.push(key);
                            console.log(`🗑️ Will remove search filter: ${key}`);
                        }
                    }
                    filtersToRemove.forEach(key => {
                        console.log(`🗑️ Removing: ${key}`);
                        tabState.activeFilters.delete(key);
                    });
                    
                    console.log('📊 Current filters after removal:', Array.from(tabState.activeFilters.entries()));
                } else {
                    // Regular single filter removal
                    console.log(`🗑️ Removing single filter: ${filterKey}`);
                    tabState.activeFilters.delete(filterKey);
                }
                
                // Update timestamp
                tabState.timestamp = Date.now();
                
                // Notify popup to refresh
                chrome.runtime.sendMessage({
                    action: 'filtersChanged',
                    tabId: tabId
                }).catch(() => {
                    // Popup might not be open, that's ok
                });
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
                    filters.tags.push({ 
                        value: filterData.value,
                        tagType: filterData.tagType || 'manual' // default to manual for backward compatibility
                    });
                    break;
                case 'search':
                    filters.search.push({ value: filterData.value });
                    break;
                case 'status':
                    filters.status.push({
                        field: filterData.field,
                        value: filterData.value
                    });
                    console.log('📊 Including Advanced Rights filter in response:', filterData);
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

    parseFiltersFromSearchUrl(url, tabId) {
        console.log('🔍 Parsing filters from search URL:', url.toString());
        
        // Initialize tab state if it doesn't exist
        if (!this.filterState.has(tabId)) {
            this.filterState.set(tabId, {
                portalUrl: url.hostname,
                timestamp: Date.now(),
                activeFilters: new Map()
            });
        }
        
        const tabState = this.filterState.get(tabId);
        tabState.timestamp = Date.now();
        
        // Clear existing filters if resetsearch is present (handle both resetsearch and resetsearch=)
        if (url.search.includes('resetsearch')) {
            console.log('🧹 Resetting filters due to resetsearch parameter');
            tabState.activeFilters.clear();
        }
        
        // Parse URL parameters in groups of field/value/filterType
        const params = url.searchParams;
        const entries = Array.from(params.entries());
        
        for (let i = 0; i < entries.length; i++) {
            const [key, value] = entries[i];
            
            if (key === 'field') {
                // Look for corresponding value and filterType
                let fieldValue = null;
                let filterType = 'add'; // default
                let arrayValues = [];
                
                // Check next parameters
                for (let j = i + 1; j < entries.length && j < i + 5; j++) {
                    const [nextKey, nextValue] = entries[j];
                    if (nextKey === 'value' && !fieldValue) {
                        fieldValue = nextValue;
                    } else if (nextKey === 'value[]') {
                        arrayValues.push(nextValue);
                    } else if (nextKey === 'filterType') {
                        filterType = nextValue;
                        break; // We have all we need
                    }
                }
                
                // Use array values if available, but skip custom date ranges
                if (arrayValues.length > 0) {
                    if (value === 'dateCreated' || value === 'datePublished' || value === 'dateArchived' || value === 'scheduledArchiveDate' || value === 'resolution') {
                        console.log('⚠️ Skipping custom range filter from URL to prevent broken links:', { field: value, values: arrayValues });
                        continue; // Skip this filter entirely
                    }
                    fieldValue = arrayValues.join(' - ');
                }
                
                if (fieldValue && filterType === 'add') {
                    const filterKey = `${value}:${fieldValue}`;
                    console.log(`➕ Adding filter from URL: ${filterKey}`);
                    
                    let filterData;
                    if (value.startsWith('metaproperty_')) {
                        const propertyName = value.replace('metaproperty_', '').replace(/_/g, ' ');
                        filterData = {
                            type: 'metaproperty',
                            property: propertyName,
                            value: fieldValue,
                            rawProperty: value.replace('metaproperty_', '')
                        };
                    } else if (value === 'tags') {
                        filterData = {
                            type: 'tag',
                            value: fieldValue,
                            tagType: 'manual'
                        };
                    } else if (value === 'autotags') {
                        filterData = {
                            type: 'tag',
                            value: fieldValue,
                            tagType: 'automated'
                        };
                    } else if (value === 'text' || value === 'singletext') {
                        filterData = {
                            type: 'search',
                            value: fieldValue
                        };
                    } else if (
                        value === 'isActive' || 
                        value === 'archive' || 
                        value === 'isPublic' || 
                        value === 'isDownloadable' || 
                        value === 'keyVisual' || 
                        value === 'audit' || 
                        value === 'watermark' ||
                        value === 'orientation' ||
                        value === 'duration' ||
                        value === 'resolution' ||
                        value === 'dpi' ||
                        value === 'dateCreated' ||
                        value === 'datePublished' ||
                        value === 'dateArchived' ||
                        value === 'scheduledArchiveDate' ||
                        value === 'userCreated' ||
                        value === 'type'
                    ) {
                        // Advanced Rights and other advanced filters
                        console.log(`📊 Advanced filter detected: ${value}=${fieldValue}`);
                        filterData = {
                            type: 'status',
                            field: value,
                            value: fieldValue
                        };
                    }
                    
                    if (filterData) {
                        tabState.activeFilters.set(filterKey, filterData);
                        console.log(`✅ Filter added to state:`, filterData);
                    } else {
                        console.log(`⚠️ Unknown filter type: ${value}`);
                    }
                }
            }
        }
        
        console.log('✅ Parsed filters from URL:', tabState.activeFilters.size, 'filters found');
        console.log('📊 Current filter state for tab:', {
            tabId,
            filters: Array.from(tabState.activeFilters.entries())
        });
        this.saveFilterState();
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
            console.log('🔄 Tab update:', { tabId, url: changeInfo.url, fullUrl: tab.url });
            
            if (changeInfo.url && tab.url) {
                const url = new URL(tab.url);
                const searchParams = new URLSearchParams(url.search);
                
                // Check if this is a Bynder URL with filter parameters
                if (url.search.includes('field=') && url.search.includes('filterType=')) {
                    // Check if filters were recently reset for this tab
                    const tabState = this.filterState.get(tabId);
                    if (tabState && tabState.lastResetTime) {
                        const timeSinceReset = Date.now() - tabState.lastResetTime;
                        if (timeSinceReset < 3000) { // 3 second grace period after reset
                            console.log('⏸️ Ignoring URL filter parsing - filters were recently reset');
                            return;
                        }
                    }
                    
                    console.log('🔍 Detected Bynder filter URL, parsing filters:', url.toString());
                    this.parseFiltersFromSearchUrl(url, tabId);
                    return;
                }
                
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
                    
                    console.log('🔍 Navigation to clean media page detected:', {
                        tabId,
                        hasState: this.filterState.has(tabId),
                        activeFilters: tabState?.activeFilters?.size || 0,
                        url: url.toString()
                    });
                    
                    // This could be a clear action for status-only filters
                    // Send a message to any open popups to refresh
                    chrome.runtime.sendMessage({
                        action: 'urlChanged',
                        tabId: tabId,
                        url: url.toString()
                    }).catch(() => {
                        // Popup might not be open, that's ok
                    });
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