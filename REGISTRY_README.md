# Alert Registry — Confirmation List

Purpose
- Inventory of every notification emit point (where code can send an alert)
- Drives the Alert Registry UI and Validate All

How a point is registered
- Any call to AdminNotificationService.sendAlert(code=...) auto-registers or updates a registry record with:
  - code, severity, location (file:line or route), feature, tab, module
  - validation state and basic stats

IDs and naming
- Registry id: <TAB>.<MODULE>.<ACTION> (dot notation)
- errorCode: <TAB>_<MODULE>_<ACTION>_<CAUSE> (snake)
- tab must match the UI tab key in the dashboard (e.g., NOTIFICATION_CENTER, DATA_CENTER, CALL_ARCHIVES)

Validity rules (what turns a point green)
- The code is reachable and was observed at least once in the last 24h
- Company context is valid (tenant exists when required)
- Notification Settings are complete (Twilio creds, admin contacts)
- Escalation engine is responsive

Validate All button
- Runs backend validations for every registry record
- Marks each entry Valid/Invalid with last-seen timestamp and any configuration gaps

Non-canonical emitters
- Direct Twilio/email/webhook sends must be flagged as NON_CANONICAL
- Migrate them to AdminNotificationService.sendAlert so registry, logs, and escalation remain consistent
