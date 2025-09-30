/**
 * Knowledge Source Priorities Manager - Standalone Component
 * For V2 Knowledge Source Priorities tab
 */

class KnowledgePrioritiesManager {
    constructor(containerId, apiBaseUrl, companyId) {
        this.container = document.getElementById(containerId);
        this.apiBaseUrl = apiBaseUrl;
        this.companyId = companyId;
        this.config = {};
        this.sourcesOrder = ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'];
        this.init();
    }

    init() {
        // Load current config
        this.loadConfig();

        // Wire buttons
        const optimizeBtn = document.getElementById('optimizeNowBtn');
        if (optimizeBtn) {
            optimizeBtn.addEventListener('click', () => this.optimizeNow());
        }

        const saveBtn = document.getElementById('savePrioritiesBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.saveConfig());
        }

        const autoToggle = document.getElementById('autoOptimizeToggle');
        if (autoToggle) {
            autoToggle.addEventListener('change', (e) => {
                this.config.autoOptimization.enabled = e.target.checked;
                this.saveConfig(); // Auto-save toggle
            });
        }

        // Sliders for thresholds
        const sliders = ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'];
        sliders.forEach(source => {
            const slider = document.getElementById(`${source}-slider`);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    this.config[source].threshold = e.target.value / 100;
                    const label = document.getElementById(`${source}-threshold-label`);
                    if (label) label.textContent = `${e.target.value}%`;
                });
            }
        });

        // Drag-drop using Sortable (assume loaded)
        const priorityList = document.getElementById('priorityList');
        if (priorityList && typeof Sortable !== 'undefined') {
            new Sortable(priorityList, {
                animation: 150,
                onEnd: (evt) => {
                    this.updateOrder();
                    this.saveConfig();
                }
            });
        } else {
            console.warn('Sortable not loaded or list not found');
        }
    }

    async loadConfig() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/priorities`, {
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to load config');

            const result = await response.json();
            this.config = result.data || {};
            this.renderConfig();
        } catch (error) {
            console.error('Load config error:', error);
            this.showError('Failed to load priorities');
        }
    }

    renderConfig() {
        // Metrics
        document.getElementById('metricsAccuracy').textContent = '94%'; // Demo; fetch real if API
        document.getElementById('sourcesCount').textContent = this.config.sources || 4;
        const activeEl = document.getElementById('activeStatus');
        if (activeEl) activeEl.textContent = this.config.autoOptimization?.enabled ? 'Active' : 'Disabled';

        // Priority list
        const priorityList = document.getElementById('priorityList');
        if (priorityList) {
            priorityList.innerHTML = '';
            this.sourcesOrder.forEach(source => {
                if (this.config[source]?.enabled !== false) {
                    const li = document.createElement('li');
                    li.className = 'sortable-item';
                    li.dataset.source = source;
                    li.innerHTML = `
                        <span>${source.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}</span>
                        <small>Threshold: <span id="${source}-threshold-label">${(this.config[source]?.threshold * 100 || 0).toFixed(0)}%</span></small>
                    `;
                    priorityList.appendChild(li);
                }
            });
        }

        // Sliders
        const sliders = ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'];
        sliders.forEach(source => {
            const slider = document.getElementById(`${source}-slider`);
            const value = (this.config[source]?.threshold * 100 || 0);
            if (slider) {
                slider.value = value;
                const label = document.getElementById(`${source}-threshold-label`);
                if (label) label.textContent = `${value}%`;
            }
        });

        // Toggle
        const autoToggle = document.getElementById('autoOptimizeToggle');
        if (autoToggle) autoToggle.checked = this.config.autoOptimization?.enabled || false;
    }

    async saveConfig() {
        // Collect sliders
        const sliders = ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'];
        sliders.forEach(source => {
            const slider = document.getElementById(`${source}-slider`);
            if (slider) this.config[source].threshold = parseFloat(slider.value) / 100;
        });

        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/priorities`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.config)
            });

            if (response.ok) {
                const result = await response.json();
                this.config = result.data;
                this.showSuccess('Priorities saved');
                this.renderConfig();
            } else {
                throw new Error('Save failed');
            }
        } catch (error) {
            console.error('Save error:', error);
            this.showError('Failed to save priorities');
        }
    }

    async optimizeNow() {
        const optimizeBtn = document.getElementById('optimizeNowBtn');
        const originalText = optimizeBtn.textContent;
        optimizeBtn.textContent = 'Optimizing...';
        optimizeBtn.disabled = true;

        try {
            const response = await fetch(`${this.apiBaseUrl}/company/${this.companyId}/priorities/optimize-now`, {
                method: 'POST',
                credentials: 'include'
            });

            if (response.ok) {
                const result = await response.json();
                this.config = result.data;
                this.showSuccess('Thresholds optimized!');
                this.renderConfig();
            } else {
                throw new Error('Optimization failed');
            }
        } catch (error) {
            console.error('Optimize error:', error);
            this.showError('Optimization failed');
        } finally {
            optimizeBtn.textContent = originalText;
            optimizeBtn.disabled = false;
        }
    }

    updateOrder() {
        const listItems = document.querySelectorAll('#priorityList .sortable-item');
        this.sourcesOrder = Array.from(listItems).map(li => li.dataset.source).filter(Boolean);
        console.log('Updated order:', this.sourcesOrder);
    }

    showSuccess(message) {
        const toast = document.getElementById('successToast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 3000);
        } else {
            alert('Success: ' + message);
        }
    }

    showError(message) {
        const toast = document.getElementById('errorToast');
        if (toast) {
            toast.textContent = message;
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 5000);
        } else {
            alert('Error: ' + message);
        }
    }
}

// Export
if (typeof module !== 'undefined' && module.exports) {
    module.exports = KnowledgePrioritiesManager;
}
