#!/bin/bash

# Script to remove Google TTS references from Twilio routes safely

# Remove Google voice variable declarations and assignments
sed -i '' 's/let voice = company.*googleVoice.*//' routes/twilio.js
sed -i '' 's/: `Google\..*`//' routes/twilio.js  
sed -i '' 's/voice = company.*googleVoice.*//' routes/twilio.js
sed -i '' 's/: voice//' routes/twilio.js

# Remove voice parameter from twiml.say calls
sed -i '' 's/{ voice }//' routes/twilio.js
sed -i '' 's/{ voice: [^}]*}//' routes/twilio.js

# Remove voice property from context
sed -i '' '/voice: voice,/d' routes/twilio.js

# Update log messages
sed -i '' 's/falling back to Google TTS/using basic TTS fallback/g' routes/twilio.js
sed -i '' 's/Using Google TTS/Using basic TTS/g' routes/twilio.js

echo "Cleanup completed"
