/**
 * ============================================================================
 * ANALYTICS MANAGER
 * ============================================================================
 * 
 * PURPOSE: Real-time AI Agent performance analytics dashboard
 * 
 * FEATURES:
 * - Hero Metrics: Match Rate, Confidence, Speed, Total Calls
 * - AI Intelligence: Scenario performance, knowledge gaps
 * - Business Intelligence: Call volume, peak hours, top categories
 * - Real-time updates and trend indicators
 * 
 * ARCHITECTURE:
 * - 3-Tab System: Intelligence Dashboard | Performance & Speed | Business
 * - Live data from v2AIAgentCallLog
 * - Auto-refresh every 60 seconds
 * - Color-coded status indicators
 * 
 * ============================================================================
 */

class AnalyticsManager {
    constructor(companyId) {
        console.log('📊 [ANALYTICS] Checkpoint 1: Constructor called');
        this.companyId = companyId;
        this.data = {
            overview: null,
            intelligence: null,
            business: null
        };
        this.currentTab = 'intelligence-dashboard';
        this.refreshInterval = null;
        console.log('✅ [ANALYTICS] Checkpoint 2: Initialized for company:', companyId);
    }

    /**
     * Load all analytics data
     */
    async load() {
        console.log('📊 [ANALYTICS] Checkpoint 3: Loading analytics...');
        
        try {
            const token = localStorage.getItem('token');
            if (!token) {
                throw new Error('No auth token found');
            }
            
            console.log('✅ [ANALYTICS] Checkpoint 4: Auth token present');
            console.log('📊 [ANALYTICS] Checkpoint 5: Fetching from API...');
            
            // Fetch all 3 endpoints in parallel for speed
            const [overviewRes, intelligenceRes, businessRes] = await Promise.all([
                fetch(`/api/company/${this.companyId}/analytics/overview`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/company/${this.companyId}/analytics/intelligence`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                }),
                fetch(`/api/company/${this.companyId}/analytics/business`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                })
            ]);
            
            console.log('✅ [ANALYTICS] Checkpoint 6: Responses received:', {
                overview: overviewRes.status,
                intelligence: intelligenceRes.status,
                business: businessRes.status
            });
            
            if (!overviewRes.ok || !intelligenceRes.ok || !businessRes.ok) {
                const errors = [];
                if (!overviewRes.ok) errors.push(`Overview: ${overviewRes.status}`);
                if (!intelligenceRes.ok) errors.push(`Intelligence: ${intelligenceRes.status}`);
                if (!businessRes.ok) errors.push(`Business: ${businessRes.status}`);
                
                console.error('❌ [ANALYTICS] Checkpoint 7: HTTP errors:', errors);
                throw new Error(`API errors: ${errors.join(', ')}`);
            }
            
            console.log('📊 [ANALYTICS] Checkpoint 7: Parsing JSON...');
            
            this.data.overview = await overviewRes.json();
            this.data.intelligence = await intelligenceRes.json();
            this.data.business = await businessRes.json();
            
            console.log('✅ [ANALYTICS] Checkpoint 8: Data parsed:', {
                overview: this.data.overview.success,
                intelligence: this.data.intelligence.success,
                business: this.data.business.success
            });
            
            console.log('📊 [ANALYTICS] Checkpoint 9: Rendering UI...');
            this.render();
            console.log('✅ [ANALYTICS] Checkpoint 10: Load complete');
            
            // Start auto-refresh
            this.startAutoRefresh();
            
        } catch (error) {
            console.error('❌ [ANALYTICS] Checkpoint ERROR:', error);
            console.error('❌ [ANALYTICS] Full error object:', error);
            this.renderError(error.message);
        }
    }

    /**
     * Render the complete analytics UI
     */
    render() {
        console.log('📊 [ANALYTICS] Checkpoint 11: Starting render...');
        
        const container = document.getElementById('ai-settings-analytics-content');
        if (!container) {
            console.error('❌ [ANALYTICS] Container not found!');
            return;
        }
        
        console.log('✅ [ANALYTICS] Checkpoint 12: Container found');
        
        container.innerHTML = `
            <div class="analytics-dashboard">
                <!-- Tab Navigation -->
                <div class="analytics-tabs" style="display: flex; gap: 12px; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">
                    <button class="analytics-tab-btn active" data-tab="intelligence-dashboard" onclick="window.analyticsManager.switchTab('intelligence-dashboard')" style="padding: 10px 20px; font-size: 14px; font-weight: 600; color: #6366f1; background: #eef2ff; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                        🧠 Intelligence Dashboard
                    </button>
                    <button class="analytics-tab-btn" data-tab="performance" onclick="window.analyticsManager.switchTab('performance')" style="padding: 10px 20px; font-size: 14px; font-weight: 500; color: #6b7280; background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                        ⚡ Performance & Speed
                    </button>
                    <button class="analytics-tab-btn" data-tab="business" onclick="window.analyticsManager.switchTab('business')" style="padding: 10px 20px; font-size: 14px; font-weight: 500; color: #6b7280; background: transparent; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                        💼 Business Intelligence
                    </button>
                </div>
                
                <!-- Tab Content -->
                <div id="analytics-tab-content"></div>
            </div>
        `;
        
        console.log('✅ [ANALYTICS] Checkpoint 13: Tab navigation rendered');
        
        // Render initial tab
        this.renderTabContent();
        
        console.log('✅ [ANALYTICS] Checkpoint 14: UI rendered successfully');
    }

    /**
     * Switch between tabs
     */
    switchTab(tab) {
        console.log(`📊 [ANALYTICS] Switching to tab: ${tab}`);
        this.currentTab = tab;
        
        // Update tab buttons
        document.querySelectorAll('.analytics-tab-btn').forEach(btn => {
            const isActive = btn.dataset.tab === tab;
            btn.classList.toggle('active', isActive);
            btn.style.color = isActive ? '#6366f1' : '#6b7280';
            btn.style.background = isActive ? '#eef2ff' : 'transparent';
        });
        
        // Render tab content
        this.renderTabContent();
    }

    /**
     * Render current tab content
     */
    renderTabContent() {
        const contentContainer = document.getElementById('analytics-tab-content');
        if (!contentContainer) return;
        
        switch (this.currentTab) {
            case 'intelligence-dashboard':
                this.renderIntelligenceDashboard(contentContainer);
                break;
            case 'performance':
                this.renderPerformance(contentContainer);
                break;
            case 'business':
                this.renderBusiness(contentContainer);
                break;
        }
    }

    /**
     * Render Intelligence Dashboard tab
     */
    renderIntelligenceDashboard(container) {
        const { overview, intelligence } = this.data;
        
        if (!overview || !intelligence) {
            container.innerHTML = '<p style="color: #6b7280;">Loading intelligence data...</p>';
            return;
        }
        
        const { matchRate, confidence, fallbackRate } = overview.overview;
        const { topScenarios, knowledgeGaps } = intelligence.intelligence;
        
        container.innerHTML = `
            <!-- Hero Metrics -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 32px;">
                ${this.renderHeroCard('Match Rate', matchRate.value, '%', matchRate.trend, matchRate.status, '🎯')}
                ${this.renderHeroCard('Avg Confidence', confidence.value, '%', confidence.trend, confidence.status, '💯')}
                ${this.renderHeroCard('Fallback Usage', fallbackRate.value, '%', null, fallbackRate.status, '🔄')}
                ${this.renderHeroCard('Total Calls', overview.overview.totalCalls.value, '', overview.overview.totalCalls.trend, 'info', '📞')}
            </div>
            
            <!-- Scenario Performance -->
            <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                    🎭 Top Performing Scenarios
                    <span style="font-size: 14px; font-weight: 400; color: #6b7280; margin-left: auto;">Last 30 days</span>
                </h3>
                ${topScenarios.length > 0 ? `
                    <div style="overflow-x: auto;">
                        <table style="width: 100%; border-collapse: collapse;">
                            <thead>
                                <tr style="border-bottom: 2px solid #e5e7eb;">
                                    <th style="text-align: left; padding: 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Scenario</th>
                                    <th style="text-align: left; padding: 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Category</th>
                                    <th style="text-align: center; padding: 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Uses</th>
                                    <th style="text-align: center; padding: 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Confidence</th>
                                    <th style="text-align: center; padding: 12px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase;">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${topScenarios.map((s, i) => `
                                    <tr style="border-bottom: 1px solid #f3f4f6;">
                                        <td style="padding: 16px 12px; font-size: 14px; font-weight: 500; color: #111827;">
                                            <div style="display: flex; align-items: center; gap: 8px;">
                                                <span style="font-size: 18px; color: #6366f1; font-weight: 700;">#${i + 1}</span>
                                                ${s.scenario}
                                            </div>
                                        </td>
                                        <td style="padding: 16px 12px; font-size: 14px; color: #6b7280;">${s.category || 'Unknown'}</td>
                                        <td style="padding: 16px 12px; text-align: center;">
                                            <span style="font-size: 16px; font-weight: 700; color: #6366f1;">${s.uses}</span>
                                        </td>
                                        <td style="padding: 16px 12px; text-align: center;">
                                            <span style="font-size: 16px; font-weight: 700; color: ${this.getConfidenceColor(s.confidence)};">${s.confidence}%</span>
                                        </td>
                                        <td style="padding: 16px 12px; text-align: center;">
                                            ${this.renderStatusBadge(s.status)}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<p style="color: #6b7280; text-align: center; padding: 32px;">No scenario data available yet. Make some calls!</p>'}
            </div>
            
            <!-- Knowledge Gaps -->
            <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px;">
                <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                    🔍 Knowledge Gaps
                    <span style="font-size: 14px; font-weight: 400; color: #6b7280; margin-left: auto;">${knowledgeGaps.length} items need attention</span>
                </h3>
                ${knowledgeGaps.length > 0 ? `
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        ${knowledgeGaps.map(g => `
                            <div style="padding: 16px; background: ${g.urgency === 'high' ? '#fef2f2' : g.urgency === 'medium' ? '#fffbeb' : '#f9fafb'}; border-left: 4px solid ${g.urgency === 'high' ? '#ef4444' : g.urgency === 'medium' ? '#f59e0b' : '#6b7280'}; border-radius: 8px;">
                                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                    <p style="font-size: 14px; font-weight: 600; color: #111827; flex: 1;">${g.question}</p>
                                    <span style="font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 12px; background: ${g.urgency === 'high' ? '#ef4444' : g.urgency === 'medium' ? '#f59e0b' : '#6b7280'}; color: white; text-transform: uppercase; white-space: nowrap; margin-left: 12px;">
                                        ${g.urgency} PRIORITY
                                    </span>
                                </div>
                                <div style="display: flex; gap: 16px; font-size: 12px; color: #6b7280;">
                                    <span>📊 ${g.occurrences} occurrences</span>
                                    <span>💯 ${g.avgConfidence}% confidence</span>
                                    <span>🕒 ${new Date(g.lastOccurrence).toLocaleDateString()}</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                ` : '<p style="color: #10b981; text-align: center; padding: 32px; font-weight: 600;">🎉 No knowledge gaps detected! Your AI is performing excellently!</p>'}
            </div>
        `;
    }

    /**
     * Render Performance & Speed tab
     */
    renderPerformance(container) {
        const { overview } = this.data;
        
        if (!overview) {
            container.innerHTML = '<p style="color: #6b7280;">Loading performance data...</p>';
            return;
        }
        
        const { speed, matchRate, confidence, totalCalls } = overview.overview;
        
        container.innerHTML = `
            <!-- Performance Hero Cards -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 32px;">
                ${this.renderHeroCard('Response Speed', speed.value, 'ms', speed.trend, speed.status, '⚡')}
                ${this.renderHeroCard('Match Rate', matchRate.value, '%', matchRate.trend, matchRate.status, '🎯')}
                ${this.renderHeroCard('Avg Confidence', confidence.value, '%', confidence.trend, confidence.status, '💯')}
                ${this.renderHeroCard('Total Calls', totalCalls.value, '', totalCalls.trend, 'info', '📞')}
            </div>
            
            <!-- Performance Insights -->
            <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 24px;">⚡ Performance Analysis</h3>
                
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                    <!-- Speed Analysis -->
                    <div style="padding: 20px; background: #f9fafb; border-radius: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="width: 48px; height: 48px; background: ${this.getStatusColor(speed.status)}20; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                                ${speed.value <= 25 ? '🚀' : speed.value <= 50 ? '✅' : speed.value <= 100 ? '⚠️' : '🐌'}
                            </div>
                            <div>
                                <p style="font-size: 14px; font-weight: 600; color: #111827;">Response Speed</p>
                                <p style="font-size: 12px; color: #6b7280;">${this.getSpeedLabel(speed.value)}</p>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 32px; font-weight: 700; color: ${this.getStatusColor(speed.status)};">${speed.value}ms</span>
                            ${speed.trend !== 0 ? `<span style="font-size: 14px; font-weight: 600; color: ${speed.trend < 0 ? '#10b981' : '#ef4444'};">${speed.trend > 0 ? '+' : ''}${speed.trend}%</span>` : ''}
                        </div>
                        <p style="margin-top: 12px; font-size: 12px; color: #6b7280;">
                            ${speed.value <= 25 ? '🎉 Excellent! Under 25ms target.' : speed.value <= 50 ? '✅ Good performance. Keep it up!' : speed.value <= 100 ? '⚠️ Acceptable but can be optimized.' : '🚨 Needs improvement. Check server load.'}
                        </p>
                    </div>
                    
                    <!-- Match Quality -->
                    <div style="padding: 20px; background: #f9fafb; border-radius: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="width: 48px; height: 48px; background: ${this.getStatusColor(matchRate.status)}20; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                                ${matchRate.value >= 90 ? '🎯' : matchRate.value >= 75 ? '✅' : matchRate.value >= 60 ? '⚠️' : '🚨'}
                            </div>
                            <div>
                                <p style="font-size: 14px; font-weight: 600; color: #111827;">Match Quality</p>
                                <p style="font-size: 12px; color: #6b7280;">${this.getStatusLabel(matchRate.status)}</p>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 32px; font-weight: 700; color: ${this.getStatusColor(matchRate.status)};">${matchRate.value}%</span>
                            ${matchRate.trend !== 0 ? `<span style="font-size: 14px; font-weight: 600; color: ${matchRate.trend > 0 ? '#10b981' : '#ef4444'};">${matchRate.trend > 0 ? '+' : ''}${matchRate.trend}%</span>` : ''}
                        </div>
                        <p style="margin-top: 12px; font-size: 12px; color: #6b7280;">
                            ${matchRate.value >= 90 ? '🎉 Excellent match rate!' : matchRate.value >= 75 ? '✅ Good match quality.' : matchRate.value >= 60 ? '⚠️ Consider adding more scenarios.' : '🚨 Check AiCore Knowledgebase for gaps.'}
                        </p>
                    </div>
                    
                    <!-- Confidence Score -->
                    <div style="padding: 20px; background: #f9fafb; border-radius: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                            <div style="width: 48px; height: 48px; background: ${this.getStatusColor(confidence.status)}20; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 24px;">
                                ${confidence.value >= 85 ? '💯' : confidence.value >= 70 ? '✅' : confidence.value >= 60 ? '⚠️' : '🚨'}
                            </div>
                            <div>
                                <p style="font-size: 14px; font-weight: 600; color: #111827;">AI Confidence</p>
                                <p style="font-size: 12px; color: #6b7280;">${this.getStatusLabel(confidence.status)}</p>
                            </div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 32px; font-weight: 700; color: ${this.getStatusColor(confidence.status)};">${confidence.value}%</span>
                            ${confidence.trend !== 0 ? `<span style="font-size: 14px; font-weight: 600; color: ${confidence.trend > 0 ? '#10b981' : '#ef4444'};">${confidence.trend > 0 ? '+' : ''}${confidence.trend}%</span>` : ''}
                        </div>
                        <p style="margin-top: 12px; font-size: 12px; color: #6b7280;">
                            ${confidence.value >= 85 ? '🎉 AI is very confident in its responses!' : confidence.value >= 70 ? '✅ Good confidence levels.' : confidence.value >= 60 ? '⚠️ Consider refining scenarios.' : '🚨 Review templates and triggers.'}
                        </p>
                    </div>
                </div>
            </div>
            
            <!-- Performance Tips -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; padding: 24px; color: white;">
                <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                    💡 Performance Tips
                </h3>
                <ul style="list-style: none; padding: 0; display: flex; flex-direction: column; gap: 12px;">
                    <li style="display: flex; align-items: start; gap: 12px;">
                        <span style="font-size: 20px;">🚀</span>
                        <span style="font-size: 14px; line-height: 1.5;">Target sub-25ms response times for world-class performance</span>
                    </li>
                    <li style="display: flex; align-items: start; gap: 12px;">
                        <span style="font-size: 20px;">🎯</span>
                        <span style="font-size: 14px; line-height: 1.5;">Maintain 90%+ match rate by regularly reviewing knowledge gaps</span>
                    </li>
                    <li style="display: flex; align-items: start; gap: 12px;">
                        <span style="font-size: 20px;">💯</span>
                        <span style="font-size: 14px; line-height: 1.5;">Aim for 85%+ confidence by refining trigger words and scenarios</span>
                    </li>
                    <li style="display: flex; align-items: start; gap: 12px;">
                        <span style="font-size: 20px;">📊</span>
                        <span style="font-size: 14px; line-height: 1.5;">Monitor trends daily to catch and fix issues before they impact customers</span>
                    </li>
                </ul>
            </div>
        `;
    }

    /**
     * Render Business Intelligence tab
     */
    renderBusiness(container) {
        const { overview, business } = this.data;
        
        if (!overview || !business) {
            container.innerHTML = '<p style="color: #6b7280;">Loading business data...</p>';
            return;
        }
        
        const { callVolume, peakHours, topCategories, summary } = business.business;
        
        container.innerHTML = `
            <!-- Business Summary -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 20px; margin-bottom: 32px;">
                ${this.renderHeroCard('Total Calls', summary.totalCalls, '', null, 'info', '📞')}
                ${this.renderHeroCard('Avg/Day', summary.avgCallsPerDay, 'calls', null, 'info', '📊')}
                ${this.renderHeroCard('Tracking Days', summary.days, 'days', null, 'info', '📅')}
                ${this.renderHeroCard('Peak Hour', peakHours[0] ? this.formatHour(peakHours[0].hour) : 'N/A', '', null, 'info', '⏰')}
            </div>
            
            <!-- Call Volume Chart -->
            <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 24px;">📈 Call Volume (Last 30 Days)</h3>
                <div style="height: 200px; display: flex; align-items: flex-end; gap: 4px; padding: 20px 0;">
                    ${this.renderSimpleBarChart(callVolume)}
                </div>
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-around; font-size: 14px;">
                    <div style="text-align: center;">
                        <p style="font-size: 24px; font-weight: 700; color: #6366f1;">${summary.totalCalls}</p>
                        <p style="color: #6b7280;">Total Calls</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="font-size: 24px; font-weight: 700; color: #10b981;">${summary.avgCallsPerDay}</p>
                        <p style="color: #6b7280;">Avg Per Day</p>
                    </div>
                    <div style="text-align: center;">
                        <p style="font-size: 24px; font-weight: 700; color: #f59e0b;">${Math.max(...callVolume.map(d => d.calls))}</p>
                        <p style="color: #6b7280;">Peak Day</p>
                    </div>
                </div>
            </div>
            
            <!-- Peak Hours & Top Categories -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 24px;">
                <!-- Peak Hours -->
                <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px;">
                    <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px;">⏰ Peak Hours</h3>
                    ${peakHours.length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            ${peakHours.map((h, i) => `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px; background: #f9fafb; border-radius: 8px;">
                                    <div style="display: flex; align-items: center; gap: 12px;">
                                        <span style="font-size: 20px;">${i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'}</span>
                                        <span style="font-size: 16px; font-weight: 600; color: #111827;">${this.formatHour(h.hour)}</span>
                                    </div>
                                    <span style="font-size: 16px; font-weight: 700; color: #6366f1;">${h.calls} calls</span>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<p style="color: #6b7280; text-align: center;">No data available</p>'}
                </div>
                
                <!-- Top Categories -->
                <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px;">
                    <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px;">🏷️ Top Categories</h3>
                    ${topCategories.length > 0 ? `
                        <div style="display: flex; flex-direction: column; gap: 12px;">
                            ${topCategories.map(c => `
                                <div style="padding: 12px; background: #f9fafb; border-radius: 8px;">
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                                        <span style="font-size: 14px; font-weight: 600; color: #111827;">${c.category}</span>
                                        <span style="font-size: 14px; font-weight: 700; color: #6366f1;">${c.percentage}%</span>
                                    </div>
                                    <div style="width: 100%; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden;">
                                        <div style="width: ${c.percentage}%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); border-radius: 4px;"></div>
                                    </div>
                                    <p style="margin-top: 4px; font-size: 12px; color: #6b7280;">${c.count} calls</p>
                                </div>
                            `).join('')}
                        </div>
                    ` : '<p style="color: #6b7280; text-align: center;">No category data available</p>'}
                </div>
            </div>
        `;
    }

    /**
     * Render a hero metric card
     */
    renderHeroCard(label, value, unit, trend, status, icon) {
        const statusColor = this.getStatusColor(status);
        const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';
        const trendColor = trend > 0 ? '#10b981' : trend < 0 ? '#ef4444' : '#6b7280';
        
        return `
            <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px; position: relative; overflow: hidden;">
                <div style="position: absolute; top: 16px; right: 16px; font-size: 32px; opacity: 0.2;">
                    ${icon}
                </div>
                <p style="font-size: 14px; font-weight: 600; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                    ${label}
                </p>
                <div style="display: flex; align-items: baseline; gap: 4px; margin-bottom: 12px;">
                    <span style="font-size: 36px; font-weight: 700; color: ${statusColor};">${value}</span>
                    <span style="font-size: 18px; font-weight: 600; color: #6b7280;">${unit}</span>
                </div>
                ${trend !== null && trend !== undefined ? `
                    <div style="display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 600; color: ${trendColor};">
                        <span style="font-size: 16px;">${trendIcon}</span>
                        <span>${Math.abs(trend)}% vs last period</span>
                    </div>
                ` : ''}
            </div>
        `;
    }

    /**
     * Render status badge
     */
    renderStatusBadge(status) {
        const configs = {
            'excellent': { color: '#10b981', bg: '#d1fae5', text: 'EXCELLENT' },
            'good': { color: '#3b82f6', bg: '#dbeafe', text: 'GOOD' },
            'acceptable': { color: '#f59e0b', bg: '#fef3c7', text: 'OK' },
            'needs_improvement': { color: '#ef4444', bg: '#fee2e2', text: 'NEEDS WORK' }
        };
        
        const config = configs[status] || configs['acceptable'];
        
        return `
            <span style="display: inline-block; padding: 6px 12px; background: ${config.bg}; color: ${config.color}; font-size: 11px; font-weight: 700; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                ${config.text}
            </span>
        `;
    }

    /**
     * Render simple bar chart
     */
    renderSimpleBarChart(data) {
        if (!data || data.length === 0) {
            return '<p style="color: #6b7280; text-align: center; width: 100%;">No call data available yet</p>';
        }
        
        const maxCalls = Math.max(...data.map(d => d.calls));
        const barWidth = `${100 / data.length}%`;
        
        return data.slice(-30).map(day => {
            const height = maxCalls > 0 ? (day.calls / maxCalls * 100) : 0;
            return `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 8px;">
                    <div style="width: 100%; height: ${height}%; background: linear-gradient(180deg, #6366f1, #8b5cf6); border-radius: 4px 4px 0 0; min-height: ${height > 0 ? '4px' : '0'}; transition: all 0.3s;" title="${day.date}: ${day.calls} calls"></div>
                </div>
            `;
        }).join('');
    }

    /**
     * Helper: Get status color
     */
    getStatusColor(status) {
        const colors = {
            'excellent': '#10b981',
            'good': '#3b82f6',
            'acceptable': '#f59e0b',
            'needs_improvement': '#ef4444',
            'info': '#6366f1'
        };
        return colors[status] || '#6b7280';
    }

    /**
     * Helper: Get status label
     */
    getStatusLabel(status) {
        const labels = {
            'excellent': 'Excellent',
            'good': 'Good',
            'acceptable': 'Acceptable',
            'needs_improvement': 'Needs Improvement'
        };
        return labels[status] || 'Unknown';
    }

    /**
     * Helper: Get speed label
     */
    getSpeedLabel(speed) {
        if (speed <= 25) return 'Lightning Fast';
        if (speed <= 50) return 'Fast';
        if (speed <= 100) return 'Acceptable';
        return 'Slow';
    }

    /**
     * Helper: Get confidence color
     */
    getConfidenceColor(confidence) {
        if (confidence >= 85) return '#10b981';
        if (confidence >= 70) return '#3b82f6';
        if (confidence >= 60) return '#f59e0b';
        return '#ef4444';
    }

    /**
     * Helper: Format hour (24h to 12h)
     */
    formatHour(hour) {
        if (hour === 0) return '12 AM';
        if (hour === 12) return '12 PM';
        if (hour < 12) return `${hour} AM`;
        return `${hour - 12} PM`;
    }

    /**
     * Start auto-refresh
     */
    startAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
        }
        
        this.refreshInterval = setInterval(() => {
            console.log('🔄 [ANALYTICS] Auto-refreshing data...');
            this.load();
        }, 60000); // 60 seconds
        
        console.log('✅ [ANALYTICS] Auto-refresh enabled (60s)');
    }

    /**
     * Render loading state
     */
    renderLoading() {
        const container = document.getElementById('ai-settings-analytics-content');
        if (!container) return;
        
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: #6b7280;">
                <div style="font-size: 48px; margin-bottom: 16px; animation: pulse 2s infinite;">📊</div>
                <p style="font-size: 18px; font-weight: 600; margin-bottom: 8px;">Loading Analytics...</p>
                <p style="font-size: 14px;">Crunching the numbers...</p>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderError(message) {
        const container = document.getElementById('ai-settings-analytics-content');
        if (!container) return;
        
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="font-size: 64px; margin-bottom: 16px;">⚠️</div>
                <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 8px;">Failed to Load Analytics</h3>
                <p style="font-size: 14px; color: #6b7280; margin-bottom: 24px;">${message}</p>
                <button onclick="window.analyticsManager.load()" style="padding: 12px 24px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
    }
}

// Expose globally for onclick handlers
window.AnalyticsManager = AnalyticsManager;
