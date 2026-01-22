// ============================================================================
// 📋 REGISTRY MANAGER - Notification Points
// ============================================================================

class RegistryManager {
    constructor(notificationCenter) {
        this.nc = notificationCenter;
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        const validateBtn = document.getElementById('validate-all-btn');
        if (validateBtn) {
            validateBtn.addEventListener('click', () => this.validateAll());
        }
    }
    
    async load() {
        console.log('📋 [REGISTRY] Loading registry...');
        
        try {
            const data = await this.nc.apiGet('/api/admin/notifications/registry');
            
            if (data.success) {
                this.renderRegistry(data.data.notificationPoints, data.data.summary);
            }
            
        } catch (error) {
            console.error('❌ [REGISTRY] Load failed:', error);
        }
    }
    
    renderRegistry(grouped, summary) {
        const container = document.getElementById('registry-container');
        
        const categories = ['SYSTEM', 'TWILIO', 'AI_AGENT', 'SPAM_FILTER', 'DATABASE', 'API', 'OTHER'];
        
        let html = `
            <div class="mb-6 p-4 bg-blue-50 rounded-lg">
                <div class="flex justify-between items-center">
                    <div>
                        <span class="text-lg font-semibold">Total: ${summary.total}</span>
                        <span class="ml-4 text-green-600">✅ Valid: ${summary.valid}</span>
                        <span class="ml-4 text-red-600">❌ Invalid: ${summary.invalid}</span>
                    </div>
                    <div class="text-2xl font-bold">${summary.percentage}%</div>
                </div>
            </div>
        `;
        
        categories.forEach(category => {
            const points = grouped[category] || [];
            if (points.length === 0) return;
            
            html += `
                <div class="mb-6">
                    <h4 class="text-lg font-semibold text-gray-700 mb-3">${category.replace('_', ' ')}</h4>
                    <div class="space-y-2">
                        ${points.map(point => this.renderNotificationPoint(point)).join('')}
                    </div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    }
    
    renderNotificationPoint(point) {
        const statusIcon = point.validation?.isValid ? '✅' : '❌';
        const statusColor = point.validation?.isValid ? 'text-green-600' : 'text-red-600';
        const errorMessages = point.validation?.errorMessages || point.validation?.errors || [];
        
        return `
            <div class="p-4 border border-gray-200 rounded-lg hover:shadow-md transition">
                <div class="flex justify-between items-start">
                    <div class="flex-1">
                        <div class="flex items-center space-x-3">
                            <span class="text-2xl">${statusIcon}</span>
                            <div>
                                <h5 class="font-mono font-semibold text-gray-900">${point.code}</h5>
                                <p class="text-sm text-gray-500">${point.location?.file || 'Unknown'}:${point.location?.line || '?'}</p>
                            </div>
                        </div>
                        <div class="mt-2 flex items-center space-x-4 text-sm">
                            <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">${point.config?.severity}</span>
                            <span class="text-gray-600">Triggered: ${point.stats?.totalTriggered || 0} times</span>
                            <span class="text-gray-600">Last: ${this.nc.formatRelativeTime(point.stats?.lastTriggered)}</span>
                        </div>
                        ${errorMessages.length > 0 ? `
                            <div class="mt-2 text-sm text-red-600">
                                ${errorMessages.map(err => `<div>• ${err}</div>`).join('')}
                            </div>
                        ` : ''}
                    </div>
                    <div class="ml-4">
                        <span class="${statusColor} font-semibold">${point.validation?.isValid ? 'Valid' : 'Invalid'}</span>
                    </div>
                </div>
            </div>
        `;
    }
    
    async validateAll() {
        if (!confirm('Validate all notification points? This will test each system.')) return;
        
        try {
            this.nc.showLoading('Validating all notification points...');
            
            const result = await this.nc.apiPost('/api/admin/notifications/registry/validate', {});
            
            this.nc.hideLoading();
            
            if (result.success) {
                const summary = result.data.summary;
                alert(`✅ Validation Complete!\n\nValid: ${summary.valid}/${summary.total} (${summary.percentage}%)\nInvalid: ${summary.invalid}`);
                this.load(); // Reload registry
            }
            
        } catch (error) {
            this.nc.hideLoading();
            this.nc.showError('Validation failed');
            console.error('❌ [REGISTRY] Validate failed:', error);
        }
    }
}

