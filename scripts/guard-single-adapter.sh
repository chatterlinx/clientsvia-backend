#!/usr/bin/env bash
set -euo pipefail

# Allowlist: adminNotifications test-sms endpoint can call Twilio directly (diagnostic),
# and AdminNotificationService may import providers internally.
ALLOWLIST='(routes/admin/adminNotifications\.js:.*test-sms|services/AdminNotificationService\.js)'

echo "🔎 SINGLE-ADAPTER SCAN"
# Find direct provider sends outside the adapter
VIOLATIONS=$(rg -nI --no-heading -S \
    "(twilio\.|SendGrid|sgMail\.send|nodemailer\.createTransport|transporter\.sendMail)" \
    routes/ services/ public/ \
  | rg -v "$ALLOWLIST" || true)

if [[ -n "$VIOLATIONS" ]]; then
  echo "❌ Found NON-CANONICAL provider sends outside AdminNotificationService:"
  echo "$VIOLATIONS"
  exit 1
else
  echo "✅ No direct provider sends outside the canonical adapter"
fi

