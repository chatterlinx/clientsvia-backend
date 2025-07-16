/**
 * Service Issue Intent Classification and Booking Flow
 * Implements the specific flow: AC stops working -> intent classification -> booking flow
 */

class ServiceIssueHandler {
  constructor() {
    this.serviceIssuePatterns = {
      // AC/Cooling Issues
      ac_not_working: {
        keywords: [
          'ac stopped working', 'ac not working', 'air conditioner stopped', 
          'ac broke', 'ac broken', 'ac quit working', 'ac died',
          'air conditioning not working', 'air conditioner not working'
        ],
        intent: 'category_service_issue',
        urgency: 'high',
        category: 'cooling',
        bookingFlow: true
      },
      
      // Heating Issues  
      heating_not_working: {
        keywords: [
          'heat not working', 'heater stopped', 'furnace not working',
          'no heat', 'heater broke', 'furnace died', 'heating stopped'
        ],
        intent: 'category_service_issue', 
        urgency: 'high',
        category: 'heating',
        bookingFlow: true
      },
      
      // General HVAC Issues
      hvac_malfunction: {
        keywords: [
          'hvac not working', 'system down', 'unit not working',
          'thermostat not working', 'system stopped'
        ],
        intent: 'category_service_issue',
        urgency: 'medium',
        category: 'general',
        bookingFlow: true
      }
    };
  }

  /**
   * Classify if the query is a service issue that needs booking
   */
  classifyServiceIssue(query) {
    const normalizedQuery = query.toLowerCase();
    
    for (const [issueType, config] of Object.entries(this.serviceIssuePatterns)) {
      const matched = config.keywords.some(keyword => 
        normalizedQuery.includes(keyword.toLowerCase())
      );
      
      if (matched) {
        return {
          isServiceIssue: true,
          intent: config.intent,
          issueType,
          category: config.category,
          urgency: config.urgency,
          requiresBooking: config.bookingFlow,
          confidence: 0.9
        };
      }
    }
    
    return {
      isServiceIssue: false,
      intent: null,
      confidence: 0
    };
  }

  /**
   * Handle service issue with booking flow
   * Flow: check_custom_KB() → check_category_QAs() → escalate_to_booking()
   */
  async handleServiceIssue(query, companyId, callContext = {}) {
    const classification = this.classifyServiceIssue(query);
    
    if (!classification.isServiceIssue) {
      return null;
    }

    console.log(`[Service Issue] Detected: ${classification.issueType} - Intent: ${classification.intent}`);
    
    // Step 1: Check Custom Knowledge Base
    const customKBResponse = await this.checkCustomKB(query, companyId, classification);
    if (customKBResponse) {
      return customKBResponse;
    }
    
    // Step 2: Check Category Q&As
    const categoryQAResponse = await this.checkCategoryQAs(query, companyId, classification);
    if (categoryQAResponse) {
      return categoryQAResponse;
    }
    
    // Step 3: Escalate to Booking Flow
    return this.escalateToBooking(classification, callContext);
  }

  /**
   * Check company's custom knowledge base for service issue
   */
  async checkCustomKB(query, companyId, classification) {
    try {
      const KnowledgeEntry = require('../models/KnowledgeEntry');
      
      // Look for entries matching the service issue category
      const entries = await KnowledgeEntry.find({
        companyId,
        category: { $in: [classification.category, 'service', 'repair', 'emergency'] },
        approved: true
      }).exec();
      
      // Check for keyword matches
      for (const entry of entries) {
        const questionLower = entry.question.toLowerCase();
        const queryLower = query.toLowerCase();
        
        // Check for high relevance match
        if (this.calculateRelevance(questionLower, queryLower) > 0.7) {
          console.log(`[Service Issue] Found custom KB match: ${entry.question}`);
          
          // If the answer includes booking/scheduling language, proceed to booking
          if (this.includesBookingLanguage(entry.answer)) {
            return {
              response: entry.answer,
              shouldEscalate: false,
              proceedToBooking: true,
              source: 'custom_kb'
            };
          }
          
          return {
            response: entry.answer,
            shouldEscalate: false,
            source: 'custom_kb'
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('[Service Issue] Error checking custom KB:', error);
      return null;
    }
  }

  /**
   * Check category Q&As for service issue responses
   */
  async checkCategoryQAs(query, companyId, classification) {
    try {
      const { getDB } = require('../db');
      const { ObjectId } = require('mongodb');
      
      const db = getDB();
      const company = await db.collection('companiesCollection').findOne({ 
        _id: new ObjectId(companyId) 
      });
      
      if (!company?.agentSetup?.categoryQAs) {
        return null;
      }
      
      // Parse category Q&As
      const categoryQAs = this.parseCategoryQAs(company.agentSetup.categoryQAs);
      
      // Look for matches related to the service issue
      for (const qa of categoryQAs) {
        const relevance = this.calculateRelevance(qa.question.toLowerCase(), query.toLowerCase());
        
        if (relevance > 0.6) {
          console.log(`[Service Issue] Found category QA match: ${qa.question}`);
          
          // Check if answer suggests booking/scheduling
          if (this.includesBookingLanguage(qa.answer)) {
            return {
              response: qa.answer,
              shouldEscalate: false,
              proceedToBooking: true,
              source: 'category_qa'
            };
          }
          
          return {
            response: qa.answer,
            shouldEscalate: false,
            source: 'category_qa'
          };
        }
      }
      
      return null;
    } catch (error) {
      console.error('[Service Issue] Error checking category QAs:', error);
      return null;
    }
  }

  /**
   * Escalate to booking flow with appropriate response
   */
  escalateToBooking(classification, callContext) {
    const bookingResponses = {
      ac_not_working: "I'm sorry to hear your AC stopped working! Let's get you scheduled for a service call right away. Is this for your home or business?",
      heating_not_working: "I understand your heating isn't working - that's definitely urgent! Let me get you scheduled for service. Is this for your home or business?", 
      hvac_malfunction: "I'm sorry to hear about the system issue! Let's get a technician out to take a look. Is this for your home or business?"
    };
    
    const defaultBookingResponse = "I'm sorry to hear about the issue! Let's get you scheduled for service. Is this for your home or business?";
    
    const response = bookingResponses[classification.issueType] || defaultBookingResponse;
    
    console.log(`[Service Issue] Escalating to booking flow: ${classification.issueType}`);
    
    return {
      response,
      shouldEscalate: false,
      proceedToBooking: true,
      bookingFlow: {
        step: 'address_collection',
        serviceType: classification.category,
        urgency: classification.urgency,
        issueDescription: classification.issueType
      },
      source: 'booking_escalation'
    };
  }

  /**
   * Calculate relevance between two text strings
   */
  calculateRelevance(text1, text2) {
    const words1 = text1.split(/\s+/);
    const words2 = text2.split(/\s+/);
    
    const commonWords = words1.filter(word => 
      word.length > 2 && words2.includes(word)
    );
    
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  /**
   * Check if response includes booking/scheduling language
   */
  includesBookingLanguage(text) {
    const bookingKeywords = [
      'schedule', 'appointment', 'book', 'visit', 'come out', 
      'technician', 'service call', 'when can', 'available'
    ];
    
    const textLower = text.toLowerCase();
    return bookingKeywords.some(keyword => textLower.includes(keyword));
  }

  /**
   * Parse category Q&As from text format
   */
  parseCategoryQAs(text = '') {
    const pairs = [];
    const blocks = text.split('\n\n').filter(b => b.trim() !== '');
    
    for (const block of blocks) {
      const lines = block.split('\n').map(l => l.trim()).filter(l => l !== '');
      if (lines.length >= 2) {
        const question = lines[0].replace(/^(Q:|Question:)\s*/i, '');
        const answer = lines.slice(1).join(' ').replace(/^(A:|Answer:)\s*/i, '');
        pairs.push({ question, answer });
      }
    }
    
    return pairs;
  }
}

module.exports = ServiceIssueHandler;
