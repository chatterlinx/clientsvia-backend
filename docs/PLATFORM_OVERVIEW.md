# ClientsVia AI Agent Platform - Platform Overview

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/clientsvia/platform)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)
[![Security](https://img.shields.io/badge/security-enterprise%20grade-red.svg)](#security-features)

## Executive Summary

ClientsVia is a **Salesforce-caliber, enterprise-grade, multi-tenant AI agent platform** specifically designed for **voice-first service companies**. The platform provides dynamic, per-company fine-tuning of agent logic, intelligent answer prioritization, template intelligence, and configurable agent personalities.

### 🎯 Core Value Proposition

- **Multi-Tenant Architecture**: Isolated, secure environments for each client company
- **Voice-First Design**: Optimized for conversational AI and voice interactions
- **Dynamic Intelligence**: Real-time adaptation and learning from company-specific data
- **Enterprise Security**: Bank-level security with single-session lockout and hardware binding
- **Template Intelligence**: Advanced AI-driven response optimization and personalization

## 🏗️ Architecture Overview

### Platform Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    ClientsVia AI Platform                       │
├─────────────────────────────────────────────────────────────────┤
│  Frontend Layer                                                 │
│  ├── Admin Dashboard (ai-agent-logic.html)                     │
│  ├── Company Management UI                                      │
│  └── Real-time Analytics Dashboard                              │
├─────────────────────────────────────────────────────────────────┤
│  API Gateway & Authentication                                   │
│  ├── JWT-based Authentication                                   │
│  ├── Single-Session Management                                  │
│  ├── Hardware ID Binding                                        │
│  └── GeoIP Security                                            │
├─────────────────────────────────────────────────────────────────┤
│  AI Intelligence Layer                                          │
│  ├── ClientsVia Intelligence Engine                            │
│  ├── Template Intelligence Engine                               │
│  ├── Agent Personality Engine                                   │
│  └── Dynamic Learning & Adaptation                              │
├─────────────────────────────────────────────────────────────────┤
│  Business Logic Layer                                           │
│  ├── Multi-Tenant Company Management                           │
│  ├── Knowledge Base Management                                  │
│  ├── Booking & Scheduling                                       │
│  └── Workflow Automation                                        │
├─────────────────────────────────────────────────────────────────┤
│  Data Layer                                                     │
│  ├── MongoDB (Primary Database)                                │
│  ├── Redis (Session & Cache)                                   │
│  ├── Pinecone (Vector Database)                                │
│  └── Audit Trail Storage                                        │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Runtime** | Node.js 18+ | High-performance JavaScript runtime |
| **Framework** | Express.js | Web application framework |
| **Database** | MongoDB | Primary data storage |
| **Cache/Session** | Redis | Session management & caching |
| **Vector DB** | Pinecone | AI embeddings & semantic search |
| **Authentication** | JWT + Passport | Secure authentication |
| **AI/ML** | OpenAI GPT, Vertex AI | Language models |
| **Voice** | ElevenLabs | Text-to-speech |
| **Monitoring** | Winston, Sentry | Logging & error tracking |

## 🚀 Key Features

### 1. Multi-Tenant Intelligence
- **Per-Company AI Tuning**: Each client gets customized AI behavior
- **Isolated Data**: Complete data separation between tenants
- **Custom Knowledge Bases**: Company-specific information repositories
- **Configurable Workflows**: Tailored business processes

### 2. Enterprise Security
- **Single-Session Lockout**: Only one active session per user
- **Hardware ID Binding**: Device-level security
- **GeoIP Validation**: Location-based access control
- **Emergency Bypass**: Admin access for critical situations
- **Audit Trails**: Complete activity logging

### 3. AI Intelligence Systems

#### Template Intelligence Engine
```javascript
// Dynamic template selection and optimization
const templateResponse = await templateEngine.processQuery({
  companyId: 'client-123',
  userQuery: 'I need to book a plumber',
  context: { location: 'New York', urgency: 'high' }
});
```

#### ClientsVia Intelligence Engine
```javascript
// Company-specific AI reasoning
const intelligentResponse = await intelligenceEngine.generateResponse({
  company: companyData,
  conversation: conversationHistory,
  businessRules: customRules
});
```

### 4. Voice-First Architecture
- **Optimized for Conversational AI**: Natural language processing
- **Real-time Response**: Sub-second response times
- **Context Awareness**: Maintains conversation state
- **Multi-Modal Support**: Text, voice, and structured data

## 📊 Performance Metrics

- **Response Time**: < 200ms for cached responses
- **Availability**: 99.9% uptime SLA
- **Scalability**: Supports 1000+ concurrent companies
- **Security**: Zero security incidents since deployment

## 🔧 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB 6+
- Redis 7+
- Git

### Installation
```bash
git clone https://github.com/clientsvia/platform.git
cd clientsvia-backend
npm install
cp .env.example .env
# Configure environment variables
npm start
```

### Access
- **Admin Dashboard**: `http://localhost:3000/ai-agent-logic.html`
- **API Documentation**: `http://localhost:3000/api-docs`
- **Health Check**: `http://localhost:3000/health`

## 📁 Project Structure

```
clientsvia-backend/
├── app.js                 # Main application entry point
├── server.js              # HTTP server configuration
├── package.json           # Dependencies and scripts
├── .env                   # Environment configuration
├── routes/                # API route definitions
│   ├── auth.js           # Authentication endpoints
│   ├── aiAgentLogic.js   # AI agent configuration
│   └── company.js        # Company management
├── services/              # Business logic services
│   ├── clientsViaIntelligenceEngine.js
│   ├── templateIntelligenceEngine.js
│   └── agent.js
├── middleware/            # Express middleware
│   ├── auth.js           # JWT authentication
│   ├── singleSessionManager.js
│   └── geoIPSecurityService.js
├── models/               # Database models
├── public/               # Frontend assets
└── docs/                 # Documentation
```

## 🔗 Navigation

- [Security Documentation](SECURITY_DOCUMENTATION.md) - Enterprise security features
- [API Reference](API_REFERENCE.md) - Complete API documentation
- [Developer Guide](DEVELOPER_GUIDE.md) - Development workflows
- [Deployment Guide](DEPLOYMENT_GUIDE.md) - Production deployment
- [Troubleshooting](TROUBLESHOOTING.md) - Common issues and solutions

## 📞 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: GitHub Issues
- **Email**: support@clientsvia.com
- **Emergency**: Use emergency bypass key

---

*Built with ❤️ for enterprise-grade voice-first AI solutions*
