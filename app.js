require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const redis = require('redis');
const passport = require('./config/passport');

const { secureHeaders } = require('./middleware/helmet');
const { apiLimiter } = require('./middleware/rateLimit');

const employeeRoutes = require("./routes/employee");
const uploadRoutes = require("./routes/uploads");
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/company');
const tradeCategoryRoutes = require('./routes/tradeCategories');
const settingsRoutes = require('./routes/settings');

const aiAgentWorkflowRoutes = require('./routes/aiAgentWorkflows');
const aiAgentAnalyticsRoutes = require('./routes/aiAgentAnalytics');
const knowledgeAutoPopulationRoutes = require('./routes/knowledgeAutoPopulation');
const enhancedAIAgentRoutes = require('./routes/enhancedAIAgent');
const aiAgentHandlerRoutes = require('./routes/aiAgentHandler');
const monitoringRoutes = require('./routes/monitoring');
const ollamaRoutes = require('./routes/ollama');
const llmRoutes = require('./routes/llm');
const bookingRoutes = require('./routes/booking');

const app = express();

// Parse cookies before any middleware that relies on them
app.use(cookieParser());          // For JWT in cookies
app.use(secureHeaders);           // Helmet/CSP
app.use(cors({ origin: false })); // Restrict origins
app.use(apiLimiter);              // Rate limiting
app.use(express.json());          // Body parsing

const redisClient = redis.createClient({ url: process.env.REDIS_URL });
const redisStore = new RedisStore({ client: redisClient });
app.use(session({
  store: redisStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

app.use('/api/auth', authRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/company', tradeCategoryRoutes);
app.use('/api/company', settingsRoutes);

app.use('/api/ai-agent-workflows', aiAgentWorkflowRoutes);
app.use('/api/ai-agent-analytics', aiAgentAnalyticsRoutes);
app.use('/api/knowledge-auto-population', knowledgeAutoPopulationRoutes);
app.use('/api/enhanced-ai-agent', enhancedAIAgentRoutes);
app.use('/api/ai-agent', aiAgentHandlerRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/ollama', ollamaRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/booking', bookingRoutes);
console.log('✅ Monitoring routes registered at /api/monitoring');
console.log('✅ Ollama routes registered at /api/ollama');
console.log('✅ LLM routes registered at /api/llm');
console.log('✅ Booking routes registered at /api/booking');
app.use("/api/employee", employeeRoutes);
app.use("/api/uploads", uploadRoutes);

// Development routes
if (process.env.NODE_ENV !== 'production') {
    // Serve test script for development
    app.get('/test-render-log.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'test-render-log.js'));
    });
    
    // Serve render log demo script
    app.get('/render-log-demo.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'render-log-demo.js'));
    });
    
    // Serve booking flow engine test
    app.get('/test-booking-flow-engine.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'test-booking-flow-engine.js'));
    });
    
    // Serve selfCheckLogger service
    app.get('/services/selfCheckLogger.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'services', 'selfCheckLogger.js'));
    });
    
    // Serve advanced AI engine
    app.get('/services/advancedAIEngine.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'services', 'advancedAIEngine.js'));
    });
    
    // Serve booking flow engine
    app.get('/services/bookingFlowEngine.js', (req, res) => {
        res.sendFile(path.join(__dirname, 'services', 'bookingFlowEngine.js'));
    });
    
    console.log('🧪 Development test routes enabled');
}

app.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = app;
