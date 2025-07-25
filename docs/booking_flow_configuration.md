# Booking Flow Configuration

## Overview

The Booking Flow Configuration allows companies to define a structured conversation flow for collecting customer information during booking appointments. This feature creates a guided, step-by-step process that the AI agent follows when a customer wants to schedule a service.

## How It Works

### 1. **Configuration Process**
- Companies configure a series of prompts and field names through the admin interface
- Each field represents one step in the booking conversation
- Fields are executed in the order they're arranged (numbered 1, 2, 3, etc.)

### 2. **Conversation Flow**
When a customer indicates they want to book an appointment, the AI agent:
1. Starts with the first configured field
2. Asks the customer the defined prompt
3. Waits for the customer's response
4. Stores the response in the specified field name
5. Moves to the next field
6. Repeats until all fields are collected

### 3. **Example Configuration**

| Order | Prompt | Field Name | Customer Response |
|-------|--------|------------|------------------|
| 1 | "What type of service are you looking for today?" | serviceType | "AC repair" |
| 2 | "Great! What is the full service address?" | address | "123 Main St, Phoenix AZ" |
| 3 | "What's the best phone number to reach you?" | phoneNumber | "(555) 123-4567" |
| 4 | "What email should we use for confirmations?" | email | "john@email.com" |

### 4. **AI Agent Conversation Example**

```
Agent: Hi! I can help you schedule an appointment. What type of service are you looking for today?
Customer: I need my AC repaired, it's not cooling properly.
Agent: Great! What is the full service address?
Customer: 123 Main Street, Phoenix, Arizona 85001
Agent: Perfect. What's the best phone number to reach you?
Customer: 555-123-4567
Agent: And what email should we use for booking confirmations?
Customer: john.doe@email.com
Agent: Excellent! I have all your information. Let me connect you with our scheduling team to find the best time for your AC repair at 123 Main Street.
```

## Configuration Features

### **Field Management**
- **Add Fields**: Create new conversation steps with custom prompts
- **Reorder Fields**: Use up/down arrows to change the conversation sequence
- **Delete Fields**: Remove unnecessary steps from the flow
- **Field Validation**: Prevents duplicate field names

### **User Experience Features**
- **Visual Feedback**: Real-time validation and error highlighting
- **Keyboard Support**: 
  - Enter key moves from prompt to field name
  - Enter key in field name adds the field
- **Empty State Guidance**: Clear instructions when no fields are configured
- **Responsive Design**: Works on all device sizes

## Technical Implementation

### **Frontend**
- Located in: `public/company-profile.html` (Booking Flow Configuration section)
- JavaScript: `public/js/company-profile.js` (booking flow functions)
- Data is loaded automatically when the page initializes
- Real-time table updates as fields are added/removed/reordered

### **Backend**
- API Endpoints in: `routes/company.js`
  - `GET /api/company/companies/:companyId/booking-flow` - Load configuration
  - `POST /api/company/companies/:companyId/booking-flow` - Save configuration
- Data stored in MongoDB `companies` collection under `bookingFlow` field
- Includes validation for required fields and data types

### **Data Structure**
```javascript
{
  bookingFlow: [
    {
      id: 1640995200000,
      prompt: "What type of service are you looking for today?",
      name: "serviceType",
      order: 0
    },
    {
      id: 1640995201000,
      prompt: "Great! What is the full service address?", 
      name: "address",
      order: 1
    }
  ]
}
```

## Default Configuration

When no custom booking flow is configured, the system provides these default fields:

1. **Service Type**: "What type of service are you looking for today?"
2. **Address**: "Great! What is the full service address?"
3. **Phone Number**: "And what's the best phone number to reach you?"
4. **Email**: "What email should we use for booking confirmations?"

## Best Practices

### **Effective Prompts**
- Use conversational, friendly language
- Be specific about what information you need
- Include examples when helpful ("e.g., 123 Main St, Phoenix AZ")
- Use transitional words to maintain flow ("Great!", "Perfect!", "And...")

### **Field Naming**
- Use descriptive, lowercase field names
- Use camelCase for multi-word fields (`phoneNumber`, `serviceType`)
- Avoid spaces or special characters
- Keep names consistent with your data system

### **Flow Organization**
- Start with the most important information (service type)
- Follow with location details (address)
- End with contact information (phone, email)
- Keep the flow logical and conversational

## Integration with AI Agent

The booking flow integrates seamlessly with the AI agent system:

1. **Intent Recognition**: Agent detects booking intent from customer messages
2. **Flow Activation**: Booking flow is initiated automatically
3. **Data Collection**: Each field is collected in sequence
4. **Storage**: Information is stored for scheduling team follow-up
5. **Handoff**: Complete booking data is passed to human schedulers

This creates a smooth, professional booking experience that captures all necessary information while maintaining a natural conversation flow.
