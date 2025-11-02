/**
 * ============================================================================
 * ENTERPRISE TREND CHARTS - TEMPLATE PERFORMANCE VISUALIZATION
 * ============================================================================
 * 
 * PURPOSE:
 * Visualizes template performance trends over time using Chart.js.
 * Shows confidence improvement, tier distribution, cost trends, and success rates.
 * 
 * ARCHITECTURE:
 * - Uses Chart.js 4.x for rendering (loaded via CDN)
 * - Fetches data from /api/admin/suggestions/trends/:templateId
 * - Graceful fallback to table view if Chart.js unavailable
 * - Responsive design for desktop and mobile
 * 
 * FEATURES:
 * 1. Confidence Trend Line Chart (last 10/50/100 tests)
 * 2. Tier Distribution Pie Chart (% in Tier 1/2/3)
 * 3. Cost Trend Area Chart (spending over time)
 * 4. Success Rate Progress Bar (matched vs unmatched)
 * 
 * ERROR HANDLING:
 * - Checkpoint debugging at every major step
 * - Graceful fallback if Chart.js not loaded
 * - Network error handling with retry logic
 * - Empty state for no data
 * 
 * DEPENDENCIES:
 * - Chart.js 4.x (CDN)
 * - Backend API: /api/admin/suggestions/trends/:templateId
 * - TrendAnalyzer service (backend)
 * 
 * USAGE:
 * const trendCharts = new EnterpriseTrendCharts('template-123');
 * await trendCharts.render();
 * 
 * ============================================================================
 */

class EnterpriseTrendCharts {
    /**
     * ========================================================================
     * CONSTRUCTOR - INITIALIZE TREND CHARTS
     * ========================================================================
     */
    constructor(templateId, options = {}) {
        console.log('🔵 [CHECKPOINT 0] EnterpriseTrendCharts - Initializing...');
        console.log('🔵 [CHECKPOINT 0.1] Template ID:', templateId);
        
        // Validate template ID
        if (!templateId) {
            console.error('❌ [CHECKPOINT 0.2] Template ID is required');
            throw new Error('Template ID is required for trend charts');
        }
        
        this.templateId = templateId;
        this.options = {
            containerId: options.containerId || 'enterprise-trend-charts',
            timeRange: options.timeRange || 50, // Default: last 50 tests
            refreshInterval: options.refreshInterval || null, // Auto-refresh disabled by default
            theme: options.theme || 'light',
            ...options
        };
        
        this.charts = {}; // Store Chart.js instances
        this.data = null; // Cached trend data
        this.isChartJsLoaded = false;
        
        console.log('✅ [CHECKPOINT 0.3] EnterpriseTrendCharts initialized successfully');
    }
    
    /**
     * ========================================================================
     * CHECK CHART.JS AVAILABILITY
     * ========================================================================
     */
    checkChartJsAvailability() {
        console.log('🔵 [CHECKPOINT 1] Checking Chart.js availability...');
        
        this.isChartJsLoaded = typeof Chart !== 'undefined';
        
        if (this.isChartJsLoaded) {
            console.log('✅ [CHECKPOINT 1.1] Chart.js is loaded and available');
        } else {
            console.warn('⚠️ [CHECKPOINT 1.2] Chart.js not loaded - will use fallback table view');
        }
        
        return this.isChartJsLoaded;
    }
    
    /**
     * ========================================================================
     * FETCH TREND DATA FROM BACKEND
     * ========================================================================
     */
    async fetchTrendData() {
        console.log('🔵 [CHECKPOINT 2] Fetching trend data from API...');
        console.log('🔵 [CHECKPOINT 2.1] Endpoint:', `/api/admin/suggestions/trends/${this.templateId}`);
        console.log('🔵 [CHECKPOINT 2.2] Time range:', this.options.timeRange);
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [CHECKPOINT 2.3] No auth token found');
                throw new Error('Authentication required - please log in');
            }
            
            const response = await fetch(
                `/api/admin/suggestions/trends/${this.templateId}?limit=${this.options.timeRange}`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            console.log('🔵 [CHECKPOINT 2.4] Response status:', response.status);
            
            if (response.status === 401) {
                console.error('❌ [CHECKPOINT 2.5] Authentication failed - token expired');
                throw new Error('Session expired - please log in again');
            }
            
            if (!response.ok) {
                console.error('❌ [CHECKPOINT 2.6] API request failed:', response.statusText);
                throw new Error(`Failed to fetch trend data: ${response.statusText}`);
            }
            
            const data = await response.json();
            
            console.log('✅ [CHECKPOINT 2.7] Trend data loaded successfully');
            console.log('🔵 [CHECKPOINT 2.8] Data points:', data.trends?.confidenceTrend?.length || 0);
            
            if (!data.success) {
                console.error('❌ [CHECKPOINT 2.9] API returned error:', data.error || data.message);
                throw new Error(data.error || data.message || 'Failed to fetch trend data');
            }
            
            this.data = data.trends;
            return this.data;
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 2.10] Error fetching trend data:', error.message);
            console.error('❌ [CHECKPOINT 2.11] Stack trace:', error.stack);
            throw error;
        }
    }
    
    /**
     * ========================================================================
     * RENDER ALL CHARTS
     * ========================================================================
     */
    async render() {
        console.log('🔵 [CHECKPOINT 3] Starting chart rendering...');
        
        try {
            // Check Chart.js availability
            this.checkChartJsAvailability();
            
            // Fetch trend data
            await this.fetchTrendData();
            
            // Get container
            const container = document.getElementById(this.options.containerId);
            if (!container) {
                console.error('❌ [CHECKPOINT 3.1] Container not found:', this.options.containerId);
                throw new Error(`Container #${this.options.containerId} not found`);
            }
            
            console.log('✅ [CHECKPOINT 3.2] Container found');
            
            // Check if data is empty
            if (!this.data || !this.data.confidenceTrend || this.data.confidenceTrend.length === 0) {
                console.warn('⚠️ [CHECKPOINT 3.3] No trend data available - showing empty state');
                this.renderEmptyState(container);
                return;
            }
            
            console.log('✅ [CHECKPOINT 3.4] Data available - rendering charts');
            
            // Render based on Chart.js availability
            if (this.isChartJsLoaded) {
                console.log('🔵 [CHECKPOINT 3.5] Rendering Chart.js visualizations...');
                this.renderChartJsView(container);
            } else {
                console.log('🔵 [CHECKPOINT 3.6] Rendering fallback table view...');
                this.renderFallbackTableView(container);
            }
            
            console.log('✅ [CHECKPOINT 3.7] Chart rendering complete!');
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 3.8] Chart rendering failed:', error.message);
            console.error('❌ [CHECKPOINT 3.9] Stack trace:', error.stack);
            this.renderErrorState(document.getElementById(this.options.containerId), error);
        }
    }
    
    /**
     * ========================================================================
     * RENDER CHART.JS VIEW (Primary)
     * ========================================================================
     */
    renderChartJsView(container) {
        console.log('🔵 [CHECKPOINT 4] Rendering Chart.js view...');
        
        container.innerHTML = `
            <div class="enterprise-trend-charts-container">
                <!-- Header -->
                <div class="flex items-center justify-between mb-6">
                    <div>
                        <h3 class="text-xl font-bold text-gray-900 flex items-center gap-2">
                            📈 Template Performance Trends
                        </h3>
                        <p class="text-sm text-gray-600 mt-1">
                            Showing last ${this.options.timeRange} tests
                        </p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.trendCharts.changeTimeRange(10)" 
                                class="px-3 py-1 text-sm border rounded hover:bg-gray-100">
                            Last 10
                        </button>
                        <button onclick="window.trendCharts.changeTimeRange(50)" 
                                class="px-3 py-1 text-sm border rounded bg-blue-50 border-blue-500 text-blue-700">
                            Last 50
                        </button>
                        <button onclick="window.trendCharts.changeTimeRange(100)" 
                                class="px-3 py-1 text-sm border rounded hover:bg-gray-100">
                            Last 100
                        </button>
                        <button onclick="window.trendCharts.refresh()" 
                                class="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 flex items-center gap-1">
                            <i class="fas fa-sync-alt"></i> Refresh
                        </button>
                    </div>
                </div>
                
                <!-- Charts Grid (2x2) -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    <!-- Chart 1: Confidence Trend -->
                    <div class="bg-white rounded-lg border-2 border-gray-200 p-5 shadow-md">
                        <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <i class="fas fa-chart-line text-blue-600"></i>
                            Confidence Trend
                        </h4>
                        <canvas id="confidence-trend-chart"></canvas>
                    </div>
                    
                    <!-- Chart 2: Tier Distribution -->
                    <div class="bg-white rounded-lg border-2 border-gray-200 p-5 shadow-md">
                        <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <i class="fas fa-chart-pie text-green-600"></i>
                            Tier Distribution
                        </h4>
                        <canvas id="tier-distribution-chart"></canvas>
                    </div>
                    
                    <!-- Chart 3: Cost Trend -->
                    <div class="bg-white rounded-lg border-2 border-gray-200 p-5 shadow-md">
                        <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <i class="fas fa-dollar-sign text-purple-600"></i>
                            Cost Trend
                        </h4>
                        <canvas id="cost-trend-chart"></canvas>
                    </div>
                    
                    <!-- Chart 4: Success Rate -->
                    <div class="bg-white rounded-lg border-2 border-gray-200 p-5 shadow-md">
                        <h4 class="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <i class="fas fa-bullseye text-orange-600"></i>
                            Success Metrics
                        </h4>
                        <div id="success-metrics-display"></div>
                    </div>
                    
                </div>
            </div>
        `;
        
        console.log('✅ [CHECKPOINT 4.1] HTML structure created');
        
        // Render individual charts
        this.renderConfidenceTrendChart();
        this.renderTierDistributionChart();
        this.renderCostTrendChart();
        this.renderSuccessMetrics();
        
        console.log('✅ [CHECKPOINT 4.2] All charts rendered successfully');
    }
    
    /**
     * ========================================================================
     * CHART 1: CONFIDENCE TREND LINE CHART
     * ========================================================================
     */
    renderConfidenceTrendChart() {
        console.log('🔵 [CHECKPOINT 5] Rendering confidence trend chart...');
        
        try {
            const canvas = document.getElementById('confidence-trend-chart');
            if (!canvas) {
                console.error('❌ [CHECKPOINT 5.1] Canvas not found');
                return;
            }
            
            const confidenceData = this.data.confidenceTrend || [];
            console.log('🔵 [CHECKPOINT 5.2] Data points:', confidenceData.length);
            
            // Prepare data for Chart.js
            const labels = confidenceData.map((point, index) => `Test ${index + 1}`);
            const values = confidenceData.map(point => (point.confidence * 100).toFixed(1));
            
            // Calculate trend line
            const avgConfidence = (values.reduce((sum, val) => sum + parseFloat(val), 0) / values.length).toFixed(1);
            
            // Create chart
            this.charts.confidenceTrend = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Confidence %',
                        data: values,
                        borderColor: 'rgb(59, 130, 246)',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        tension: 0.4,
                        fill: true,
                        pointRadius: 4,
                        pointHoverRadius: 6
                    }, {
                        label: 'Average',
                        data: Array(values.length).fill(avgConfidence),
                        borderColor: 'rgb(34, 197, 94)',
                        borderDash: [5, 5],
                        borderWidth: 2,
                        fill: false,
                        pointRadius: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `${context.dataset.label}: ${context.parsed.y}%`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            max: 100,
                            ticks: {
                                callback: function(value) {
                                    return value + '%';
                                }
                            }
                        }
                    }
                }
            });
            
            console.log('✅ [CHECKPOINT 5.3] Confidence trend chart created');
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 5.4] Failed to render confidence chart:', error.message);
            console.error('❌ [CHECKPOINT 5.5] Stack trace:', error.stack);
        }
    }
    
    /**
     * ========================================================================
     * CHART 2: TIER DISTRIBUTION PIE CHART
     * ========================================================================
     */
    renderTierDistributionChart() {
        console.log('🔵 [CHECKPOINT 6] Rendering tier distribution chart...');
        
        try {
            const canvas = document.getElementById('tier-distribution-chart');
            if (!canvas) {
                console.error('❌ [CHECKPOINT 6.1] Canvas not found');
                return;
            }
            
            const distribution = this.data.tierDistribution || { tier1: 0, tier2: 0, tier3: 0 };
            console.log('🔵 [CHECKPOINT 6.2] Distribution:', distribution);
            
            this.charts.tierDistribution = new Chart(canvas, {
                type: 'doughnut',
                data: {
                    labels: ['Tier 1 (Rules)', 'Tier 2 (Semantic)', 'Tier 3 (LLM)'],
                    datasets: [{
                        data: [distribution.tier1, distribution.tier2, distribution.tier3],
                        backgroundColor: [
                            'rgb(34, 197, 94)',  // Green for Tier 1
                            'rgb(59, 130, 246)',  // Blue for Tier 2
                            'rgb(168, 85, 247)'   // Purple for Tier 3
                        ],
                        borderWidth: 2,
                        borderColor: '#fff'
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            position: 'bottom'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                    const percentage = ((context.parsed / total) * 100).toFixed(1);
                                    return `${context.label}: ${context.parsed} tests (${percentage}%)`;
                                }
                            }
                        }
                    }
                }
            });
            
            console.log('✅ [CHECKPOINT 6.3] Tier distribution chart created');
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 6.4] Failed to render tier chart:', error.message);
            console.error('❌ [CHECKPOINT 6.5] Stack trace:', error.stack);
        }
    }
    
    /**
     * ========================================================================
     * CHART 3: COST TREND AREA CHART
     * ========================================================================
     */
    renderCostTrendChart() {
        console.log('🔵 [CHECKPOINT 7] Rendering cost trend chart...');
        
        try {
            const canvas = document.getElementById('cost-trend-chart');
            if (!canvas) {
                console.error('❌ [CHECKPOINT 7.1] Canvas not found');
                return;
            }
            
            const costData = this.data.costTrend || [];
            console.log('🔵 [CHECKPOINT 7.2] Cost data points:', costData.length);
            
            const labels = costData.map((point, index) => `Test ${index + 1}`);
            const values = costData.map(point => point.cost || 0);
            
            this.charts.costTrend = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Cost per Test ($)',
                        data: values,
                        borderColor: 'rgb(168, 85, 247)',
                        backgroundColor: 'rgba(168, 85, 247, 0.1)',
                        tension: 0.4,
                        fill: true,
                        pointRadius: 3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom'
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `Cost: $${context.parsed.y.toFixed(4)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: function(value) {
                                    return '$' + value.toFixed(4);
                                }
                            }
                        }
                    }
                }
            });
            
            console.log('✅ [CHECKPOINT 7.3] Cost trend chart created');
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 7.4] Failed to render cost chart:', error.message);
            console.error('❌ [CHECKPOINT 7.5] Stack trace:', error.stack);
        }
    }
    
    /**
     * ========================================================================
     * CHART 4: SUCCESS METRICS DISPLAY
     * ========================================================================
     */
    renderSuccessMetrics() {
        console.log('🔵 [CHECKPOINT 8] Rendering success metrics...');
        
        try {
            const container = document.getElementById('success-metrics-display');
            if (!container) {
                console.error('❌ [CHECKPOINT 8.1] Container not found');
                return;
            }
            
            const metrics = this.data.summary || {};
            console.log('🔵 [CHECKPOINT 8.2] Metrics:', metrics);
            
            const successRate = ((metrics.matchedCount / metrics.totalTests) * 100).toFixed(1);
            const avgConfidence = (metrics.averageConfidence * 100).toFixed(1);
            
            container.innerHTML = `
                <div class="space-y-4">
                    <!-- Success Rate -->
                    <div>
                        <div class="flex justify-between mb-2">
                            <span class="text-sm font-semibold text-gray-700">Success Rate</span>
                            <span class="text-sm font-bold text-green-700">${successRate}%</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-3">
                            <div class="bg-green-600 h-3 rounded-full" style="width: ${successRate}%"></div>
                        </div>
                        <div class="text-xs text-gray-600 mt-1">
                            ${metrics.matchedCount} matched / ${metrics.totalTests} total
                        </div>
                    </div>
                    
                    <!-- Average Confidence -->
                    <div>
                        <div class="flex justify-between mb-2">
                            <span class="text-sm font-semibold text-gray-700">Avg Confidence</span>
                            <span class="text-sm font-bold text-blue-700">${avgConfidence}%</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-3">
                            <div class="bg-blue-600 h-3 rounded-full" style="width: ${avgConfidence}%"></div>
                        </div>
                    </div>
                    
                    <!-- Total Cost -->
                    <div class="pt-3 border-t border-gray-200">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-semibold text-gray-700">Total Cost</span>
                            <span class="text-lg font-bold text-purple-700">$${metrics.totalCost?.toFixed(4) || '0.00'}</span>
                        </div>
                        <div class="text-xs text-gray-600 mt-1">
                            Avg: $${(metrics.totalCost / metrics.totalTests)?.toFixed(4) || '0.00'} per test
                        </div>
                    </div>
                    
                    <!-- Tier 1 Performance -->
                    <div class="pt-3 border-t border-gray-200">
                        <div class="flex justify-between items-center">
                            <span class="text-sm font-semibold text-gray-700">Tier 1 Success</span>
                            <span class="text-lg font-bold text-green-700">
                                ${((this.data.tierDistribution?.tier1 / metrics.totalTests) * 100).toFixed(1)}%
                            </span>
                        </div>
                        <div class="text-xs text-green-600 mt-1">
                            💚 ${this.data.tierDistribution?.tier1 || 0} tests used FREE rules
                        </div>
                    </div>
                </div>
            `;
            
            console.log('✅ [CHECKPOINT 8.3] Success metrics rendered');
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 8.4] Failed to render metrics:', error.message);
            console.error('❌ [CHECKPOINT 8.5] Stack trace:', error.stack);
        }
    }
    
    /**
     * ========================================================================
     * FALLBACK: TABLE VIEW (When Chart.js unavailable)
     * ========================================================================
     */
    renderFallbackTableView(container) {
        console.log('🔵 [CHECKPOINT 9] Rendering fallback table view...');
        
        const confidenceData = this.data.confidenceTrend || [];
        const metrics = this.data.summary || {};
        
        container.innerHTML = `
            <div class="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-6">
                <div class="flex items-center gap-3 mb-4">
                    <i class="fas fa-exclamation-triangle text-3xl text-yellow-600"></i>
                    <div>
                        <h3 class="text-lg font-bold text-yellow-900">Chart.js Not Available</h3>
                        <p class="text-sm text-yellow-700">Showing data in table format</p>
                    </div>
                </div>
                
                <div class="bg-white rounded-lg p-4">
                    <h4 class="font-bold text-gray-900 mb-3">📊 Performance Summary</h4>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <div class="text-sm text-gray-600">Total Tests</div>
                            <div class="text-2xl font-bold text-gray-900">${metrics.totalTests || 0}</div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-600">Success Rate</div>
                            <div class="text-2xl font-bold text-green-700">
                                ${((metrics.matchedCount / metrics.totalTests) * 100).toFixed(1)}%
                            </div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-600">Avg Confidence</div>
                            <div class="text-2xl font-bold text-blue-700">
                                ${(metrics.averageConfidence * 100).toFixed(1)}%
                            </div>
                        </div>
                        <div>
                            <div class="text-sm text-gray-600">Total Cost</div>
                            <div class="text-2xl font-bold text-purple-700">
                                $${metrics.totalCost?.toFixed(4) || '0.00'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        console.log('✅ [CHECKPOINT 9.1] Fallback table view rendered');
    }
    
    /**
     * ========================================================================
     * EMPTY STATE (No data available)
     * ========================================================================
     */
    renderEmptyState(container) {
        console.log('🔵 [CHECKPOINT 10] Rendering empty state...');
        
        container.innerHTML = `
            <div class="text-center py-12 bg-gray-50 rounded-lg border-2 border-gray-200">
                <i class="fas fa-chart-line text-6xl text-gray-300 mb-4"></i>
                <h3 class="text-xl font-bold text-gray-700 mb-2">No Trend Data Yet</h3>
                <p class="text-gray-600 mb-4">
                    Run some tests to see performance trends appear here.
                </p>
                <button onclick="window.trendCharts.refresh()" 
                        class="px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700">
                    <i class="fas fa-sync-alt mr-2"></i> Refresh
                </button>
            </div>
        `;
        
        console.log('✅ [CHECKPOINT 10.1] Empty state rendered');
    }
    
    /**
     * ========================================================================
     * ERROR STATE (Something went wrong)
     * ========================================================================
     */
    renderErrorState(container, error) {
        console.log('🔵 [CHECKPOINT 11] Rendering error state...');
        
        if (!container) {
            console.error('❌ [CHECKPOINT 11.1] Container not found for error state');
            return;
        }
        
        container.innerHTML = `
            <div class="bg-red-50 border-2 border-red-400 rounded-lg p-6">
                <div class="flex items-center gap-3 mb-4">
                    <i class="fas fa-exclamation-circle text-3xl text-red-600"></i>
                    <div>
                        <h3 class="text-lg font-bold text-red-900">Failed to Load Trend Data</h3>
                        <p class="text-sm text-red-700">${error.message || 'Unknown error'}</p>
                    </div>
                </div>
                <button onclick="window.trendCharts.refresh()" 
                        class="px-4 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700">
                    <i class="fas fa-redo mr-2"></i> Try Again
                </button>
            </div>
        `;
        
        console.log('✅ [CHECKPOINT 11.2] Error state rendered');
    }
    
    /**
     * ========================================================================
     * PUBLIC API - CHANGE TIME RANGE
     * ========================================================================
     */
    async changeTimeRange(range) {
        console.log('🔵 [CHECKPOINT 12] Changing time range to:', range);
        
        this.options.timeRange = range;
        await this.refresh();
        
        console.log('✅ [CHECKPOINT 12.1] Time range changed successfully');
    }
    
    /**
     * ========================================================================
     * PUBLIC API - REFRESH DATA
     * ========================================================================
     */
    async refresh() {
        console.log('🔵 [CHECKPOINT 13] Refreshing trend charts...');
        
        try {
            // Destroy existing charts
            Object.values(this.charts).forEach(chart => {
                if (chart && chart.destroy) {
                    chart.destroy();
                }
            });
            this.charts = {};
            
            console.log('✅ [CHECKPOINT 13.1] Old charts destroyed');
            
            // Re-render
            await this.render();
            
            console.log('✅ [CHECKPOINT 13.2] Charts refreshed successfully');
            
        } catch (error) {
            console.error('❌ [CHECKPOINT 13.3] Refresh failed:', error.message);
            console.error('❌ [CHECKPOINT 13.4] Stack trace:', error.stack);
        }
    }
    
    /**
     * ========================================================================
     * PUBLIC API - DESTROY
     * ========================================================================
     */
    destroy() {
        console.log('🔵 [CHECKPOINT 14] Destroying trend charts...');
        
        // Destroy all Chart.js instances
        Object.values(this.charts).forEach(chart => {
            if (chart && chart.destroy) {
                chart.destroy();
            }
        });
        this.charts = {};
        
        // Clear container
        const container = document.getElementById(this.options.containerId);
        if (container) {
            container.innerHTML = '';
        }
        
        console.log('✅ [CHECKPOINT 14.1] Trend charts destroyed');
    }
}

// ============================================================================
// EXPORT FOR USE IN HTML
// ============================================================================
// Make available globally
if (typeof window !== 'undefined') {
    window.EnterpriseTrendCharts = EnterpriseTrendCharts;
    console.log('✅ EnterpriseTrendCharts loaded and available globally');
}

