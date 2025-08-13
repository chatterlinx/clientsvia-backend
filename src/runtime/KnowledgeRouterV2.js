/**
 * 🎯 BLUEPRINT COMPLIANCE: Knowledge Router
 * Implements priority flow + thresholds for AI agent decisions
 * Core component of the production-ready AI Agent Logic system
 * 
 * ENTERPRISE UPGRADE: Now uses EnterpriseKnowledgeRouter for optimal performance
 */

const EnterpriseKnowledgeRouter = require('./EnterpriseKnowledgeRouter');

class KnowledgeRouter {
    constructor() {
        this.enterpriseRouter = EnterpriseKnowledgeRouter;
        console.log('🚀 Knowledge Router initialized with Enterprise backend');
    }

    /**
     * Route a user query through the knowledge priority flow
     * Uses enterprise-grade caching and optimized algorithms
     */
    async route(params) {
        return await this.enterpriseRouter.route(params);
    }

    /**
     * Legacy methods for backward compatibility
     */
    async searchCompanyKB(companyID, text, cfg) {
        return await this.enterpriseRouter.searchCompanyKB(companyID, text, cfg);
    }

    async searchTradeQA(tradeCategories, text) {
        return await this.enterpriseRouter.searchTradeQA(tradeCategories, text);
    }

    /**
     * Get performance analytics
     */
    getAnalytics() {
        return this.enterpriseRouter.getAnalytics();
    }

    /**
     * Health check for monitoring
     */
    async healthCheck() {
        const enterpriseCache = require('../services/enterpriseCacheService');
        return {
            status: 'ok',
            cache: await enterpriseCache.healthCheck(),
            analytics: this.getAnalytics()
        };
    }
}

module.exports = KnowledgeRouter;
