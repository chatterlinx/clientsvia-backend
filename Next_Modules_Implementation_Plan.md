# 🔧 Upcoming ModuWe will create:

- [x] HTML UI (dropdowns/sliders for each) ✅ COMPLETED
- [x] Company schema: `agentPersonalitySettings` ✅ COMPLETED
- [x] API routes: GET/PUT company/:id/personality ✅ COMPLETED
- [ ] Live preview tool (text-to-speech test)r Gold Standard AI Agent

This file outlines and begins implementation prep for the next key sections of your Admin Agent Logic Tab:

---

## 1. 🧠 Agent Personality Configuration

This section will allow admins to control:

- Voice tone (friendly, professional, playful)
- Speech speed (slow, normal, fast)
- Barriers: interrupt tolerance (barge-in mode)
- Empathy level: low/medium/high
- Opening/closing phrases
- Script intro tone (e.g., "Hi, how can I help you?" vs. "Penguin Air — how may I assist?")
- AI persona name (optional, for fun/branding)

We will create:

- [ ] HTML UI (dropdowns/sliders for each)
- [x] Company schema: `agentPersonalitySettings` ✅ COMPLETED
- [ ] API routes: GET/PUT company/:id/personality
- [ ] Live preview tool (text-to-speech test)

---

## 2. 📚 Knowledge Q&A Source Controls

Admins will toggle where answers come from and in what order:

- Company Q&A
- Trade Q&A
- Vector search (semantic)
- LLM fallback
- Memory mode (short/conversational)
- Confidence thresholds per layer
- Reject low-confidence matches

We will build:

- [ ] HTML UI with drag-to-prioritize and toggles
- [ ] Schema: `agentKnowledgeSettings`
- [ ] API endpoints: save/load settings
- [ ] Connection to Q&A fallback logic

---

## 3. 📅 Booking Flow Controls

Allow full override of:

- Prompt frequency
- Reask behavior
- Auto book vs. ask first
- Booking form type: simple/detailed
- Tech preference: required/optional
- Fallback after failed booking attempt
- Allowed booking methods: voice/text/web

We will deliver:

- [ ] HTML config UI with select+sliders
- [ ] Save logic to `bookingSettings` in Company
- [ ] Real-time preview simulation tool
- [ ] Agent respect for prompt limits (backend update)

---

## 4. 🔔 Notification Rules + Escalation

Control:

- Who gets notified (owner, tech, dispatcher)
- SMS/email toggle per event
- Escalation behavior: transfer vs. message
- Retry logic
- Emergency override contacts
- Quiet hours

Deliverables:

- [ ] UI config block under Notifications tab
- [ ] Save logic to `notificationSettings`
- [ ] Hook override logic in `eventHookManager`

---

## 5. 🧪 Testing Console + Trace Logs

Internal tools for QA/devs:

- Test button for: Q&A, booking, escalation
- Console display: what trade matched, which Q&A used, what confidence
- Toggle to show LLM input/output
- Trace log ID + search by date/session
- Auto-health-check agent diagnostics

We will:

- [ ] Build trace viewer UI
- [ ] Add POST /agent/test-call
- [ ] Show all step-by-step logic chain from Q→A
- [ ] Log source used: company → trade → fallback → LLM

---

Each module will include:

- Full HTML block (styled and tab-ready)
- JS: load/save functions
- MongoDB schema patch
- API endpoints (RESTful)
- Integration notes

You are on track to launch a true enterprise-grade AI receptionist system. 💪
