/**
 * Mock Data for ClientsVia Enterprise Testing Suite
 * 
 * Comprehensive mock data for testing all enterprise features
 */

const mockData = {
  // Mock company data
  company: {
    _id: '507f1f77bcf86cd799439011',
    name: 'Test Company Ltd',
    email: 'test@company.com',
    phone: '+1234567890',
    industry: 'Technology',
    size: 'Medium',
    aiAgentLogic: {
      // Basic settings
      isEnabled: true,
      agentName: 'TestBot',
      personality: 'professional',
      responseStyle: 'concise',
      
      // Analytics configuration
      analytics: {
        enabled: true,
        trackingId: 'GA-TEST-123456',
        realTimeEnabled: true,
        dashboardConfig: {
          refreshInterval: 30000,
          chartTypes: ['line', 'bar', 'pie'],
          metrics: ['conversations', 'satisfaction', 'resolution_time']
        }
      },
      
      // A/B Testing configuration
      abTesting: {
        enabled: true,
        activeTests: [
          {
            id: 'test-1',
            name: 'Greeting Style Test',
            variants: [
              { id: 'variant-a', name: 'Formal', weight: 50 },
              { id: 'variant-b', name: 'Casual', weight: 50 }
            ],
            startDate: new Date('2025-01-01'),
            endDate: new Date('2025-12-31'),
            status: 'active'
          }
        ]
      },
      
      // Personalization configuration
      personalization: {
        enabled: true,
        rules: [
          {
            id: 'rule-1',
            name: 'VIP Customer Rule',
            conditions: [
              { field: 'customerTier', operator: 'equals', value: 'VIP' }
            ],
            actions: [
              { type: 'setTone', value: 'premium' },
              { type: 'prioritize', value: true }
            ]
          }
        ],
        aiRecommendations: true,
        learningEnabled: true
      },
      
      // Flow Designer configuration
      flowDesigner: {
        enabled: true,
        flows: [
          {
            id: 'flow-1',
            name: 'Customer Support Flow',
            nodes: [
              {
                id: 'start',
                type: 'trigger',
                config: { event: 'chat_start' }
              },
              {
                id: 'greeting',
                type: 'message',
                config: { text: 'Hello! How can I help you today?' }
              },
              {
                id: 'intent',
                type: 'intent_detection',
                config: { model: 'gpt-4' }
              }
            ],
            connections: [
              { from: 'start', to: 'greeting' },
              { from: 'greeting', to: 'intent' }
            ],
            version: 1,
            isActive: true
          }
        ]
      }
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date()
  },
  
  // Mock analytics data
  analytics: {
    realTimeMetrics: {
      activeConversations: 15,
      todayConversations: 127,
      averageResponseTime: 2.3,
      satisfactionScore: 4.2,
      resolutionRate: 0.85
    },
    historicalData: {
      conversations: [
        { date: '2025-08-01', count: 145 },
        { date: '2025-08-02', count: 167 },
        { date: '2025-08-03', count: 134 }
      ],
      satisfaction: [
        { date: '2025-08-01', score: 4.1 },
        { date: '2025-08-02', score: 4.3 },
        { date: '2025-08-03', score: 4.2 }
      ]
    },
    topIntents: [
      { intent: 'support_request', count: 45, percentage: 35.4 },
      { intent: 'product_inquiry', count: 38, percentage: 29.9 },
      { intent: 'billing_question', count: 22, percentage: 17.3 }
    ]
  },
  
  // Mock A/B testing data
  abTesting: {
    testResults: {
      'test-1': {
        variants: [
          {
            id: 'variant-a',
            name: 'Formal',
            visitors: 1250,
            conversions: 85,
            conversionRate: 0.068,
            confidence: 0.95
          },
          {
            id: 'variant-b',
            name: 'Casual',
            visitors: 1180,
            conversions: 94,
            conversionRate: 0.0797,
            confidence: 0.98
          }
        ],
        winner: 'variant-b',
        statisticalSignificance: 0.02
      }
    }
  },
  
  // Mock personalization data
  personalization: {
    customerProfiles: [
      {
        id: 'customer-1',
        tier: 'VIP',
        preferences: {
          communicationStyle: 'formal',
          preferredChannel: 'email',
          timezone: 'EST'
        },
        behaviorData: {
          averageSessionDuration: 450,
          commonTopics: ['billing', 'support'],
          satisfactionHistory: [4.5, 4.2, 4.8]
        }
      }
    ],
    aiRecommendations: [
      {
        type: 'tone_adjustment',
        confidence: 0.92,
        suggestion: 'Use more casual language based on customer interaction history'
      },
      {
        type: 'topic_priority',
        confidence: 0.88,
        suggestion: 'Prioritize billing-related responses for this customer segment'
      }
    ]
  },
  
  // Mock conversation data
  conversations: [
    {
      id: 'conv-1',
      customerId: 'customer-1',
      startTime: new Date('2025-08-03T10:00:00Z'),
      endTime: new Date('2025-08-03T10:15:00Z'),
      messages: [
        {
          role: 'user',
          content: 'I need help with my billing',
          timestamp: new Date('2025-08-03T10:00:00Z')
        },
        {
          role: 'assistant',
          content: 'I\'d be happy to help you with your billing inquiry. Could you please provide your account number?',
          timestamp: new Date('2025-08-03T10:00:30Z')
        }
      ],
      intent: 'billing_question',
      satisfaction: 4.5,
      resolved: true,
      abTestVariant: 'variant-b'
    }
  ],
  
  // Mock API responses
  apiResponses: {
    success: {
      status: 'success',
      message: 'Operation completed successfully',
      data: {}
    },
    error: {
      status: 'error',
      message: 'An error occurred',
      code: 'GENERIC_ERROR'
    },
    unauthorized: {
      status: 'error',
      message: 'Unauthorized access',
      code: 'UNAUTHORIZED'
    }
  }
};

module.exports = mockData;
