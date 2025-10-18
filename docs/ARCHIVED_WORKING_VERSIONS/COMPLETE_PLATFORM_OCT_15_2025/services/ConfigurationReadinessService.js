/**
 * ============================================================================
 * CONFIGURATION READINESS SERVICE
 * ============================================================================
 * 
 * PURPOSE: Calculate if a company is ready to take live calls
 * 
 * SCORING COMPONENTS (100 points total):
 * - Variables Complete: 45 points
 * - Filler Words Active: 10 points
 * - Scenarios Active: 25 points
 * - Voice Configured: 10 points
 * - Test Calls Made: 10 points
 * 
 * OUTPUTS:
 * - Overall score (0-100)
 * - canGoLive (boolean)
 * - Blockers (critical issues preventing go-live)
 * - Warnings (non-critical issues)
 * - Component scores (detailed breakdown)
 * 
 * ============================================================================
 */

const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

/**
 * Calculate readiness score for a company
 * @param {Object} company - Company document from MongoDB
 * @returns {Object} Readiness report
 */
async function calculateReadiness(company) {
    console.log(`[READINESS] Calculating readiness for company: ${company._id}`);
    
    const report = {
        companyId: company._id,
        companyName: company.companyName,
        calculatedAt: new Date(),
        score: 0,
        canGoLive: false,
        components: {},
        blockers: [],
        warnings: [],
        recommendations: []
    };
    
    // Component 1: Variables Complete (45 points)
    const variablesScore = await scoreVariables(company, report);
    report.components.variables = variablesScore;
    report.score += variablesScore.points;
    
    // Component 2: Filler Words Active (10 points)
    const fillerWordsScore = scoreFillerWords(company, report);
    report.components.fillerWords = fillerWordsScore;
    report.score += fillerWordsScore.points;
    
    // Component 3: Scenarios Active (25 points)
    const scenariosScore = scoreScenarios(company, report);
    report.components.scenarios = scenariosScore;
    report.score += scenariosScore.points;
    
    // Component 4: Voice Configured (10 points)
    const voiceScore = scoreVoice(company, report);
    report.components.voice = voiceScore;
    report.score += voiceScore.points;
    
    // Component 5: Test Calls Made (10 points)
    const testCallsScore = scoreTestCalls(company, report);
    report.components.testCalls = testCallsScore;
    report.score += testCallsScore.points;
    
    // Determine if company can go live
    report.canGoLive = determineCanGoLive(report);
    
    // Add recommendations
    report.recommendations = generateRecommendations(report);
    
    console.log(`[READINESS] ✅ Score: ${report.score}/100, Can Go Live: ${report.canGoLive}`);
    
    return report;
}

/**
 * Score: Variables Complete (45 points)
 */
async function scoreVariables(company, report) {
    const score = {
        points: 0,
        maxPoints: 45,
        percentage: 0,
        status: 'incomplete',
        details: {}
    };
    
    try {
        // Load template to get required variables
        if (!company.configuration?.clonedFrom) {
            report.blockers.push({
                severity: 'critical',
                category: 'variables',
                title: 'No Template Cloned',
                detail: 'Company must clone a Global AI Brain template first',
                impact: 'Cannot configure AI without a template',
                fixTarget: 'ai-agent-settings:template-info'
            });
            return score;
        }
        
        const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
        
        if (!template) {
            report.blockers.push({
                severity: 'critical',
                category: 'variables',
                title: 'Template Not Found',
                detail: `Template ${company.configuration.clonedFrom} no longer exists`,
                impact: 'Cannot validate variables without template',
                fixTarget: 'ai-agent-settings:template-info'
            });
            return score;
        }
        
        // Get variable definitions from template
        const variableDefs = template.variableDefinitions || [];
        const requiredVars = variableDefs.filter(v => v.required);
        const optionalVars = variableDefs.filter(v => !v.required);
        
        score.details.totalRequired = requiredVars.length;
        score.details.totalOptional = optionalVars.length;
        
        // Check which variables are filled
        const companyVars = company.configuration?.variables || new Map();
        
        const filledRequired = requiredVars.filter(v => {
            const value = companyVars.get(v.key);
            return value && value.trim() !== '';
        });
        
        const filledOptional = optionalVars.filter(v => {
            const value = companyVars.get(v.key);
            return value && value.trim() !== '';
        });
        
        score.details.filledRequired = filledRequired.length;
        score.details.filledOptional = filledOptional.length;
        
        // Calculate points
        // Required variables: 35 points
        // Optional variables: 10 points
        const requiredPercentage = requiredVars.length > 0 
            ? filledRequired.length / requiredVars.length 
            : 1;
        const optionalPercentage = optionalVars.length > 0 
            ? filledOptional.length / optionalVars.length 
            : 1;
        
        score.points = Math.round(
            (requiredPercentage * 35) + (optionalPercentage * 10)
        );
        score.percentage = Math.round((score.points / score.maxPoints) * 100);
        
        // Add blockers for missing required variables
        const missingRequired = requiredVars.filter(v => {
            const value = companyVars.get(v.key);
            return !value || value.trim() === '';
        });
        
        if (missingRequired.length > 0) {
            report.blockers.push({
                severity: 'critical',
                category: 'variables',
                title: `${missingRequired.length} Required Variable${missingRequired.length > 1 ? 's' : ''} Missing`,
                detail: `Missing: ${missingRequired.map(v => v.label).join(', ')}`,
                impact: 'AI cannot personalize responses without these values',
                fixTarget: 'ai-agent-settings:variables'
            });
        }
        
        // Add warnings for missing optional variables
        const missingOptional = optionalVars.filter(v => {
            const value = companyVars.get(v.key);
            return !value || value.trim() === '';
        });
        
        if (missingOptional.length > 0) {
            report.warnings.push({
                severity: 'minor',
                category: 'variables',
                title: `${missingOptional.length} Optional Variable${missingOptional.length > 1 ? 's' : ''} Empty`,
                detail: `Consider filling: ${missingOptional.slice(0, 3).map(v => v.label).join(', ')}`,
                impact: 'AI will use placeholder text instead',
                fixTarget: 'ai-agent-settings:variables'
            });
        }
        
        score.status = requiredPercentage === 1 ? 'complete' : 'incomplete';
        
    } catch (error) {
        console.error('[READINESS] Error scoring variables:', error);
        report.blockers.push({
            severity: 'critical',
            category: 'variables',
            title: 'Variables Check Failed',
            detail: error.message,
            impact: 'Cannot verify variable configuration',
            fixTarget: 'ai-agent-settings:variables'
        });
    }
    
    return score;
}

/**
 * Score: Filler Words Active (10 points)
 */
function scoreFillerWords(company, report) {
    const score = {
        points: 0,
        maxPoints: 10,
        percentage: 0,
        status: 'incomplete',
        details: {}
    };
    
    const fillerWords = company.configuration?.fillerWords || {};
    const inherited = fillerWords.inherited || [];
    const custom = fillerWords.custom || [];
    const total = inherited.length + custom.length;
    
    score.details.inherited = inherited.length;
    score.details.custom = custom.length;
    score.details.total = total;
    
    if (total >= 10) {
        score.points = 10;
        score.percentage = 100;
        score.status = 'complete';
    } else if (total >= 5) {
        score.points = 7;
        score.percentage = 70;
        score.status = 'partial';
        report.warnings.push({
            severity: 'minor',
            category: 'fillerWords',
            title: 'Limited Filler Words',
            detail: `Only ${total} filler words configured (recommend 10+)`,
            impact: 'AI may not ignore common conversational noise',
            fixTarget: 'ai-agent-settings:filler-words'
        });
    } else {
        score.points = 0;
        score.percentage = 0;
        score.status = 'incomplete';
        report.blockers.push({
            severity: 'major',
            category: 'fillerWords',
            title: 'No Filler Words Configured',
            detail: 'Filler words help AI ignore "um", "uh", "like", etc.',
            impact: 'AI may misinterpret conversational noise as intent',
            fixTarget: 'ai-agent-settings:filler-words'
        });
    }
    
    return score;
}

/**
 * Score: Scenarios Active (25 points)
 */
function scoreScenarios(company, report) {
    const score = {
        points: 0,
        maxPoints: 25,
        percentage: 0,
        status: 'incomplete',
        details: {}
    };
    
    // Count active scenarios
    // Scenarios are inherited from template and stored in instantResponses collection
    // For now, we'll check if the company has cloned a template
    
    const hasTemplate = !!company.configuration?.clonedFrom;
    const clonedAt = company.configuration?.clonedAt;
    
    if (!hasTemplate) {
        score.points = 0;
        score.status = 'incomplete';
        report.blockers.push({
            severity: 'critical',
            category: 'scenarios',
            title: 'No Scenarios Configured',
            detail: 'Company must clone a Global AI Brain template to get scenarios',
            impact: 'AI has no knowledge to respond to callers',
            fixTarget: 'ai-agent-settings:scenarios'
        });
    } else {
        // Company has cloned template, assume scenarios are active
        score.points = 25;
        score.percentage = 100;
        score.status = 'complete';
        score.details.clonedAt = clonedAt;
        score.details.templateId = company.configuration.clonedFrom;
        
        // Check if template has been updated since cloning
        const lastSyncedAt = company.configuration?.lastSyncedAt;
        if (!lastSyncedAt || (clonedAt && lastSyncedAt < clonedAt)) {
            report.warnings.push({
                severity: 'minor',
                category: 'scenarios',
                title: 'Template May Have Updates',
                detail: 'Your Global AI Brain template may have been updated since cloning',
                impact: 'Missing latest improvements and fixes',
                fixTarget: 'ai-agent-settings:scenarios'
            });
        }
    }
    
    return score;
}

/**
 * Score: Voice Configured (10 points)
 */
function scoreVoice(company, report) {
    const score = {
        points: 0,
        maxPoints: 10,
        percentage: 0,
        status: 'incomplete',
        details: {}
    };
    
    const voice = company.voiceSettings || {};
    
    // Check if voice provider is configured
    const hasProvider = !!voice.provider;
    const hasVoiceId = !!voice.voiceId;
    
    score.details.provider = voice.provider || 'none';
    score.details.voiceId = voice.voiceId || 'none';
    
    if (hasProvider && hasVoiceId) {
        score.points = 10;
        score.percentage = 100;
        score.status = 'complete';
    } else {
        score.points = 0;
        score.percentage = 0;
        score.status = 'incomplete';
        report.blockers.push({
            severity: 'critical',
            category: 'voice',
            title: 'Voice Not Configured',
            detail: 'AI needs a voice to speak with callers',
            impact: 'AI cannot make or receive calls',
            fixTarget: 'ai-voice-settings'
        });
    }
    
    return score;
}

/**
 * Score: Test Calls Made (10 points)
 */
function scoreTestCalls(company, report) {
    const score = {
        points: 0,
        maxPoints: 10,
        percentage: 0,
        status: 'incomplete',
        details: {}
    };
    
    // Check if company has made test calls
    // This would ideally check v2AIAgentCallLog collection
    // For now, we'll give partial credit if they've configured everything else
    
    const testCallsMade = company.configuration?.testCallsMade || 0;
    
    score.details.testCallsMade = testCallsMade;
    
    if (testCallsMade >= 3) {
        score.points = 10;
        score.percentage = 100;
        score.status = 'complete';
    } else if (testCallsMade >= 1) {
        score.points = 5;
        score.percentage = 50;
        score.status = 'partial';
        report.warnings.push({
            severity: 'minor',
            category: 'testCalls',
            title: 'Limited Testing',
            detail: `Only ${testCallsMade} test call${testCallsMade > 1 ? 's' : ''} made (recommend 3+)`,
            impact: 'AI may have untested edge cases',
            fixTarget: 'ai-agent-settings:template-info'
        });
    } else {
        score.points = 0;
        score.percentage = 0;
        score.status = 'incomplete';
        report.warnings.push({
            severity: 'major',
            category: 'testCalls',
            title: 'No Test Calls Made',
            detail: 'Recommend making 3+ test calls before going live',
            impact: 'AI behavior has not been verified',
            fixTarget: 'ai-agent-settings:template-info'
        });
    }
    
    return score;
}

/**
 * Determine if company can go live
 */
function determineCanGoLive(report) {
    // Must have 0 critical blockers
    const criticalBlockers = report.blockers.filter(b => b.severity === 'critical');
    
    if (criticalBlockers.length > 0) {
        return false;
    }
    
    // Must have score >= 70
    if (report.score < 70) {
        return false;
    }
    
    return true;
}

/**
 * Generate personalized recommendations
 */
function generateRecommendations(report) {
    const recommendations = [];
    
    // Based on score
    if (report.score >= 90) {
        recommendations.push({
            priority: 'high',
            action: 'Go Live',
            description: 'Your AI agent is fully configured and ready for live calls!',
            icon: '🚀'
        });
    } else if (report.score >= 70) {
        recommendations.push({
            priority: 'medium',
            action: 'Make Test Calls',
            description: 'Configuration is complete. Test your AI before going live.',
            icon: '📞'
        });
    } else {
        recommendations.push({
            priority: 'high',
            action: 'Complete Configuration',
            description: 'Fill in missing variables and configure voice settings.',
            icon: '⚙️'
        });
    }
    
    // Component-specific recommendations
    if (report.components.variables?.percentage < 100) {
        recommendations.push({
            priority: 'high',
            action: 'Fill Required Variables',
            description: 'Complete pricing, contact info, and business details.',
            icon: '📝'
        });
    }
    
    if (report.components.fillerWords?.percentage < 70) {
        recommendations.push({
            priority: 'medium',
            action: 'Add Filler Words',
            description: 'Help AI ignore "um", "uh", "like" in conversations.',
            icon: '🔇'
        });
    }
    
    if (report.components.testCalls?.testCallsMade === 0) {
        recommendations.push({
            priority: 'high',
            action: 'Test Your AI',
            description: 'Make at least 3 test calls to verify AI behavior.',
            icon: '🧪'
        });
    }
    
    return recommendations;
}

module.exports = {
    calculateReadiness
};

