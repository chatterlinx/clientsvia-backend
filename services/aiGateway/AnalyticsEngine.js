// ============================================================================
// 📈 AI GATEWAY - ANALYTICS ENGINE
// ============================================================================
// PURPOSE: Calculate trends, statistics, and performance metrics
// FEATURES: Response times, uptime %, P50/P95/P99, SLA tracking
// CREATED: 2025-10-29
// ============================================================================

const { AIGatewayHealthLog } = require('../../models/aiGateway');
const logger = require('../../utils/logger');

class AnalyticsEngine {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [ANALYTICS ENGINE] Initializing...');
        console.log('✅ [ANALYTICS ENGINE] Initialized');
    }
    
    // ========================================================================
    // 📊 RESPONSE TIME ANALYTICS
    // ========================================================================
    
    /**
     * Get response time trends for a service
     */
    async getResponseTimeTrends(service, days = 7) {
        console.log(`📊 [ANALYTICS] Getting response time trends for ${service} (${days} days)`);
        
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            // Get all health logs for the period
            const logs = await AIGatewayHealthLog.find({
                timestamp: { $gte: startDate },
                [`${service}.status`]: 'HEALTHY'
            }).sort({ timestamp: 1 }).lean();
            
            if (logs.length === 0) {
                return {
                    service,
                    period: `${days} days`,
                    dataPoints: [],
                    stats: { average: 0, min: 0, max: 0, p50: 0, p95: 0, p99: 0 }
                };
            }
            
            // Extract response times
            const responseTimes = logs.map(log => {
                const serviceData = log[service];
                return serviceData.responseTime || serviceData.queryTime || serviceData.latency || 0;
            }).filter(rt => rt > 0);
            
            // Calculate statistics
            const sorted = [...responseTimes].sort((a, b) => a - b);
            const stats = {
                average: Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length),
                min: Math.min(...responseTimes),
                max: Math.max(...responseTimes),
                p50: this.calculatePercentile(sorted, 50),
                p95: this.calculatePercentile(sorted, 95),
                p99: this.calculatePercentile(sorted, 99)
            };
            
            // Group by day for chart data
            const dataPoints = this.groupByDay(logs, service);
            
            console.log(`✅ [ANALYTICS] ${service} trends: avg=${stats.average}ms, p95=${stats.p95}ms`);
            
            return {
                service,
                period: `${days} days`,
                dataPoints,
                stats
            };
            
        } catch (error) {
            console.error(`❌ [ANALYTICS] Failed to get trends:`, error.message);
            throw error;
        }
    }
    
    /**
     * Group health logs by day and calculate daily averages
     */
    groupByDay(logs, service) {
        const dailyData = {};
        
        logs.forEach(log => {
            const date = new Date(log.timestamp).toISOString().split('T')[0]; // YYYY-MM-DD
            const serviceData = log[service];
            const responseTime = serviceData.responseTime || serviceData.queryTime || serviceData.latency || 0;
            
            if (!dailyData[date]) {
                dailyData[date] = { values: [], date };
            }
            
            if (responseTime > 0) {
                dailyData[date].values.push(responseTime);
            }
        });
        
        // Calculate daily stats
        return Object.values(dailyData).map(day => {
            const values = day.values;
            return {
                date: day.date,
                average: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
                min: Math.min(...values),
                max: Math.max(...values),
                count: values.length
            };
        }).sort((a, b) => a.date.localeCompare(b.date));
    }
    
    /**
     * Calculate percentile
     */
    calculatePercentile(sortedValues, percentile) {
        if (sortedValues.length === 0) return 0;
        const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
        return sortedValues[Math.max(0, index)];
    }
    
    // ========================================================================
    // ⏱️ UPTIME & SLA TRACKING
    // ========================================================================
    
    /**
     * Calculate uptime percentage for all services
     */
    async getUptimeStats(days = 30) {
        console.log(`⏱️ [ANALYTICS] Calculating uptime for last ${days} days`);
        
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const logs = await AIGatewayHealthLog.find({
                timestamp: { $gte: startDate }
            }).lean();
            
            if (logs.length === 0) {
                return {
                    period: `${days} days`,
                    services: {}
                };
            }
            
            const services = ['openai', 'mongodb', 'redis'];
            const uptimeData = {};
            
            for (const service of services) {
                const healthyChecks = logs.filter(log => log[service]?.status === 'HEALTHY').length;
                const totalChecks = logs.length;
                const uptime = (healthyChecks / totalChecks) * 100;
                
                // Calculate downtime incidents
                const incidents = this.detectDowntimeIncidents(logs, service);
                
                uptimeData[service] = {
                    uptime: parseFloat(uptime.toFixed(2)),
                    healthyChecks,
                    totalChecks,
                    incidents: incidents.length,
                    totalDowntime: this.calculateTotalDowntime(incidents),
                    target: 99.9, // SLA target
                    meetsTarget: uptime >= 99.9
                };
            }
            
            console.log(`✅ [ANALYTICS] Uptime calculated for ${days} days`);
            
            return {
                period: `${days} days`,
                services: uptimeData
            };
            
        } catch (error) {
            console.error(`❌ [ANALYTICS] Failed to calculate uptime:`, error.message);
            throw error;
        }
    }
    
    /**
     * Detect downtime incidents (consecutive failures)
     */
    detectDowntimeIncidents(logs, service) {
        const incidents = [];
        let currentIncident = null;
        
        logs.forEach(log => {
            const status = log[service]?.status;
            const isUnhealthy = status === 'UNHEALTHY' || status === 'CRITICAL';
            
            if (isUnhealthy) {
                if (!currentIncident) {
                    // Start new incident
                    currentIncident = {
                        startTime: log.timestamp,
                        endTime: log.timestamp,
                        checks: 1,
                        service
                    };
                } else {
                    // Extend current incident
                    currentIncident.endTime = log.timestamp;
                    currentIncident.checks++;
                }
            } else {
                if (currentIncident) {
                    // End current incident
                    incidents.push(currentIncident);
                    currentIncident = null;
                }
            }
        });
        
        // Add last incident if still ongoing
        if (currentIncident) {
            incidents.push(currentIncident);
        }
        
        return incidents;
    }
    
    /**
     * Calculate total downtime in minutes
     */
    calculateTotalDowntime(incidents) {
        const totalMs = incidents.reduce((sum, incident) => {
            const duration = new Date(incident.endTime) - new Date(incident.startTime);
            return sum + duration;
        }, 0);
        
        return Math.round(totalMs / 1000 / 60); // Convert to minutes
    }
    
    // ========================================================================
    // 📊 COMPREHENSIVE DASHBOARD DATA
    // ========================================================================
    
    /**
     * Get complete analytics dashboard data
     */
    async getDashboardData(days = 7) {
        console.log(`📊 [ANALYTICS] Generating dashboard data for ${days} days`);
        
        try {
            // Get trends for all services
            const openaiTrends = await this.getResponseTimeTrends('openai', days);
            const mongodbTrends = await this.getResponseTimeTrends('mongodb', days);
            const redisTrends = await this.getResponseTimeTrends('redis', days);
            
            // Get uptime stats
            const uptimeStats = await this.getUptimeStats(days);
            
            // Get overall health summary
            const healthSummary = await this.getHealthSummary(days);
            
            return {
                trends: {
                    openai: openaiTrends,
                    mongodb: mongodbTrends,
                    redis: redisTrends
                },
                uptime: uptimeStats,
                health: healthSummary,
                period: `${days} days`,
                generatedAt: new Date()
            };
            
        } catch (error) {
            console.error(`❌ [ANALYTICS] Failed to generate dashboard:`, error.message);
            throw error;
        }
    }
    
    /**
     * Get overall health summary
     */
    async getHealthSummary(days = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);
            
            const logs = await AIGatewayHealthLog.find({
                timestamp: { $gte: startDate }
            }).lean();
            
            const totalChecks = logs.length;
            const healthyChecks = logs.filter(l => l.overallStatus === 'ALL_HEALTHY').length;
            const degradedChecks = logs.filter(l => l.overallStatus === 'DEGRADED').length;
            const criticalChecks = logs.filter(l => l.overallStatus === 'CRITICAL').length;
            
            return {
                totalChecks,
                breakdown: {
                    healthy: healthyChecks,
                    degraded: degradedChecks,
                    critical: criticalChecks
                },
                percentages: {
                    healthy: ((healthyChecks / totalChecks) * 100).toFixed(1),
                    degraded: ((degradedChecks / totalChecks) * 100).toFixed(1),
                    critical: ((criticalChecks / totalChecks) * 100).toFixed(1)
                }
            };
            
        } catch (error) {
            console.error(`❌ [ANALYTICS] Failed to get health summary:`, error.message);
            return {
                totalChecks: 0,
                breakdown: { healthy: 0, degraded: 0, critical: 0 },
                percentages: { healthy: '0', degraded: '0', critical: '0' }
            };
        }
    }
    
    // ========================================================================
    // 🔮 TREND PREDICTION
    // ========================================================================
    
    /**
     * Calculate trend direction (improving, stable, degrading)
     */
    calculateTrend(dataPoints) {
        if (dataPoints.length < 2) return 'stable';
        
        // Compare first half vs second half
        const midpoint = Math.floor(dataPoints.length / 2);
        const firstHalf = dataPoints.slice(0, midpoint);
        const secondHalf = dataPoints.slice(midpoint);
        
        const firstAvg = firstHalf.reduce((sum, d) => sum + d.average, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, d) => sum + d.average, 0) / secondHalf.length;
        
        const change = ((secondAvg - firstAvg) / firstAvg) * 100;
        
        if (change < -5) return 'improving'; // Response times decreased by >5%
        if (change > 5) return 'degrading'; // Response times increased by >5%
        return 'stable';
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new AnalyticsEngine();

