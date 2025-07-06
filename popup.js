class PopupManager {
    constructor() {
        this.elements = {
            loading: document.getElementById('loading'),
            notBynder: document.getElementById('not-bynder'),
            filtersDetected: document.getElementById('filters-detected'),
            portalUrl: document.getElementById('portal-url'),
            filterCount: document.getElementById('filter-count'),
            generatedUrl: document.getElementById('generated-url'),
            openBtn: document.getElementById('open-btn'),
            copyBtn: document.getElementById('copy-btn'),
            clearStatusBtn: document.getElementById('clear-status-btn')
        };

        this.currentPortalUrl = null;
        this.currentFilters = null;
        this.selectedStatusActions = new Set();

        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadSavedStatusActions();
        this.detectFilters();
    }

    setupEventListeners() {
        this.elements.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.elements.openBtn.addEventListener('click', () => this.openUrl());
        this.elements.clearStatusBtn.addEventListener('click', () => this.clearAllStatusActions());
        
        // Setup status button click handlers
        document.querySelectorAll('.btn-status').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleStatusClick(e));
        });
    }

    async detectFilters() {
        this.showLoading();

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('.bynder.com')) {
                this.showNotBynder();
                return;
            }

            // Request filter data from background script
            const results = await chrome.runtime.sendMessage({ action: 'getFilters' });
            
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
        this.elements.portalUrl.textContent = portalUrl;

        // Update filter count display
        this.updateFilterCount(filters);

        // Check if we have any active filters (not counting selected status actions)
        const hasActiveFilters = (filters.metaproperties && filters.metaproperties.length > 0) ||
                                (filters.tags && filters.tags.length > 0) ||
                                (filters.search && filters.search.length > 0);

        if (!hasActiveFilters && this.selectedStatusActions.size === 0) {
            // No filters active, show base URL without parameters
            this.elements.generatedUrl.value = `https://${portalUrl}/media/`;
        } else {
            // Generate and display URL with filters
            const generatedUrl = this.generateUrl(portalUrl, filters);
            this.elements.generatedUrl.value = generatedUrl;
        }
    }

    handleStatusClick(event) {
        const button = event.target.closest('.btn-status');
        if (!button) return;
        
        const field = button.dataset.field;
        const value = button.dataset.value;
        const statusKey = `${field}:${value}`;
        
        // Toggle the status action
        if (this.selectedStatusActions.has(statusKey)) {
            this.selectedStatusActions.delete(statusKey);
            button.classList.remove('selected');
        } else {
            this.selectedStatusActions.add(statusKey);
            button.classList.add('selected');
        }
        
        if (!this.currentPortalUrl) {
            // Try to get current tab's portal URL
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const tab = tabs[0];
                if (tab && tab.url.includes('.bynder.com')) {
                    const url = new URL(tab.url);
                    this.currentPortalUrl = url.hostname;
                    this.updateGeneratedUrl();
                }
            });
        } else {
            this.updateGeneratedUrl();
        }
        
        // Update filter count display when status actions change
        this.updateFilterCount(this.currentFilters);
        
        // Save status actions to storage
        this.saveStatusActions();
    }

    clearAllStatusActions() {
        
        // Clear the set
        this.selectedStatusActions.clear();
        
        // Remove selected styling from all buttons
        document.querySelectorAll('.btn-status.selected').forEach(btn => {
            btn.classList.remove('selected');
        });
        
        // Update URL and filter count
        this.updateGeneratedUrl();
        this.updateFilterCount(this.currentFilters);
        
        // Save to storage
        this.saveStatusActions();
    }
    
    updateGeneratedUrl() {
        // Check if we have any active filters
        const hasActiveFilters = this.currentFilters && (
            (this.currentFilters.metaproperties && this.currentFilters.metaproperties.length > 0) ||
            (this.currentFilters.tags && this.currentFilters.tags.length > 0) ||
            (this.currentFilters.search && this.currentFilters.search.length > 0)
        );

        // Start with base URL
        let baseUrl = `https://${this.currentPortalUrl}/media/`;
        
        // Only add filter parameters if we have filters or status actions
        if (hasActiveFilters || this.selectedStatusActions.size > 0) {
            if (hasActiveFilters) {
                baseUrl = this.generateUrl(this.currentPortalUrl, this.currentFilters);
            }
            
            // Parse the base URL to add status filters
            const urlObj = new URL(baseUrl);
            
            // If we only have status actions (no other filters), ensure we start with resetsearch
            if (!hasActiveFilters && this.selectedStatusActions.size > 0) {
                // Status actions only - start fresh with resetsearch
                const statusParams = [];
                this.selectedStatusActions.forEach(statusKey => {
                    const [field, value] = statusKey.split(':');
                    statusParams.push(`field=${field}&value=${value}&filterType=add`);
                });
                urlObj.search = `?resetsearch&${statusParams.join('&')}`;
            } else {
                // Add status actions to existing filter URL
                this.selectedStatusActions.forEach(statusKey => {
                    const [field, value] = statusKey.split(':');
                    urlObj.search += `&field=${field}&value=${value}&filterType=add`;
                });
            }
            
            this.elements.generatedUrl.value = urlObj.toString();
        } else {
            // No filters at all - just show base URL
            this.elements.generatedUrl.value = baseUrl;
        }
        
    }

    updateFilterCount(filters) {
        if (!filters) {
            this.elements.filterCount.textContent = 'No filters active';
            return;
        }

        const filterCount = (filters.metaproperties?.length || 0) + (filters.tags?.length || 0);
        const keywordCount = filters.search?.length || 0;
        const statusActionCount = this.selectedStatusActions.size;
        
        const totalCount = filterCount + keywordCount + statusActionCount;
        
        if (totalCount === 0) {
            this.elements.filterCount.textContent = 'No filters active';
            return;
        }
        
        const parts = [];
        
        if (filterCount > 0) {
            parts.push(`${filterCount} filter${filterCount === 1 ? '' : 's'}`);
        }
        
        if (keywordCount > 0) {
            parts.push(`${keywordCount} keyword${keywordCount === 1 ? '' : 's'}`);
        }
        
        if (statusActionCount > 0) {
            parts.push(`${statusActionCount} status action${statusActionCount === 1 ? '' : 's'}`);
        }
        
        this.elements.filterCount.textContent = parts.join(' + ');
    }

    async loadSavedStatusActions() {
        try {
            const result = await chrome.storage.local.get(['selectedStatusActions']);
            if (result.selectedStatusActions) {
                this.selectedStatusActions = new Set(result.selectedStatusActions);
                
                // Update UI to show selected buttons
                this.selectedStatusActions.forEach(statusKey => {
                    const [field, value] = statusKey.split(':');
                    const button = document.querySelector(`[data-field="${field}"][data-value="${value}"]`);
                    if (button) {
                        button.classList.add('selected');
                    }
                });
            }
        } catch (error) {
            console.error('❌ Error loading status actions:', error);
        }
    }

    async saveStatusActions() {
        try {
            await chrome.storage.local.set({
                selectedStatusActions: Array.from(this.selectedStatusActions)
            });
        } catch (error) {
            console.error('❌ Error saving status actions:', error);
        }
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

        // Add ALL tags
        if (filters.tags && filters.tags.length > 0) {
            hasFilters = true;
            filters.tags.forEach(tag => {
                params.push(`field=tags&value=${tag.value}&filterType=add`);
            });
        }

        // Add ALL search terms
        if (filters.search && filters.search.length > 0) {
            hasFilters = true;
            filters.search.forEach(search => {
                params.push(`field=text&value=${search.value}&filterType=add`);
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

    sanitizeProperty(property) {
        return property.replace(/[^a-zA-Z0-9-]/g, "_");
    }

    sanitizeValue(value) {
        return value.replace(/[^a-zA-Z0-9-]/g, "_");
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