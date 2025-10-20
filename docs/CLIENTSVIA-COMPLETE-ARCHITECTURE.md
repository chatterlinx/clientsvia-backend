# ClientsVia.ai - Complete Platform Architecture

**Version**: 2.0  
**Last Updated**: October 20, 2025  
**Status**: Production-Ready  
**Platform Type**: Multi-Tenant AI Agent SaaS

---

## 📋 Table of Contents

1. [Executive Summary](#executive-summary)
2. [Platform Overview](#platform-overview)
3. [System Architecture](#system-architecture)
4. [Call Flow Architecture](#call-flow-architecture)
5. [Data Architecture](#data-architecture)
6. [Tab-by-Tab Guide](#tab-by-tab-guide)
7. [Security & Multi-Tenancy](#security--multi-tenancy)
8. [Performance & Caching](#performance--caching)
9. [Deployment Architecture](#deployment-architecture)
10. [File Structure Map](#file-structure-map)

---

## 🎯 Executive Summary

**What is ClientsVia?**

ClientsVia is an enterprise-grade, multi-tenant SaaS platform that powers AI-driven phone receptionists for service businesses (HVAC, Plumbing, Electrical, etc.).

**Core Value Proposition:**
- 24/7 AI receptionist that answers calls, books appointments, and provides instant answers
- Voice-to-AI-to-Voice in real-time using Twilio + ElevenLabs
- Sub-50ms response times via Mongoose + Redis architecture
- 100% configurable per company through Admin Dashboard

**Key Metrics:**
- **Response Time Target**: <50ms (AI knowledge retrieval)
- **Voice Latency**: Real-time streaming (<2s end-to-end)
- **Uptime**: 99.9% (Render.com hosting)
- **Scalability**: 100+ companies per instance

---

## 🏗️ Platform Overview

### **The Journey: From Call to AI Response**

```
📞 Customer Calls → Twilio → ClientsVia Backend → AI Processing → ElevenLabs → Voice Response
```

**Detailed Flow:**

1. **Customer dials** company's phone number (e.g., +1-239-232-2030)
2. **Twilio** receives call, forwards to ClientsVia webhook
3. **ClientsVia** identifies company via phone number lookup
4. **Greeting** plays (ElevenLabs voice, company-specific)
5. **Customer speaks** → Twilio transcribes to text
6. **AI Core** processes request:
   - Checks Company Q&A (highest priority)
   - Checks Trade Q&A (industry-specific)
   - Checks Templates (structured responses)
   - Falls back to In-House AI (keyword matching)
7. **Response generated** → Sent to ElevenLabs
8. **ElevenLabs** converts text → voice
9. **Voice streamed** back to customer via Twilio

**Time Budget (Target):**
- Phone number lookup: <5ms (Redis cache)
- Company data load: <10ms (Redis cache)
- AI knowledge match: <30ms (Redis + vector search)
- ElevenLabs TTS: <2s (streaming)
- **Total call response**: <3s from speech end to voice start

---

## 🏛️ System Architecture

### **High-Level Architecture Diagram**

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        🌐 CLIENT LAYER                                    │
│  - Web Browser (Admin Dashboard)                                         │
│  - Twilio (Phone Calls)                                                  │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                    🛡️ SECURITY & ROUTING LAYER                           │
│  - JWT Authentication (admin users)                                      │
│  - Rate Limiting (express-rate-limit)                                    │
│  - Helmet.js (security headers)                                          │
│  - Company ID scoping (multi-tenancy)                                    │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                        🚀 APPLICATION LAYER                               │
│                                                                           │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  EXPRESS.JS SERVER (Node.js)                                       │  │
│  │  Port: 10000                                                        │  │
│  │  Entry: server.js → app.js                                         │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  ┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────┐  │
│  │  ADMIN ROUTES       │  │  TWILIO ROUTES      │  │  GLOBAL ROUTES  │  │
│  │  /api/admin/*       │  │  /api/twilio/*      │  │  /api/global/*  │  │
│  │  - Data Center      │  │  - Voice Webhook    │  │  - Trade Cats   │  │
│  │  - Call Filtering   │  │  - SMS Webhook      │  │  - Templates    │  │
│  │  - Account Deletion │  │  - Status Callbacks │  │  - Directories  │  │
│  └─────────────────────┘  └─────────────────────┘  └─────────────────┘  │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  COMPANY ROUTES /api/company/:companyId/*                           │ │
│  │  - Profile & Settings                                               │ │
│  │  - AI Agent Logic (Q&A, Templates, Thresholds)                     │ │
│  │  - Voice Settings (ElevenLabs config)                              │ │
│  │  - Connection Messages (Greetings)                                 │ │
│  │  - Twilio Control (Credentials, Numbers)                           │ │
│  │  - Notes & Contacts                                                │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                        🧠 BUSINESS LOGIC LAYER                            │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  AI AGENT RUNTIME (v2AIAgentRuntime.js)                          │   │
│  │  - Priority-driven knowledge routing                             │   │
│  │  - Confidence threshold matching                                 │   │
│  │  - Multi-source knowledge aggregation                            │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  KNOWLEDGE SERVICES                                               │   │
│  │  - CompanyKnowledgeService (Q&A management)                      │   │
│  │  - v2priorityDrivenKnowledgeRouter (routing logic)               │   │
│  │  - KeywordGenerationService (AI keyword extraction)              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  EXTERNAL SERVICE INTEGRATIONS                                    │   │
│  │  - v2elevenLabsService (TTS)                                     │   │
│  │  - SmartCallFilter (spam detection)                              │   │
│  │  - AccountDeletionService (GDPR)                                 │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                        💾 DATA LAYER                                      │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  MONGOOSE (MongoDB ODM)                                           │   │
│  │  - Schema validation & enforcement                                │   │
│  │  - Multi-tenant data isolation (companyId)                        │   │
│  │  - Persistent storage                                             │   │
│  │  Response Time: ~100-200ms                                        │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │  REDIS CACHE                                                      │   │
│  │  - In-memory key-value store                                      │   │
│  │  - Company data caching (company:{id})                            │   │
│  │  - Phone number lookup (company-phone:{number})                   │   │
│  │  - Session storage                                                │   │
│  │  Response Time: <5ms                                              │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                           │
│  🎯 COMBINED TARGET: <50ms data retrieval                                │
└──────────────────────────────────────────────────────────────────────────┘
                                    ↓
┌──────────────────────────────────────────────────────────────────────────┐
│                    🌍 EXTERNAL SERVICES                                   │
│                                                                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                   │
│  │  📞 TWILIO   │  │  🎤 ELEVENLABS│  │  🗄️ MONGODB  │                   │
│  │  - Voice     │  │  - TTS        │  │  ATLAS       │                   │
│  │  - SMS       │  │  - Voice      │  │  - Cloud DB  │                   │
│  │  - Status    │  │  - Streaming  │  │  - Backups   │                   │
│  └──────────────┘  └──────────────┘  └──────────────┘                   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

**(Continued in next section...)**

---

**Document Size**: Too large for single file. Creating modular architecture docs...

