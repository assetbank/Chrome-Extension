class PopupManager {
    constructor() {
        this.elements = {
            loading: document.getElementById('loading'),
            notBynder: document.getElementById('not-bynder'),
            filtersDetected: document.getElementById('filters-detected'),
            filterCount: document.getElementById('filter-count'),
            generatedUrl: document.getElementById('generated-url'),
            openBtn: document.getElementById('open-btn'),
            copyBtn: document.getElementById('copy-btn')
        };

        this.currentPortalUrl = null;
        this.currentFilters = null;

        this.init();
    }

    async init() {
        this.setupEventListeners();
        // Don't load saved status actions - they should be tab-specific
        this.detectFilters();
    }

    setupEventListeners() {
        this.elements.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.elements.openBtn.addEventListener('click', () => this.openUrl());
        
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

    openUrl() {
        const url = this.elements.generatedUrl.value;
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
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
});