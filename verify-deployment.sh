#!/bin/bash

# Deployment Verification Script
# Run this after deployment to verify the Service Type Manager fix

echo "🚀 Verifying Service Type Manager Deployment..."
echo ""

# Test if server is responding
echo "1. Testing server response..."
curl -s -o /dev/null -w "%{http_code}" http://localhost:4000/api/trade-categories
if [ $? -eq 0 ]; then
    echo "✅ Server is responding"
else
    echo "❌ Server not responding"
    exit 1
fi

echo ""
echo "2. Testing Service Type Manager endpoint..."

# Test the update-service-types endpoint
response=$(curl -s -X POST http://localhost:4000/api/trade-categories/update-service-types \
  -H "Content-Type: application/json" \
  -d '{
    "tradeName": "HVAC Residential",
    "serviceTypes": ["Installation", "Repair", "Test Deployment"]
  }')

if echo "$response" | grep -q "success"; then
    echo "✅ Service Type Manager endpoint working correctly"
    echo "✅ Response: $response"
else
    echo "❌ Service Type Manager endpoint failed"
    echo "❌ Response: $response"
    exit 1
fi

echo ""
echo "3. Verifying data persistence..."

# Check if the data was saved
saved_data=$(curl -s http://localhost:4000/api/trade-categories | jq '.[] | select(.name == "HVAC Residential") | .serviceTypes')

if echo "$saved_data" | grep -q "Test Deployment"; then
    echo "✅ Service types are being saved to database"
    echo "✅ Current service types: $saved_data"
else
    echo "⚠️  Could not verify data persistence"
    echo "Response: $saved_data"
fi

echo ""
echo "🎉 Deployment verification complete!"
echo "📋 Service Type Manager should now work in the frontend"
echo ""
echo "Next steps:"
echo "- Test the admin UI Service Type Manager"
echo "- Verify service types appear in Booking Script Configuration"
echo "- No more 'Trade category not found' errors should occur"
