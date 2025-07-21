class PopupManager {
    constructor() {
        this.elements = {
            loading: document.getElementById('loading'),
            notBynder: document.getElementById('not-bynder'),
            filtersDetected: document.getElementById('filters-detected'),
            filterCount: document.getElementById('filter-count'),
            generatedUrl: document.getElementById('generated-url'),
            openBtn: document.getElementById('open-btn'),
            copyBtn: document.getElementById('copy-btn'),
            filterUrlToggle: document.getElementById('filter-url-toggle'),
            filterUrlContent: document.getElementById('filter-url-content'),
            predictableUrlSection: document.getElementById('predictable-url-section'),
            predictableUrlToggle: document.getElementById('predictable-url-toggle'),
            predictableUrlContent: document.getElementById('predictable-url-content'),
            predictableUrl: document.getElementById('predictable-url'),
            predictableFilterCount: document.getElementById('predictable-filter-count'),
            predictableOpenBtn: document.getElementById('predictable-open-btn'),
            predictableCopyBtn: document.getElementById('predictable-copy-btn')
        };

        this.currentPortalUrl = null;
        this.currentFilters = null;
        this.filterUrlExpanded = true;
        this.predictableUrlExpanded = false;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadPreferences();
        // Don't load saved status actions - they should be tab-specific
        this.detectFilters();
    }

    async loadPreferences() {
        try {
            const result = await chrome.storage.local.get(['filterUrlExpanded', 'predictableUrlExpanded']);
            if (result.filterUrlExpanded !== undefined) {
                this.filterUrlExpanded = result.filterUrlExpanded;
            }
            if (result.predictableUrlExpanded !== undefined) {
                this.predictableUrlExpanded = result.predictableUrlExpanded;
            }
        } catch (error) {
            console.error('Error loading preferences:', error);
        }
    }

    setupEventListeners() {
        this.elements.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.elements.openBtn.addEventListener('click', () => this.openUrl());
        
        // Predictable URL buttons
        this.elements.predictableCopyBtn?.addEventListener('click', () => this.copyPredictableUrl());
        this.elements.predictableOpenBtn?.addEventListener('click', () => this.openPredictableUrl());
        
        // Toggle buttons
        this.elements.filterUrlToggle?.addEventListener('click', () => this.toggleFilterUrl());
        this.elements.predictableUrlToggle?.addEventListener('click', () => this.togglePredictableUrl());
        
        // Setup info button
        const infoBtn = document.getElementById('info-btn');
        const infoTooltip = document.getElementById('info-tooltip');
        
        infoBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            const isVisible = infoTooltip.style.display !== 'none';
            infoTooltip.style.display = isVisible ? 'none' : 'block';
            
            // Toggle active state for button styling
            if (isVisible) {
                infoBtn.classList.remove('active');
            } else {
                infoBtn.classList.add('active');
            }
        });
        
        // Close tooltip when clicking outside
        document.addEventListener('click', (e) => {
            if (!infoBtn?.contains(e.target) && !infoTooltip?.contains(e.target)) {
                if (infoTooltip) {
                    infoTooltip.style.display = 'none';
                    infoBtn?.classList.remove('active');
                }
            }
        });
        
        // Listen for URL changes from background script
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'urlChanged' || request.action === 'filtersCleared' || request.action === 'filtersChanged') {
                console.log('📍 Filters changed, refreshing...');
                // Re-detect filters when URL changes or filters are cleared
                this.detectFilters();
            }
        });
    }

    async detectFilters() {
        this.showLoading();

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            // Only work on pages with /media/ in the URL (actual Bynder portals)
            if (!tab.url.includes('/media/')) {
                this.showNotBynder();
                return;
            }

            // Request filter data from background script
            const results = await chrome.runtime.sendMessage({ action: 'getFilters' });
            console.log('📥 Received filter data:', results);
            
            // Always show the main UI if we have a portal URL
            if (results && results.portalUrl) {
                const filters = results.filters || { metaproperties: [], tags: [], search: [], status: [] };
                this.displayFilters(filters, results.portalUrl);
            } else {
                this.showNotBynder();
            }
        } catch (error) {
            console.error('❌ Error detecting filters:', error);
            this.showNotBynder();
        }
    }

    showLoading() {
        this.hideAllSections();
        this.elements.loading.style.display = 'block';
    }

    showNotBynder() {
        this.hideAllSections();
        this.elements.notBynder.style.display = 'block';
    }

    hideAllSections() {
        this.elements.loading.style.display = 'none';
        this.elements.notBynder.style.display = 'none';
        this.elements.filtersDetected.style.display = 'none';
    }

    displayFilters(filters, portalUrl) {
        this.hideAllSections();
        this.elements.filtersDetected.style.display = 'block';
        
        this.currentPortalUrl = portalUrl;
        this.currentFilters = filters;

        // Update filter count display
        this.updateFilterCount(filters);

        // Update the generated URL with all filters
        this.updateGeneratedUrl();
        
        // Update predictable URL (only if there are metaproperties)
        this.updatePredictableUrl();
        
        // Apply saved toggle states
        this.applyToggleStates();
    }

    
    updateGeneratedUrl() {
        // Check if we have any active filters
        const hasActiveFilters = this.currentFilters && (
            (this.currentFilters.metaproperties && this.currentFilters.metaproperties.length > 0) ||
            (this.currentFilters.tags && this.currentFilters.tags.length > 0) ||
            (this.currentFilters.search && this.currentFilters.search.length > 0) ||
            (this.currentFilters.status && this.currentFilters.status.length > 0)
        );

        if (hasActiveFilters) {
            // Generate URL with all filters including Advanced Rights
            const generatedUrl = this.generateUrl(this.currentPortalUrl, this.currentFilters);
            this.elements.generatedUrl.value = generatedUrl;
        } else {
            // No filters - show base URL
            this.elements.generatedUrl.value = `https://${this.currentPortalUrl}/media/`;
        }
    }

    updateFilterCount(filters) {
        if (!filters) {
            this.elements.filterCount.textContent = 'No filters active';
            return;
        }

        console.log('📊 Updating filter count with filters:', filters);

        const metapropertyCount = filters.metaproperties?.length || 0;
        const manualTagCount = filters.tags?.filter(tag => tag.tagType === 'manual').length || 0;
        const automatedTagCount = filters.tags?.filter(tag => tag.tagType === 'automated').length || 0;
        const keywordCount = filters.search?.length || 0;
        const advancedRightsCount = filters.status?.length || 0;
        
        console.log('📊 Filter counts:', {
            metapropertyCount,
            manualTagCount,
            automatedTagCount,
            keywordCount,
            advancedRightsCount,
            totalTags: filters.tags?.length || 0
        });
        
        const totalCount = metapropertyCount + manualTagCount + automatedTagCount + keywordCount + advancedRightsCount;
        
        if (totalCount === 0) {
            this.elements.filterCount.textContent = 'No filters active';
            return;
        }
        
        const parts = [];
        
        if (metapropertyCount > 0) {
            parts.push(`${metapropertyCount} option${metapropertyCount === 1 ? '' : 's'}`);
        }
        
        if (manualTagCount > 0) {
            parts.push(`${manualTagCount} manual tag${manualTagCount === 1 ? '' : 's'}`);
        }
        
        if (automatedTagCount > 0) {
            parts.push(`${automatedTagCount} automated tag${automatedTagCount === 1 ? '' : 's'}`);
        }
        
        if (keywordCount > 0) {
            parts.push(`${keywordCount} keyword${keywordCount === 1 ? '' : 's'}`);
        }
        
        if (advancedRightsCount > 0) {
            parts.push(`${advancedRightsCount} advanced filter${advancedRightsCount === 1 ? '' : 's'}`);
        }
        
        this.elements.filterCount.textContent = parts.join(' + ');
    }

    generateUrl(portalUrl, filters) {
        const params = [];
        let hasFilters = false;

        // Add ALL metaproperties
        if (filters.metaproperties && filters.metaproperties.length > 0) {
            hasFilters = true;
            filters.metaproperties.forEach(meta => {
                const field = meta.rawProperty || meta.property;
                params.push(`field=metaproperty_${field}&value=${meta.value}&filterType=add`);
            });
        }

        // Add ALL tags (manual and automated)
        if (filters.tags && filters.tags.length > 0) {
            hasFilters = true;
            filters.tags.forEach(tag => {
                const fieldName = tag.tagType === 'automated' ? 'autotags' : 'tags';
                params.push(`field=${fieldName}&value=${tag.value}&filterType=add`);
            });
        }

        // Add ALL search terms
        if (filters.search && filters.search.length > 0) {
            hasFilters = true;
            filters.search.forEach(search => {
                params.push(`field=text&value=${search.value}&filterType=add`);
            });
        }

        // Add ALL Advanced Rights (status filters)
        if (filters.status && filters.status.length > 0) {
            hasFilters = true;
            filters.status.forEach(status => {
                params.push(`field=${status.field}&value=${status.value}&filterType=add`);
            });
        }

        // Construct URL with all filters
        if (hasFilters && params.length > 0) {
            // Determine endpoint based on filter types
            const hasMetaproperties = filters.metaproperties && filters.metaproperties.length > 0;
            const endpoint = hasMetaproperties ? '/search/set/' : '/search/media/';
            
            // Join all parameters
            const queryString = params.join('&');
            const generatedUrl = `https://${portalUrl}${endpoint}?resetsearch&${queryString}`;
            
            return generatedUrl;
        } else {
            // No filters, return base URL
            const baseUrl = `https://${portalUrl}/media/`;
            return baseUrl;
        }
    }

    generatePredictableUrl(portalUrl, filters) {
        // Only use metaproperties (options) for predictable URL
        if (!filters.metaproperties || filters.metaproperties.length === 0) {
            return `https://${portalUrl}/match/`;
        }

        let pathSegments = ['match'];
        
        // Add each metaproperty/option pair to the URL path
        filters.metaproperties.forEach(meta => {
            const propertyName = meta.rawProperty || meta.property;
            // Encode the values to handle special characters and spaces
            pathSegments.push(encodeURIComponent(propertyName));
            pathSegments.push(encodeURIComponent(meta.value));
        });

        // Build the final URL with trailing slash
        const predictableUrl = `https://${portalUrl}/${pathSegments.join('/')}/`;
        return predictableUrl;
    }

    updatePredictableUrl() {
        // Only show predictable URL section if there are metaproperties
        if (this.currentFilters && this.currentFilters.metaproperties && this.currentFilters.metaproperties.length > 0) {
            const predictableUrl = this.generatePredictableUrl(this.currentPortalUrl, this.currentFilters);
            this.elements.predictableUrl.value = predictableUrl;
            this.elements.predictableUrlSection.style.display = 'block';
            
            // Update the predictable filter count
            const optionCount = this.currentFilters.metaproperties.length;
            this.elements.predictableFilterCount.textContent = `${optionCount} option${optionCount === 1 ? '' : 's'}`;
        } else {
            this.elements.predictableUrlSection.style.display = 'none';
            this.predictableUrlExpanded = false;
        }
    }

    applyToggleStates() {
        // Apply filter URL toggle state
        if (!this.filterUrlExpanded) {
            this.elements.filterUrlContent.style.display = 'none';
            this.elements.filterUrlToggle.classList.add('collapsed');
        } else {
            this.elements.filterUrlContent.style.display = 'block';
            this.elements.filterUrlToggle.classList.remove('collapsed');
        }
        
        // Apply predictable URL toggle state
        if (!this.predictableUrlExpanded) {
            this.elements.predictableUrlContent.style.display = 'none';
            this.elements.predictableUrlToggle.classList.add('collapsed');
        } else {
            this.elements.predictableUrlContent.style.display = 'block';
            this.elements.predictableUrlToggle.classList.remove('collapsed');
        }
    }

    toggleFilterUrl() {
        this.filterUrlExpanded = !this.filterUrlExpanded;
        
        if (this.filterUrlExpanded) {
            this.elements.filterUrlContent.style.display = 'block';
            this.elements.filterUrlToggle.classList.remove('collapsed');
        } else {
            this.elements.filterUrlContent.style.display = 'none';
            this.elements.filterUrlToggle.classList.add('collapsed');
        }
        
        // Save the preference
        chrome.storage.local.set({ filterUrlExpanded: this.filterUrlExpanded });
    }

    togglePredictableUrl() {
        this.predictableUrlExpanded = !this.predictableUrlExpanded;
        
        if (this.predictableUrlExpanded) {
            this.elements.predictableUrlContent.style.display = 'block';
            this.elements.predictableUrlToggle.classList.remove('collapsed');
        } else {
            this.elements.predictableUrlContent.style.display = 'none';
            this.elements.predictableUrlToggle.classList.add('collapsed');
        }
        
        // Save the preference
        chrome.storage.local.set({ predictableUrlExpanded: this.predictableUrlExpanded });
    }

    openUrl() {
        const url = this.elements.generatedUrl.value;
        if (url) {
            chrome.tabs.create({ url: url });
        }
    }

    openPredictableUrl() {
        const url = this.elements.predictableUrl.value;
        if (url) {
            chrome.tabs.create({ url: url });
        }
    }

    async copyToClipboard() {
        try {
            await navigator.clipboard.writeText(this.elements.generatedUrl.value);
            
            const originalText = this.elements.copyBtn.innerHTML;
            this.elements.copyBtn.innerHTML = '<span class="copy-icon">✓</span>';
            this.elements.copyBtn.classList.add('copied');
            
            setTimeout(() => {
                this.elements.copyBtn.innerHTML = originalText;
                this.elements.copyBtn.classList.remove('copied');
            }, 1500);
        } catch (error) {
            console.error('Failed to copy:', error);
            this.elements.generatedUrl.select();
            document.execCommand('copy');
        }
    }

    async copyPredictableUrl() {
        try {
            await navigator.clipboard.writeText(this.elements.predictableUrl.value);
            
            const originalText = this.elements.predictableCopyBtn.innerHTML;
            this.elements.predictableCopyBtn.innerHTML = '<span class="copy-icon">✓</span>';
            this.elements.predictableCopyBtn.classList.add('copied');
            
            setTimeout(() => {
                this.elements.predictableCopyBtn.innerHTML = originalText;
                this.elements.predictableCopyBtn.classList.remove('copied');
            }, 1500);
        } catch (error) {
            console.error('Failed to copy:', error);
            this.elements.predictableUrl.select();
            document.execCommand('copy');
        }
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});