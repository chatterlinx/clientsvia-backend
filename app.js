require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const mongoose = require('mongoose');
const session = require('express-session');
const redis = require('redis');
const employeeRoutes = require("./routes/employee");
const uploadRoutes = require("./routes/uploads");
const authRoutes = require('./routes/auth');
const companyRoutes = require('./routes/company');

const app = express();

app.use(helmet());
app.use(cors({ origin: false }));
app.use(express.json());

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 100
}));

(async () => {
  const redisClient = redis.createClient({ url: process.env.REDIS_URL });
  await redisClient.connect();
  const RedisStore = require('connect-redis').default;
  const store = new RedisStore({
    client: redisClient,
    prefix: "sess:",
  });

  app.use(session({
    store,
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: 'strict'
    }
  }));

  mongoose.connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  app.use('/api/employee', employeeRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/company', companyRoutes);

  app.get('/healthz', (req, res) => res.json({ ok: true }));

  module.exports = app;
})();
