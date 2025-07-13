# 🔗 Twilio Webhook Configuration

This document provides all the webhook URLs and configuration details for integrating Twilio with the ClientsVia backend.

## 🌐 Base URL
```
https://clientsvia-backend.onrender.com
```

## 📞 Available Webhook Endpoints

### 1. **Voice Webhook (Primary)**
**URL:** `https://clientsvia-backend.onrender.com/api/twilio/voice`
**Method:** POST
**Purpose:** Main webhook for incoming voice calls
**Configure in:** Twilio Console → Phone Numbers → Voice Configuration

### 2. **Speech Recognition Webhook**
**URL:** `https://clientsvia-backend.onrender.com/api/twilio/handle-speech`
**Method:** POST
**Purpose:** AI speech processing and response generation
**Used by:** Internal call flow for voice recognition

### 3. **Partial Speech Webhook**
**URL:** `https://clientsvia-backend.onrender.com/api/twilio/partial-speech`
**Method:** POST
**Purpose:** Real-time speech processing for advanced features
**Used by:** Streaming speech recognition

### 4. **Speech Timing Test**
**URL:** `https://clientsvia-backend.onrender.com/api/twilio/speech-timing-test`
**Method:** POST
**Purpose:** Performance testing and latency measurement
**Used by:** Development and optimization

## ⚙️ Twilio Console Configuration

### Step-by-Step Setup:

1. **Login to Twilio Console**
   - Go to [https://console.twilio.com](https://console.twilio.com)
   - Sign in with your Twilio credentials

2. **Navigate to Phone Numbers**
   - Click on "Phone Numbers" in the left sidebar
   - Select "Manage" → "Active Numbers"

3. **Configure Your Phone Number**
   - Click on the phone number you want to configure
   - In the "Voice Configuration" section:
     - **Webhook URL:** `https://clientsvia-backend.onrender.com/api/twilio/voice`
     - **HTTP Method:** POST
     - **Primary Handler:** Webhooks

4. **Save Configuration**
   - Click "Save Configuration" at the bottom of the page

## 🔧 Testing Webhooks

### Voice Webhook Test:
```bash
curl -X POST https://clientsvia-backend.onrender.com/api/twilio/voice \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "Called=%2B12395551212&Caller=%2B15551234567&CallSid=test123"
```

### Expected Response:
The webhook should return TwiML XML response for call handling.

## 🏢 Multi-Company Support

The webhook system automatically:
- Identifies the company based on the called phone number
- Loads company-specific AI settings and configurations
- Applies the appropriate agent personality and knowledge base
- Routes calls according to business hours and availability

## 🔒 Security Notes

- All webhooks use HTTPS encryption
- Twilio request validation can be enabled for additional security
- Phone number lookup uses caching for performance
- Company data is cached for fast retrieval

## 📋 Configuration UI

Webhook URLs are also available in the application:
1. Go to **Configuration** tab in the company profile
2. Click "Show Webhook URLs" in the Twilio section
3. Copy URLs directly from the interface
4. Follow the built-in setup instructions

## 🚨 Troubleshooting

### Common Issues:

1. **Webhook Not Responding**
   - Verify the URL is correct
   - Check that the method is set to POST
   - Ensure the phone number is properly configured in the system

2. **Company Not Found**
   - Verify the phone number is added to a company profile
   - Check the phone number format (E.164 standard)
   - Ensure the company is active in the system

3. **AI Not Responding**
   - Check that AI settings are configured for the company
   - Verify API keys (ElevenLabs, OpenAI, etc.) are valid
   - Review logs for specific error messages

## 📞 Support

For webhook configuration support:
- Check the Configuration tab in the company profile
- Review server logs for detailed error information
- Contact support with specific error messages and phone numbers

---

*Last Updated: July 13, 2025*
*Platform: ClientsVia Backend v3.0*
