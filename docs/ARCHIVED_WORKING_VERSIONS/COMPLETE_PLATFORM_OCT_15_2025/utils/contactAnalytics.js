// utils/contactAnalytics.js
// Contact Analytics and Lead Scoring Utilities

/**
 * Calculate lead score based on contact behavior and interaction data
 * Higher scores indicate more qualified/valuable leads
 */
function calculateLeadScore(contact) {
  let score = 0;
  
  // Base score for having contact info
  if (contact.firstName && contact.lastName) score += 10;
  if (contact.email) score += 5;
  if (contact.primaryAddress) score += 5;
  
  // Interaction frequency scoring
  const totalInteractions = contact.interactions?.length || 0;
  if (totalInteractions >= 5) score += 20;
  else if (totalInteractions >= 3) score += 15;
  else if (totalInteractions >= 2) score += 10;
  else if (totalInteractions >= 1) score += 5;
  
  // Recent activity scoring
  const daysSinceLastContact = contact.lastContactDate ? 
    Math.floor((Date.now() - new Date(contact.lastContactDate)) / (1000 * 60 * 60 * 24)) : 999;
  
  if (daysSinceLastContact <= 1) score += 20;
  else if (daysSinceLastContact <= 7) score += 15;
  else if (daysSinceLastContact <= 30) score += 10;
  else if (daysSinceLastContact <= 90) score += 5;
  
  // Service request scoring
  const pendingRequests = contact.serviceRequests?.filter(req => req.status === 'pending') || [];
  const completedRequests = contact.serviceRequests?.filter(req => req.status === 'completed') || [];
  
  score += pendingRequests.length * 25; // High value for pending requests
  score += completedRequests.length * 15; // Value for past customers
  
  // Emergency/urgency scoring
  if (contact.extractedData?.hasEmergency) score += 30;
  
  // Sentiment scoring
  if (contact.extractedData?.sentimentScore > 0) score += 10;
  else if (contact.extractedData?.sentimentScore < -2) score += 20; // Negative sentiment needs attention
  
  // Customer type scoring
  if (contact.customerType === 'commercial') score += 15; // Higher value typically
  
  // Repeat customer bonus
  if (contact.status === 'customer') score += 25;
  
  return Math.min(score, 100); // Cap at 100
}

/**
 * Determine contact priority based on multiple factors
 */
function getContactPriority(contact) {
  const score = calculateLeadScore(contact);
  const hasEmergency = contact.extractedData?.hasEmergency;
  const hasPendingRequest = contact.serviceRequests?.some(req => req.status === 'pending');
  
  if (hasEmergency) return 'emergency';
  if (score >= 80 || hasPendingRequest) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 30) return 'low';
  return 'follow_up';
}

/**
 * Generate insights about a contact's interaction patterns
 */
function generateContactInsights(contact) {
  const insights = [];
  
  const callCount = contact.interactions?.filter(i => i.type === 'call').length || 0;
  const avgCallDuration = contact.interactions?.length > 0 ? 
    contact.interactions
      .filter(i => i.type === 'call' && i.duration)
      .reduce((sum, i) => sum + i.duration, 0) / callCount : 0;
  
  // Call patterns
  if (callCount >= 3) {
    insights.push('frequent_caller');
  }
  
  if (avgCallDuration > 300) { // 5+ minutes average
    insights.push('long_conversations');
  }
  
  // Service patterns
  const serviceRequestCount = contact.serviceRequests?.length || 0;
  if (serviceRequestCount >= 2) {
    insights.push('repeat_service_requests');
  }
  
  // Timing patterns
  const daysSinceLastContact = contact.lastContactDate ? 
    Math.floor((Date.now() - new Date(contact.lastContactDate)) / (1000 * 60 * 60 * 24)) : 999;
  
  if (daysSinceLastContact <= 1) {
    insights.push('very_recent_contact');
  } else if (daysSinceLastContact > 90) {
    insights.push('dormant_contact');
  }
  
  // Keywords patterns
  const keywords = contact.extractedData?.mentionedKeywords || [];
  if (keywords.includes('emergency') || keywords.includes('urgent')) {
    insights.push('emergency_keywords');
  }
  
  if (keywords.includes('quote') || keywords.includes('estimate')) {
    insights.push('price_shopper');
  }
  
  // Sentiment patterns
  if (contact.extractedData?.sentimentScore > 1) {
    insights.push('positive_sentiment');
  } else if (contact.extractedData?.sentimentScore < -1) {
    insights.push('negative_sentiment');
  }
  
  return insights;
}

/**
 * Get recommended actions for a contact
 */
function getRecommendedActions(contact) {
  const actions = [];
  const priority = getContactPriority(contact);
  const insights = generateContactInsights(contact);
  
  // Emergency actions
  if (contact.extractedData?.hasEmergency) {
    actions.push({
      type: 'immediate_callback',
      priority: 'emergency',
      description: 'Emergency service request detected - immediate callback required'
    });
  }
  
  // Service request actions
  const pendingRequests = contact.serviceRequests?.filter(req => req.status === 'pending') || [];
  if (pendingRequests.length > 0) {
    actions.push({
      type: 'schedule_service',
      priority: 'high',
      description: `Schedule ${pendingRequests.length} pending service request(s)`
    });
  }
  
  // Follow-up actions based on insights
  if (insights.includes('negative_sentiment')) {
    actions.push({
      type: 'customer_service_review',
      priority: 'medium',
      description: 'Review interaction - negative sentiment detected'
    });
  }
  
  if (insights.includes('price_shopper')) {
    actions.push({
      type: 'send_quote',
      priority: 'medium',
      description: 'Send detailed quote - price inquiry detected'
    });
  }
  
  if (insights.includes('dormant_contact')) {
    actions.push({
      type: 'reactivation_campaign',
      priority: 'low',
      description: 'Add to reactivation campaign - dormant for 90+ days'
    });
  }
  
  // General follow-up based on priority
  if (priority === 'high' && actions.length === 0) {
    actions.push({
      type: 'priority_follow_up',
      priority: 'high',
      description: 'High-value lead - prioritize follow-up contact'
    });
  }
  
  return actions;
}

/**
 * Generate analytics summary for a company's contacts
 */
function generateCompanyContactAnalytics(contacts) {
  const analytics = {
    totalContacts: contacts.length,
    statusBreakdown: {},
    priorityBreakdown: {},
    totalServiceRequests: 0,
    totalRevenue: 0,
    averageLeadScore: 0,
    recentActivity: 0,
    emergencyContacts: 0
  };
  
  let totalScore = 0;
  const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  contacts.forEach(contact => {
    // Status breakdown
    analytics.statusBreakdown[contact.status] = 
      (analytics.statusBreakdown[contact.status] || 0) + 1;
    
    // Priority breakdown
    const priority = getContactPriority(contact);
    analytics.priorityBreakdown[priority] = 
      (analytics.priorityBreakdown[priority] || 0) + 1;
    
    // Service requests
    analytics.totalServiceRequests += contact.serviceRequests?.length || 0;
    
    // Revenue tracking
    analytics.totalRevenue += contact.actualValue || 0;
    
    // Lead scoring
    const score = calculateLeadScore(contact);
    totalScore += score;
    
    // Recent activity
    if (contact.lastContactDate && new Date(contact.lastContactDate) >= last7Days) {
      analytics.recentActivity++;
    }
    
    // Emergency tracking
    if (contact.extractedData?.hasEmergency) {
      analytics.emergencyContacts++;
    }
  });
  
  analytics.averageLeadScore = contacts.length > 0 ? totalScore / contacts.length : 0;
  
  return analytics;
}

module.exports = {
  calculateLeadScore,
  getContactPriority,
  generateContactInsights,
  getRecommendedActions,
  generateCompanyContactAnalytics
};
