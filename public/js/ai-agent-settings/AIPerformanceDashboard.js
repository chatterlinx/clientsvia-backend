// ============================================================================
// AI PERFORMANCE DASHBOARD MANAGER
// ============================================================================
// 📋 PURPOSE: Frontend UI for AI Performance Dashboard
// 🎯 FEATURES:
//    - Real-time metrics display
//    - Speed breakdown visualization
//    - Index usage monitoring
//    - Slow query tracking
// 🔄 AUTO-REFRESH: Every 30 seconds
// ============================================================================

class AIPerformanceDashboard {
    constructor(companyId) {
        console.log(`🚀 [AI PERF DASHBOARD] CHECKPOINT 1: Constructor called for company: ${companyId}`);
        this.companyId = companyId;
        this.refreshInterval = null;
        this.autoRefreshEnabled = true;
        console.log(`✅ [AI PERF DASHBOARD] CHECKPOINT 2: Initialized successfully`);
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * INITIALIZE DASHBOARD
     * ────────────────────────────────────────────────────────────────────────
     */
    init() {
        console.log(`🎯 [AI PERF DASHBOARD] Init called - starting load...`);
        this.load();
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * LOAD DASHBOARD
     * ────────────────────────────────────────────────────────────────────────
     */
    async load() {
        try {
            console.log(`📊 [AI PERF DASHBOARD] CHECKPOINT 3: Loading dashboard...`);

            // ================================================================
            // STEP 1: Fetch all data in parallel
            // ================================================================
            console.log(`📊 [AI PERF DASHBOARD] CHECKPOINT 4: Fetching data from API...`);
            
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error(`❌ [AI PERF DASHBOARD] No auth token found`);
                this.renderError('Authentication required');
                return;
            }

            const [realtimeRes, trendsRes, indexUsageRes, slowQueriesRes, dbStatsRes] = await Promise.all([
                fetch(`/api/company/${this.companyId}/ai-performance/realtime`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/company/${this.companyId}/ai-performance/trends?days=7`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/company/${this.companyId}/ai-performance/index-usage`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/company/${this.companyId}/ai-performance/slow-queries`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/company/${this.companyId}/ai-performance/db-stats`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);

            console.log(`✅ [AI PERF DASHBOARD] CHECKPOINT 5: All API calls completed`);
            console.log(`   - Realtime: ${realtimeRes.status}`);
            console.log(`   - Trends: ${trendsRes.status}`);
            console.log(`   - Index Usage: ${indexUsageRes.status}`);
            console.log(`   - Slow Queries: ${slowQueriesRes.status}`);
            console.log(`   - DB Stats: ${dbStatsRes.status}`);

            // ================================================================
            // ✅ FIX: Check response status before parsing JSON (Bug #8)
            // ================================================================
            console.log(`🔍 [AI PERF DASHBOARD] CHECKPOINT 5.5: Validating response status...`);
            
            const responses = [
                { name: 'Realtime', res: realtimeRes },
                { name: 'Trends', res: trendsRes },
                { name: 'Index Usage', res: indexUsageRes },
                { name: 'Slow Queries', res: slowQueriesRes },
                { name: 'DB Stats', res: dbStatsRes }
            ];

            for (const { name, res } of responses) {
                if (!res.ok) {
                    const errorText = await res.text();
                    console.error(`❌ [AI PERF DASHBOARD] ${name} API failed: ${res.status}`);
                    console.error(`   Response: ${errorText}`);
                    throw new Error(`${name} API failed with status ${res.status}: ${errorText.substring(0, 100)}`);
                }
            }

            console.log(`✅ [AI PERF DASHBOARD] All API responses validated successfully`);

            // ================================================================
            // STEP 2: Parse responses
            // ================================================================
            console.log(`📊 [AI PERF DASHBOARD] CHECKPOINT 6: Parsing JSON responses...`);
            
            const realtime = await realtimeRes.json();
            const trends = await trendsRes.json();
            const indexUsage = await indexUsageRes.json();
            const slowQueries = await slowQueriesRes.json();
            const dbStats = await dbStatsRes.json();

            console.log(`✅ [AI PERF DASHBOARD] CHECKPOINT 7: Data parsed successfully`);
            console.log(`   - Total Lookups: ${realtime.data?.totalLookups || 0}`);
            console.log(`   - Avg Speed: ${realtime.data?.avgSpeed || 0}ms`);
            console.log(`   - Trends Days: ${trends.data?.length || 0}`);

            // ================================================================
            // STEP 3: Store data
            // ================================================================
            this.data = {
                realtime: realtime.data || {},
                trends: trends.data || [],
                indexUsage: indexUsage.data || {},
                slowQueries: slowQueries.data || [],
                dbStats: dbStats.data || {}
            };

            console.log(`✅ [AI PERF DASHBOARD] CHECKPOINT 8: Data stored locally`);

            // ================================================================
            // STEP 4: Render UI
            // ================================================================
            console.log(`📊 [AI PERF DASHBOARD] CHECKPOINT 9: Rendering UI...`);
            this.render();
            console.log(`✅ [AI PERF DASHBOARD] CHECKPOINT 10: Dashboard loaded successfully`);

            // ================================================================
            // STEP 5: Start auto-refresh
            // ================================================================
            this.startAutoRefresh();

        } catch (error) {
            console.error(`❌ [AI PERF DASHBOARD] ERROR loading dashboard:`, error);
            console.error(`❌ [AI PERF DASHBOARD] Stack:`, error.stack);
            this.renderError(error.message);
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER DASHBOARD
     * ────────────────────────────────────────────────────────────────────────
     */
    render() {
        console.log(`🎨 [AI PERF DASHBOARD] CHECKPOINT 11: Starting render...`);
        
        // Support both AI Agent Settings sub-tab and main tab
        let container = document.getElementById('ai-performance-dashboard-container');
        if (!container) {
            container = document.getElementById('ai-settings-ai-performance-content');
        }
        
        if (!container) {
            console.error(`❌ [AI PERF DASHBOARD] Container not found`);
            return;
        }
        
        console.log(`✅ [AI PERF DASHBOARD] Rendering into:`, container.id);

        const { realtime, trends, indexUsage, slowQueries, dbStats } = this.data;

        // ================================================================
        // Build HTML
        // ================================================================
        container.innerHTML = `
            <div class="ai-performance-dashboard">
                <!-- HEADER -->
                <div class="dashboard-header">
                    <h3>🚀 AI Performance Dashboard</h3>
                    <div class="header-actions">
                        <button class="refresh-btn" onclick="aiPerformanceDashboard.load()">
                            <i class="fas fa-sync-alt"></i> Refresh Now
                        </button>
                        <label class="auto-refresh-toggle">
                            <input type="checkbox" ${this.autoRefreshEnabled ? 'checked' : ''} 
                                   onchange="aiPerformanceDashboard.toggleAutoRefresh(this.checked)">
                            Auto-refresh (30s)
                        </label>
                    </div>
                </div>

                <!-- REAL-TIME METRICS -->
                ${this.renderRealtimeMetrics(realtime)}

                <!-- SPEED BREAKDOWN -->
                ${this.renderSpeedBreakdown(realtime)}

                <!-- DATABASE PERFORMANCE -->
                ${this.renderDatabasePerformance(indexUsage, dbStats)}

                <!-- TRENDS -->
                ${this.renderTrends(trends)}

                <!-- SLOW QUERIES -->
                ${this.renderSlowQueries(slowQueries)}
            </div>
        `;

        console.log(`✅ [AI PERF DASHBOARD] CHECKPOINT 12: Render complete`);
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER REALTIME METRICS
     * ────────────────────────────────────────────────────────────────────────
     */
    renderRealtimeMetrics(realtime) {
        const totalLookups = realtime.totalLookups || 0;
        const avgSpeed = realtime.avgSpeed || 0;
        const cacheHitRate = realtime.cacheHitRate || 0;
        const sourceDistribution = realtime.sourceDistribution || {};

        return `
            <div class="metrics-grid">
                <div class="metric-card">
                    <div class="metric-icon">📊</div>
                    <div class="metric-content">
                        <div class="metric-label">Total Lookups</div>
                        <div class="metric-value">${totalLookups.toLocaleString()}</div>
                        <div class="metric-subtitle">Last 24 Hours</div>
                    </div>
                </div>

                <div class="metric-card ${avgSpeed < 25 ? 'success' : avgSpeed < 50 ? 'warning' : 'danger'}">
                    <div class="metric-icon">⚡</div>
                    <div class="metric-content">
                        <div class="metric-label">Avg Speed</div>
                        <div class="metric-value">${avgSpeed}ms</div>
                        <div class="metric-subtitle">${avgSpeed < 25 ? 'Excellent' : avgSpeed < 50 ? 'Good' : 'Needs Attention'}</div>
                    </div>
                </div>

                <div class="metric-card ${cacheHitRate >= 90 ? 'success' : cacheHitRate >= 70 ? 'warning' : 'danger'}">
                    <div class="metric-icon">💾</div>
                    <div class="metric-content">
                        <div class="metric-label">Cache Hit Rate</div>
                        <div class="metric-value">${cacheHitRate.toFixed(1)}%</div>
                        <div class="metric-subtitle">${cacheHitRate >= 90 ? 'Excellent' : cacheHitRate >= 70 ? 'Good' : 'Poor'}</div>
                    </div>
                </div>

                <div class="metric-card">
                    <div class="metric-icon">🎯</div>
                    <div class="metric-content">
                        <div class="metric-label">AI Sources</div>
                        <div class="metric-value">${Object.keys(sourceDistribution).length}</div>
                        <div class="metric-subtitle">Active Sources</div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER SPEED BREAKDOWN
     * ────────────────────────────────────────────────────────────────────────
     */
    renderSpeedBreakdown(realtime) {
        const breakdown = realtime.speedBreakdown || {};
        const total = breakdown.mongoLookup + breakdown.redisCache + breakdown.templateLoading + 
                      breakdown.scenarioMatching + breakdown.confidenceCalculation + breakdown.responseGeneration;

        const getPercentageBar = (value) => {
            if (total === 0) return 0;
            return Math.round((value / total) * 100);
        };

        return `
            <div class="performance-section">
                <h4>⚡ Speed Breakdown by Component</h4>
                <div class="speed-breakdown">
                    ${this.renderSpeedItem('MongoDB Lookup', breakdown.mongoLookup || 0, getPercentageBar(breakdown.mongoLookup || 0), '#3b82f6')}
                    ${this.renderSpeedItem('Redis Cache', breakdown.redisCache || 0, getPercentageBar(breakdown.redisCache || 0), '#10b981')}
                    ${this.renderSpeedItem('Template Loading', breakdown.templateLoading || 0, getPercentageBar(breakdown.templateLoading || 0), '#8b5cf6')}
                    ${this.renderSpeedItem('Scenario Matching', breakdown.scenarioMatching || 0, getPercentageBar(breakdown.scenarioMatching || 0), '#f59e0b')}
                    ${this.renderSpeedItem('Confidence Calc', breakdown.confidenceCalculation || 0, getPercentageBar(breakdown.confidenceCalculation || 0), '#ec4899')}
                    ${this.renderSpeedItem('Response Gen', breakdown.responseGeneration || 0, getPercentageBar(breakdown.responseGeneration || 0), '#06b6d4')}
                </div>
                <div class="speed-total">
                    <strong>Total Average:</strong> ${total}ms
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER SPEED ITEM (helper)
     * ────────────────────────────────────────────────────────────────────────
     */
    renderSpeedItem(label, value, percentage, color) {
        return `
            <div class="speed-item">
                <div class="speed-label">${label}</div>
                <div class="speed-bar-container">
                    <div class="speed-bar" style="width: ${percentage}%; background-color: ${color};">
                        <span class="speed-value">${value}ms</span>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER DATABASE PERFORMANCE
     * ────────────────────────────────────────────────────────────────────────
     */
    renderDatabasePerformance(indexUsage, dbStats) {
        return `
            <div class="performance-section">
                <h4>💾 Database Performance</h4>
                <div class="db-performance-grid">
                    <!-- Index Usage -->
                    <div class="db-section">
                        <h5>Index Usage (Last Hour)</h5>
                        <div class="index-list">
                            ${this.renderIndexItem('companyId', indexUsage.companyIdIndex)}
                            ${this.renderIndexItem('phoneNumber', indexUsage.phoneNumberIndex)}
                            ${this.renderIndexItem('createdAt', indexUsage.createdAtIndex)}
                            ${this.renderIndexItem('confidence', indexUsage.confidenceIndex)}
                        </div>
                    </div>

                    <!-- Collection Stats -->
                    <div class="db-section">
                        <h5>Collection Statistics</h5>
                        <div class="stat-list">
                            <div class="stat-row">
                                <span>Total Documents:</span>
                                <strong>${(dbStats.totalDocuments || 0).toLocaleString()}</strong>
                            </div>
                            <div class="stat-row">
                                <span>Company Documents:</span>
                                <strong>${(dbStats.companyDocuments || 0).toLocaleString()}</strong>
                            </div>
                            <div class="stat-row">
                                <span>Index Size:</span>
                                <strong>${dbStats.indexSize || 0} MB</strong>
                            </div>
                            <div class="stat-row">
                                <span>Data Size:</span>
                                <strong>${dbStats.dataSize || 0} MB</strong>
                            </div>
                            <div class="stat-row">
                                <span>Avg Doc Size:</span>
                                <strong>${dbStats.avgDocSize || 0} KB</strong>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER INDEX ITEM (helper)
     * ────────────────────────────────────────────────────────────────────────
     */
    renderIndexItem(name, indexData) {
        const used = indexData?.used || false;
        const hits = indexData?.hits || 0;
        return `
            <div class="index-item ${used ? 'used' : 'unused'}">
                <span class="index-icon">${used ? '✅' : '⚠️'}</span>
                <span class="index-name">${name}</span>
                <span class="index-hits">${hits.toLocaleString()} hits</span>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER TRENDS
     * ────────────────────────────────────────────────────────────────────────
     */
    renderTrends(trends) {
        if (!trends || trends.length === 0) {
            return `
                <div class="performance-section">
                    <h4>📈 Speed Trends (7 Days)</h4>
                    <div class="no-data">No trend data available yet</div>
                </div>
            `;
        }

        const avgSpeed = trends.map(t => t.avgSpeed);
        const dates = trends.map(t => new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        const minSpeed = Math.min(...avgSpeed);
        const maxSpeed = Math.max(...avgSpeed);
        const improvement = maxSpeed > 0 ? Math.round(((maxSpeed - minSpeed) / maxSpeed) * 100) : 0;

        return `
            <div class="performance-section">
                <h4>📈 Speed Trends (7 Days)</h4>
                <div class="trends-summary">
                    <span>Trend: ${improvement > 0 ? '✅ IMPROVING' : improvement < 0 ? '⚠️ DEGRADING' : '➡️ STABLE'}</span>
                    <span>${Math.abs(improvement)}% ${improvement > 0 ? 'faster' : improvement < 0 ? 'slower' : 'change'} than slowest day</span>
                </div>
                <div class="trends-chart">
                    ${trends.map((trend, idx) => {
                        const height = maxSpeed > 0 ? (trend.avgSpeed / maxSpeed) * 100 : 0;
                        return `
                            <div class="trend-bar-container">
                                <div class="trend-bar" style="height: ${height}%;">
                                    <span class="trend-value">${trend.avgSpeed}ms</span>
                                </div>
                                <div class="trend-label">${dates[idx]}</div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER SLOW QUERIES
     * ────────────────────────────────────────────────────────────────────────
     */
    renderSlowQueries(slowQueries) {
        if (!slowQueries || slowQueries.length === 0) {
            return `
                <div class="performance-section">
                    <h4>🐌 Slow Queries (Last 24 Hours)</h4>
                    <div class="no-data success">✅ No slow queries detected! All responses under 50ms.</div>
                </div>
            `;
        }

        return `
            <div class="performance-section">
                <h4>🐌 Slow Queries (Last 24 Hours) - ${slowQueries.length} found</h4>
                <div class="slow-queries-list">
                    ${slowQueries.slice(0, 10).map(query => `
                        <div class="slow-query-item">
                            <div class="slow-query-header">
                                <span class="query-duration">${query.duration}ms</span>
                                <span class="query-type">${query.queryType}</span>
                                <span class="query-time">${new Date(query.timestamp).toLocaleString()}</span>
                            </div>
                            <div class="slow-query-text">${this.truncate(query.customerQuery, 100)}</div>
                        </div>
                    `).join('')}
                </div>
                ${slowQueries.length > 10 ? `<div class="show-more">... and ${slowQueries.length - 10} more</div>` : ''}
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * RENDER ERROR
     * ────────────────────────────────────────────────────────────────────────
     */
    renderError(message) {
        // Support both AI Agent Settings sub-tab and main tab
        let container = document.getElementById('ai-performance-dashboard-container');
        if (!container) {
            container = document.getElementById('ai-settings-ai-performance-content');
        }
        
        if (!container) return;

        container.innerHTML = `
            <div class="error-banner">
                <i class="fas fa-exclamation-triangle"></i>
                <div>
                    <strong>Failed to load AI Performance Dashboard</strong>
                    <p>${message}</p>
                </div>
            </div>
        `;
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * AUTO-REFRESH
     * ────────────────────────────────────────────────────────────────────────
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }

        if (this.autoRefreshEnabled) {
            console.log(`🔄 [AI PERF DASHBOARD] Auto-refresh enabled (30s)`);
            this.refreshInterval = setInterval(() => {
                console.log(`🔄 [AI PERF DASHBOARD] Auto-refreshing...`);
                this.load();
            }, 30000);
        }
    }

    toggleAutoRefresh(enabled) {
        this.autoRefreshEnabled = enabled;
        console.log(`🔄 [AI PERF DASHBOARD] Auto-refresh ${enabled ? 'enabled' : 'disabled'}`);
        if (enabled) {
            this.startAutoRefresh();
        } else {
            if (this.refreshInterval) {
                clearInterval(this.refreshInterval);
                this.refreshInterval = null;
            }
        }
    }

    /**
     * ────────────────────────────────────────────────────────────────────────
     * HELPERS
     * ────────────────────────────────────────────────────────────────────────
     */
    truncate(str, length) {
        if (!str) return '';
        return str.length > length ? str.substring(0, length) + '...' : str;
    }
}

// ============================================================================
// EXPORT (will be instantiated by AIAgentSettingsManager)
// ============================================================================
window.AIPerformanceDashboard = AIPerformanceDashboard;

