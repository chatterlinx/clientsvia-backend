#!/bin/bash

# 🚀 Deploy Script for clientsvia-backend
# This script checks deployment readiness and provides deployment steps

echo "🔍 Checking deployment readiness..."

# Check if all files are committed
if [ -n "$(git status --porcelain)" ]; then
    echo "❌ You have uncommitted changes. Please commit all changes first."
    git status --short
    exit 1
fi

echo "✅ All files are committed"

# Check if .env file exists (for local testing)
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Make sure to set environment variables in your deployment platform."
fi

# Check package.json
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found"
    exit 1
fi

echo "✅ package.json found"

# Check main entry points
if [ ! -f "server.js" ]; then
    echo "❌ server.js not found"
    exit 1
fi

if [ ! -f "index.js" ]; then
    echo "❌ index.js not found"
    exit 1
fi

echo "✅ Entry points (server.js, index.js) found"

# Count files
file_count=$(find . -name "*.js" -o -name "*.html" -o -name "*.json" | wc -l)
echo "✅ $file_count application files ready for deployment"

echo ""
echo "🚀 DEPLOYMENT READY!"
echo ""
echo "📋 Next Steps:"
echo "1. Go to https://render.com"
echo "2. Sign in with GitHub"
echo "3. Click 'New +' > 'Web Service'"
echo "4. Connect repository: chatterlinx/clientsvia-backend"
echo "5. Use these settings:"
echo "   - Name: clientsvia-backend"
echo "   - Environment: Node"
echo "   - Build Command: npm install"
echo "   - Start Command: npm start"
echo "   - Instance Type: Starter (Free)"
echo ""
echo "6. Add Environment Variables:"
echo "   - Copy from your .env file"
echo "   - Include: MONGODB_URI, REDIS_URL, etc."
echo ""
echo "7. Click 'Create Web Service'"
echo ""
echo "🎉 Your app will be live at: https://clientsvia-backend.onrender.com"
