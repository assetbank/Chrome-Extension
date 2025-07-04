class PopupManager {
    constructor() {
        this.elements = {
            loading: document.getElementById('loading'),
            notBynder: document.getElementById('not-bynder'),
            noFilters: document.getElementById('no-filters'),
            filtersDetected: document.getElementById('filters-detected'),
            portalUrl: document.getElementById('portal-url'),
            generatedUrl: document.getElementById('generated-url'),
            copyBtn: document.getElementById('copy-btn'),
            refreshBtn: document.getElementById('refresh-btn')
        };

        this.currentPortalUrl = null;
        this.currentFilters = null;
        this.selectedStatusActions = new Set();

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.detectFilters();
    }

    setupEventListeners() {
        this.elements.copyBtn.addEventListener('click', () => this.copyToClipboard());
        this.elements.refreshBtn.addEventListener('click', () => this.detectFilters());
        
        // Setup status button click handlers
        document.querySelectorAll('.btn-status').forEach(btn => {
            btn.addEventListener('click', (e) => this.handleStatusClick(e));
        });
    }

    async detectFilters() {
        console.log('📋 Starting filter detection...');
        this.showLoading();

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab.url.includes('.bynder.com')) {
                this.showNotBynder();
                return;
            }

            // Request filter data from background script
            const results = await chrome.runtime.sendMessage({ action: 'getFilters' });
            
            console.log('📊 Results from background:', results);
            console.log('📊 Has filters check:', results?.hasFilters);
            console.log('📊 Filters data:', results?.filters);
            
            if (results && results.hasFilters) {
                console.log('✅ Displaying filters');
                this.displayFilters(results.filters, results.portalUrl);
            } else {
                console.log('❌ No filters to display');
                this.showNoFilters();
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

    showNoFilters() {
        this.hideAllSections();
        this.elements.noFilters.style.display = 'block';
    }

    hideAllSections() {
        this.elements.loading.style.display = 'none';
        this.elements.notBynder.style.display = 'none';
        this.elements.noFilters.style.display = 'none';
        this.elements.filtersDetected.style.display = 'none';
    }

    displayFilters(filters, portalUrl) {
        console.log('📺 Displaying filters:', filters);
        this.hideAllSections();
        this.elements.filtersDetected.style.display = 'block';
        
        this.currentPortalUrl = portalUrl;
        this.currentFilters = filters;
        this.elements.portalUrl.textContent = portalUrl;

        // Generate and display URL
        const generatedUrl = this.generateUrl(portalUrl, filters);
        this.elements.generatedUrl.value = generatedUrl;
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
    }
    
    updateGeneratedUrl() {
        // Start with existing filters if any
        let baseUrl = '';
        if (this.currentFilters) {
            baseUrl = this.generateUrl(this.currentPortalUrl, this.currentFilters);
        } else {
            baseUrl = `https://${this.currentPortalUrl}/media/`;
        }
        
        // Parse the base URL to add status filters
        const urlObj = new URL(baseUrl);
        
        // Add each selected status action
        this.selectedStatusActions.forEach(statusKey => {
            const [field, value] = statusKey.split(':');
            // Append status filters to existing URL
            if (urlObj.search) {
                urlObj.search += `&field=${field}&value=${value}`;
            } else {
                urlObj.search = `?field=${field}&value=${value}`;
            }
        });
        
        this.elements.generatedUrl.value = urlObj.toString();
        console.log('🔗 Generated URL with status actions:', urlObj.toString());
    }

    generateUrl(portalUrl, filters) {
        const params = [];
        let hasMetaproperties = false;

        // Add metaproperties
        if (filters.metaproperties && filters.metaproperties.length > 0) {
            hasMetaproperties = true;
            const meta = filters.metaproperties[0]; // Take first metaproperty
            const field = meta.rawProperty || meta.property;
            params.push(`field=metaproperty_${field}&value=${meta.value}&filterType=add`);
        }

        // Add other filters (tags, search)
        if (filters.tags && filters.tags.length > 0) {
            const tag = filters.tags[0]; // Take first tag
            params.push(`field=tags&value=${tag.value}&filterType=add`);
        }

        if (filters.search && filters.search.length > 0) {
            const search = filters.search[0]; // Take first search term
            params.push(`field=text&value=${search.value}&filterType=add`);
        }

        // Choose endpoint and construct URL according to project format
        if (hasMetaproperties) {
            const meta = filters.metaproperties[0];
            const field = meta.rawProperty || meta.property;
            const generatedUrl = `https://${portalUrl}/search/set/?resetsearch&field=metaproperty_${field}&value=${meta.value}&filterType=add`;
            console.log('🔗 Generated URL:', generatedUrl);
            return generatedUrl;
        } else {
            // For non-metaproperty filters, use /search/media/ endpoint
            let field, value;
            if (filters.tags && filters.tags.length > 0) {
                field = 'tags';
                value = filters.tags[0].value;
            } else if (filters.search && filters.search.length > 0) {
                field = 'text';
                value = filters.search[0].value;
            }
            
            const generatedUrl = `https://${portalUrl}/search/media/?resetsearch&field=${field}&value=${value}&filterType=add`;
            console.log('🔗 Generated URL:', generatedUrl);
            return generatedUrl;
        }
    }

    sanitizeProperty(property) {
        return property.replace(/[^a-zA-Z0-9-]/g, "_");
    }

    sanitizeValue(value) {
        return value.replace(/[^a-zA-Z0-9-]/g, "_");
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