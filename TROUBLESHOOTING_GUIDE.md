# 🔧 **Twilio Troubleshooting Guide - Render Logs Reference**

## 📋 **Log Checkpoint Categories**

### 🎯 **Call Flow Checkpoints**

#### **1. Call Initiation**
- `[CALL START] 📞` - Call begins, shows timestamp
- `[CALL DEBUG]` - From/To numbers and CallSid
- `[PHONE LOOKUP] 🔍` - Which phone number is being searched
- `[COMPANY FOUND] ✅` - Company details (name, ID)
- `[ERROR] ❌` - No company found for phone number

#### **2. AI Settings Validation**
- `[AI SETTINGS]` - Voice ID, personality settings
- `[THRESHOLDS]` - Confidence threshold, timeout, delay settings
- `[GREETING TYPE] 🎵` - TTS vs audio greeting, URL if applicable

#### **3. Greeting Generation**
- `[GREETING RAW] 📝` - Original greeting text
- `[GREETING FINAL] 📝` - Final greeting after placeholder replacement
- `[TTS START] ⏱️` - ElevenLabs synthesis start time
- `[TTS SUCCESS] ✅` - TTS completion time and duration
- `[TTS ERROR] ❌` - TTS synthesis failures
- `[AUDIO FILE] 💾` - Audio file creation (filename, size)

#### **4. Gather Configuration**
- `[GATHER CONFIG] ⚙️` - Timeout, BargeIn, Enhanced settings
- `[TWIML OUTPUT] 📤` - Final TwiML being sent to Twilio

---

### 🎤 **Speech Processing Checkpoints**

#### **1. Speech Reception**
- `[SPEECH START] 🎤` - Speech processing begins
- `[SPEECH RECEIVED] 🎯` - Speech text and character count
- `[SPEECH ERROR] ❌` - Empty speech results
- `[COMPANY LOOKUP] 🔍` - Company lookup during speech processing
- `[COMPANY CONFIRMED] ✅` - Company validation success

#### **2. Confidence Analysis**
- `[CONFIDENCE CHECK]` - Speech confidence vs threshold with PASS/FAIL
- `[CONFIDENCE REJECT] ❌` - Low confidence speech rejection
- `[CONFIDENCE SUMMARY]` - Final confidence validation

#### **3. Q&A Processing**
- `[Q&A MATCHING] 🔍` - Number of Q&A entries being searched
- `[Q&A MATCH FOUND] ✅` - Q&A match success with preview
- `[Q&A NO MATCH] ❌` - No Q&A match, escalating to AI

#### **4. AI Processing**
- `[AI PROCESSING] 🤖` - AI response generation start
- `[AI HISTORY] 📚` - Conversation history loading/saving
- `[AI SUCCESS] ✅` - AI response completion time
- `[AI ERROR] ❌` - AI processing failures

#### **5. Response Generation**
- `[RESPONSE DELAY] ⏱️` - Configured response delay application
- `[SPEECH COMPLETE] ✅` - Total speech processing time

---

### 💾 **Caching & Database Checkpoints**

#### **Cache Performance**
- `[CACHE HIT] ⚡` - Company found in Redis cache (with timing)
- `[CACHE MISS] 🔍` - Company not cached, querying database
- `[CACHE SAVE] 💾` - Company cached successfully
- `[CACHE/DB ERROR] ❌` - Cache or database errors

#### **Database Queries**
- `[DB SUCCESS] ✅` - Database query success (with timing)
- `[DB MISS] ❌` - No company found in database

---

## 🚨 **Common Issues & Log Patterns**

### **Issue: Long Response Times**
**Look for:**
```
[CALL START] 📞 → [SPEECH COMPLETE] ✅
```
**Normal:** < 5 seconds total
**Problem:** > 8 seconds total

**Breakdown timing:**
- `[TTS SUCCESS]` - Should be < 2 seconds
- `[AI SUCCESS]` - Should be < 3 seconds  
- `[CACHE HIT]` - Should be < 50ms
- `[DB SUCCESS]` - Should be < 500ms

### **Issue: No Company Found**
**Look for:**
```
[PHONE LOOKUP] 🔍 Searching for company with phone: +1234567890
[ERROR] ❌ No company found for phone number: +1234567890
```
**Fix:** Check phone number normalization and database entries

### **Issue: Speech Recognition Problems**
**Look for:**
```
[CONFIDENCE CHECK] Speech: "mumbled" | Confidence: 0.23 | Threshold: 0.65 | FAIL ❌
[CONFIDENCE REJECT] ❌ Low confidence (0.23 < 0.65) - asking user to repeat
```
**Fix:** Lower confidence threshold in AI Voice Settings

### **Issue: TTS Failures**
**Look for:**
```
[TTS ERROR] ❌ ElevenLabs synthesis failed: [error message]
[TTS FALLBACK] 🔄 Using Twilio's built-in TTS instead
```
**Fix:** Check ElevenLabs API key and voice ID settings

### **Issue: Q&A Not Matching**
**Look for:**
```
[Q&A MATCHING] 🔍 Searching 5 Q&A entries with fuzzy threshold: 0.3
[Q&A NO MATCH] ❌ No Q&A match found, escalating to AI processing
```
**Fix:** Check fuzzy threshold or add more Q&A variations

### **Issue: AI Processing Slow**
**Look for:**
```
[AI PROCESSING] 🤖 Starting AI response generation...
[AI SUCCESS] ✅ AI response generated in 8000ms
```
**Normal:** < 3000ms
**Problem:** > 5000ms
**Fix:** Check AI service performance

---

## ⚡ **Performance Benchmarks**

| Component | Good | Warning | Critical |
|-----------|------|---------|----------|
| **Cache Hit** | < 50ms | 50-200ms | > 200ms |
| **DB Query** | < 500ms | 500ms-2s | > 2s |
| **TTS Generation** | < 2s | 2-4s | > 4s |
| **AI Processing** | < 3s | 3-5s | > 5s |
| **Total Response** | < 5s | 5-8s | > 8s |

---

## 🔍 **How to Use These Logs**

### **1. Real-Time Monitoring**
Watch live logs during test calls to see immediate issues

### **2. Performance Analysis**
Search for timing patterns:
```bash
# Find slow TTS
grep "TTS SUCCESS" logs | grep -E "[5-9][0-9]{3}ms|[0-9]{5}ms"

# Find confidence failures  
grep "CONFIDENCE.*FAIL" logs

# Find cache misses
grep "CACHE MISS" logs
```

### **3. Error Tracking**
Search for error patterns:
```bash
# All errors
grep "❌" logs

# Specific error types
grep "TTS ERROR" logs
grep "AI ERROR" logs
grep "SPEECH ERROR" logs
```

**These comprehensive checkpoints make troubleshooting lightning-fast!** 🚀
