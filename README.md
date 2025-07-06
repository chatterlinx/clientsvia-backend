# ClientsVia Backend

The backend API server for the ClientsVia admin dashboard application.

## 🚀 Features

- **Node.js/Express REST API** - Fast, scalable backend server
- **MongoDB with Mongoose** - Document database with ODM
- **Google OAuth Authentication** - Secure user authentication
- **JWT Token Management** - Stateless authentication
- **AI/ML Integration** - Google Cloud Vertex AI, Pinecone vector database
- **Text-to-Speech Services** - Google Cloud TTS, ElevenLabs
- **SMS Integration** - Twilio messaging
- **Redis Caching** - High-performance caching
- **Rate Limiting & Security** - Helmet, CORS, Express rate limiting
- **Comprehensive Test Suite** - Jest testing framework

## 🛠 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Passport.js (Google OAuth), JWT
- **Caching**: Redis
- **AI/ML**: Google Cloud Vertex AI, Pinecone
- **SMS**: Twilio
- **Testing**: Jest, Supertest
- **Security**: Helmet, CORS, Rate limiting

## 📦 Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd clientsvia-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Start the development server**
   ```bash
   npm run dev
   ```

## 🔧 Environment Variables

Create a `.env` file in the root directory:

```env
# Database
MONGODB_URI=mongodb://localhost:27017/clientsvia

# Authentication
JWT_SECRET=your-jwt-secret-here
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# Redis
REDIS_URL=redis://localhost:6379

# Google Cloud
GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account.json
GOOGLE_PROJECT_ID=your-project-id

# Twilio
TWILIO_ACCOUNT_SID=your-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
TWILIO_PHONE_NUMBER=your-twilio-phone

# Pinecone
PINECONE_API_KEY=your-pinecone-api-key
PINECONE_ENVIRONMENT=your-pinecone-environment

# ElevenLabs
ELEVENLABS_API_KEY=your-elevenlabs-api-key

# Server
PORT=3001
NODE_ENV=development
```

## 🚦 Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm test` - Run test suite
- `npm run test:watch` - Run tests in watch mode

## 📁 Project Structure

```
clientsvia-backend/
├── config/          # Configuration files (passport, etc.)
├── docs/            # Documentation
├── lib/             # Utility libraries
├── middleware/      # Express middleware
├── models/          # Mongoose models
├── routes/          # API route handlers
├── scripts/         # Utility scripts
├── services/        # Business logic services
├── tests/           # Test files
├── utils/           # Utility functions
├── app.js           # Express app configuration
├── server.js        # Server entry point
├── db.js            # Database connection
├── index.js         # Main application file
├── clients.js       # Client management
└── package.json     # Dependencies and scripts
```

## 🔗 API Endpoints

### Authentication
- `POST /auth/login` - User login
- `POST /auth/logout` - User logout
- `GET /auth/google` - Google OAuth login
- `GET /auth/google/callback` - Google OAuth callback

### Companies
- `GET /api/companies` - Get all companies
- `POST /api/companies` - Create new company
- `GET /api/companies/:id` - Get company by ID
- `PUT /api/companies/:id` - Update company
- `DELETE /api/companies/:id` - Delete company

### AI Agent
- `POST /api/ai/chat` - Chat with AI agent
- `GET /api/ai/knowledge` - Get knowledge base entries
- `POST /api/ai/knowledge` - Add knowledge entry

### Integrations
- `POST /api/twilio/sms` - Send SMS
- `POST /api/tts/generate` - Generate text-to-speech

## 🧪 Testing

Run the test suite:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## 🔒 Security

- ✅ CORS enabled for cross-origin requests
- ✅ Helmet for security headers
- ✅ Rate limiting on API endpoints
- ✅ JWT authentication
- ✅ Input validation with Joi
- ✅ Environment variable protection
- ✅ Password hashing with bcrypt
- ✅ Session management with Redis

## 🚀 Deployment

1. **Set production environment variables**
2. **Install dependencies**
   ```bash
   npm install --production
   ```
3. **Start the application**
   ```bash
   npm start
   ```

## 📄 License

MIT

---

**⚠️ Security Notice**: This backend contains sensitive API keys and credentials. Never commit `.env` files or expose secrets in code. Always use environment variables for configuration.
