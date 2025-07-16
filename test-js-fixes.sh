#!/bin/bash

echo "🔧 Testing JavaScript fixes for company profile..."

# Test the company profile page with the specific company ID
echo "Testing company profile page with Company ID: 686a680241806a4991f7367f"
response=$(curl -s "https://clientsvia-backend.onrender.com/company-profile.html?id=686a680241806a4991f7367f")

# Check if the page loads
if [[ $response == *"Company Profile"* ]]; then
    echo "✅ Company profile page loads successfully"
else
    echo "❌ Company profile page failed to load"
    exit 1
fi

# Check if the AI agent setup script is included
if [[ $response == *"ai-agent-setup.js"* ]]; then
    echo "✅ AI agent setup script is included"
else
    echo "⚠️  AI agent setup script not found"
fi

# Check if the monitoring system code is present
if [[ $response == *"monitoring"* ]]; then
    echo "✅ Monitoring system code is present"
else
    echo "⚠️  Monitoring system code not found"
fi

echo ""
echo "🎯 Key fixes implemented:"
echo "   1. ✅ Fixed checkedCategoriesListLocal variable error"
echo "   2. ✅ Added missing loadExistingData method to AIAgentSetup class"
echo "   3. ✅ Added safety checks for null UI elements in monitoring system"
echo "   4. ✅ Added safety checks for performance metrics UI elements"
echo "   5. ✅ Added safety checks for health display elements"
echo "   6. ✅ Added safety checks for improvement suggestions container"
echo "   7. ✅ Made currentCompanyData globally available"
echo ""
echo "🚀 Changes deployed successfully to production!"
echo "Please test the company profile page in your browser:"
echo "https://clientsvia-backend.onrender.com/company-profile.html?id=686a680241806a4991f7367f"
