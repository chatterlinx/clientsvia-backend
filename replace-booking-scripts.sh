#!/bin/bash
# replace-booking-scripts.sh
# Shell script to replace existing booking scripts with improved versions

echo "🚀 Replacing booking scripts for Penguin Air..."

COMPANY_ID="686a680241806a4991f7367f"
BASE_URL="http://localhost:4000/api/booking-scripts"

echo "🗑️  Deleting existing booking scripts..."

# Delete existing scripts
curl -X DELETE "$BASE_URL/$COMPANY_ID/HVAC/Repair" 2>/dev/null
curl -X DELETE "$BASE_URL/$COMPANY_ID/HVAC/Maintenance" 2>/dev/null  
curl -X DELETE "$BASE_URL/$COMPANY_ID/Plumbing/Emergency" 2>/dev/null

echo "✅ Existing scripts deleted"
echo ""
echo "📝 Adding improved booking scripts..."

# Add HVAC Repair (7 steps)
echo "Adding HVAC - Repair..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "'$COMPANY_ID'",
    "tradeType": "HVAC",
    "serviceType": "Repair",
    "script": [
      "Hi! I understand you need HVAC repair service. Is this for your home or a business location?",
      "What specific issue are you experiencing with your HVAC system? For example, no heating, no cooling, strange noises, or something else?",
      "I can definitely help you get this resolved. What'\''s the full address where the service is needed?",
      "Is this an urgent repair that needs immediate attention, or can we schedule it for a convenient time?",
      "What day works best for you? We have availability throughout the week.",
      "Would you prefer a morning appointment (8 AM - 12 PM) or afternoon slot (1 PM - 5 PM)?",
      "Perfect! I have you scheduled for HVAC repair service. You'\''ll receive a confirmation text with the technician'\''s details and arrival window. Is there anything else I can help you with today?"
    ]
  }' 2>/dev/null && echo " ✅"

# Add HVAC Maintenance
echo "Adding HVAC - Maintenance..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "'$COMPANY_ID'",
    "tradeType": "HVAC", 
    "serviceType": "Maintenance",
    "script": [
      "Hello! I see you'\''re calling about HVAC maintenance. Is this for your seasonal tune-up service?",
      "That'\''s great! Regular maintenance keeps your system running efficiently. Is this for your home or business?",
      "What'\''s the address where we'\''ll be providing the maintenance service?",
      "When was your system last serviced? This helps our technician prepare the right tools and parts.",
      "We have several time slots available this week. What day works best for your schedule?",
      "Would you prefer a morning visit (8 AM - 12 PM) or afternoon (1 PM - 5 PM)?",
      "Excellent! Your HVAC maintenance is scheduled. We'\''ll send you a confirmation with all the details. Our technician will perform a complete system check and tune-up."
    ]
  }' 2>/dev/null && echo " ✅"

# Add HVAC Installation
echo "Adding HVAC - Installation..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "'$COMPANY_ID'",
    "tradeType": "HVAC",
    "serviceType": "Installation",
    "script": [
      "Hi there! I understand you'\''re interested in HVAC installation. What type of system are you looking to install?",
      "Is this for a new construction project, replacing an existing system, or adding HVAC to a space that doesn'\''t currently have it?",
      "What'\''s the address where the installation will take place?",
      "What'\''s the approximate square footage of the area that needs heating and cooling?",
      "Would you like to schedule a free consultation? Our technician can assess your space and provide recommendations and pricing.",
      "When would be convenient for the consultation visit? We can usually schedule within 2-3 business days.",
      "Perfect! I'\''ve scheduled your HVAC installation consultation. Our expert will evaluate your needs and provide a detailed proposal. You'\''ll receive confirmation details shortly."
    ]
  }' 2>/dev/null && echo " ✅"

# Add Plumbing Emergency
echo "Adding Plumbing - Emergency..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "'$COMPANY_ID'",
    "tradeType": "Plumbing",
    "serviceType": "Emergency",
    "script": [
      "This is an emergency plumbing line. What'\''s the urgent plumbing issue you'\''re experiencing right now?",
      "Is there any active water damage, flooding, or risk to your property that I should know about?",
      "For safety, if there'\''s flooding, please turn off electricity to affected areas. Do you know where your main water shutoff valve is located?",
      "I need your address to dispatch our emergency plumber immediately. Where are you located?",
      "Our emergency plumber is being dispatched now and will arrive within 60-90 minutes. They'\''ll call you when they'\''re en route. Please stay safe and keep the area clear."
    ]
  }' 2>/dev/null && echo " ✅"

# Add Plumbing Repair
echo "Adding Plumbing - Repair..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "'$COMPANY_ID'",
    "tradeType": "Plumbing",
    "serviceType": "Repair",
    "script": [
      "Hi! I can help you with your plumbing repair needs. What plumbing issue are you experiencing?",
      "Is this affecting your daily routine significantly, or is it something that can wait a day or two?",
      "What'\''s the address where the plumbing repair is needed?",
      "Is this for a home or business location?",
      "When would be the most convenient time for our plumber to visit? We have openings throughout the week.",
      "Would a morning appointment (8 AM - 12 PM) or afternoon slot (1 PM - 5 PM) work better for you?",
      "Great! I have your plumbing repair scheduled. Our licensed plumber will diagnose the issue and provide upfront pricing before starting any work. You'\''ll get a confirmation text soon."
    ]
  }' 2>/dev/null && echo " ✅"

# Add Plumbing Installation
echo "Adding Plumbing - Installation..."
curl -X POST "$BASE_URL" \
  -H "Content-Type: application/json" \
  -d '{
    "companyId": "'$COMPANY_ID'",
    "tradeType": "Plumbing", 
    "serviceType": "Installation",
    "script": [
      "Hello! I see you need plumbing installation service. What type of plumbing installation are you looking for?",
      "Is this part of a renovation project, new construction, or replacing existing fixtures?",
      "What'\''s the address where the installation will take place?",
      "Do you already have the fixtures/materials, or would you like our plumber to provide recommendations and supply them?",
      "When would you like to schedule this installation? Some installations may require permits or multiple visits.",
      "Would you prefer a morning (8 AM - 12 PM) or afternoon appointment (1 PM - 5 PM)?",
      "Perfect! I have your plumbing installation scheduled. Our licensed plumber will assess the work needed and provide a detailed quote. You'\''ll receive confirmation details shortly."
    ]
  }' 2>/dev/null && echo " ✅"

echo ""
echo "🎉 All booking scripts have been replaced with improved versions!"
echo ""
echo "📋 New booking flows added:"
echo "   • HVAC - Repair (7 steps)"
echo "   • HVAC - Maintenance (7 steps)" 
echo "   • HVAC - Installation (7 steps)"
echo "   • Plumbing - Emergency (5 steps)"
echo "   • Plumbing - Repair (7 steps)"
echo "   • Plumbing - Installation (7 steps)"
echo ""
echo "🧪 Test the new flows with:"
echo "   curl 'http://localhost:4000/api/booking-handler/flow/$COMPANY_ID/HVAC/Repair'"
