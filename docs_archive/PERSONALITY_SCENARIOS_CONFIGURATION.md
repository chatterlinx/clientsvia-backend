# WHERE TO CONFIGURE PERSONALITY SCENARIOS

## 🎯 **Location in Admin Dashboard**

Navigate to: **Company Profile → Agent Personality Responses tab**

## 📋 **Available Personality Response Categories**

You can customize responses for these scenarios in the Admin UI:

### **Core Response Categories:**
1. **`cantUnderstand`** - When agent doesn't understand customer
2. **`speakClearly`** - When speech is unclear  
3. **`frustratedCaller`** - When customer is frustrated/annoyed
4. **`transferToRep`** - When transferring to human agent
5. **`connectionTrouble`** - For call quality issues
6. **`businessHours`** - Hours of operation responses
7. **`outOfCategory`** - For requests outside service scope

### **Engagement Categories:**
8. **`lightHumor`** - Professional humor responses
9. **`customerJoke`** - Responding to customer jokes
10. **`complimentResponse`** - Handling customer compliments
11. **`empathyResponse`** - Empathetic responses for problems
12. **`casualGreeting`** - Friendly greeting variations
13. **`weatherSmallTalk`** - Weather-related small talk

## 🔧 **How Personality Scenarios Work**

When customer says something like:
- **"You're repeating the same things"** → Uses `frustratedCaller` responses
- **"I'm frustrated"** → Uses `frustratedCaller` responses  
- **"Thank you"** → Uses `complimentResponse` responses
- **"Can you hear me?"** → Uses `connectionTrouble` responses
- **"I'm confused"** → Uses `cantUnderstand` responses

## 📝 **How to Customize:**

1. **Go to Company Profile**
2. **Click "Agent Personality Responses" tab**
3. **Find the category you want to customize**
4. **Add multiple response variations** (agent will pick randomly)
5. **Save changes**

## 🎯 **Example Customization:**

For `frustratedCaller` category, you could add:
```
"I completely understand your frustration. Let me get this sorted out for you right away."
"I hear you - that's definitely not the experience we want you to have. Let me fix this."
"I'm sorry this has been frustrating. Let me connect you with someone who can resolve this immediately."
```

## 💡 **Pro Tips:**

- **Add 3-5 variations** per category for natural conversation
- **Keep responses concise** but empathetic  
- **Match your company's tone** (professional, friendly, casual)
- **Test different scenarios** to see which responses trigger

---

**The agent will automatically use these customized responses when it detects the matching scenario in customer speech.**
