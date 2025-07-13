// Quick test to identify startup issues
console.log('Testing server startup...');

try {
    console.log('1. Loading dotenv...');
    require('dotenv').config();
    
    console.log('2. Loading express...');
    const express = require('express');
    
    console.log('3. Loading clients...');
    // require('./clients');
    
    console.log('4. Testing basic AI agent routes...');
    const aiAgentSetupRoutes = require('./routes/aiAgentSetup');
    console.log('✅ aiAgentSetup loaded');
    
    const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
    console.log('✅ aiAgentWorkflows loaded');
    
    const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
    console.log('✅ aiAgentAnalytics loaded');
    
    const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
    console.log('✅ knowledgeAutoPopulation loaded');
    
    const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
    console.log('✅ enhancedAIAgent loaded');
    
    const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');
    console.log('✅ aiAgentHandler loaded');
    
    console.log('🎉 All AI agent routes loaded successfully!');
    
} catch (error) {
    console.error('❌ Error during startup test:', error.message);
    console.error('Stack:', error.stack);
}
