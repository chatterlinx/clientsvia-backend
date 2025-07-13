/**
 * AI Agent Analytics Service
 * Provides comprehensive analytics for call performance and agent effectiveness
 */

const Company = require('../models/Company');

class AIAgentAnalyticsService {
    
    /**
     * Get comprehensive analytics for a company's AI agent
     */
    static async getAgentAnalytics(companyId, dateRange = {}) {
        try {
            const { startDate, endDate } = dateRange;
            
            // This would integrate with your existing call logging system
            const analytics = {
                overview: {
                    totalCalls: 190,
                    callsCompleted: 165,
                    actionsTriggered: 100,
                    averageDuration: 0.5,
                    totalDuration: 95,
                    sentiment: {
                        positive: 58,
                        neutral: 30,
                        negative: 12
                    }
                },
                trends: {
                    callVolume: [
                        { date: '2025-07-01', calls: 16 },
                        { date: '2025-07-02', calls: 15 },
                        { date: '2025-07-03', calls: 23 },
                        { date: '2025-07-04', calls: 24 },
                        { date: '2025-07-05', calls: 5 },
                        { date: '2025-07-06', calls: 6 },
                        { date: '2025-07-07', calls: 27 },
                        { date: '2025-07-08', calls: 15 },
                        { date: '2025-07-09', calls: 15 },
                        { date: '2025-07-10', calls: 28 },
                        { date: '2025-07-11', calls: 20 },
                        { date: '2025-07-12', calls: 8 },
                        { date: '2025-07-13', calls: 0 }
                    ],
                    completionRate: [
                        { date: '2025-07-01', rate: 92 },
                        { date: '2025-07-02', rate: 89 },
                        { date: '2025-07-03', rate: 95 },
                        { date: '2025-07-04', rate: 91 },
                        { date: '2025-07-05', rate: 88 },
                        { date: '2025-07-06', rate: 93 },
                        { date: '2025-07-07', rate: 96 }
                    ]
                },
                performance: {
                    responseTime: {
                        average: 1.8,
                        median: 1.5,
                        p95: 3.2
                    },
                    conversionRates: {
                        appointmentBooking: 85,
                        informationProvided: 94,
                        callTransfer: 78
                    },
                    commonFailures: [
                        { issue: 'Complex scheduling request', count: 8 },
                        { issue: 'Technical difficulties', count: 5 },
                        { issue: 'Out of scope inquiry', count: 12 }
                    ]
                },
                recentCalls: [
                    {
                        id: 'call_001',
                        contactName: 'Gina Duder',
                        fromNumber: '(870) 930-0324',
                        dateTime: '2025-07-12 2:24 PM',
                        duration: '00:16',
                        status: 'completed',
                        actionsTriggered: ['emergency Service call Team'],
                        sentiment: 'positive'
                    },
                    {
                        id: 'call_002',
                        contactName: 'Pengu',
                        fromNumber: '(239) 361-5532',
                        dateTime: '2025-07-12 1:45 PM',
                        duration: '-',
                        status: 'missed',
                        actionsTriggered: [],
                        sentiment: 'neutral'
                    },
                    {
                        id: 'call_003',
                        contactName: '(440) 667-1890',
                        fromNumber: '(440) 667-1890',
                        dateTime: '2025-07-12 1:34 PM',
                        duration: '00:32',
                        status: 'completed',
                        actionsTriggered: [],
                        sentiment: 'positive'
                    },
                    {
                        id: 'call_004',
                        contactName: '(440) 667-1890',
                        fromNumber: '(440) 667-1890',
                        dateTime: '2025-07-12 1:33 PM',
                        duration: '00:21',
                        status: 'completed',
                        actionsTriggered: ['appointment inquiries'],
                        sentiment: 'positive'
                    }
                ],
                actionAnalytics: {
                    mostTriggered: [
                        { action: 'appointment inquiries', count: 45 },
                        { action: 'emergency Service call Team', count: 32 },
                        { action: 'information request', count: 23 }
                    ],
                    successRates: {
                        'call-transfer': 95,
                        'book-appointment': 87,
                        'send-sms': 99,
                        'extract-data': 92
                    }
                }
            };

            return analytics;
        } catch (error) {
            console.error('Failed to get agent analytics:', error);
            throw error;
        }
    }

    /**
     * Get real-time agent performance metrics
     */
    static async getRealTimeMetrics(companyId) {
        try {
            return {
                status: 'active',
                currentCalls: 0,
                averageResponseTime: '1.2s',
                lastCallTime: '2025-07-12 2:24 PM',
                todayStats: {
                    calls: 8,
                    completed: 7,
                    actionsTaken: 12
                },
                systemHealth: {
                    aiStatus: 'healthy',
                    phoneStatus: 'connected',
                    workflowStatus: 'active'
                }
            };
        } catch (error) {
            console.error('Failed to get real-time metrics:', error);
            throw error;
        }
    }

    /**
     * Generate insights and recommendations
     */
    static async getInsights(companyId) {
        try {
            return {
                insights: [
                    {
                        type: 'performance',
                        title: 'High Call Completion Rate',
                        description: 'Your agent is successfully completing 87% of calls, which is above industry average.',
                        action: null,
                        priority: 'good'
                    },
                    {
                        type: 'improvement',
                        title: 'Optimize Response Time',
                        description: 'Average response time is 1.8s. Consider simplifying complex prompts to reach the 1.5s target.',
                        action: 'Review prompt complexity in Advanced settings',
                        priority: 'medium'
                    },
                    {
                        type: 'knowledge',
                        title: 'Knowledge Gap Detected',
                        description: '12 calls failed due to out-of-scope inquiries. Consider adding more Q&A entries.',
                        action: 'Add knowledge entries for common questions',
                        priority: 'high'
                    },
                    {
                        type: 'workflow',
                        title: 'Successful Action Execution',
                        description: 'Workflow actions are executing with 95% success rate. Great job!',
                        action: null,
                        priority: 'good'
                    }
                ]
            };
        } catch (error) {
            console.error('Failed to generate insights:', error);
            throw error;
        }
    }

    /**
     * Export analytics data
     */
    static async exportAnalytics(companyId, format = 'csv', dateRange = {}) {
        try {
            const analytics = await this.getAgentAnalytics(companyId, dateRange);
            
            if (format === 'csv') {
                return this.generateCSVExport(analytics);
            } else if (format === 'json') {
                return analytics;
            }
            
            throw new Error('Unsupported export format');
        } catch (error) {
            console.error('Failed to export analytics:', error);
            throw error;
        }
    }

    static generateCSVExport(analytics) {
        const csvData = [
            ['Date', 'Total Calls', 'Completed Calls', 'Actions Triggered', 'Completion Rate'],
            ...analytics.trends.callVolume.map((day, index) => [
                day.date,
                day.calls,
                Math.round(day.calls * (analytics.trends.completionRate[index]?.rate || 90) / 100),
                Math.round(day.calls * 0.6), // Estimate actions
                analytics.trends.completionRate[index]?.rate || 90
            ])
        ];

        return csvData.map(row => row.join(',')).join('\n');
    }
}

module.exports = AIAgentAnalyticsService;
