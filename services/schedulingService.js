// services/schedulingService.js
// Enhanced Scheduling Service - Phase 4
// Integrates existing schedulingRules with contact management

/**
 * Check if a service can be scheduled based on company rules
 */
function canScheduleService(company, serviceName, requestedDate = new Date()) {
    const schedulingRules = company.agentSetup?.schedulingRules || [];
    
    // Find matching rule for the service
    const rule = schedulingRules.find(r => 
        r.serviceName.toLowerCase() === serviceName.toLowerCase()
    );
    
    if (!rule) {
        return { canSchedule: false, reason: 'No scheduling rule found for this service' };
    }
    
    const dayOfWeek = new Date(requestedDate).toLocaleDateString('en-US', { weekday: 'long' });
    
    // Check if service is available on the requested day
    const dayRule = rule.dailyServiceHours.find(d => d.day === dayOfWeek);
    if (!dayRule || !dayRule.enabled) {
        return { canSchedule: false, reason: `Service not available on ${dayOfWeek}` };
    }
    
    return { canSchedule: true, rule, message: 'Service can be scheduled' };
}

/**
 * Generate intelligent scheduling response for AI agent
 */
function generateSchedulingResponse(company, serviceName, contact) {
    const result = canScheduleService(company, serviceName);
    
    if (!result.canSchedule) {
        return {
            canSchedule: false,
            response: `I understand you need ${serviceName}. Unfortunately, ${result.reason}. Let me connect you with someone who can help with scheduling.`
        };
    }
    
    const rule = result.rule;
    
    // Check for emergency/immediate scheduling
    if (rule.schedulingType === 'immediate') {
        return {
            canSchedule: true,
            isEmergency: true,
            response: `I understand this is urgent. We provide emergency ${serviceName} service. Let me connect you immediately with our dispatch team.`,
            nextAction: 'transfer_to_dispatch'
        };
    }
    
    // Future booking logic
    return {
        canSchedule: true,
        response: `I can help you schedule ${serviceName}. Let me have our scheduling coordinator call you back within the hour to set up an appointment that works for your schedule.`,
        nextAction: 'schedule_callback'
    };
}

/**
 * Detect service types mentioned in speech text
 */
function detectServiceTypes(speechText, company) {
    const schedulingRules = company.agentSetup?.schedulingRules || [];
    const detectedServices = [];
    
    const speechLower = speechText.toLowerCase();
    
    schedulingRules.forEach(rule => {
        if (speechLower.includes(rule.serviceName.toLowerCase())) {
            detectedServices.push(rule.serviceName);
        }
    });
    
    return detectedServices;
}

module.exports = {
    canScheduleService,
    generateSchedulingResponse,
    detectServiceTypes
};
