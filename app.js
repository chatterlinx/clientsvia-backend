require('dotenv').config();
const express = require('express');
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
const workflowRoutes = require('./routes/workflows');

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
app.use('/api/workflows', workflowRoutes);
app.use("/api/employee", employeeRoutes);
app.use("/api/uploads", uploadRoutes);

app.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = app;
