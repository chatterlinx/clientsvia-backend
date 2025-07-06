# Troubleshooting Scheduling Questions

Use this procedure when customers say they want the soonest appointment but the AI does not respond correctly.

1. **Check SpeechResult in the logs.** If the logged value does not match what the caller said, the issue is speech-to-text (Twilio quality or phone connection).
2. **If SpeechResult is accurate**, expand the relevant Q&A entry in the company knowledge base. Add keywords covering common phrases such as:
   - `soonest`
   - `first available`
   - `earliest`
   - `schedule`
3. **Retest the call** and verify that the logs show a match for the updated keywords.
