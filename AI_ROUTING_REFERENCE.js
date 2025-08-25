/**
 * AI AGENT ROUTING ARCHITECTURE - QUICK REFERENCE GUIDE
 * ClientsVia Company Q&A Knowledge Source Priority System
 * 
 * 🚨 READ THIS FIRST FOR TROUBLESHOOTING AI ROUTING ISSUES 🚨
 * 
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║                    COMPLETE ROUTING FLOW                        ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ 1. Customer asks question to AI agent                           ║
 * ║ 2. AI Agent → POST /api/ai-agent/company-knowledge/:companyId   ║
 * ║ 3. aiAgentLogic.js → CompanyKnowledgeService.findAnswerForAIAgent() ║
 * ║ 4. Service checks Redis cache: knowledge:company:{id}:search:{hash} ║
 * ║ 5. If cache miss → Query CompanyQnA model via Mongoose          ║
 * ║ 6. Semantic search using auto-generated keywords                ║
 * ║ 7. Calculate confidence score (0.0-1.0)                        ║
 * ║ 8. If confidence >= 0.8 → Return company-specific answer       ║
 * ║ 9. If confidence < 0.8 → Try Priority #2 (Trade Q&A)           ║
 * ║ 10. Cache result in Redis for future queries                    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * 📁 KEY FILES FOR TROUBLESHOOTING:
 * 
 * 🔧 BACKEND CORE:
 * • /models/knowledge/CompanyQnA.js → Mongoose model + keyword generation
 * • /services/knowledge/CompanyKnowledgeService.js → Main AI integration logic
 * • /services/knowledge/KeywordGenerationService.js → NLP keyword engine
 * • /routes/knowledge/companyKnowledge.js → CRUD API endpoints
 * • /routes/aiAgentLogic.js → AI agent routing control center
 * 
 * 🎯 CRITICAL AI ENDPOINTS:
 * • POST /api/ai-agent/company-knowledge/:companyId → PRIMARY AI LOOKUP
 * • POST /api/ai-agent/test-priority-flow/:companyId → TESTING ENDPOINT
 * • GET /api/admin/:companyID/ai-settings → CONFIGURATION
 * 
 * 🖥️ FRONTEND MANAGEMENT:
 * • /public/js/components/CompanyQnAManager.js → UI for managing Q&As
 * • /public/css/knowledge-management.css → Styling
 * • /public/company-profile.html → Knowledge Sources tab integration
 * 
 * 🔄 DATA FLOW:
 * Frontend UI → Knowledge API → Service Layer → Mongoose + Redis → AI Agent
 * 
 * 💾 REDIS CACHE KEYS:
 * • knowledge:company:{companyId}:list → Cached Q&A lists
 * • knowledge:company:{companyId}:search:{queryHash} → Search results
 * • knowledge:company:{companyId}:analytics → Usage metrics
 * 
 * 🎚️ CONFIDENCE THRESHOLDS:
 * • Company Q&A: 0.80 (Priority #1)
 * • Trade Q&A: 0.75 (Priority #2) - Future
 * • Templates: 0.70 (Priority #3) - Existing
 * • Learning: 0.65 (Priority #4) - Existing
 * • LLM Fallback: 0.60 (Priority #5) - GPT/Gemini
 * 
 * 🚨 COMMON TROUBLESHOOTING:
 * 
 * ❌ AI not finding company answers:
 * → Check CompanyQnA model has entries for companyId
 * → Verify keywords generated correctly (check pre-save middleware)
 * → Test semantic search with /api/knowledge/company/:id/search
 * → Check confidence scores in test results
 * 
 * ❌ Slow AI responses:
 * → Check Redis connection status in logs
 * → Monitor CompanyKnowledgeService.performanceMetrics
 * → Verify Mongoose indexes on CompanyQnA model
 * 
 * ❌ Cache issues:
 * → Redis keys: knowledge:company:{id}:*
 * → Service automatically handles Redis failures (graceful fallback)
 * → Check logs for Redis connection errors
 * 
 * ❌ Priority flow not working:
 * → Test with /api/ai-agent/test-priority-flow/:companyId
 * → Check confidence thresholds in AI settings
 * → Verify CompanyKnowledgeService initialization in aiAgentLogic.js
 * 
 * 🔍 TESTING TOOLS:
 * • Knowledge Sources tab → "Test with AI Agent" buttons
 * • "Test Priority Flow" → Full routing simulation
 * • /scripts/validate-knowledge-system.js → System validation
 * 
 * 📊 MONITORING:
 * • CompanyKnowledgeService.performanceMetrics → Response times, cache hits
 * • Winston logs → /logs/knowledge-*.log files
 * • Redis monitoring → Cache utilization and performance
 * 
 * 🔄 PRIORITY ROUTING ORDER:
 * 1. Company Q&A (THIS SYSTEM) → CompanyKnowledgeService
 * 2. Trade Q&A (Future) → TradeKnowledgeService
 * 3. Templates (Existing) → Template system
 * 4. Learning Queue (Existing) → Learning system
 * 5. LLM Fallback (Existing) → GPT/Gemini
 * 
 * Last Updated: August 25, 2025
 * System Version: Production-Ready v2.0.0
 */
